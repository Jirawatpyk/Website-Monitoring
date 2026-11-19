set local lock_timeout = '5s';

-- S13 PR 4 (spec §40, D-068): messages on an incident opened for an SSL / domain expiry.
--
-- 1. Back up, still expiring (§40.2). A DOWN that joined an expiry incident and recovers while the
--    expiry is still under its line keeps the incident open for it: one RECOVERED "back up, still SSL
--    expiring" and a silent switch back to the expiry, at any hour (D-068 items 1–2). The engine has to
--    know the DOWN came from the expiry, and the raise to DOWN overwrites the cause (cause_trigger =
--    hard_fail, expiry_left = false): `down_from_expiry` keeps that one fact, set by a trigger whenever
--    the cause moves to a DOWN drop from an expiry (or a cause taken from one), cleared when the cause
--    moves on again. Every writer of cause_trigger (raise, DOWN AGAIN, hand raise) agrees without each
--    function being copied.
-- 2. The ack of the expiry a new cause sets aside names its acker (§40.3, EmailAlert "New cause ·
--    acknowledged"): the reply @mentions them and only they get the email.
-- 3. The ack given back when the incident goes back to the expiry is recorded with the event, for the
--    timeline row "Acknowledgement given back" (§40.5).
-- 4. engine_relapse_incident records no not-OK change for that silent way back: its RECOVERED recorded
--    the OK one, so a site going up and down under its SSL incident flaps (D-024, engine review H1).

alter table public.incidents add column down_from_expiry boolean not null default false;

create function private.incident_down_from_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Every writer of cause_trigger moves the cause (raise, relapse, new cause, back), so recompute each
  -- time — a DOWN AGAIN (hard_fail → hard_fail) after a clean recovery is a new drop of its own (db review).
  -- …and only from an incident still open for the expiry: a recovered one (Monitoring, Needs root cause)
  -- keeps its old cause, but a DOWN on it is a fresh drop (engine review M1).
  new.down_from_expiry := coalesce(new.episode_severity, new.severity) = 'down'
    and old.state in ('unacked', 'escalated', 'acknowledged')
    and (coalesce(old.cause_trigger, old.trigger) in ('ssl', 'domain') or old.expiry_left);
  return new;
end;
$$;

create trigger incidents_down_from_expiry
  before update of cause_trigger on public.incidents
  for each row execute function private.incident_down_from_expiry();

-- Open incidents already on a DOWN drop that came from an expiry: none before S13 PR 2, and the raise's
-- own event says so (escalated_to_down from an incident whose cause was an expiry). Not backfilled: such
-- an incident recovers with a clean RECOVERED as before this migration.

create or replace function public.engine_new_cause_incident(
  p_incident_id uuid,
  p_monitor_id uuid,
  p_trigger public.incident_trigger,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean,
  p_monitors jsonb default null,
  p_status public.site_state default null,
  p_hold_until timestamptz default null,
  -- The runner's response-hours verdict (SQL never works out hours): a Tier 1 new cause at night
  -- @mentions the person on call (Tao, 17 Nov).
  p_outside_hours boolean default false
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_was public.incident_trigger;
  v_state public.incident_state;
  v_severity public.severity;
  v_column public.incident_trigger;
  v_expiry_ack boolean;
  v_acked_at timestamptz;
  v_acked_by uuid;
  v_oncall uuid;
  v_recent_chat boolean;
  v_recent_mail boolean;
  v_hold timestamptz := case when p_hold_until > now() then p_hold_until end;
  v_key text := 'new_cause:' || to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_ctx jsonb;
  v_acker boolean := false;
begin
  -- An incident on a PROBLEM drop whose cause is an expiry (a DOWN incident back up on SSL too, Tao
  -- 17 Nov), and only for a cause that isn't one.
  select i.site_id, coalesce(i.cause_trigger, i.trigger), i.state, i.severity, i.trigger,
         coalesce(p_notify and i.acked_at is not null and i.acked_cause in ('ssl', 'domain'), false)
           -- …and only when the thread is told: the same cause again inside 30 min keeps the ack.
           and not exists (
             select 1 from public.notifications n
             where n.incident_id = p_incident_id and n.channel = 'google_chat' and n.template = 'problem_again'
               and coalesce((n.context ->> 'newCause')::boolean, false) and n.context ->> 'trigger' = p_trigger::text
               and n.context ->> 'monitorUrl' is not distinct from p_context ->> 'monitorUrl'
               and n.context ->> 'summary' is not distinct from p_context ->> 'summary'
               and n.status <> 'cancelled' and n.created_at > now() - interval '30 minutes'),
         i.acked_at, i.acked_by
    into v_site_id, v_was, v_state, v_severity, v_column, v_expiry_ack, v_acked_at, v_acked_by
  from public.incidents i
  where i.id = p_incident_id
    and p_trigger not in ('ssl', 'domain')
    and coalesce(i.episode_severity, i.severity) = 'problem'
    and i.state in ('unacked', 'escalated', 'acknowledged')
    and coalesce(i.cause_trigger, i.trigger) in ('ssl', 'domain')
  for update;

  if v_site_id is null then
    return false;
  end if;

  update public.incidents i
    set trigger = case when v_severity = 'problem' then p_trigger else i.trigger end,
        expiry_left = true,
        cause_trigger = p_trigger,
        monitor_id = case when v_severity = 'problem' then coalesce(p_monitor_id, i.monitor_id) else i.monitor_id end,
        -- Tao, 17–18 Nov: an ack given for the expiry doesn't cover the new cause — it is set aside and
        -- the ladder carries on from where it was (as a relapse, D-004 / D-058; levels and clock kept).
        acked_at = case when v_expiry_ack then null else i.acked_at end,
        acked_by = case when v_expiry_ack then null else i.acked_by end,
        state = case when not v_expiry_ack then i.state
                     when i.escalation_level > 0 then 'escalated'::public.incident_state
                     else 'unacked'::public.incident_state end
    where i.id = p_incident_id;
  -- After the trigger (which clears them on any acked_at change): the ack set aside, to give back.
  if v_expiry_ack then
    update public.incidents set expiry_ack_at = v_acked_at, expiry_ack_by = v_acked_by where id = p_incident_id;
  end if;

  if v_expiry_ack then
    v_state := (select state from public.incidents where id = p_incident_id);
    -- Its ACKNOWLEDGED still held or retrying never posts after the reply; a sent one stays the record.
    update public.notifications
      set status = 'cancelled', error = 'Superseded: new cause', next_retry_at = null
      where incident_id = p_incident_id and template = 'acknowledged' and status = 'queued'
        and attempts = (select count(*) from public.notification_attempts a where a.notification_id = public.notifications.id);
    update public.notifications
      set dedupe_key = coalesce(dedupe_key, '') || ':expiry-ack:' || to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      where incident_id = p_incident_id and template = 'acknowledged' and status <> 'cancelled'
        and coalesce(dedupe_key, '') not like '%:expiry-ack:%';
  end if;

  -- Tao, 17 Nov: a Tier 1 new cause at night that nobody acknowledged is told to whoever is on call now.
  -- Only this reply and its email name them: the incident's L0 (the owner's emails, RECOVERED) is kept.
  if p_outside_hours and v_state <> 'acknowledged'
     and (select s.tier from public.sites s where s.id = v_site_id) = 1 then
    v_oncall := public.oncall_person_at(p_round_at);
  end if;
  -- D-068 item 3 (Tao, 19 Nov; EmailAlert "New cause · acknowledged"): the ack of the expiry set aside
  -- names its acker — they were on it, at any hour. The reply @mentions them and only they get the
  -- email ("because you acknowledged this incident"), which keeps the Acknowledge button.
  -- Someone who can still act on it (security review M1: a demoted acker falls back to L0 / on call).
  if v_expiry_ack and exists (select 1 from public.profiles p where p.id = v_acked_by and p.is_active
                                and p.role in ('admin', 'responder')) then
    v_oncall := v_acked_by;
    v_acker := true;
  end if;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'new_cause',
          coalesce(p_context, '{}') || jsonb_build_object('trigger', p_trigger, 'was', v_was)
            || case when v_expiry_ack then jsonb_build_object('ackCleared', true,
                 -- §40.5's own timeline row, "Acknowledgement set aside" (D-068).
                 'setAside', jsonb_build_object('at', v_acked_at,
                   'by', (select p.display_name from public.profiles p where p.id = v_acked_by)))
               else '{}'::jsonb end
            -- Who it told at night (their later emails say why they get them).
            || case when exists (select 1 from public.profiles p where p.id = v_oncall and p.is_active)
                    then jsonb_build_object('mention', jsonb_build_object('id', v_oncall)) else '{}'::jsonb end,
          p_round_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.new_cause', 'incident', p_incident_id,
          -- The column as it was and is (a DOWN incident keeps hard_fail / manual), and the cause.
          jsonb_build_object('trigger', v_column, 'cause', v_was,
                             'state', case when v_expiry_ack then 'acknowledged' else v_state::text end)
            || case when v_expiry_ack then jsonb_build_object('expiry_ack_cleared', true,
                 'acked_at', v_acked_at, 'acked_by', v_acked_by) else '{}'::jsonb end,
          jsonb_build_object('trigger', case when v_severity = 'problem' then p_trigger else v_column end,
                             'cause', p_trigger, 'state', v_state));

  v_ctx := coalesce(p_context, '{}') || jsonb_build_object('trigger', p_trigger, 'was', v_was, 'newCause', true,
    'afterDown', v_severity = 'down')
    || coalesce((select jsonb_build_object('mention', jsonb_build_object(
                  'id', p.id, 'name', p.display_name, 'chatUserId', p.google_chat_user_id)
                  || case when v_acker then jsonb_build_object('acked', true, 'ackedAt', v_acked_at) else '{}'::jsonb end)
                 from public.profiles p where p.id = v_oncall and p.is_active), '{}');

  -- A cause that comes and goes (a key page flipping) is told once per 30 min, per channel: the same
  -- trigger, page and words with a reply (or an L0 email) not cancelled is not posted (or emailed) again.
  -- Another page, word or domain is news (engine re-review M-b).
  v_recent_chat := exists (
    select 1 from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'google_chat' and n.template = 'problem_again'
      and coalesce((n.context ->> 'newCause')::boolean, false) and n.context ->> 'trigger' = p_trigger::text
      and n.context ->> 'monitorUrl' is not distinct from p_context ->> 'monitorUrl'
      and n.context ->> 'summary' is not distinct from p_context ->> 'summary'
      and n.context -> 'mention' ->> 'id' is not distinct from v_ctx -> 'mention' ->> 'id'
      and n.status <> 'cancelled' and n.created_at > now() - interval '30 minutes');
  v_recent_mail := exists (
    select 1 from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'email' and n.template = 'problem_again'
      and coalesce((n.context ->> 'newCause')::boolean, false) and n.context ->> 'trigger' = p_trigger::text
      and n.context ->> 'monitorUrl' is not distinct from p_context ->> 'monitorUrl'
      and n.context ->> 'summary' is not distinct from p_context ->> 'summary'
      and n.context -> 'mention' ->> 'id' is not distinct from v_ctx -> 'mention' ->> 'id'
      and n.status <> 'cancelled' and n.created_at > now() - interval '30 minutes');

  if p_notify and not v_recent_chat then
    -- The thread's first card may still be held for response hours (an SSL PROBLEM at night): it goes
    -- no later than this reply, or the reply would wait behind it (claim_notifications keeps order).
    update public.notifications
      set hold_until = coalesce(v_hold, now())
      where incident_id = p_incident_id and template in ('problem', 'problem_again') and status = 'queued'
        and channel = 'google_chat' and hold_until > coalesce(v_hold, now());

    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key, hold_until)
    values (p_incident_id, 'google_chat', 'problem_again', p_incident_id::text, v_ctx, v_key, v_hold)
    on conflict do nothing;
  end if;

  if p_notify and not v_recent_mail and v_ctx ? 'mention' then
    -- At night the person on call, or the acker of the expiry set aside, as the reply (D-047 grace kept).
    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, dedupe_key, hold_until)
    values (p_incident_id, v_oncall, 'email', 'problem_again', p_incident_id::text, v_ctx, v_key,
            greatest(v_hold, now() + interval '5 minutes'))
    on conflict do nothing;
  elsif p_notify and not v_recent_mail then
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

