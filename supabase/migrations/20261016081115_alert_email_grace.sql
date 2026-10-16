-- D-047 (16 Oct 2026, after INC-0015): a drop that recovers within 5 min sends no email.
-- Google Chat is unchanged. The incident's alert email (the owner's DOWN / PROBLEM, and a relapse's for
-- an owner not emailed yet) waits out a 5-min grace in hold_until (= its queue time + 5 min, which tells
-- it from a longer response-hours hold); a recovery inside it cancels the email, so nobody was emailed
-- and no RECOVERED or RESOLVED email follows. An ack (with its Undo window) or a failed Chat alert
-- (D-016) releases it. Same signatures: grants and comments carry over.

create or replace function public.engine_cancel_held_problem(p_incident_id uuid, p_reason text)
returns integer
language sql
set search_path = ''
as $$
  with c as (
    update public.notifications
      set status = 'cancelled', error = p_reason, next_retry_at = null
      where incident_id = p_incident_id and template in ('problem', 'problem_again')
        and status = 'queued' and attempts = 0 and hold_until > now()
        -- D-047: not an email in its 5-min grace — recovery, ack and fallback handle those.
        and not (channel = 'email' and hold_until <= created_at + interval '5 minutes')
      returning 1
  )
  select count(*)::integer from c;
$$;

create or replace function public.engine_open_incident(
  p_site_id uuid,
  p_monitor_id uuid,
  p_trigger public.incident_trigger,
  p_severity public.severity,
  p_started_at timestamptz,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean,
  p_monitors jsonb default null,
  p_status public.site_state default null,
  p_hold_until timestamptz default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_verify_job uuid := nullif(p_context ->> 'verifyJobId', '')::uuid;
  v_hold timestamptz := case when p_severity = 'problem' and p_hold_until > p_detected_at
                             then p_hold_until end;
begin
  insert into public.incidents (site_id, monitor_id, trigger, severity, episode_severity, started_at,
                                detected_at, escalation_plan)
  select p_site_id, p_monitor_id, p_trigger, p_severity, p_severity, p_started_at, p_detected_at,
         public.escalation_plan_for(s.tier, p_severity)
  from public.sites s where s.id = p_site_id
  on conflict (site_id) where state not in ('resolved', 'in_review', 'closed') do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.incident_events (incident_id, type, payload, at)
  values (v_id, 'detected',
          case when v_hold is null then p_context else p_context || jsonb_build_object('heldUntil', v_hold) end,
          p_detected_at);

  insert into public.audit_log (action, entity, entity_id, after)
  values ('incident.opened', 'incident', v_id,
          jsonb_build_object('state', 'unacked', 'severity', p_severity, 'trigger', p_trigger,
                             'site_id', p_site_id, 'started_at', p_started_at));

  insert into public.site_status as s
    (site_id, status, since, last_evaluated_at, last_round_at, ok_rounds)
  values (p_site_id, p_severity::text::public.site_state, p_started_at, p_detected_at, p_round_at, 0)
  on conflict (site_id) do update
    set status = excluded.status, since = excluded.since,
        last_evaluated_at = excluded.last_evaluated_at, last_round_at = excluded.last_round_at,
        ok_rounds = 0
    where s.last_round_at is null or s.last_round_at <= excluded.last_round_at;

  perform public.engine_record_flip(p_site_id, p_round_at, false);

  if p_trigger = 'hard_fail' then
    -- The browser's verdict links its job; without its screenshot, an evidence job takes one.
    if v_verify_job is not null then
      update public.verification_jobs set incident_id = v_id where id = v_verify_job;
      insert into public.incident_events (incident_id, type, payload, at)
      select v_id, 'evidence',
             jsonb_build_object('screenshotPath', j.screenshot_path, 'result', j.result, 'jobId', j.id),
             coalesce(j.completed_at, p_detected_at)
      from public.verification_jobs j
      where j.id = v_verify_job and j.screenshot_path is not null;
    end if;
    if not exists (select 1 from public.incident_events e where e.incident_id = v_id and e.type = 'evidence') then
      insert into public.verification_jobs (kind, monitor_id, site_id, incident_id, url)
      select 'evidence', m.id, p_site_id, v_id, m.url
      from public.monitors m where m.id = p_monitor_id
      on conflict do nothing;
    end if;
  end if;

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
    values (v_id, 'google_chat', p_severity::text, v_id::text, p_context, v_hold);

    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, hold_until)
    -- D-047: the email waits 5 min — a drop that recovers inside it sends no email at all.
    select v_id, s.primary_owner_id, 'email', p_severity::text, v_id::text, p_context,
           greatest(v_hold, now() + interval '5 minutes')
    from public.sites s
    join public.profiles p on p.id = s.primary_owner_id and p.is_active
    where s.id = p_site_id;
  end if;

  perform public.engine_write_monitors(p_site_id, p_round_at, p_monitors, p_status);
  return v_id;
