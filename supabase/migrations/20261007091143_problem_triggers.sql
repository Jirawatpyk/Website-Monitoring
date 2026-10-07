-- DxT Monitor · S04a PROBLEM triggers & status rules (FR-03, D-022): what the probe saw beyond
-- pass / fail / blocked (final URL, keyword result), the per-monitor state the engine carries from
-- round to round (slow streak, per-location failing-since, last verdict), site status worked out
-- from every monitor's verdict in the same transaction as the incident change, and the Admin alert
-- when fewer than 2 probe locations are beating.
--
-- Deploy order: apply this migration BEFORE the code that passes p_monitors / p_status. The old code
-- keeps working against the new functions (the new parameters default to null), but the new code
-- gets "function not found" from the old ones. Production waits for `migrate-production` (Deployment
-- Checks); on staging run `pnpm db:push:staging` before pushing the branch to `staging`.

-- ── check_results: keyword and redirect facts ────────────────────────────
-- Null = not checked (no keywords on the monitor, a HEAD request, or a check that got no answer).
-- Keyword and redirect results never make a check fail; the engine turns them into PROBLEMs.
alter table public.check_results
  add column final_url text check (char_length(final_url) <= 2048),
  add column keyword_missing text[] check (cardinality(keyword_missing) <= 20),
  add column keyword_forbidden text[] check (cardinality(keyword_forbidden) <= 20);

-- ── monitor_status ────────────────────────────────────────────────────────
-- One row per monitor (keyed by monitor_id, like site_status, D-014): the engine's carry state that
-- the lookback window can't give — slow streak (3 rounds in a row, up to 15 min on Tier 3) and when
-- each location started failing (regional ≥ 5 min) — plus the monitor's last verdict, which the
-- site status is the worst of (D-022). Written only by the engine functions, never backwards.
create table public.monitor_status (
  monitor_id uuid primary key references public.monitors (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  last_round_at timestamptz not null,
  status public.site_state not null default 'ok' check (status <> 'maintenance'),
  -- The PROBLEM trigger behind a `problem` verdict, and its cause line.
  trigger public.incident_trigger,
  cause text check (char_length(cause) <= 500),
  -- Rounds in a row whose p50 was over the slow threshold.
  slow_rounds smallint not null default 0 check (slow_rounds between 0 and 100),
  -- {"SIN": "2026-09-14T14:12:00Z"}: the first failed scheduled check of each location still failing.
  failing_since jsonb not null default '{}' check (jsonb_typeof(failing_since) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'problem') = (trigger is not null))
);

create index monitor_status_site_id_idx on public.monitor_status (site_id);

create trigger monitor_status_set_updated_at before update on public.monitor_status
  for each row execute function private.set_updated_at();

alter table public.monitor_status enable row level security;
create policy monitor_status_select_staff on public.monitor_status
  for select to authenticated using ((select public.is_staff()));
revoke all on public.monitor_status from public, anon, authenticated;
grant select on public.monitor_status to authenticated;
grant all on public.monitor_status to service_role;

-- ── system_alerts: fewer than 2 locations ─────────────────────────────────
-- PRD §5: fewer than 2 locations → statuses stay as they are and the Admin is told (D-022).
alter table public.system_alerts drop constraint system_alerts_kind_check;
alter table public.system_alerts add constraint system_alerts_kind_check
  check (kind in ('verifier_unavailable', 'verifier_backlog', 'probe_locations_low'));