create or replace function public.engine_cause_back_incident(
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
  v_back jsonb;
begin
  select site_id, coalesce(cause_trigger, trigger), state
    into v_site_id, v_was, v_state
  from public.incidents
  where id = p_incident_id
    and p_trigger in ('ssl', 'domain')
    and coalesce(episode_severity, severity) = 'problem'
    and state in ('unacked', 'escalated', 'acknowledged')
    and (
      -- Its cause was taken from an expiry (engine re-review H3: one that never had one recovers instead)…
      (coalesce(cause_trigger, trigger) not in ('ssl', 'domain') and expiry_left)
      -- …or it moves from one expiry to the other (Tao, 17 Nov: SSL renewed, the domain still due).
      or (coalesce(cause_trigger, trigger) in ('ssl', 'domain') and coalesce(cause_trigger, trigger) <> p_trigger))
  for update;

  if v_site_id is null then
    return false;
  end if;

  -- The ack of the expiry about to be given back (spec §40.5: "Acknowledgement given back").
  select jsonb_build_object('at', i.expiry_ack_at, 'by', p.display_name)
    into v_back
  from public.incidents i
  left join public.profiles p on p.id = i.expiry_ack_by
  where i.id = p_incident_id and i.expiry_ack_at is not null and i.acked_at is null;

  update public.incidents
    set trigger = case when severity = 'problem' then p_trigger else trigger end,
        expiry_left = false,
        cause_trigger = p_trigger,
        -- Tao, 18 Nov: the ack of the expiry a new cause set aside comes back with the expiry.
        acked_at = case when expiry_ack_at is not null and acked_at is null then expiry_ack_at else acked_at end,
        acked_by = case when expiry_ack_at is not null and acked_at is null then expiry_ack_by else acked_by end,
        state = case when expiry_ack_at is not null and acked_at is null then 'acknowledged'::public.incident_state
                     else state end,
        monitor_id = case when severity = 'problem' then coalesce(p_monitor_id, monitor_id) else monitor_id end
    where id = p_incident_id;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'new_cause',
          coalesce(p_context, '{}') || jsonb_build_object('trigger', p_trigger, 'was', v_was, 'back', true)
            || case when v_back is not null then jsonb_build_object('ackBack', v_back) else '{}'::jsonb end,
          p_round_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.cause_back', 'incident', p_incident_id,
          jsonb_build_object('trigger', v_was, 'state', v_state),
          (select jsonb_build_object('trigger', p_trigger, 'state', i.state, 'acked_by', i.acked_by,
                                     'acked_at', i.acked_at)
           from public.incidents i where i.id = p_incident_id));

  update public.notifications
    set status = 'cancelled', error = 'Superseded: the new cause cleared', next_retry_at = null
    where incident_id = p_incident_id and status = 'queued'
      -- Held or waiting for a retry, never one in flight (db review).
      and attempts = (select count(*) from public.notification_attempts a where a.notification_id = public.notifications.id)
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
  v_expiry_ack boolean;
  v_acked_at timestamptz;
  v_acked_by uuid;