end;
$$;

create or replace function public.engine_escalate_incident(
  p_incident_id uuid,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean,
  p_monitors jsonb default null,
  p_status public.site_state default null,
  p_flapping boolean default false
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_from public.incident_state;
  v_to public.incident_state;
  v_verify_job uuid := nullif(p_context ->> 'verifyJobId', '')::uuid;
begin
  select site_id, state into v_site_id, v_from
  from public.incidents
  where id = p_incident_id and severity = 'problem' and state not in ('resolved', 'in_review', 'closed')
  for update;

  if v_site_id is null then
    return false;
  end if;

  update public.incidents i
    set severity = 'down',
        episode_severity = 'down',
        detected_at = p_detected_at,
        is_flapping = is_flapping or coalesce(p_flapping, false),
        recovered_at = case when state in ('monitoring', 'needs_root_cause') then null else recovered_at end,
        escalation_plan = public.escalation_plan_for(s.tier, 'down'),
        escalation_level = case when acked_at is not null then escalation_level else 0 end,
        state = case
          when acked_at is not null then
            case when state in ('monitoring', 'needs_root_cause') then 'acknowledged'::public.incident_state
                 else state end
          else 'unacked'::public.incident_state
        end
    from public.sites s
    where i.id = p_incident_id and s.id = i.site_id
    returning i.state into v_to;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'escalated_to_down', p_context, p_detected_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.severity', 'incident', p_incident_id,
          jsonb_build_object('severity', 'problem', 'state', v_from),
          jsonb_build_object('severity', 'down', 'state', v_to));

  update public.site_status
    set status = 'down', ok_rounds = 0, last_evaluated_at = p_detected_at, last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  perform public.engine_record_flip(v_site_id, p_round_at, false);
  perform public.engine_cancel_flap_summary(p_incident_id);
  perform public.engine_cancel_held_problem(p_incident_id, 'Superseded: went down');
  -- The PROBLEM ladder ends here: its step or reminder still waiting never goes before the DOWN card.
  perform public.engine_cancel_ladder(p_incident_id, 'Superseded: went down');

  -- The browser's screenshot joins the timeline as evidence.
  if v_verify_job is not null then
    update public.verification_jobs set incident_id = p_incident_id where id = v_verify_job;
    insert into public.incident_events (incident_id, type, payload, at)
    select p_incident_id, 'evidence',
           jsonb_build_object('screenshotPath', j.screenshot_path, 'result', j.result, 'jobId', j.id),
           coalesce(j.completed_at, p_detected_at)
    from public.verification_jobs j
    where j.id = v_verify_job and j.screenshot_path is not null;
  end if;

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context)
    values (p_incident_id, 'google_chat', 'down', p_incident_id::text, p_context)
    on conflict do nothing;

    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, hold_until)
    select p_incident_id, s.primary_owner_id, 'email', 'down', p_incident_id::text, p_context,
           now() + interval '5 minutes' -- D-047
    from public.sites s
    join public.profiles p on p.id = s.primary_owner_id and p.is_active
    where s.id = v_site_id
    on conflict do nothing;
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