-- ── engine_write_monitors ─────────────────────────────────────────────────
-- Writes the judged round's monitor verdicts (`p_monitors`: [{monitorId, status, trigger, cause,
-- slowRounds, failingSince}]) and the site status worked out from them (`p_status`). Each engine
-- function below calls it inside its own transaction, so the carry state and the incident change
-- commit together. A monitor row never moves back to an older round. The site
-- status follows the same never-backwards rule as the rest of site_status. Inline SQL: functions
-- the service role calls can't reach `private` (supabase/CLAUDE.md).
create function public.engine_write_monitors(
  p_site_id uuid,
  p_round_at timestamptz,
  p_monitors jsonb,
  p_status public.site_state
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_monitors is not null then
    insert into public.monitor_status as ms
      (monitor_id, site_id, last_round_at, status, trigger, cause, slow_rounds, failing_since)
    select (d.m ->> 'monitorId')::uuid, p_site_id, p_round_at,
           (d.m ->> 'status')::public.site_state,
           nullif(d.m ->> 'trigger', '')::public.incident_trigger,
           left(nullif(d.m ->> 'cause', ''), 500),
           coalesce((d.m ->> 'slowRounds')::smallint, 0),
           coalesce(d.m -> 'failingSince', '{}')
    -- One row per monitor even if the list names one twice (the last wins).
    from (
      select distinct on (e ->> 'monitorId') e as m
      from jsonb_array_elements(p_monitors) with ordinality as x(e, n)
      order by e ->> 'monitorId', n desc
    ) d
    -- Only this site's monitors.
    join public.monitors mon on mon.id = (d.m ->> 'monitorId')::uuid and mon.site_id = p_site_id
    on conflict (monitor_id) do update
      set last_round_at = excluded.last_round_at, status = excluded.status,
          trigger = excluded.trigger, cause = excluded.cause,
          slow_rounds = excluded.slow_rounds, failing_since = excluded.failing_since
      -- Same round again (overlapping runs judge it from the same prior state): the same values, so
      -- `<=` rewrites them harmlessly and keeps the monitor in step with site_status's `<=` guard.
      where ms.last_round_at <= excluded.last_round_at;
  end if;

  if p_status is not null then
    update public.site_status
      set status = p_status, since = p_round_at
      where site_id = p_site_id and status is distinct from p_status
        and (last_round_at is null or last_round_at <= p_round_at);
  end if;
end;
$$;

-- ── Engine functions gain the round's monitor verdicts ───────────────────
-- Same bodies as before (S02b, S03, D-021), each with `p_monitors` / `p_status` written at the end
-- of its transaction. The old signatures go: an added parameter would otherwise leave an overload.
drop function public.engine_record_round(uuid, timestamptz, timestamptz, smallint);
drop function public.engine_open_incident(
  uuid, uuid, public.incident_trigger, public.severity, timestamptz, timestamptz, timestamptz, jsonb, boolean);
drop function public.engine_recover_incident(
  uuid, public.incident_state, public.incident_state, timestamptz, timestamptz, jsonb, boolean);
drop function public.engine_settle_incident(
  uuid, public.incident_state, public.incident_state, timestamptz, timestamptz);
drop function public.engine_escalate_incident(uuid, timestamptz, timestamptz, jsonb, boolean);

-- A judged round with no incident change. Engine runs overlap (the probe that completes a round
-- runs one, the cron another): a run holding an older snapshot never moves the round back.
create function public.engine_record_round(
  p_site_id uuid,
  p_round_at timestamptz,
  p_evaluated_at timestamptz,
  p_ok_rounds smallint,
  p_monitors jsonb default null,
  p_status public.site_state default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.site_status as s (site_id, last_round_at, last_evaluated_at, ok_rounds)
  values (p_site_id, p_round_at, p_evaluated_at, p_ok_rounds)
  on conflict (site_id) do update
    set last_round_at = excluded.last_round_at, last_evaluated_at = excluded.last_evaluated_at,
        ok_rounds = excluded.ok_rounds
    where s.last_round_at is null or s.last_round_at < excluded.last_round_at;

  perform public.engine_write_monitors(p_site_id, p_round_at, p_monitors, p_status);
end;
$$;

-- Opens the incident (one open per site) with its event, audit, site status, the evidence job for a
-- hard-fail DOWN, and (unless muted) the Chat post + owner email — `template` = severity, so a
-- PROBLEM (any trigger, PROBLEM (unverified) included, D-019) queues `problem`.
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
  insert into public.incidents (site_id, monitor_id, trigger, severity, started_at, detected_at)
  values (p_site_id, p_monitor_id, p_trigger, p_severity, p_started_at, p_detected_at)
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

-- First OK round: Monitoring, RECOVERED (to everyone already emailed), a Chat DOWN / PROBLEM still
-- waiting for a retry dropped so RECOVERED isn't stuck behind it.
create function public.engine_recover_incident(
  p_incident_id uuid,
  p_from public.incident_state,
  p_to public.incident_state,
  p_recovered_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
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
begin
  update public.incidents
    set state = p_to, recovered_at = p_recovered_at
    where id = p_incident_id and state = p_from
    returning site_id into v_site_id;

  if v_site_id is null then
    return false;
  end if;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'recovered', p_context, p_recovered_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.recovered', 'incident', p_incident_id,
          jsonb_build_object('state', p_from),
          jsonb_build_object('state', p_to, 'recovered_at', p_recovered_at));

  update public.site_status
    set ok_rounds = 1, last_evaluated_at = p_recovered_at, last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  update public.notifications n
    set status = 'cancelled', error = 'Superseded: recovered first', next_retry_at = null
    where n.incident_id = p_incident_id and n.channel = 'google_chat'
      and n.template in ('down', 'problem') and n.status = 'queued' and n.attempts > 0
      -- waiting for a retry, not in flight: every attempt it was claimed for is logged
      and n.attempts = (select count(*) from public.notification_attempts a where a.notification_id = n.id);

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context)
    values (p_incident_id, 'google_chat', 'recovered', p_incident_id::text, p_context)
    on conflict do nothing;

    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context)
    select distinct p_incident_id, n.user_id, 'email'::public.notification_channel, 'recovered',
           p_incident_id::text, p_context
    from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'email' and n.status <> 'cancelled'
      and n.user_id is not null
    on conflict do nothing;
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

