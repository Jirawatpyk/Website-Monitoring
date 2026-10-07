-- DxT Monitor · S04b relapse, flapping & auto-resolve (D-004, D-023, D-024, spec §16.1, §19.3–19.4):
-- a new problem on a recovered incident joins it in one state-guarded function, the OK ↔ not-OK
-- flips that tag flapping, the RECOVERED summary held until 15 min of continuous OK, the < 5 min
-- unacknowledged PROBLEM that resolves itself, a dedupe key so a template can repeat on one incident,
-- and the engine's reads as service-role RPCs (no monitor ids in a GET query string).
--
-- Deploy order: apply this migration BEFORE the code. The old code keeps working against the new
-- functions (every new parameter has a default), but the new code gets "function not found" from
-- the old ones. Production waits for `migrate-production`; on staging run `pnpm db:push:staging`
-- before pushing the branch to `staging`.

-- ── notifications: a template may repeat on one incident ─────────────────
-- D-014: one live message per incident / channel / template / person — plus the dedupe key. RECOVERED,
-- DOWN AGAIN, PROBLEM AGAIN and the flapping summary use their round (a site can drop and recover
-- several times in one incident); everything else keeps '' and stays once per incident.
alter table public.notifications
  add column dedupe_key text not null default '' check (char_length(dedupe_key) <= 64);

create unique index notifications_once_per_incident_key
  on public.notifications (incident_id, channel, template, user_id, dedupe_key) nulls not distinct
  where status <> 'cancelled' and incident_id is not null;
drop index public.notifications_once_per_incident;
alter index public.notifications_once_per_incident_key rename to notifications_once_per_incident;

-- ── incidents: what is failing now, auto-resolved ────────────────────────
-- `severity` is the incident's worst (only goes up); `episode_severity` the severity of the drop in
-- progress — the site's status floor and the recovery rule follow it (D-023: a DOWN ends when the
-- primary is OK; a key page still failing carries on as a PROBLEM in the same incident).
alter table public.incidents
  add column episode_severity public.severity,
  add column auto_resolved boolean not null default false;
update public.incidents set episode_severity = severity;
alter table public.incidents alter column episode_severity set not null;

-- ── site_status: OK ↔ not-OK flips (flapping) ─────────────────────────────
-- A flip is recorded at an incident step: OK → not-OK when an incident opens, relapses or escalates,
-- not-OK → OK when it recovers with every monitor OK (D-024). Only the last 30 min are kept; the
-- 3rd flip in 30 min tags the incident flapping (PRD §7).
alter table public.site_status
  add column flips timestamptz[] not null default '{}' check (cardinality(flips) <= 64),
  add column flip_ok boolean;