create or replace function public.engine_post_late_alert(p_incident_id uuid, p_at timestamptz, p_hold_until timestamptz default null)
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

  -- The facts of the drop it alerts about: its latest detection event's payload.
  select e.payload into v_context from public.incident_events e
  where e.incident_id = p_incident_id and e.type in ('detected', 'relapsed', 'escalated_to_down')
  order by e.at desc limit 1;
  v_context := coalesce(v_context, '{}'::jsonb) || jsonb_build_object('afterMute', true,
    'heldUntil', (select max(coalesce(mw.ended_at, mw.ends_at)) from public.maintenance_windows mw
                  where mw.site_id = v_inc.site_id and mw.kind = 'mute' and mw.cancelled_at is null
                    and coalesce(mw.ended_at, mw.ends_at) <= p_at
                    and coalesce(mw.ended_at, mw.ends_at) >= v_inc.detected_at));
  v_hold := case when v_sev = 'problem' and p_hold_until > p_at then p_hold_until end;

  insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
  values (p_incident_id, 'google_chat', v_sev, p_incident_id::text, v_context, v_hold);
  insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, hold_until)
  select p_incident_id, s.primary_owner_id, 'email', v_sev, p_incident_id::text, v_context,
         greatest(v_hold, now() + interval '5 minutes') -- D-047
  from public.sites s
  join public.profiles p on p.id = s.primary_owner_id and p.is_active
  where s.id = v_inc.site_id;

  update public.incidents set alerted_at = p_at where id = p_incident_id;
  return true;
end;
$$;

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

    -- D-047: the owner hasn't been emailed about this incident (every earlier drop came back inside
    -- its grace): this drop's email waits out its own 5 min, as the first alert's did.
    insert into public.notifications
      (incident_id, user_id, channel, template, thread_key, context, dedupe_key, hold_until)
    select p_incident_id, s.primary_owner_id, 'email', p_severity::text || '_again', p_incident_id::text,
           p_context, to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           greatest(case when p_severity = 'problem' and p_hold_until > p_detected_at then p_hold_until end,
                    now() + interval '5 minutes')
    from public.sites s
    join public.profiles p on p.id = s.primary_owner_id and p.is_active
    where s.id = v_site_id
      and not exists (
        select 1 from public.notifications e
        where e.incident_id = p_incident_id and e.channel = 'email' and e.status <> 'cancelled'
          and e.user_id = s.primary_owner_id)
    on conflict do nothing;
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

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

  -- D-047: back inside the 5-min grace → its alert email never goes (no RECOVERED email follows).
  update public.notifications
    set status = 'cancelled', error = 'Recovered within 5 min — no email (D-047)', next_retry_at = null
    where incident_id = p_incident_id and channel = 'email' and template in ('down', 'problem', 'down_again', 'problem_again')
      and status = 'queued' and attempts = 0
      and hold_until > p_recovered_at and hold_until <= created_at + interval '5 minutes'
      -- The team saw it in Chat; a card that never got through keeps the email.
      and exists (
        select 1 from public.notifications c
        where c.incident_id = p_incident_id and c.channel = 'google_chat'
          and c.template in ('down', 'problem', 'down_again', 'problem_again') and c.status = 'sent');

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
      -- email thread would otherwise end on the first PROBLEM. D-047: for every drop, DOWN too — drops
      -- that each came back inside 5 min emailed nobody.
      and exists (
        select 1 from public.notifications e
        where e.incident_id = p_incident_id and e.channel = 'email' and e.status <> 'cancelled'
          and e.user_id = s.primary_owner_id)
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