begin
  select site_id, state, severity,
         coalesce(p_severity = 'down' and acked_at is not null and acked_cause in ('ssl', 'domain'), false),
         acked_at, acked_by
    into v_site_id, v_from, v_before, v_expiry_ack, v_acked_at, v_acked_by
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
        -- A new drop brings its own cause: nothing to go back to.
        expiry_left = false,
        expiry_ack_at = null,
        expiry_ack_by = null,
        cause_trigger = p_trigger,
        recovered_at = null,
        is_flapping = is_flapping or coalesce(p_flapping, false),
        -- Tao, 17 Nov: an ack of the expiry never silences a real outage (DOWN AGAIN as D-021).
        acked_at = case when v_expiry_ack then null else acked_at end,
        acked_by = case when v_expiry_ack then null else acked_by end,
        state = case when acked_at is not null and not v_expiry_ack then 'acknowledged'::public.incident_state
                     -- Escalated only when a step of this severity really paged someone (D-034).
                     when exists (select 1 from public.incident_events e
                                  where e.incident_id = p_incident_id and e.type = 'step_fired'
                                    and e.payload ->> 'severity' = severity::text
                                    and jsonb_array_length(e.payload -> 'notified') > 0)
                       then 'escalated'::public.incident_state
                     else 'unacked'::public.incident_state end
    where id = p_incident_id
    returning state, severity into v_to, v_after;

  -- The cleared ack's ACKNOWLEDGED: one still held is cancelled (it would post after the DOWN — message-
  -- checker); one sent stays as the record under its own key, so the next ack posts a fresh one (one live
  -- message per incident / channel / template / person / key). Undo reads only the current ack's rows.
  if v_expiry_ack then
    update public.notifications
      set status = 'cancelled', error = 'Superseded: went down', next_retry_at = null
      where incident_id = p_incident_id and template = 'acknowledged' and status = 'queued'
        and attempts = (select count(*) from public.notification_attempts a where a.notification_id = public.notifications.id);
    update public.notifications
      set dedupe_key = coalesce(dedupe_key, '') || ':expiry-ack:' || to_char(p_detected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      where incident_id = p_incident_id and template = 'acknowledged' and status <> 'cancelled'
        and coalesce(dedupe_key, '') not like '%:expiry-ack:%';
  end if;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'relapsed',
          coalesce(p_context, '{}') || jsonb_build_object(
            'severity', p_severity, 'trigger', p_trigger, 'startedAt', p_started_at,
            'flapping', coalesce(p_flapping, false))
            || case when v_expiry_ack then jsonb_build_object('ackCleared', true) else '{}'::jsonb end,
          p_detected_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.relapsed', 'incident', p_incident_id,
          jsonb_build_object('state', v_from, 'severity', v_before)
            || case when v_expiry_ack then jsonb_build_object('expiry_ack_cleared', true,
                 'acked_at', v_acked_at, 'acked_by', v_acked_by) else '{}'::jsonb end,
          jsonb_build_object('state', v_to, 'severity', v_after, 'episode', p_severity));

  update public.site_status
    set ok_rounds = 0, last_evaluated_at = p_detected_at, last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  -- D-068 (engine review H1): back up on the expiry the DOWN joined, the incident goes back to it in
  -- the round its RECOVERED recorded an OK change — the site answered, so that one stands.
  if not coalesce((p_context ->> 'stillExpiry')::boolean, false) then
    perform public.engine_record_flip(v_site_id, p_round_at, false);
  end if;
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
