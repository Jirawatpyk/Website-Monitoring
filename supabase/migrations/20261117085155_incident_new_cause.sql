-- S13 (D-067): an incident open for an SSL / domain expiry takes a more urgent PROBLEM as its new
-- cause. A site has one open incident (incidents_one_open_per_site), and an expiry PROBLEM can stay
-- open for weeks while the certificate waits for its renewal; without this a defacement keyword, a
-- redirect or a key page failing on that site would only change monitor_status (engine review S13 H1).
--
-- The incident's trigger and monitor switch to the new cause, the state is kept (the ladder carries
-- on: an acknowledged incident stays acknowledged, its acker is the one mentioned), and the thread gets
-- one reply @mentioning whoever acts now, with an email to L0 after the D-047 grace. Both are
-- `problem_again` rows marked `newCause` in their context (keyed `new_cause:<round>`): every list
-- that cancels, releases, orders or falls back for a PROBLEM AGAIN then covers them too — cancelled on
-- recovery or ack while held, no email once it cleared inside the grace, the fallback email if the
-- reply fails (message-checker S13 H3).

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
  v_key text := 'new_cause:' || to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_ctx jsonb;
begin
  -- Only a plain PROBLEM incident open for an expiry (trigger = the cause it carries now, kept by
  -- every writer: open, PROBLEM AGAIN, new cause, back to it), and only for a cause that isn't one.
  select site_id, trigger, state into v_site_id, v_was, v_state
  from public.incidents
  where id = p_incident_id
    and trigger in ('ssl', 'domain')
    and p_trigger not in ('ssl', 'domain')
    and severity = 'problem'
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

  v_ctx := coalesce(p_context, '{}') || jsonb_build_object('trigger', p_trigger, 'was', v_was, 'newCause', true);

  -- A cause that comes and goes (a key page flipping) is told once per 30 min (engine re-review).
  if p_notify and exists (
    select 1 from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'google_chat' and n.template = 'problem_again'
      and coalesce((n.context ->> 'newCause')::boolean, false) and n.context ->> 'trigger' = p_trigger::text
      and n.status <> 'cancelled' and n.created_at > now() - interval '30 minutes') then
    p_notify := false;
  end if;

  if p_notify then
    -- The thread's first card may still be held for response hours (an SSL PROBLEM at night): it goes
    -- no later than this reply, or the reply would wait behind it (claim_notifications keeps order).
    update public.notifications
      set hold_until = coalesce(v_hold, now())
      where incident_id = p_incident_id and template in ('problem', 'problem_again') and status = 'queued'
        and channel = 'google_chat' and hold_until > coalesce(v_hold, now());

    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key, hold_until)
    values (p_incident_id, 'google_chat', 'problem_again', p_incident_id::text, v_ctx, v_key, v_hold)
    on conflict do nothing;

    perform public.engine_queue_l0_emails(
      p_incident_id, 'problem_again', v_ctx,
      greatest(v_hold, now() + interval '5 minutes'), v_key, false);
  end if;

  -- The site's round moves on with the monitors', as every other incident writer does (engine re-review
  -- H1: otherwise the next run's skew guard skips the site for good).
  update public.site_status
    set ok_rounds = 0, last_evaluated_at = now(), last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

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

-- D-067 item 4: the new cause cleared and the certificate / domain is still under its line — the
-- incident goes back to its expiry, silently: the trigger, a `new_cause` event marked `back` (the
-- timeline's "Back to SSL expiring", and what the reports and replies read the cause from), one audit
-- row, and any new-cause reply or email not sent yet cancelled (a keyword held to 09:00 that cleared at
-- 23:00 must not post).
create function public.engine_cause_back_incident(
  p_incident_id uuid,
  p_monitor_id uuid,
  p_trigger public.incident_trigger,
  p_round_at timestamptz,
  p_context jsonb,
  p_monitors jsonb default null,
  p_status public.site_state default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_was public.incident_trigger;
  v_state public.incident_state;
begin
  select site_id, trigger, state into v_site_id, v_was, v_state
  from public.incidents
  where id = p_incident_id
    and trigger not in ('ssl', 'domain')
    and p_trigger in ('ssl', 'domain')
    and severity = 'problem'
    and coalesce(episode_severity, severity) = 'problem'
    and state in ('unacked', 'escalated', 'acknowledged')
    -- Its newest new_cause / PROBLEM AGAIN is a new cause taken from an expiry (engine re-review H3:
    -- an incident that never had one recovers instead).
    and (select e.type = 'new_cause' and e.payload ->> 'was' in ('ssl', 'domain')
                and not coalesce((e.payload ->> 'back')::boolean, false)
         from public.incident_events e
         where e.incident_id = p_incident_id and e.type in ('new_cause', 'relapsed')
         order by e.at desc, e.id desc limit 1)
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
          coalesce(p_context, '{}') || jsonb_build_object('trigger', p_trigger, 'was', v_was, 'back', true),
          p_round_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.cause_back', 'incident', p_incident_id,
          jsonb_build_object('trigger', v_was, 'state', v_state),
          jsonb_build_object('trigger', p_trigger, 'state', v_state));

  update public.notifications
    set status = 'cancelled', error = 'Superseded: the new cause cleared', next_retry_at = null
    where incident_id = p_incident_id and status = 'queued' and attempts = 0
      and template = 'problem_again' and coalesce((context ->> 'newCause')::boolean, false);

  -- The site's round moves on with the monitors', as every other incident writer does (engine re-review
  -- H1: otherwise the next run's skew guard skips the site for good).
  update public.site_status
    set ok_rounds = 0, last_evaluated_at = now(), last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

revoke execute on function public.engine_cause_back_incident(uuid, uuid, public.incident_trigger,
  timestamptz, jsonb, jsonb, public.site_state)
  from public, anon, authenticated;
grant execute on function public.engine_cause_back_incident(uuid, uuid, public.incident_trigger,
  timestamptz, jsonb, jsonb, public.site_state)
  to service_role;

-- D-067 (engine re-review H2): a PROBLEM AGAIN writes the cause it carries, so a recovered SSL incident
-- that relapses on a keyword isn't read as still open for SSL. As in 20261029144512, plus the trigger.
create or replace function public.engine_relapse_incident(
  p_incident_id uuid,
  p_severity public.severity,
  p_trigger public.incident_trigger,
  p_started_at timestamptz,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_flapping boolean,
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
  v_from public.incident_state;
  v_before public.severity;
  v_to public.incident_state;
  v_after public.severity;
begin
  select site_id, state, severity into v_site_id, v_from, v_before
  from public.incidents
  where id = p_incident_id
    -- A DOWN never relapses a PROBLEM incident: that is engine_escalate_incident (D-021), which
    -- writes the escalated_to_down event (S06 engine-review L2).
    and not (p_severity = 'down' and severity = 'problem')
    and (state in ('monitoring', 'needs_root_cause')
         -- D-023: the DOWN ended, a key page carried on as a PROBLEM, and the home page fails again.
         or (p_severity = 'down' and severity = 'down' and episode_severity = 'problem'
             and state not in ('resolved', 'in_review', 'closed')))
  for update;

  if v_site_id is null then
    return false;
  end if;

  update public.incidents
    set severity = case when p_severity = 'down' then 'down'::public.severity else severity end,
        episode_severity = p_severity,
        -- D-067: the trigger is the cause the incident carries now, and a DOWN AGAIN keeps it (a DOWN by
        -- hand passes 'manual', which the reports read as true of the whole incident).
        -- Only on a PROBLEM incident (engine re-review M2: a DOWN incident keeps hard_fail / manual).
        trigger = case when p_severity = 'problem' and severity = 'problem' then p_trigger else trigger end,
        recovered_at = null,
        is_flapping = is_flapping or coalesce(p_flapping, false),
        state = case when acked_at is not null then 'acknowledged'::public.incident_state
                     -- Escalated only when a step of this severity really paged someone (D-034).
                     when exists (select 1 from public.incident_events e
                                  where e.incident_id = p_incident_id and e.type = 'step_fired'
                                    and e.payload ->> 'severity' = severity::text
                                    and jsonb_array_length(e.payload -> 'notified') > 0)
                       then 'escalated'::public.incident_state
                     else 'unacked'::public.incident_state end
    where id = p_incident_id
    returning state, severity into v_to, v_after;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'relapsed',
          coalesce(p_context, '{}') || jsonb_build_object(
            'severity', p_severity, 'trigger', p_trigger, 'startedAt', p_started_at,
            'flapping', coalesce(p_flapping, false)),
          p_detected_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.relapsed', 'incident', p_incident_id,
          jsonb_build_object('state', v_from, 'severity', v_before),
          jsonb_build_object('state', v_to, 'severity', v_after, 'episode', p_severity));

  update public.site_status
    set ok_rounds = 0, last_evaluated_at = p_detected_at, last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  perform public.engine_record_flip(v_site_id, p_round_at, false);
  perform public.engine_cancel_flap_summary(p_incident_id);

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key, hold_until)
    values (p_incident_id, 'google_chat', p_severity::text || '_again', p_incident_id::text,
            p_context, to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            case when p_severity = 'problem' and p_hold_until > p_detected_at then p_hold_until end)
    on conflict do nothing;

    -- D-047: an L0 person who hasn't been emailed about this incident (every earlier drop came back inside
    -- its grace): this drop's email waits out its own 5 min, as the first alert's did.
    perform public.engine_queue_l0_emails(
      p_incident_id, p_severity::text || '_again', p_context,
      greatest(case when p_severity = 'problem' and p_hold_until > p_detected_at then p_hold_until end,
               now() + interval '5 minutes'),
      to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), true);
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

