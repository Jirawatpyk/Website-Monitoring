set local lock_timeout = '5s';

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

-- Whether the cause the incident carries now was taken from an SSL / domain expiry (D-067 item 4: only
-- such an incident goes back to it). Written by the engine functions only: a new cause sets it, going
-- back or a PROBLEM AGAIN clears it. One flag the runner reads with the incident, not a history scan.
alter table public.incidents add column expiry_left boolean not null default false;

-- The cause of the drop in progress, for every severity (null = as it opened: `trigger`). Written by
-- a PROBLEM / DOWN AGAIN, a new cause and going back to the expiry. Every rule about the expiry reads
-- `coalesce(cause_trigger, trigger)`; `trigger` stays what the pages and reports show (a DOWN incident
-- keeps hard_fail / manual). One stored fact, so a window hiding rounds can't lose it (engine re-review).
alter table public.incidents add column cause_trigger public.incident_trigger;

-- What the ack was given for: the drop's cause when someone acknowledged (Tao, 17 Nov: an ack of an SSL
-- / domain expiry never silences a real outage, while an ack of the outage itself still holds — engine
-- re-review). Kept by a trigger, so every writer of acked_at (ack, Undo, a DOWN clearing it) agrees.
alter table public.incidents add column acked_cause public.incident_trigger;

create function private.incident_acked_cause()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.acked_at is null then
    new.acked_cause := null;
  elsif tg_op = 'INSERT' or old.acked_at is distinct from new.acked_at then
    new.acked_cause := coalesce(new.cause_trigger, new.trigger);
  end if;
  return new;
end;
$$;

create trigger incidents_acked_cause
  before insert or update of acked_at on public.incidents
  for each row execute function private.incident_acked_cause();

-- Incidents acknowledged before this migration: acknowledged for the cause they carry (no expiry
-- incident exists before S13), so no open ack reads "unknown" (engine review).
update public.incidents set acked_cause = coalesce(cause_trigger, trigger) where acked_at is not null;

create function public.engine_new_cause_incident(
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
begin
  -- An incident on a PROBLEM drop whose cause is an expiry (a DOWN incident back up on SSL too, Tao
  -- 17 Nov), and only for a cause that isn't one.
  select i.site_id, coalesce(i.cause_trigger, i.trigger), i.state, i.severity, i.trigger,
         coalesce(i.acked_at is not null and i.acked_cause in ('ssl', 'domain'), false), i.acked_at, i.acked_by
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
        -- Tao, 17 Nov: an ack given for the expiry doesn't cover the new cause — it is cleared and the
        -- ladder starts again from the new cause (alerted_at: no level counted from the old clock).
        acked_at = case when v_expiry_ack then null else i.acked_at end,
        acked_by = case when v_expiry_ack then null else i.acked_by end,
        state = case when v_expiry_ack then 'unacked'::public.incident_state else i.state end,
        escalation_level = case when v_expiry_ack then 0 else i.escalation_level end,
        alerted_at = case when v_expiry_ack then p_round_at else i.alerted_at end
    where i.id = p_incident_id;

  if v_expiry_ack then
    v_state := 'unacked';
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

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'new_cause',
          coalesce(p_context, '{}') || jsonb_build_object('trigger', p_trigger, 'was', v_was)
            || case when v_expiry_ack then jsonb_build_object('ackCleared', true) else '{}'::jsonb end
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
                  'id', p.id, 'name', p.display_name, 'chatUserId', p.google_chat_user_id))
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
    -- At night: the person on call, as the reply (D-047 grace kept).
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

revoke execute on function public.engine_new_cause_incident(uuid, uuid, public.incident_trigger,
  timestamptz, jsonb, boolean, jsonb, public.site_state, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.engine_new_cause_incident(uuid, uuid, public.incident_trigger,
  timestamptz, jsonb, boolean, jsonb, public.site_state, timestamptz, boolean)
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

  update public.incidents
    set trigger = case when severity = 'problem' then p_trigger else trigger end,
        expiry_left = false,
        cause_trigger = p_trigger,
        monitor_id = case when severity = 'problem' then coalesce(p_monitor_id, monitor_id) else monitor_id end
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
        -- On a PROBLEM drop whose cause is the expiry (a DOWN incident back up on SSL too, Tao 17 Nov).
        and not (coalesce(i.episode_severity, i.severity) = 'problem'
                 and coalesce(i.cause_trigger, i.trigger) in ('ssl', 'domain'))
      limit 1),
    (select 'down' from public.site_status st where st.site_id = p_site_id and st.status = 'down'));
$$;