create or replace function public.ack_incident(p_incident_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_now timestamptz := now();
  v_hold timestamptz := now() + interval '10 seconds';
  v_name text;
  v_context jsonb;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if not private.can_ack(v_inc.site_id) then
    raise exception 'This role can''t acknowledge this incident' using errcode = '42501';
  end if;
  if v_inc.state not in ('unacked', 'escalated') then
    raise exception 'incident is not waiting for an acknowledgement' using errcode = '55000';
  end if;

  select display_name into v_name from public.profiles where id = auth.uid();
  v_context := jsonb_build_object('ackedBy', v_name, 'ackedById', auth.uid(), 'ackedAt', v_now,
                                  'escalationLevel', v_inc.escalation_level);

  update public.incidents
    set state = 'acknowledged', acked_at = v_now, acked_by = auth.uid()
    where id = p_incident_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.ack', 'incident', p_incident_id,
          jsonb_build_object('state', v_inc.state),
          jsonb_build_object('state', 'acknowledged', 'acked_at', v_now));

  perform public.engine_cancel_held_problem(p_incident_id, 'Superseded: acknowledged first');
  -- D-047: an alert email in its 5-min grace goes when the ack does (after its 10-s Undo window):
  -- someone took it, so it is real, and the record reads DOWN → ACKNOWLEDGED. Undo puts the grace back.
  update public.notifications
    set hold_until = v_hold
    where incident_id = p_incident_id and channel = 'email' and template in ('down', 'problem', 'down_again', 'problem_again')
      and status = 'queued' and attempts = 0 and hold_until > v_hold and hold_until <= created_at + interval '5 minutes';
  -- The chain stops (spec §8): a reminder or step still waiting never goes; Undo puts it back.
  perform public.engine_cancel_ladder(p_incident_id, 'Superseded: acknowledged first');

  insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
  select p_incident_id, 'google_chat', 'acknowledged', p_incident_id::text, v_context, v_hold
  where exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat'
      and template in ('down', 'problem') and status <> 'cancelled'
  )
  on conflict do nothing;

  -- A DOWN waiting for a retry would hold ACKNOWLEDGED back for minutes (one thread, in order): it
  -- is set aside, and Undo puts it back. The owner's DOWN email stays: it is the record.
  update public.notifications n
    set status = 'cancelled', error = 'Superseded: acknowledged first', next_retry_at = null
    where n.incident_id = p_incident_id and n.channel = 'google_chat'
      and n.template in ('down', 'problem') and n.status = 'queued' and n.attempts > 0
      -- waiting for a retry, not in flight: every attempt it was claimed for is logged
      and n.attempts = (select count(*) from public.notification_attempts a where a.notification_id = n.id);

  insert into public.notifications
    (incident_id, user_id, channel, template, thread_key, context, hold_until)
  select distinct p_incident_id, n.user_id, 'email'::public.notification_channel, 'acknowledged',
         p_incident_id::text, v_context, v_hold
  from public.notifications n
  where n.incident_id = p_incident_id and n.channel = 'email' and n.status <> 'cancelled'
    and n.user_id is not null
  on conflict do nothing;

  -- The timeline says when the ack posts, and whether it posts at all (a muted incident has no
  -- thread and no emails to follow up).
  insert into public.incident_events (incident_id, type, actor_id, payload, at)
  values (p_incident_id, 'acknowledged', auth.uid(),
          jsonb_build_object('from', v_inc.state, 'posts_at', v_hold,
            'notifies', exists (select 1 from public.notifications
                                where incident_id = p_incident_id and template = 'acknowledged'
                                  and status = 'queued')),
          v_now);

  return v_hold;
end;
$$;

create or replace function public.undo_ack(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_from public.incident_state;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if v_inc.acked_by is null then
    raise exception 'Nothing to undo' using errcode = '55000';
  end if;
  if v_inc.acked_by is distinct from auth.uid() then
    raise exception 'Only the person who acknowledged can undo it' using errcode = '42501';
  end if;
  -- Their own ack, but the incident moved on (recovered) or the window passed: too late.
  if v_inc.state <> 'acknowledged' or now() >= v_inc.acked_at + interval '10 seconds' then
    raise exception 'The undo window has closed' using errcode = '55000';
  end if;

  perform 1 from public.notifications
    where incident_id = p_incident_id and template = 'acknowledged' and status = 'queued'
    for update;
  if exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and template = 'acknowledged'
      and (status = 'sent' or (status = 'queued' and attempts > 0))
  ) then
    raise exception 'The undo window has closed' using errcode = '55000';
  end if;

  select (payload->>'from')::public.incident_state into v_from
  from public.incident_events
  where incident_id = p_incident_id and type = 'acknowledged'
  order by at desc
  limit 1;

  update public.notifications
    set status = 'cancelled', next_retry_at = null
    where incident_id = p_incident_id and template = 'acknowledged' and status = 'queued';

  -- D-047: the alert email the ack released waits out the rest of its grace again.
  update public.notifications
    set hold_until = created_at + interval '5 minutes'
    where incident_id = p_incident_id and channel = 'email' and template in ('down', 'problem', 'down_again', 'problem_again')
      and status = 'queued' and attempts = 0
      and hold_until = v_inc.acked_at + interval '10 seconds'
      and created_at + interval '5 minutes' > now();

  -- As if the ack never happened: an alert it set aside is due again.
  update public.notifications
    set status = 'queued', error = null, next_retry_at = null
    where incident_id = p_incident_id and status = 'cancelled'
      and error = 'Superseded: acknowledged first';

  update public.incidents
    set state = coalesce(v_from, 'unacked'), acked_at = null, acked_by = null
    where id = p_incident_id;

  insert into public.incident_events (incident_id, type, actor_id, payload)
  values (p_incident_id, 'ack_undone', auth.uid(),
          jsonb_build_object('state', coalesce(v_from, 'unacked')));

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.ack_undone', 'incident', p_incident_id,
          jsonb_build_object('state', 'acknowledged', 'acked_at', v_inc.acked_at),
          jsonb_build_object('state', coalesce(v_from, 'unacked')));
