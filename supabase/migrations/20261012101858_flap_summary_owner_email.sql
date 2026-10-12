-- D-039 (12 Oct 2026, code review of #83): a flapping run's summary emails the owner whenever they were
-- emailed about the incident — D-038 limited it to people emailed since the latest relapse, so the
-- owner's email thread ended on the first PROBLEM. RECOVERED after a PROBLEM relapse stays Chat only.

-- D-038 body (20261012044122), the flap summary's owner condition only.
create or replace function public.engine_recover_incident(
  p_incident_id uuid,
  p_from public.incident_state,
  p_to public.incident_state,
  p_recovered_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean,
  p_monitors jsonb default null,
  p_status public.site_state default null,
  p_flip_ok boolean default null,
  p_auto_resolve boolean default false,
  p_hold_summary boolean default false
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_notify boolean;
  v_since timestamptz;
  -- The round in UTC, whatever the session's TimeZone / DateStyle: overlapping callers agree.
  v_key text := to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  -- Auto-resolve only for a PROBLEM nobody acknowledged (spec §16.1); DOWN never auto-resolves.
  if p_auto_resolve and p_to <> 'resolved' then
    raise exception 'auto-resolve must go to resolved';
  end if;

  -- D-038: a PROBLEM drop after a relapse emails RECOVERED only to whoever was emailed about that
  -- drop (a fallback for a failed PROBLEM AGAIN card, an escalation step) — its PROBLEM AGAIN was a
  -- Chat reply, and a RECOVERED email per cycle flooded owners while a site flapped. The first drop
  -- and any DOWN drop still email everyone already emailed (S02b).
  -- The drop began when the latest relapse was recorded: its audit row's time is that transaction's
  -- clock, always written (muted or not) and always after the previous drop's RECOVERED was queued —
  -- the event's `at` is the round's start, which can come before it.
  select (select max(a.at) from public.audit_log a
          where a.entity = 'incident' and a.entity_id = i.id and a.action = 'incident.relapsed')
    into v_since
  from public.incidents i
  where i.id = p_incident_id and i.episode_severity = 'problem';

  update public.incidents
    set state = p_to,
        recovered_at = p_recovered_at,
        resolved_at = case when p_auto_resolve then p_recovered_at else resolved_at end,
        auto_resolved = auto_resolved or p_auto_resolve
    where id = p_incident_id and state = p_from
      and (not p_auto_resolve or (severity = 'problem' and acked_at is null))
    returning site_id into v_site_id;

  if v_site_id is null then
    return false;
  end if;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'recovered', p_context, p_recovered_at);
  if p_auto_resolve then
    insert into public.incident_events (incident_id, type, payload, at)
    values (p_incident_id, 'auto_resolved', jsonb_build_object('state', p_to), p_recovered_at);
  end if;

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.recovered', 'incident', p_incident_id,
          jsonb_build_object('state', p_from),
          jsonb_build_object('state', p_to, 'recovered_at', p_recovered_at,
                             'auto_resolved', p_auto_resolve));

  update public.site_status
    set ok_rounds = 1, last_evaluated_at = p_recovered_at, last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  if p_flip_ok then
    perform public.engine_record_flip(v_site_id, p_round_at, true);
  end if;

  update public.notifications n
    set status = 'cancelled', error = 'Superseded: recovered first', next_retry_at = null
    where n.incident_id = p_incident_id and n.channel = 'google_chat'
      and n.template in ('down', 'problem', 'down_again', 'problem_again')
      and n.status = 'queued' and n.attempts > 0
      -- waiting for a retry, not in flight: every attempt it was claimed for is logged
      and n.attempts = (select count(*) from public.notification_attempts a where a.notification_id = n.id);

  perform public.engine_cancel_held_problem(p_incident_id, 'Superseded: recovered before response hours');
  perform public.engine_cancel_ladder(p_incident_id, 'Superseded: recovered first');

  -- Nothing to follow up when the thread never got an alert: one went (or is going), or was tried and
  -- set aside for a retry above — a held card cancelled before its hour never was (§19.6).
  v_notify := p_notify and exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat'
      and template in ('down', 'problem', 'down_again', 'problem_again')
      and (status <> 'cancelled' or attempts > 0));

  if v_notify and p_hold_summary then
    insert into public.notifications
      (incident_id, channel, template, thread_key, context, dedupe_key, hold_until)
    values (p_incident_id, 'google_chat', 'flap_summary', p_incident_id::text, p_context, v_key,
            p_recovered_at + interval '15 minutes')
    on conflict do nothing;

    insert into public.notifications
      (incident_id, user_id, channel, template, thread_key, context, dedupe_key, hold_until)
    select p_incident_id, s.primary_owner_id, 'email', 'flap_summary', p_incident_id::text,
           p_context, v_key, p_recovered_at + interval '15 minutes'
    from public.sites s
    join public.profiles p on p.id = s.primary_owner_id and p.is_active
    where s.id = v_site_id
      -- D-039: one summary per flapping run, to an owner emailed about the incident at all — the
      -- email thread would otherwise end on the first PROBLEM.
      and (v_since is null or exists (
        select 1 from public.notifications e
        where e.incident_id = p_incident_id and e.channel = 'email' and e.status <> 'cancelled'
          and e.user_id = s.primary_owner_id))
    on conflict do nothing;
  elsif v_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
    values (p_incident_id, 'google_chat', 'recovered', p_incident_id::text, p_context, v_key)
    on conflict do nothing;

    insert into public.notifications
      (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
    select distinct p_incident_id, n.user_id, 'email'::public.notification_channel, 'recovered',
           p_incident_id::text, p_context, v_key
    from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'email' and n.status <> 'cancelled'
      and n.user_id is not null and (v_since is null or n.created_at >= v_since)
    on conflict do nothing;
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;