-- Appends the flip when the direction changes. Called by the engine functions inside their guarded
-- transactions, so overlapping runs can't record it twice.
create function public.engine_record_flip(p_site_id uuid, p_round_at timestamptz, p_ok boolean)
returns void
language sql
set search_path = ''
as $$
  update public.site_status
    set flip_ok = p_ok,
        flips = array(
          select f from unnest(flips || p_round_at) f
          where f > p_round_at - interval '30 minutes'
          order by f
        )
    where site_id = p_site_id and flip_ok is distinct from p_ok
      -- A run holding an older round never moves the flips back (as site_status's other columns).
      and (last_round_at is null or last_round_at <= p_round_at);
$$;

-- ── Engine functions ──────────────────────────────────────────────────────
drop function public.engine_open_incident(
  uuid, uuid, public.incident_trigger, public.severity, timestamptz, timestamptz, timestamptz, jsonb,
  boolean, jsonb, public.site_state);
drop function public.engine_recover_incident(
  uuid, public.incident_state, public.incident_state, timestamptz, timestamptz, jsonb, boolean, jsonb,
  public.site_state);
drop function public.engine_escalate_incident(
  uuid, timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state);

-- Opens the incident (S02b–S04a body) and records the OK → not-OK flip.
create function public.engine_open_incident(
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
  p_status public.site_state default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_verify_job uuid := nullif(p_context ->> 'verifyJobId', '')::uuid;
begin
  insert into public.incidents (site_id, monitor_id, trigger, severity, episode_severity, started_at, detected_at)
  values (p_site_id, p_monitor_id, p_trigger, p_severity, p_severity, p_started_at, p_detected_at)
  on conflict (site_id) where state not in ('resolved', 'in_review', 'closed') do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.incident_events (incident_id, type, payload, at)
  values (v_id, 'detected', p_context, p_detected_at);

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
    insert into public.notifications (incident_id, channel, template, thread_key, context)
    values (v_id, 'google_chat', p_severity::text, v_id::text, p_context);

    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context)
    select v_id, s.primary_owner_id, 'email', p_severity::text, v_id::text, p_context
    from public.sites s
    join public.profiles p on p.id = s.primary_owner_id and p.is_active
    where s.id = p_site_id;
  end if;

  perform public.engine_write_monitors(p_site_id, p_round_at, p_monitors, p_status);
  return v_id;
end;
$$;

-- First OK round of a drop.
--   · Monitoring (or Resolved for an auto-resolving PROBLEM, `p_auto_resolve`, spec §16.1) with its
--     event, audit and site bookkeeping;
--   · a Chat DOWN / PROBLEM / AGAIN still waiting for a retry is dropped so RECOVERED isn't behind it;
--   · RECOVERED to Chat and everyone already emailed — or, for a flapping incident (`p_hold_summary`),
--     one summary to Chat and the owner held until 15 min after the recovery; a new drop cancels it,
--     so it only goes after 15 min of continuous OK (D-024);
--   · the not-OK → OK flip when every monitor is OK (`p_flip_ok`; null for D-023's partial recovery).
create function public.engine_recover_incident(
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
  -- The round in UTC, whatever the session's TimeZone / DateStyle: overlapping callers agree.
  v_key text := to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  -- Auto-resolve only for a PROBLEM nobody acknowledged (spec §16.1); DOWN never auto-resolves.
  if p_auto_resolve and p_to <> 'resolved' then
    raise exception 'auto-resolve must go to resolved';
  end if;

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

  if p_notify and p_hold_summary then
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
    on conflict do nothing;
  elsif p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
    values (p_incident_id, 'google_chat', 'recovered', p_incident_id::text, p_context, v_key)
    on conflict do nothing;

    insert into public.notifications
      (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
    select distinct p_incident_id, n.user_id, 'email'::public.notification_channel, 'recovered',
           p_incident_id::text, p_context, v_key
    from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'email' and n.status <> 'cancelled'
      and n.user_id is not null
    on conflict do nothing;
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

-- A queued flapping summary that hasn't gone out yet: a new drop means the site wasn't OK for 15 min.
-- (Once claimed — the 15 min passed — it goes.)
create function public.engine_cancel_flap_summary(p_incident_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.notifications
    set status = 'cancelled', error = 'Superseded: down again', next_retry_at = null
    where incident_id = p_incident_id and template = 'flap_summary'
      and status = 'queued' and attempts = 0;
$$;

-- Raises the open PROBLEM incident to DOWN (D-021) — S03 body, plus: back to Escalated when a level
-- had fired (D-004), the episode is DOWN, the OK → not-OK flip, the flapping tag, and a held summary
-- cancelled.
create function public.engine_escalate_incident(
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

  update public.incidents
    set severity = 'down',
        episode_severity = 'down',
        detected_at = p_detected_at,
        is_flapping = is_flapping or coalesce(p_flapping, false),
        recovered_at = case when state in ('monitoring', 'needs_root_cause') then null else recovered_at end,
        state = case
          when state in ('monitoring', 'needs_root_cause') then
            case when acked_at is not null then 'acknowledged'::public.incident_state
                 when escalation_level > 0 then 'escalated'::public.incident_state
                 else 'unacked'::public.incident_state end
          else state
        end
    where id = p_incident_id
    returning state into v_to;

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

    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context)
    select p_incident_id, s.primary_owner_id, 'email', 'down', p_incident_id::text, p_context
    from public.sites s
    join public.profiles p on p.id = s.primary_owner_id and p.is_active
    where s.id = v_site_id
    on conflict do nothing;
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

-- A new DOWN / PROBLEM on an incident that has recovered (Monitoring / Needs root cause) joins it
-- (D-004, §19.3): back to Acknowledged if acked, Escalated if a level had fired, else Unacked;
-- severity only goes up; the episode is the new one; timeline, audit, site bookkeeping, the flip,
-- the flapping tag (`p_flapping`, worked out by the engine), a held summary cancelled, and (unless
-- muted) the DOWN AGAIN / PROBLEM AGAIN reply in the thread — Chat only (D-024). The state guard
-- makes overlapping engine runs harmless: the second gets false and queues nothing (S02b carry-over).
-- A DOWN on a recovered PROBLEM incident goes through engine_escalate_incident instead (D-021).
create function public.engine_relapse_incident(
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
  p_status public.site_state default null
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
                     when escalation_level > 0 then 'escalated'::public.incident_state
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
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
    values (p_incident_id, 'google_chat', p_severity::text || '_again', p_incident_id::text,
            p_context, to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    on conflict do nothing;
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

-- ── Chat failed: the fallback email keeps the row's dedupe key ───────────
-- (S02b body; a repeated template — a 2nd DOWN AGAIN — is its own fallback email.) The AGAIN replies
-- are Chat only (D-024), so when Chat fails their email also goes to the person the reply mentions —
-- whoever acknowledged, else the owner — who has no other copy of it.
create or replace function public.queue_fallback_emails(p_notification_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
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
    and not (n.template in ('down', 'problem') and i.state not in ('unacked', 'escalated'))
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

-- ── The engine's reads (db-reviewer M2, S04a) ─────────────────────────────
-- The runner judged every monitor of every active site by passing their ids in a GET query string —
-- near the gateway's 8 KB limit at the PRD's 200 monitors. These read the same rows server-side.

-- Checks of the active sites' HTTP monitors since `p_since`, newest first, keyset-paged on
-- (checked_at, id): a row arriving while the runner pages can't shift another onto the next page.
create function public.engine_checks(
  p_since timestamptz,
  p_after_checked_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 1000
)
returns setof public.check_results
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  -- `execute` plans each call with its values: a plain SQL function here gets one generic plan,
  -- where the optional keyset predicate turns the partition into a sequential scan (db-reviewer).
  v_sql text := 'select c.* from public.check_results c '
    'join public.monitors m on m.id = c.monitor_id and m.type in (''http'', ''keyword'') '
    'join public.sites s on s.id = m.site_id and s.is_active '
    'where c.checked_at >= $1 ';
begin
  if p_after_checked_at is null or p_after_id is null then
    return query execute v_sql || 'order by c.checked_at desc, c.id desc limit $2'
      using p_since, v_limit;
  else
    return query execute v_sql || 'and (c.checked_at, c.id) < ($3, $4) '
      'order by c.checked_at desc, c.id desc limit $2'
      using p_since, v_limit, p_after_checked_at, p_after_id;
  end if;
end;
$$;

-- The carry state of the active sites' monitors.
create function public.engine_monitor_status()
returns setof public.monitor_status
language sql
stable
set search_path = ''
as $$
  select ms.*
  from public.monitor_status ms
  join public.sites s on s.id = ms.site_id and s.is_active;
$$;

-- The browser verifier's jobs for rounds since `p_since`, for the active sites.
create function public.engine_verify_jobs(p_since timestamptz)
returns setof public.verification_jobs
language sql
stable
set search_path = ''
as $$
  select j.*
  from public.verification_jobs j
  join public.sites s on s.id = j.site_id and s.is_active
  where j.kind = 'verify' and j.round_at >= p_since
  -- The newest rounds first: if a flood ever passes max_rows, it is the oldest that drop.
  order by j.round_at desc, j.id desc
  limit 1000;
$$;

create index verification_jobs_verify_round_idx on public.verification_jobs (round_at desc)
  where kind = 'verify';

-- ── A held summary never blocks its thread ───────────────────────────────
-- S02b body, plus: an older `flap_summary` still inside its 15-min hold doesn't hold back newer
-- messages of the same incident (db-reviewer). The ack's 10 s hold still keeps its thread in order.
drop function public.claim_notifications(public.notification_channel, integer, uuid);
create function public.claim_notifications(
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
          and not (older.template = 'flap_summary' and older.hold_until > now())
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

revoke execute on function
  public.engine_record_flip(uuid, timestamptz, boolean),
  public.engine_cancel_flap_summary(uuid),
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state),
  public.engine_recover_incident(uuid, public.incident_state, public.incident_state, timestamptz,
    timestamptz, jsonb, boolean, jsonb, public.site_state, boolean, boolean, boolean),
  public.engine_escalate_incident(uuid, timestamptz, timestamptz, jsonb, boolean, jsonb,
    public.site_state, boolean),
  public.engine_relapse_incident(uuid, public.severity, public.incident_trigger, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, boolean, jsonb, public.site_state),
  public.queue_fallback_emails(uuid),
  public.engine_checks(timestamptz, timestamptz, uuid, integer),
  public.engine_monitor_status(),
  public.engine_verify_jobs(timestamptz),
  public.claim_notifications(public.notification_channel, integer, uuid)
  from public, anon, authenticated;
grant execute on function
  public.engine_record_flip(uuid, timestamptz, boolean),
  public.engine_cancel_flap_summary(uuid),
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state),
  public.engine_recover_incident(uuid, public.incident_state, public.incident_state, timestamptz,
    timestamptz, jsonb, boolean, jsonb, public.site_state, boolean, boolean, boolean),
  public.engine_escalate_incident(uuid, timestamptz, timestamptz, jsonb, boolean, jsonb,
    public.site_state, boolean),
  public.engine_relapse_incident(uuid, public.severity, public.incident_trigger, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, boolean, jsonb, public.site_state),
  public.queue_fallback_emails(uuid),
  public.engine_checks(timestamptz, timestamptz, uuid, integer),
  public.engine_monitor_status(),
  public.engine_verify_jobs(timestamptz),
  public.claim_notifications(public.notification_channel, integer, uuid)
  to service_role;
