-- DxT Monitor · probes, check results, site status, incidents and notifications (PRD §11, S02a).
-- Written only by server jobs with the service role (probes, engine, notifier); staff read.
-- The engine's writes that must happen together (open / recover / settle an incident) are SQL
-- functions so each one is a single transaction: an incident is never open without its alert.

-- The table site_status (PRD §11) needs the name that the 0001 enum took: the enum becomes
-- site_state (values unchanged; packages/shared SITE_STATUSES still mirrors them).
alter type public.site_status rename to site_state;

-- ── probe_locations ───────────────────────────────────────────────────────
-- Reference data: the three places checks run from. Keyed by the code the probes report.
create table public.probe_locations (
  code text primary key check (code in ('BKK', 'SIN', 'TYO')),
  region text not null,
  provider text not null check (provider in ('vercel', 'vps')),
  last_heartbeat_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bangkok joins with the VPS agent (S03); until then a DOWN needs SIN and TYO.
insert into public.probe_locations (code, region, provider, is_active) values
  ('BKK', 'th-bkk', 'vps', false),
  ('SIN', 'sin1', 'vercel', true),
  ('TYO', 'hnd1', 'vercel', true);

-- ── check_results ─────────────────────────────────────────────────────────
-- One row per HTTP check. Monthly range partitions (PRD §11), kept 90 days. Append-only and
-- written by probes only, so there is no updated_at. `attempt` (an addition to PRD §11) tells a
-- scheduled check (1) from its immediate recheck (2): the engine counts each location once per round.
create table public.check_results (
  id uuid not null default gen_random_uuid(),
  monitor_id uuid not null references public.monitors (id) on delete restrict,
  location text not null references public.probe_locations (code) on delete restrict,
  checked_at timestamptz not null,
  attempt smallint not null default 1 check (attempt in (1, 2)),
  outcome public.check_outcome not null,
  status_code smallint check (status_code between 100 and 599),
  response_ms integer check (response_ms >= 0),
  ttfb_ms integer check (ttfb_ms >= 0),
  resolved_ip inet,
  error text,
  created_at timestamptz not null default now(),
  primary key (id, checked_at)
) partition by range (checked_at);

create index check_results_monitor_idx on public.check_results (monitor_id, checked_at desc);
create index check_results_monitor_location_idx
  on public.check_results (monitor_id, location, checked_at desc);

-- Partitions live in `private` (not exposed by the API): a partition has no RLS of its own, so
-- it must only be reachable through the parent table and its policies.
-- Creates this month's and the next two months' partitions and drops months that ended more than
-- 90 days ago. Runs nightly (pg_cron below) and once now.
create function private.manage_check_results_partitions(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_name text;
  v_part record;
begin
  for i in 0..2 loop
    v_month := (date_trunc('month', p_now at time zone 'UTC') + make_interval(months => i))::date;
    v_name := 'check_results_' || to_char(v_month, 'YYYY_MM');
    if to_regclass('private.' || v_name) is null then
      execute format(
        'create table private.%I partition of public.check_results for values from (%L) to (%L)',
        v_name,
        v_month::timestamp at time zone 'UTC',
        (v_month + interval '1 month')::timestamp at time zone 'UTC'
      );
      execute format('revoke all on private.%I from public, anon, authenticated', v_name);
    end if;
  end loop;

  for v_part in
    select c.relname
    from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where i.inhparent = 'public.check_results'::regclass
      and n.nspname = 'private'
      and c.relname ~ '^check_results_\d{4}_\d{2}$'
  loop
    if (to_date(right(v_part.relname, 7), 'YYYY_MM') + interval '1 month')
       <= (p_now at time zone 'UTC') - interval '90 days' then
      execute format('drop table private.%I', v_part.relname);
    end if;
  end loop;
end;
$$;

revoke execute on function private.manage_check_results_partitions(timestamptz)
  from public, anon, authenticated;

select private.manage_check_results_partitions();

select cron.schedule(
  'check-results-partitions',
  '17 19 * * *', -- 02:17 Bangkok, outside the busy hours
  $$select private.manage_check_results_partitions()$$
);

-- ── site_status ───────────────────────────────────────────────────────────
-- Current state per site (one row per site, keyed by site_id). The engine keeps its round
-- bookkeeping here so it stays stateless (PRD §10): `last_round_at` = the scheduled-check time of
-- the last round it judged, `ok_rounds` = OK rounds in a row since the last failure.
create table public.site_status (
  site_id uuid primary key references public.sites (id) on delete cascade,
  status public.site_state not null default 'ok',
  since timestamptz not null default now(),
  note text,
  last_evaluated_at timestamptz,
  last_round_at timestamptz,
  ok_rounds smallint not null default 0 check (ok_rounds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── incidents ─────────────────────────────────────────────────────────────
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  -- Shown as INC-0007 (D-013).
  number bigint generated always as identity unique,
  site_id uuid not null references public.sites (id) on delete restrict,
  monitor_id uuid references public.monitors (id) on delete restrict,
  trigger public.incident_trigger not null,
  severity public.severity not null,
  state public.incident_state not null default 'unacked',
  -- First failed check (spec §6: duration counts from here) and when DOWN was confirmed.
  started_at timestamptz not null,
  detected_at timestamptz not null,
  acked_at timestamptz,
  acked_by uuid references public.profiles (id) on delete restrict,
  recovered_at timestamptz,
  resolved_at timestamptz,
  root_cause text,
  root_cause_category text,
  escalation_level smallint not null default 0 check (escalation_level between 0 and 3),
  is_flapping boolean not null default false,
  is_manual boolean not null default false,
  client_update_required boolean not null default false,
  client_update_due_at timestamptz,
  client_updated_at timestamptz,
  client_updated_by uuid references public.profiles (id) on delete restrict,
  client_update_note text,
  review_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (detected_at >= started_at)
);

-- One open incident per site: a relapse joins it (D-004), and two engine runs can't open two.
create unique index incidents_one_open_per_site on public.incidents (site_id)
  where state not in ('resolved', 'in_review', 'closed');
create index incidents_site_started_idx on public.incidents (site_id, started_at desc);
create index incidents_monitor_id_idx on public.incidents (monitor_id);

-- ── incident_events ───────────────────────────────────────────────────────
-- The incident timeline. Append-only by convention: written by the engine, notifier and (later)
-- actions; nobody edits history.
create table public.incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete restrict,
  type text not null check (type ~ '^[a-z_]+$'),
  -- null = the system.
  actor_id uuid references public.profiles (id) on delete restrict,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  at timestamptz not null default now()
);

create index incident_events_incident_idx on public.incident_events (incident_id, at);

-- ── notifications ─────────────────────────────────────────────────────────
-- One row per outgoing message (delivery audit). A channel post has no user_id; per-person email
-- comes in S02b. `context` holds the facts the message is rendered from at send time; `thread_key`
-- keeps every message of an incident in one Chat thread (PRD §7).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete restrict,
  user_id uuid references public.profiles (id) on delete restrict,
  channel public.notification_channel not null,
  template text not null check (template ~ '^[a-z_]+$'),
  status public.notification_status not null default 'queued',
  attempts smallint not null default 0 check (attempts >= 0),
  hold_until timestamptz,
  next_retry_at timestamptz,
  thread_key text,
  context jsonb not null default '{}' check (jsonb_typeof(context) = 'object'),
  provider_message_id text,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The same message can't be queued twice for one incident (two engine runs, a retry).
create unique index notifications_once_per_incident
  on public.notifications (incident_id, channel, template, user_id) nulls not distinct;
create index notifications_due_idx on public.notifications (status, next_retry_at);
create index notifications_user_id_idx on public.notifications (user_id);

-- ── updated_at ────────────────────────────────────────────────────────────
create trigger probe_locations_set_updated_at before update on public.probe_locations
  for each row execute function private.set_updated_at();
create trigger site_status_set_updated_at before update on public.site_status
  for each row execute function private.set_updated_at();
create trigger incidents_set_updated_at before update on public.incidents
  for each row execute function private.set_updated_at();
create trigger notifications_set_updated_at before update on public.notifications
  for each row execute function private.set_updated_at();

-- ── Engine writes (service role only) ─────────────────────────────────────
-- Each function is one transaction. The engine decides (packages/engine); these only record.

-- Opens a DOWN incident for the site, with its timeline event, site status and (unless muted) the
-- DOWN Chat message. Returns the new incident id, or null when the site already has an open one.
create function public.engine_open_incident(
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

  -- Every incident state change is audited (CLAUDE.md → Audit); actor null = the engine.
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
        ok_rounds = 0;

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context)
    values (v_id, 'google_chat', p_severity::text, v_id::text, p_context);
  end if;

  return v_id;
end;
$$;

-- First OK round after a failure: the incident moves to `p_to` (Monitoring, decided by the
-- engine's lifecycle) if it is still in `p_from`, and the RECOVERED message is queued.
-- Returns false when the incident had already moved on.
create function public.engine_recover_incident(
  p_incident_id uuid,
  p_from public.incident_state,
  p_to public.incident_state,
  p_recovered_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean
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
    where site_id = v_site_id;

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context)
    values (p_incident_id, 'google_chat', 'recovered', p_incident_id::text, p_context)
    on conflict do nothing;
  end if;

  return true;
end;
$$;

-- Second OK round in a row: the site is OK again and the incident moves to `p_to` (Needs root
-- cause, or stays in Monitoring when a root cause is already written — engine lifecycle).
create function public.engine_settle_incident(
  p_incident_id uuid,
  p_from public.incident_state,
  p_to public.incident_state,
  p_at timestamptz,
  p_round_at timestamptz
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
    where site_id = v_site_id;

  return true;
end;
$$;

-- Claims due Chat / email messages for one notifier run. Rows are locked with SKIP LOCKED so two
-- runs never send the same message, and leased for 2 minutes (next_retry_at) in case a run dies.
create function public.claim_notifications(p_limit integer default 20)
returns setof public.notifications
language sql
set search_path = ''
as $$
  with due as (
    select id from public.notifications
    where status = 'queued'
      and (hold_until is null or hold_until <= now())
      and (next_retry_at is null or next_retry_at <= now())
    order by created_at
    limit p_limit
    for update skip locked
  )
  update public.notifications n
    set attempts = n.attempts + 1, next_retry_at = now() + interval '2 minutes'
    from due
    where n.id = due.id
  returning n.*;
$$;

revoke execute on function
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz, timestamptz, timestamptz, jsonb, boolean),
  public.engine_recover_incident(uuid, public.incident_state, public.incident_state, timestamptz, timestamptz, jsonb, boolean),
  public.engine_settle_incident(uuid, public.incident_state, public.incident_state, timestamptz, timestamptz),
  public.claim_notifications(integer)
  from public, anon, authenticated;
grant execute on function
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz, timestamptz, timestamptz, jsonb, boolean),
  public.engine_recover_incident(uuid, public.incident_state, public.incident_state, timestamptz, timestamptz, jsonb, boolean),
  public.engine_settle_incident(uuid, public.incident_state, public.incident_state, timestamptz, timestamptz),
  public.claim_notifications(integer)
  to service_role;

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Read-only for people: staff see monitoring data and incidents; only Admins see the delivery log.
-- No insert / update / delete policies — writes come from the service role (bypasses RLS).
alter table public.probe_locations enable row level security;
alter table public.check_results enable row level security;
alter table public.site_status enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_events enable row level security;
alter table public.notifications enable row level security;

create policy probe_locations_select_staff on public.probe_locations
  for select to authenticated using ((select public.is_staff()));
create policy check_results_select_staff on public.check_results
  for select to authenticated using ((select public.is_staff()));
create policy site_status_select_staff on public.site_status
  for select to authenticated using ((select public.is_staff()));
create policy incidents_select_staff on public.incidents
  for select to authenticated using ((select public.is_staff()));
create policy incident_events_select_staff on public.incident_events
  for select to authenticated using ((select public.is_staff()));
create policy notifications_select_admin on public.notifications
  for select to authenticated using ((select public.current_app_role()) = 'admin');

-- ── Grants (auto_expose_new_tables = false) ───────────────────────────────
revoke all on public.probe_locations, public.check_results, public.site_status, public.incidents,
  public.incident_events, public.notifications from public, anon, authenticated;
grant select on public.probe_locations, public.check_results, public.site_status, public.incidents,
  public.incident_events, public.notifications to authenticated;
grant all on public.probe_locations, public.check_results, public.site_status, public.incidents,
  public.incident_events, public.notifications to service_role;
