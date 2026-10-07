-- DxT Monitor · S03 browser verifier (FR-04, D-001, D-019): the verification job queue the VPS
-- leases through the Job API, the verifier's heartbeat, Admin alerts that aren't about one
-- incident ("verifier unavailable", "queue > 5"), and the private screenshot bucket.

-- ── verification_jobs ─────────────────────────────────────────────────────
-- The queue (D-019, like `notifications` in D-014): `verify` = a blocked round the browser decides
-- (one per monitor and round); `evidence` = the screenshot after a hard-fail DOWN (one per
-- incident, never blocks the alert). The Job API leases rows for 60 s; a lease that runs out
-- without a result expires (the engine then counts the verifier unavailable). Rows and their
-- screenshots are removed after 30 days by the housekeeping cron.
create table public.verification_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('verify', 'evidence')),
  monitor_id uuid not null references public.monitors (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  incident_id uuid references public.incidents (id) on delete cascade,
  -- The blocked round a verify job decides.
  round_at timestamptz,
  url text not null,
  must_contain text[] not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'leased', 'done', 'expired')),
  lease_until timestamptz,
  attempts smallint not null default 0 check (attempts >= 0),
  result text check (result in ('loaded', 'failed')),
  detail text check (char_length(detail) <= 500),
  http_status smallint check (http_status between 100 and 599),
  -- Set by the Job API (never by the agent): `<yyyy-mm>/<job id>.jpg` in `verifier-screenshots`.
  screenshot_path text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'verify') = (round_at is not null)),
  check (kind <> 'evidence' or incident_id is not null),
  check ((status = 'done') = (result is not null))
);

create unique index verification_jobs_once_per_round
  on public.verification_jobs (monitor_id, round_at) where kind = 'verify';
create unique index verification_jobs_evidence_once
  on public.verification_jobs (incident_id) where kind = 'evidence';
create index verification_jobs_open_idx
  on public.verification_jobs (created_at) where status in ('queued', 'leased');
create index verification_jobs_site_id_idx on public.verification_jobs (site_id);
create index verification_jobs_created_idx on public.verification_jobs (created_at);

create trigger verification_jobs_set_updated_at before update on public.verification_jobs
  for each row execute function private.set_updated_at();

-- ── agent_heartbeats ──────────────────────────────────────────────────────
-- Workers outside Vercel that the engine must know are alive. `verifier` is stamped on every
-- Job API poll (every 5 s); no poll for 2 min = verifier unavailable (D-019). `info` carries the
-- agent's own numbers (sessions in use) for the Probes board (S12).
create table public.agent_heartbeats (
  name text primary key check (name in ('verifier')),
  last_seen_at timestamptz not null,
  info jsonb not null default '{}' check (jsonb_typeof(info) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger agent_heartbeats_set_updated_at before update on public.agent_heartbeats
  for each row execute function private.set_updated_at();

-- ── system_alerts ─────────────────────────────────────────────────────────
-- Admin alerts that aren't about one incident (D-019). One open alert per kind: an outage emails
-- each Admin once, however many sites or rounds it touches; it clears when the cause goes away.
create table public.system_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('verifier_unavailable', 'verifier_backlog')),
  opened_at timestamptz not null default now(),
  cleared_at timestamptz,
  context jsonb not null default '{}' check (jsonb_typeof(context) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cleared_at is null or cleared_at >= opened_at)
);

create unique index system_alerts_one_open on public.system_alerts (kind) where cleared_at is null;

create trigger system_alerts_set_updated_at before update on public.system_alerts
  for each row execute function private.set_updated_at();

-- ── notifications: an incident or a system alert ──────────────────────────
alter table public.notifications alter column incident_id drop not null;
alter table public.notifications
  add column system_alert_id uuid references public.system_alerts (id) on delete restrict;
alter table public.notifications
  add constraint notifications_one_subject check (num_nonnulls(incident_id, system_alert_id) = 1);