-- Tao, 17 Nov (engine re-review M3): a DOWN on an incident acknowledged for an SSL / domain expiry starts
-- the DOWN ladder from L0 again (Unacked; the person on call at night), never only an FYI. As in
-- 20261029144512 otherwise.
create or replace function public.engine_escalate_incident(
  p_incident_id uuid,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean,
  p_monitors jsonb default null,
  p_status public.site_state default null,
  p_flapping boolean default false,
  p_outside_hours boolean default false
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
  v_expiry_ack boolean;
  v_acked_at timestamptz;
  v_acked_by uuid;
begin
  -- Tao, 17 Nov: an ack of an SSL / domain expiry ("waiting for the client to renew") never silences a
  -- real outage — the DOWN restarts the ladder as if nobody had acknowledged.
  -- An ack given while the incident was about the expiry: its cause is one, or was taken from one (an
  -- ack of the SSL, then a keyword new cause, then the DOWN — advisor).
  select site_id, state, coalesce(acked_at is not null and acked_cause in ('ssl', 'domain'), false),
         acked_at, acked_by
    into v_site_id, v_from, v_expiry_ack, v_acked_at, v_acked_by
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
        escalation_level = case when acked_at is not null and not v_expiry_ack then escalation_level else 0 end,
        -- The ladder clock restarts unless acknowledged: so does who L0 pages (S10).
        l0_user_id = case when acked_at is not null and not v_expiry_ack then l0_user_id
                          when s.tier = 1 and p_outside_hours then public.oncall_person_at(p_detected_at) end,
        acked_at = case when v_expiry_ack then null else acked_at end,
        acked_by = case when v_expiry_ack then null else acked_by end,
        -- A DOWN drop: its own cause, nothing to go back to.
        cause_trigger = 'hard_fail',
        expiry_left = false,
        state = case
          when acked_at is not null and not v_expiry_ack then
            case when state in ('monitoring', 'needs_root_cause') then 'acknowledged'::public.incident_state
                 else state end
          else 'unacked'::public.incident_state
        end
    from public.sites s
    where i.id = p_incident_id and s.id = i.site_id
    returning i.state into v_to;

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
  values (p_incident_id, 'escalated_to_down',
          case when v_expiry_ack then p_context || jsonb_build_object('ackCleared', true) else p_context end,
          p_detected_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.severity', 'incident', p_incident_id,
          jsonb_build_object('severity', 'problem', 'state', v_from, 'expiry_ack_cleared', v_expiry_ack)
            || case when v_expiry_ack then jsonb_build_object('acked_at', v_acked_at, 'acked_by', v_acked_by)
                    else '{}'::jsonb end,
          jsonb_build_object('severity', 'down', 'state', v_to,
                             'l0_user_id', (select l0_user_id from public.incidents where id = p_incident_id)));

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

    perform public.engine_queue_l0_emails(p_incident_id, 'down', p_context,
                                           now() + interval '5 minutes', null, false); -- D-047
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

-- S13 (message-checker): Undo reads only the current ack's rows — an expiry ack a DOWN cleared (its
-- ACKNOWLEDGED sent days ago) never closes the window of the next ack, and what that old ack set aside
-- isn't put back. As in 20261016081115 otherwise.
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
      and created_at >= v_inc.acked_at
    for update;
  if exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and template = 'acknowledged'
      and created_at >= v_inc.acked_at
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
    where incident_id = p_incident_id and template = 'acknowledged' and status = 'queued'
      and created_at >= v_inc.acked_at;

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
      and error = 'Superseded: acknowledged first' and updated_at >= v_inc.acked_at;

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

