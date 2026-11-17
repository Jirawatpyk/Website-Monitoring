-- S13 (D-067): an incident open for an SSL / domain expiry takes a more urgent PROBLEM as its new
-- cause. A site has one open incident (incidents_one_open_per_site), and an expiry PROBLEM can stay
-- open for weeks while the certificate waits for its renewal; without this a defacement keyword, a
-- redirect or a key page failing on that site would only change monitor_status (engine review S13 H1).
--
-- The incident's trigger and monitor switch to the new cause, the state is kept (the ladder carries
-- on: an acknowledged incident stays acknowledged, its acker is the one mentioned), and the thread gets
-- one `problem_new_cause` reply @mentioning whoever acts now, with an email to L0 after the D-047 grace.

create function public.engine_new_cause_incident(
  p_incident_id uuid,
  p_monitor_id uuid,
  p_trigger public.incident_trigger,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean,
  p_monitors jsonb default null,
  p_status public.site_state default null,
  p_hold_until timestamptz default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_was public.incident_trigger;
  v_state public.incident_state;
  v_hold timestamptz := case when p_hold_until > now() then p_hold_until end;
  v_key text := to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  -- Only an open, unrecovered PROBLEM drop opened for an expiry, and only for a cause that isn't one.
  select site_id, trigger, state into v_site_id, v_was, v_state
  from public.incidents
  where id = p_incident_id
    and trigger in ('ssl', 'domain')
    and p_trigger not in ('ssl', 'domain')
    and coalesce(episode_severity, severity) = 'problem'
    and state in ('unacked', 'escalated', 'acknowledged')
  for update;

  if v_site_id is null then
    return false;
  end if;

  update public.incidents
    set trigger = p_trigger,
        monitor_id = coalesce(p_monitor_id, monitor_id)
    where id = p_incident_id;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'new_cause',
          coalesce(p_context, '{}') || jsonb_build_object('trigger', p_trigger, 'was', v_was),
          p_round_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.new_cause', 'incident', p_incident_id,
          jsonb_build_object('trigger', v_was, 'state', v_state),
          jsonb_build_object('trigger', p_trigger, 'state', v_state));

  if p_notify then
    -- The thread's first card may still be held for response hours (an SSL PROBLEM at night): it goes
    -- no later than this reply, or the reply would wait behind it (claim_notifications keeps order).
    update public.notifications
      set hold_until = coalesce(v_hold, now())
      where incident_id = p_incident_id and template = 'problem' and status = 'queued'
        and hold_until > coalesce(v_hold, now());

    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key, hold_until)
    values (p_incident_id, 'google_chat', 'problem_new_cause', p_incident_id::text,
            coalesce(p_context, '{}') || jsonb_build_object('trigger', p_trigger, 'was', v_was),
            v_key, v_hold)
    on conflict do nothing;

    perform public.engine_queue_l0_emails(
      p_incident_id, 'problem_new_cause',
      coalesce(p_context, '{}') || jsonb_build_object('trigger', p_trigger, 'was', v_was),
      greatest(v_hold, now() + interval '5 minutes'), v_key, false);
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

revoke execute on function public.engine_new_cause_incident(uuid, uuid, public.incident_trigger,
  timestamptz, jsonb, boolean, jsonb, public.site_state, timestamptz)
  from public, anon, authenticated;
grant execute on function public.engine_new_cause_incident(uuid, uuid, public.incident_trigger,
  timestamptz, jsonb, boolean, jsonb, public.site_state, timestamptz)
  to service_role;