-- One live message per incident (as before) and per system alert / channel / template / person.
drop index public.notifications_once_per_incident;
create unique index notifications_once_per_incident
  on public.notifications (incident_id, channel, template, user_id) nulls not distinct
  where status <> 'cancelled' and incident_id is not null;
create unique index notifications_once_per_system_alert
  on public.notifications (system_alert_id, channel, template, user_id) nulls not distinct
  where status <> 'cancelled' and system_alert_id is not null;

-- ── Job queue functions (service role) ────────────────────────────────────
-- Leases up to `p_limit` queued jobs, oldest first, for 60 s (SKIP LOCKED keeps two polls apart).
create function public.claim_verification_jobs(p_limit integer default 1)
returns setof public.verification_jobs
language sql
set search_path = ''
as $$
  with due as (
    select id from public.verification_jobs
    where status = 'queued'
    order by created_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.verification_jobs j
    set status = 'leased', lease_until = now() + interval '60 seconds', attempts = j.attempts + 1
    from due
    where j.id = due.id
  returning j.*;
$$;

-- Records a leased job's result while its lease holds; returns the job, or nothing when the lease
-- ran out or the job isn't leased (the Job API answers 409). An evidence screenshot joins the
-- incident's timeline in the same transaction.
create function public.complete_verification_job(
  p_job_id uuid,
  p_result text,
  p_detail text,
  p_http_status smallint,
  p_screenshot_path text
)
returns setof public.verification_jobs
language plpgsql
set search_path = ''
as $$
declare
  v_job public.verification_jobs;
begin
  update public.verification_jobs
    set status = 'done', result = p_result, detail = left(p_detail, 500), http_status = p_http_status,
        screenshot_path = p_screenshot_path, completed_at = now(), lease_until = null
    where id = p_job_id and status = 'leased' and lease_until >= now()
    returning * into v_job;

  if v_job.id is null then
    return;
  end if;

  if v_job.kind = 'evidence' and p_screenshot_path is not null then
    insert into public.incident_events (incident_id, type, payload)
    values (v_job.incident_id, 'evidence',
            jsonb_build_object('screenshotPath', p_screenshot_path, 'result', p_result, 'jobId', v_job.id));
  end if;

  return next v_job;
end;
$$;

-- Jobs that can no longer help: a lease that ran out, a verify job nobody picked up within 2 min
-- (its round is already judged), an evidence job older than 15 min. Returns how many expired.
create function public.expire_verification_jobs()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.verification_jobs
    set status = 'expired', lease_until = null
    where (status = 'leased' and lease_until < now())
       or (status = 'queued' and kind = 'verify' and created_at < now() - interval '2 minutes')
       or (status = 'queued' and kind = 'evidence' and created_at < now() - interval '15 minutes');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Admin alerts (service role) ───────────────────────────────────────────
-- Opens the alert of `p_kind` and queues one email per active Admin, in one transaction. Returns
-- the alert id, or null when one is already open (nothing queued).
create function public.open_system_alert(p_kind text, p_context jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.system_alerts (kind, context)
  values (p_kind, coalesce(p_context, '{}'))
  on conflict (kind) where cleared_at is null do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.audit_log (action, entity, entity_id, after)
  values ('system_alert.opened', 'system_alert', v_id,
          jsonb_build_object('kind', p_kind, 'context', p_context));

  insert into public.notifications (system_alert_id, user_id, channel, template, thread_key, context)
  select v_id, p.id, 'email', p_kind, 'alert-' || v_id::text, coalesce(p_context, '{}')
  from public.profiles p
  where p.role = 'admin' and p.is_active;

  return v_id;
end;
$$;

-- Clears the open alert of `p_kind`, if any. No "back to normal" email (spec §15.3 asks for none).
create function public.clear_system_alert(p_kind text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.system_alerts set cleared_at = now()
    where kind = p_kind and cleared_at is null
    returning id into v_id;
  if v_id is null then
    return false;
  end if;
  insert into public.audit_log (action, entity, entity_id, after)
  values ('system_alert.cleared', 'system_alert', v_id, jsonb_build_object('kind', p_kind));
  return true;
end;
$$;

-- ── Site note ─────────────────────────────────────────────────────────────
-- The latest judged round's note: "Automated check blocked by bot protection; verified via
-- browser" (OK + note), "Blocked, not verified" (PROBLEM unverified), or none. Never from an older
-- round than the one already recorded (engine runs overlap).
create function public.engine_note_site(p_site_id uuid, p_round_at timestamptz, p_note text)
returns void
language sql
set search_path = ''
as $$
  update public.site_status
    set note = p_note
    where site_id = p_site_id and note is distinct from p_note
      and (last_round_at is null or last_round_at <= p_round_at);
$$;

-- ── engine_open_incident: the screenshot after a hard-fail DOWN ───────────
-- Same as S02b, plus the evidence (FR-04): a hard-fail DOWN queues an evidence job for the
-- verifier (async, never holds the alert); a DOWN the browser already decided (blocked → page
-- failed) carries that job in `p_context.verifyJobId`, whose screenshot joins the timeline instead.
create or replace function public.engine_open_incident(
  p_site_id uuid,
  p_monitor_id uuid,
  p_trigger public.incident_trigger,
  p_severity public.severity,
  p_started_at timestamptz,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean
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
    if v_verify_job is null then
      insert into public.verification_jobs (kind, monitor_id, site_id, incident_id, url)
      select 'evidence', m.id, p_site_id, v_id, m.url
      from public.monitors m where m.id = p_monitor_id
      on conflict do nothing;
    else
      update public.verification_jobs set incident_id = v_id where id = v_verify_job;
      insert into public.incident_events (incident_id, type, payload, at)
      select v_id, 'evidence',
             jsonb_build_object('screenshotPath', j.screenshot_path, 'result', j.result, 'jobId', j.id),
             coalesce(j.completed_at, p_detected_at)
      from public.verification_jobs j
      where j.id = v_verify_job and j.screenshot_path is not null;
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

  return v_id;
end;
$$;

revoke execute on function
  public.claim_verification_jobs(integer),
  public.complete_verification_job(uuid, text, text, smallint, text),
  public.expire_verification_jobs(),
  public.open_system_alert(text, jsonb),
  public.clear_system_alert(text),
  public.engine_note_site(uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function
  public.claim_verification_jobs(integer),
  public.complete_verification_job(uuid, text, text, smallint, text),
  public.expire_verification_jobs(),
  public.open_system_alert(text, jsonb),
  public.clear_system_alert(text),
  public.engine_note_site(uuid, timestamptz, text)
  to service_role;

-- ── RLS and grants ────────────────────────────────────────────────────────
-- People only read; the engine and the Job API write as the service role.
alter table public.verification_jobs enable row level security;
alter table public.agent_heartbeats enable row level security;
alter table public.system_alerts enable row level security;

create policy verification_jobs_select_staff on public.verification_jobs
  for select to authenticated using ((select public.is_staff()));
create policy agent_heartbeats_select_staff on public.agent_heartbeats
  for select to authenticated using ((select public.is_staff()));
create policy system_alerts_select_admin on public.system_alerts
  for select to authenticated using ((select public.current_app_role()) = 'admin');

revoke all on public.verification_jobs, public.agent_heartbeats, public.system_alerts
  from public, anon, authenticated;
grant select on public.verification_jobs, public.agent_heartbeats, public.system_alerts to authenticated;
grant all on public.verification_jobs, public.agent_heartbeats, public.system_alerts to service_role;

-- ── Screenshot bucket ─────────────────────────────────────────────────────
-- Private, JPEG only, 1 MB at most. No policies for people: the VPS uploads through a signed upload
-- URL the Job API issues with the lease, and pages read through signed URLs (S07).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verifier-screenshots', 'verifier-screenshots', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;