-- D-067 item 5: the card after a mute is worded with the cause the incident carries then. As in
-- 20261113044845, plus the `new_cause` event.
create or replace function public.engine_post_late_alert(
  p_incident_id uuid, p_at timestamptz, p_hold_until timestamptz default null,
  p_outside_hours boolean default false
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_context jsonb;
  v_hold timestamptz;
  v_sev text;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.state not in ('unacked', 'escalated') then
    return false;
  end if;
  if exists (select 1 from public.sites s where s.id = v_inc.site_id and s.muted_until > p_at) then
    return false;
  end if;
  -- Silent: no alert of its worst severity went (engine review M-A — a PROBLEM AGAIN held back by a
  -- mute on an incident that already alerted DOWN isn't one). The card is for the drop in progress
  -- (D-023: a DOWN whose home page is back is a PROBLEM now).
  if exists (select 1 from public.notifications n
             where n.incident_id = p_incident_id and n.channel = 'google_chat'
               and n.template in (v_inc.severity::text, v_inc.severity::text || '_again',
                                  coalesce(v_inc.episode_severity, v_inc.severity)::text,
                                  coalesce(v_inc.episode_severity, v_inc.severity)::text || '_again')
               and (n.status <> 'cancelled' or n.attempts > 0)) then
    return false;
  end if;
  v_sev := coalesce(v_inc.episode_severity, v_inc.severity)::text;

  -- The facts of the drop it alerts about: its latest detection event's payload — or the cause it
  -- took since (D-067 item 5: one card worded with the cause it carries now, never a card plus a reply).
  select e.payload into v_context from public.incident_events e
  where e.incident_id = p_incident_id and e.type in ('detected', 'relapsed', 'escalated_to_down', 'new_cause')
  order by e.at desc limit 1;
  v_context := coalesce(v_context, '{}'::jsonb) || jsonb_build_object('afterMute', true,
    'heldUntil', (select max(coalesce(mw.ended_at, mw.ends_at)) from public.maintenance_windows mw
                  where mw.site_id = v_inc.site_id and mw.kind = 'mute' and mw.cancelled_at is null
                    and coalesce(mw.ended_at, mw.ends_at) <= p_at
                    and coalesce(mw.ended_at, mw.ends_at) >= v_inc.detected_at));
  v_hold := case when v_sev = 'problem' and p_hold_until > p_at then p_hold_until end;

  insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
  values (p_incident_id, 'google_chat', v_sev, p_incident_id::text, v_context, v_hold);
  -- The ladder clock starts now (alerted_at): L0 pages whoever responds now (S10), then emails them.
  update public.incidents i
    set alerted_at = p_at,
        l0_user_id = case when s.tier = 1 and p_outside_hours then public.oncall_person_at(p_at) end
    from public.sites s
    where i.id = p_incident_id and s.id = i.site_id;
  -- S15: who may acknowledge, and when the ladder counts from, change here (System row).
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  select null, 'incident.alerted', 'incident', p_incident_id,
         jsonb_build_object('alerted_at', v_inc.alerted_at, 'l0_user_id', v_inc.l0_user_id),
         jsonb_build_object('alerted_at', i.alerted_at, 'l0_user_id', i.l0_user_id, 'after_mute', true)
  from public.incidents i where i.id = p_incident_id;
  perform public.engine_queue_l0_emails(p_incident_id, v_sev, v_context,
                                         greatest(v_hold, now() + interval '5 minutes'), null, false); -- D-047
  return true;
end;
$$;

-- D-067 item 3: an incident open only for an SSL / domain expiry (a plain PROBLEM incident whose cause
-- is ssl / domain) doesn't stop a maintenance window or a mute — the engine's `windowHides` is the
-- same rule. As in 20261011082307 otherwise.
create or replace function private.site_busy(p_site_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 'INC-' || lpad(i.number::text, 4, '0') from public.incidents i
      where i.site_id = p_site_id and i.state in ('unacked', 'escalated', 'acknowledged')
        and not (i.severity = 'problem' and coalesce(i.episode_severity, i.severity) = 'problem'
                 and i.trigger in ('ssl', 'domain'))
      limit 1),
    (select 'down' from public.site_status st where st.site_id = p_site_id and st.status = 'down'));
$$;