end;
$$;

create or replace function public.queue_fallback_emails(p_notification_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- D-047: the Chat alert failed for good — the owner's alert email in its grace goes now.
  update public.notifications e
    set hold_until = now()
    from public.notifications n
    join public.incidents i on i.id = n.incident_id
    where n.id = p_notification_id and n.channel = 'google_chat' and n.template in ('down', 'problem', 'down_again', 'problem_again')
      and i.state in ('unacked', 'escalated')
      and e.incident_id = n.incident_id and e.channel = 'email' and e.template in ('down', 'problem', 'down_again', 'problem_again')
      and e.status = 'queued' and e.attempts = 0 and e.hold_until > now() and e.hold_until <= e.created_at + interval '5 minutes';

  insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
  select n.incident_id, r.user_id, 'email', n.template, n.thread_key,
         n.context || jsonb_build_object('fallback', true), n.dedupe_key
  from public.notifications n
  join public.incidents i on i.id = n.incident_id
  join public.sites s on s.id = i.site_id
  cross join lateral (
    select b.id as user_id from public.profiles b where b.id = s.backup_owner_id and b.is_active
    union
    select p.id from public.profiles p where p.role = 'admin' and p.is_active
    union
    select a.id from public.profiles a
    where n.template in ('down_again', 'problem_again') and a.is_active
      and a.id = coalesce(i.acked_by, s.primary_owner_id)
  ) r
  where n.id = p_notification_id and n.channel = 'google_chat'
    and n.template <> 'reminder'
    and not (n.template in ('down', 'problem', 'step_fired') and i.state not in ('unacked', 'escalated'))
    -- An AGAIN reply is old news once the site is back (Monitoring); it still counts while acknowledged.
    and not (n.template in ('down_again', 'problem_again')
             and i.state not in ('unacked', 'escalated', 'acknowledged'))
    and not exists (
      select 1 from public.notifications e
      where e.incident_id = n.incident_id and e.channel = 'email' and e.template = n.template
        and e.dedupe_key = n.dedupe_key and e.user_id = r.user_id and e.status <> 'cancelled'
    )
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.claim_notifications(
  p_channel public.notification_channel,
  p_limit integer default 20,
  p_incident_id uuid default null
)
returns setof public.notifications
language sql
set search_path = ''
as $$
  with due as (
    select id from public.notifications
    where status = 'queued'
      and channel = p_channel
      and (p_incident_id is null or incident_id = p_incident_id)
      and (hold_until is null or hold_until <= now())
      and (next_retry_at is null or next_retry_at <= now())
      and not exists (
        select 1 from public.notifications older
        where older.incident_id = notifications.incident_id and older.channel = notifications.channel
          and older.user_id is not distinct from notifications.user_id
          and older.status = 'queued' and older.created_at < notifications.created_at
          and not (older.template in ('flap_summary', 'down', 'problem', 'down_again', 'problem_again')
                   and coalesce(older.hold_until > now(), false))
      )
      and not exists (
        select 1 from public.notifications older
        where older.maintenance_window_id = notifications.maintenance_window_id
          and older.channel = notifications.channel
          -- Chat: behind the action's own line and anything of an earlier action; one action's mention
          -- replies go together (db review M4). Email: in order per person.
          and (case when older.channel = 'google_chat'
                    then older.template = 'mw_line' or older.dedupe_key <> notifications.dedupe_key
                    else older.user_id is not distinct from notifications.user_id end)
          and older.status = 'queued' and older.created_at < notifications.created_at
      )
    order by created_at
    limit p_limit
    for update skip locked
  )
  update public.notifications n
    set attempts = n.attempts + 1, next_retry_at = now() + interval '90 seconds'
    from due
    where n.id = due.id
  returning n.*;
$$;