-- Second OK round in a row: the site is OK; Needs root cause (or stays in Monitoring).
create function public.engine_settle_incident(
  p_incident_id uuid,
  p_from public.incident_state,
  p_to public.incident_state,
  p_at timestamptz,
  p_round_at timestamptz,
  p_monitors jsonb default null,
  p_status public.site_state default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_site_id uuid;
begin
  update public.incidents
    set state = p_to
    where id = p_incident_id and state = p_from
    returning site_id into v_site_id;

  if v_site_id is null then
    return false;
  end if;

  if p_to is distinct from p_from then
    insert into public.incident_events (incident_id, type, payload, at)
    values (p_incident_id, 'ok_two_rounds', jsonb_build_object('state', p_to), p_at);

    insert into public.audit_log (action, entity, entity_id, before, after)
    values ('incident.state', 'incident', p_incident_id,
            jsonb_build_object('state', p_from), jsonb_build_object('state', p_to));
  end if;

  update public.site_status
    set status = 'ok', since = p_at, ok_rounds = 2, last_evaluated_at = p_at,
        last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

-- Raises the open PROBLEM incident to DOWN (D-021): severity, "Confirmed down", back to waiting for
-- an ack when it had recovered, timeline, audit, site status, and (unless muted) the DOWN alert.
create function public.engine_escalate_incident(
  p_incident_id uuid,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
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
        detected_at = p_detected_at,
        recovered_at = case when state in ('monitoring', 'needs_root_cause') then null else recovered_at end,
        state = case
          when state in ('monitoring', 'needs_root_cause') then
            case when acked_at is not null then 'acknowledged'::public.incident_state else 'unacked'::public.incident_state end
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

revoke execute on function
  public.engine_write_monitors(uuid, timestamptz, jsonb, public.site_state),
  public.engine_record_round(uuid, timestamptz, timestamptz, smallint, jsonb, public.site_state),
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state),
  public.engine_recover_incident(uuid, public.incident_state, public.incident_state, timestamptz,
    timestamptz, jsonb, boolean, jsonb, public.site_state),
  public.engine_settle_incident(uuid, public.incident_state, public.incident_state, timestamptz,
    timestamptz, jsonb, public.site_state),
  public.engine_escalate_incident(uuid, timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state)
  from public, anon, authenticated;
grant execute on function
  public.engine_write_monitors(uuid, timestamptz, jsonb, public.site_state),
  public.engine_record_round(uuid, timestamptz, timestamptz, smallint, jsonb, public.site_state),
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state),
  public.engine_recover_incident(uuid, public.incident_state, public.incident_state, timestamptz,
    timestamptz, jsonb, boolean, jsonb, public.site_state),
  public.engine_settle_incident(uuid, public.incident_state, public.incident_state, timestamptz,
    timestamptz, jsonb, public.site_state),
  public.engine_escalate_incident(uuid, timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state)
  to service_role;