-- D-067 item 3 (db review): the window's start has its own copy of the busy check (an invoker function
-- can't call private.site_busy); it gets the same exception, or a window allowed on a site open for an
-- expiry would be marked "didn't start". As in 20261011174143 otherwise.
create or replace function public.engine_log_windows(p_now timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  w public.maintenance_windows%rowtype;
  v_busy text;
  m public.maintenance_windows%rowtype;
begin
  -- Nobody approved it before its start: it never starts, and stops holding its time (D-036, §23.10).
  for w in
    update public.maintenance_windows mw
      set cancelled_at = mw.starts_at, outcome = 'not_approved', end_logged = true,
          log = mw.log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'not_approved'))
    where mw.approved_at is null and mw.cancelled_at is null and mw.outcome is null and mw.starts_at <= p_now
      and (mw.undo_until is null or mw.undo_until <= p_now)
    returning mw.*
  loop
    insert into public.audit_log (action, entity, entity_id, before, after)
    values ('maintenance.start', 'maintenance_window', w.id, jsonb_build_object('state', 'waiting'),
            jsonb_build_object('state', 'not_approved', 'site_id', w.site_id));
    perform public.engine_queue_window_messages(w.id, 'not_approved', null, null, 'not_approved');
  end loop;

  -- A window's start: it doesn't start on a site that is DOWN or has an incident that hasn't recovered
  -- (§23.10); otherwise it starts, and a running mute on the site ends (alerts are off anyway).
  for w in
    select * from public.maintenance_windows mw
    where mw.kind = 'maintenance' and not mw.start_logged and mw.cancelled_at is null and mw.outcome is null
      and mw.approved_at is not null and mw.starts_at <= p_now
      and (mw.undo_until is null or mw.undo_until <= p_now)
    for update skip locked
  loop
    select coalesce(
      (select 'INC-' || lpad(i.number::text, 4, '0') from public.incidents i
        where i.site_id = w.site_id and i.state in ('unacked', 'escalated', 'acknowledged')
          and not (coalesce(i.episode_severity, i.severity) = 'problem'
                   and coalesce(i.cause_trigger, i.trigger) in ('ssl', 'domain'))
        limit 1),
      (select 'down' from public.site_status st where st.site_id = w.site_id and st.status = 'down'))
    into v_busy;
    if v_busy is not null then
      update public.maintenance_windows
        set cancelled_at = w.starts_at, outcome = 'didnt_start', outcome_detail = v_busy,
            start_logged = true, end_logged = true,
            log = log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'didnt_start', 'incident', v_busy))
        where id = w.id;
      insert into public.audit_log (action, entity, entity_id, before, after)
      values ('maintenance.start', 'maintenance_window', w.id, jsonb_build_object('state', 'scheduled'),
              jsonb_build_object('state', 'didnt_start', 'site_id', w.site_id, 'incident', v_busy));
      perform public.engine_queue_window_messages(w.id, 'didnt_start', null, null, 'didnt_start',
        jsonb_build_object('incident', v_busy));
      continue;
    end if;
    update public.maintenance_windows
      set start_logged = true,
          log = log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'started'))
      where id = w.id;
    insert into public.audit_log (action, entity, entity_id, before, after)
    values ('maintenance.start', 'maintenance_window', w.id, jsonb_build_object('state', 'scheduled'),
            jsonb_build_object('state', 'active', 'site_id', w.site_id, 'ends_at', w.ends_at));
    perform public.engine_queue_window_messages(w.id, 'started', null, null, 'started');
    for m in
      select * from public.maintenance_windows mm
      where mm.site_id = w.site_id and mm.kind = 'mute' and mm.cancelled_at is null and mm.ended_at is null
        and mm.starts_at <= p_now and mm.ends_at > p_now
    loop
      update public.maintenance_windows
        set ended_at = p_now, end_reason = 'Maintenance started', end_logged = true,
            log = log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'ended_by_maintenance'))
        where id = m.id;
      insert into public.audit_log (action, entity, entity_id, before, after)
      values ('site.mute_end', 'site', m.site_id, jsonb_build_object('muted_until', m.ends_at),
              jsonb_build_object('ended_at', p_now, 'reason', 'Maintenance started', 'window_id', m.id));
    end loop;
  end loop;

  -- Windows and mutes that ran their course: logged once (System).
  for w in
    update public.maintenance_windows mw
      set end_logged = true,
          log = mw.log || jsonb_build_array(jsonb_build_object('at', mw.ends_at, 'action', 'ended'))
    where not mw.end_logged and mw.start_logged and mw.cancelled_at is null and mw.ended_at is null
      and mw.outcome is null and mw.ends_at <= p_now
      and (mw.undo_until is null or mw.undo_until <= p_now)
    returning mw.*
  loop
    insert into public.audit_log (action, entity, entity_id, before, after)
    values (case w.kind when 'mute' then 'site.mute_end' else 'maintenance.end' end,
            case w.kind when 'mute' then 'site' else 'maintenance_window' end,
            case w.kind when 'mute' then w.site_id else w.id end,
            jsonb_build_object('state', 'active'),
            jsonb_build_object('state', 'ended', 'ended_at', w.ends_at, 'window_id', w.id));
    perform public.engine_queue_window_messages(w.id,
      case w.kind when 'mute' then 'mute_ended' else 'ended' end, null, null, 'ended');
  end loop;

  -- A mute that ran out, or that maintenance ended, leaves the site row; one with no window behind it
  -- (never written by the RPCs) is logged as it goes.
  perform set_config('dxt.window_write', 'on', true);
  with cleared as (
    update public.sites s set muted_until = null, mute_reason = null, muted_at = null
    where s.muted_until is not null
      and (s.muted_until <= p_now
           or not exists (select 1 from public.maintenance_windows mm
                          where mm.site_id = s.id and mm.kind = 'mute' and mm.cancelled_at is null
                            and mm.ended_at is null and mm.starts_at <= p_now and mm.ends_at > p_now))
    returning s.id
  )
  insert into public.audit_log (action, entity, entity_id, after)
  select 'site.mute_end', 'site', c.id, jsonb_build_object('reason', 'No mute window behind it')
  from cleared c
  where not exists (select 1 from public.maintenance_windows mm where mm.site_id = c.id and mm.kind = 'mute'
                    and coalesce(mm.ended_at, mm.ends_at) between p_now - interval '2 minutes' and p_now + interval '1 minute');
end;
$$;
