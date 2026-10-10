-- S08 (FR-09a, D-034): escalation L0–L1 and response hours.
--   · escalation_policies / escalation_steps — the Escalation board's four policies, as config (PRD §11);
--   · organisation_settings (response hours for Tier 2–3, reminder intervals) and company_holidays,
--     edited in S17 (Organisation) — seeded here;
--   · incidents.escalation_plan — the policy an incident opened with (open incidents keep their timers);
--   · engine_fire_step / engine_remind — the ladder's guarded writes, called by the engine runner (the
--     pure rule that decides *when* is @dxt/engine escalation.ts);
--   · a Tier 2–3 PROBLEM outside response hours is held until the next opening (§7, §19.2), never
--     blocks its thread, and is cancelled if it clears or is acknowledged first (§19.6);
--   · save_escalation_policies — the Admin's one write path, re-checking every guardrail (§14.7, §15.5).
-- Nothing here queues the new templates (`step_fired`, `reminder`): only the S08 runner calls the
-- functions that do, so a migration that lands before the code can't queue a message nobody renders.

-- ── Tables ──────────────────────────────────────────────────────────────────
create table public.escalation_policies (
  id uuid primary key default gen_random_uuid(),
  severity public.severity not null,
  -- null = every tier (the PROBLEM policy).
  tier smallint check (tier between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint escalation_policies_shape check ((severity = 'down') = (tier is not null))
);
create unique index escalation_policies_key on public.escalation_policies (severity, tier) nulls not distinct;

create table public.escalation_steps (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.escalation_policies (id) on delete cascade,
  level smallint not null check (level between 0 and 3),
  -- Minutes after "Confirmed down" (response-hours minutes for Tier 2–3).
  delay_min integer not null check (delay_min >= 0 and delay_min <= 10080),
  -- Role tokens (D-034): mirrors ESCALATION_TARGETS in packages/shared.
  targets text[] not null check (targets <@ array['owner', 'backup', 'admins', 'site_am', 'ceo']),
  -- chat = @mention in the thread · space = the Alerts Space post · email · voice (S10, off).
  channels text[] not null check (channels <@ array['chat', 'space', 'email', 'voice']),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id, level)
);

create table public.organisation_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  -- Response hours (spec §7, §14.14): one value for Tier 2–3, in Asia/Bangkok; ISO days 1 = Monday.
  response_start time not null default '09:00',
  response_end time not null default '18:00',
  response_days smallint[] not null default array[1, 2, 3, 4, 5]::smallint[]
    check (response_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[] and cardinality(response_days) > 0),
  down_reminder_min integer not null default 15 check (down_reminder_min between 1 and 1440),
  problem_reminder_min integer not null default 60 check (problem_reminder_min between 1 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisation_settings_hours check (response_start < response_end)
);

create table public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  name text not null check (length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger escalation_policies_set_updated_at before update on public.escalation_policies
  for each row execute function private.set_updated_at();
create trigger escalation_steps_set_updated_at before update on public.escalation_steps
  for each row execute function private.set_updated_at();
create trigger organisation_settings_set_updated_at before update on public.organisation_settings
  for each row execute function private.set_updated_at();
create trigger company_holidays_set_updated_at before update on public.company_holidays
  for each row execute function private.set_updated_at();

-- Holidays are config: every change is in the audit log (S17 edits them; SQL until then). Policies,
-- steps and the reminder intervals change only through save_escalation_policies, which writes one
-- audit row with the Admin's note.
create trigger company_holidays_audit after insert or update or delete on public.company_holidays
  for each row execute function private.audit_row_change('holiday');

-- Staff read (the incident page shows the ladder; the Escalation page is Admin-only in the app);
-- nobody writes through the API — the Admin saves through save_escalation_policies.
alter table public.escalation_policies enable row level security;
alter table public.escalation_steps enable row level security;
alter table public.organisation_settings enable row level security;
alter table public.company_holidays enable row level security;

create policy escalation_policies_select_staff on public.escalation_policies
  for select to authenticated using ((select public.is_staff()));
create policy escalation_steps_select_staff on public.escalation_steps
  for select to authenticated using ((select public.is_staff()));
create policy organisation_settings_select_staff on public.organisation_settings
  for select to authenticated using ((select public.is_staff()));
create policy company_holidays_select_staff on public.company_holidays
  for select to authenticated using ((select public.is_staff()));

revoke all on public.escalation_policies, public.escalation_steps, public.organisation_settings,
  public.company_holidays from public, anon, authenticated;
grant select on public.escalation_policies, public.escalation_steps, public.organisation_settings,
  public.company_holidays to authenticated;
grant all on public.escalation_policies, public.escalation_steps, public.organisation_settings,
  public.company_holidays to service_role;

-- ── Seeds (real defaults, not sample data) ──────────────────────────────────
insert into public.organisation_settings (singleton) values (true);

with p as (
  insert into public.escalation_policies (severity, tier) values
    ('down', 1), ('down', 2), ('down', 3), ('problem', null)
  returning id, severity
)
insert into public.escalation_steps (policy_id, level, delay_min, targets, channels)
select p.id, s.level, s.delay_min, s.targets, s.channels
from p
cross join lateral (
  values
    (0::smallint, 0, array['owner'], array['chat', 'space', 'email']),
    (1::smallint, case when p.severity = 'down' then 15 else 60 end,
     case when p.severity = 'down' then array['backup', 'admins'] else array['backup'] end,
     array['chat', 'email'])
) as s (level, delay_min, targets, channels);

-- Thai public holidays with a fixed date, and their substitute days, from October 2026 through 2027
-- (Tao, 10 Oct 2026). Buddhist holidays follow the lunar calendar and are announced each year: add
-- them, and any company day, with supabase/access/holidays.template.sql until S17.
insert into public.company_holidays (day, name) values
  ('2026-10-13', 'King Bhumibol Memorial Day'),
  ('2026-10-23', 'Chulalongkorn Day'),
  ('2026-12-07', 'Father''s Day (substitute)'),
  ('2026-12-10', 'Constitution Day'),
  ('2026-12-31', 'New Year''s Eve'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-04-06', 'Chakri Day'),
  ('2027-04-13', 'Songkran'),
  ('2027-04-14', 'Songkran'),
  ('2027-04-15', 'Songkran'),
  ('2027-05-03', 'Labour Day (substitute)'),
  ('2027-05-04', 'Coronation Day'),
  ('2027-06-03', 'Queen Suthida''s Birthday'),
  ('2027-07-28', 'King Vajiralongkorn''s Birthday'),
  ('2027-08-12', 'Mother''s Day'),
  ('2027-10-13', 'King Bhumibol Memorial Day'),
  ('2027-10-25', 'Chulalongkorn Day (substitute)'),
  ('2027-12-06', 'Father''s Day (substitute)'),
  ('2027-12-10', 'Constitution Day'),
  ('2027-12-31', 'New Year''s Eve');

-- ── The plan an incident keeps ──────────────────────────────────────────────
alter table public.incidents add column escalation_plan jsonb
  check (escalation_plan is null or jsonb_typeof(escalation_plan) = 'object');

-- The policy for a tier and severity with the reminder interval, as the incident keeps it:
-- {severity, tier, reminderMin, steps: [{level, delayMin, targets, channels}]}. Service role only.
create function public.escalation_plan_for(p_tier smallint, p_severity public.severity)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'severity', p.severity,
    'tier', p_tier,
    'reminderMin', case when p.severity = 'down' then o.down_reminder_min else o.problem_reminder_min end,
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object('level', s.level, 'delayMin', s.delay_min,
                                          'targets', to_jsonb(s.targets), 'channels', to_jsonb(s.channels))
                       order by s.level)
      from public.escalation_steps s where s.policy_id = p.id), '[]'::jsonb))
  from public.escalation_policies p
  cross join public.organisation_settings o
  where p.severity = p_severity and (p.tier = p_tier or (p_severity = 'problem' and p.tier is null));
$$;

-- Incidents opened before S08 keep no plan, so the ladder never starts on them: an incident that
-- opened days ago would otherwise page its backup the minute this ships.

-- ── Open: the plan, and the PROBLEM hold ────────────────────────────────────
-- S04b body, plus: the incident keeps its plan, and `p_hold_until` (a Tier 2–3 PROBLEM outside
-- response hours, worked out by the runner from organisation_settings / company_holidays) holds the
-- card and the owner email until the next opening.
drop function public.engine_open_incident(
  uuid, uuid, public.incident_trigger, public.severity, timestamptz, timestamptz, timestamptz, jsonb,
  boolean, jsonb, public.site_state);

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
    select v_id, s.primary_owner_id, 'email', p_severity::text, v_id::text, p_context, v_hold
    from public.sites s
    join public.profiles p on p.id = s.primary_owner_id and p.is_active
    where s.id = p_site_id;
  end if;

  perform public.engine_write_monitors(p_site_id, p_round_at, p_monitors, p_status);
  return v_id;
end;
$$;

-- A PROBLEM card or PROBLEM AGAIN reply (and the owner email) still held for response hours: never
-- sent, never claimed.
create function public.engine_cancel_held_problem(p_incident_id uuid, p_reason text)
returns integer
language sql
set search_path = ''
as $$
  with c as (
    update public.notifications
      set status = 'cancelled', error = p_reason, next_retry_at = null
      where incident_id = p_incident_id and template in ('problem', 'problem_again')
        and status = 'queued' and attempts = 0 and hold_until > now()
      returning 1
  )
  select count(*)::integer from c;
$$;

-- The ladder's messages still waiting (a step or reminder not yet claimed, or held back for a retry):
-- an ack or a recovery stops the chain (spec §8), so they never go, and they don't hold ACKNOWLEDGED /
-- RECOVERED back in the thread. One the notifier is sending right now (claimed, attempt not logged)
-- goes.
create function public.engine_cancel_ladder(p_incident_id uuid, p_reason text)
returns integer
language sql
set search_path = ''
as $$
  with c as (
    update public.notifications n
      set status = 'cancelled', error = p_reason, next_retry_at = null
      where n.incident_id = p_incident_id and n.template in ('step_fired', 'reminder')
        and n.status = 'queued'
        and n.attempts = (select count(*) from public.notification_attempts a where a.notification_id = n.id)
      returning 1
  )
  select count(*)::integer from c;
$$;

-- ── Recover: a held PROBLEM that clears posts nothing ──────────────────────
-- S04b body, plus: a PROBLEM card still held for response hours is cancelled, and RECOVERED (or the
-- flapping summary) is queued only if an alert actually went or is going to the thread (§19.6).
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
      and n.user_id is not null
    on conflict do nothing;
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

-- ── D-021: a PROBLEM raised to DOWN starts the DOWN ladder ──────────────────
-- S04b body, plus (D-034): the incident takes the DOWN policy; unless someone acknowledged, the
-- level returns to 0 and the state to Unacked (the DOWN clock starts at the new "Confirmed down");
-- a PROBLEM card still held for response hours is dropped — the DOWN card posts now and starts the
-- thread.
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

-- ── Relapse: PROBLEM AGAIN waits for response hours too ─────────────────────
-- S07 body (20261009120515), plus `p_hold_until`: a Tier 2–3 PROBLEM AGAIN outside response hours is
-- held until the next opening like the first card (spec §7, §19.2), and cancelled with it if the site
-- clears first. DOWN AGAIN always posts at once.
drop function public.engine_relapse_incident(
  uuid, public.severity, public.incident_trigger, timestamptz, timestamptz, timestamptz, jsonb,
  boolean, boolean, jsonb, public.site_state);

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
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

-- ── Chat failed: no fallback for the ladder's chatter ───────────────────────
-- S04b body, plus (D-034): a reminder is a Chat reply only, so its failure emails nobody; a step's
-- Chat reply that failed after the ack (or the recovery) is old news, like a superseded DOWN. A
-- step's own emails already went to its people, so the fallback reaches the others only.
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

-- ── The ladder's writes ─────────────────────────────────────────────────────
-- Whether the incident's thread has its first alert out (or going now): a Chat DOWN / PROBLEM /
-- AGAIN that isn't cancelled — or was tried — and isn't waiting for response hours.
create function public.engine_thread_live(p_incident_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat'
      and template in ('down', 'problem', 'down_again', 'problem_again')
      and (status <> 'cancelled' or attempts > 0)
      and (hold_until is null or hold_until <= now()));
$$;

-- The people a step's tokens name for the incident's site: active profiles only, in token order,
-- with the token that named them (the first, when two name the same person).
create function public.escalation_people(p_incident_id uuid, p_targets jsonb)
returns table (user_id uuid, token text, chat_user_id text)
language sql
stable
set search_path = ''
as $$
  select distinct on (x.uid) x.uid, x.token, p.google_chat_user_id
  from (
    select s.primary_owner_id as uid, 'owner' as token, 1 as ord
      from public.incidents i join public.sites s on s.id = i.site_id
      where i.id = p_incident_id and p_targets ? 'owner'
    union all
    select s.backup_owner_id, 'backup', 2
      from public.incidents i join public.sites s on s.id = i.site_id
      where i.id = p_incident_id and p_targets ? 'backup'
    union all
    select c.am_user_id, 'site_am', 3
      from public.incidents i join public.sites s on s.id = i.site_id
      join public.clients c on c.id = s.client_id
      where i.id = p_incident_id and p_targets ? 'site_am'
    union all
    select a.id, 'admins', 4
      from public.profiles a
      where a.role = 'admin' and a.is_active and p_targets ? 'admins'
  ) x
  join public.profiles p on p.id = x.uid and p.is_active
  where x.uid is not null
  order by x.uid, x.ord;
$$;

-- Fires step `p_level` of the incident's plan, once: only while it waits for an ack (Unacked /
-- Escalated) and the level hasn't fired. Its people minus everyone already told at an earlier level
-- (PRD §8): the people named by the plan's earlier steps and earlier fired steps. Chat: the new
-- people are @mentioned, except Admins named next to someone else, who are told as FYI (D-034: "Tao
-- FYI"); email to each new person when the step has email. State → Escalated, level, timeline,
-- audit. `p_context` carries what the message needs (elapsed minutes, site, …). Returns whether it fired.
create function public.engine_fire_step(
  p_incident_id uuid,
  p_level smallint,
  p_due_at timestamptz,
  p_context jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_step jsonb;
  v_told uuid[];
  v_new uuid[];
  v_mention uuid[];
  v_fyi uuid[];
  v_others boolean;
  v_payload jsonb;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.state not in ('unacked', 'escalated') or v_inc.escalation_level >= p_level
     or p_level < 1 then
    return false;
  end if;

  -- The thread needs its first alert: none for an incident opened while muted (mute stops new
  -- alerts, §15.1), and none yet while a PROBLEM card waits for response hours (§19.2).
  if not public.engine_thread_live(p_incident_id) then
    return false;
  end if;

  select s into v_step
  from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s
  where (s ->> 'level')::smallint = p_level;
  if v_step is null then
    return false;
  end if;

  -- Told already: everyone the earlier steps name (L0 = the owner) and every person a fired step told.
  select coalesce(array_agg(distinct u), '{}') into v_told
  from (
    select pe.user_id as u
    from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s,
         public.escalation_people(p_incident_id, s -> 'targets') pe
    where (s ->> 'level')::smallint = 0
    union
    select (jsonb_array_elements_text(e.payload -> 'notified'))::uuid
    from public.incident_events e
    where e.incident_id = p_incident_id and e.type = 'step_fired'
      and e.payload ->> 'severity' = v_inc.severity::text
  ) t;

  select coalesce(array_agg(pe.user_id), '{}'),
         coalesce(bool_or(pe.token <> 'admins'), false)
    into v_new, v_others
  from public.escalation_people(p_incident_id, v_step -> 'targets') pe
  where pe.user_id <> all (v_told);

  select coalesce(array_agg(pe.user_id) filter (where not (v_others and pe.token = 'admins')), '{}'),
         coalesce(array_agg(pe.user_id) filter (where v_others and pe.token = 'admins'), '{}')
    into v_mention, v_fyi
  from public.escalation_people(p_incident_id, v_step -> 'targets') pe
  where pe.user_id = any (v_new);

  -- Nobody new to tell (all told already, or not active): the level is passed, but nothing is posted
  -- and the incident doesn't read "Escalated" (spec §14.3) for a step that paged no one.
  update public.incidents
    set state = case when cardinality(v_new) > 0 then 'escalated'::public.incident_state else state end,
        escalation_level = p_level
    where id = p_incident_id;

  v_payload := jsonb_build_object(
    'level', p_level, 'severity', v_inc.severity, 'dueAt', p_due_at,
    'notified', to_jsonb(v_new), 'mentioned', to_jsonb(v_mention), 'fyi', to_jsonb(v_fyi),
    'channels', v_step -> 'channels');

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'step_fired', v_payload, now());

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.escalated', 'incident', p_incident_id,
          jsonb_build_object('state', v_inc.state, 'escalation_level', v_inc.escalation_level),
          jsonb_build_object('state', case when cardinality(v_new) > 0 then 'escalated' else v_inc.state::text end,
                             'escalation_level', p_level));

  if cardinality(v_new) > 0 and v_step -> 'channels' ?| array['chat', 'space'] then
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
    values (p_incident_id, 'google_chat', 'step_fired', p_incident_id::text,
            p_context || v_payload, v_inc.severity || ':L' || p_level)
    on conflict do nothing;
  end if;

  if v_step -> 'channels' ? 'email' then
    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
    select p_incident_id, u, 'email', 'step_fired', p_incident_id::text,
           p_context || v_payload || jsonb_build_object('asFyi', u = any (v_fyi)), v_inc.severity || ':L' || p_level
    from unnest(v_new) u
    on conflict do nothing;
  end if;

  return true;
end;
$$;

-- A reminder in the thread (Chat only, PRD §7), once per due time, only while the incident waits
-- for an ack: @mentions everyone asked to act so far — L0's people and those a fired step mentioned
-- (FYI people aren't asked). Returns whether it was queued.
create function public.engine_remind(
  p_incident_id uuid,
  p_due_at timestamptz,
  p_context jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_mention uuid[];
  v_id uuid;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.state not in ('unacked', 'escalated') or v_inc.escalation_plan is null
     or not public.engine_thread_live(p_incident_id) then
    return false;
  end if;

  select coalesce(array_agg(distinct u), '{}') into v_mention
  from (
    select pe.user_id as u
    from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s,
         public.escalation_people(p_incident_id, s -> 'targets') pe
    where (s ->> 'level')::smallint = 0 and pe.token <> 'admins'
    union
    select (jsonb_array_elements_text(e.payload -> 'mentioned'))::uuid
    from public.incident_events e
    where e.incident_id = p_incident_id and e.type = 'step_fired'
      and e.payload ->> 'severity' = v_inc.severity::text
  ) t;

  insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
  values (p_incident_id, 'google_chat', 'reminder', p_incident_id::text,
          p_context || jsonb_build_object('dueAt', p_due_at, 'severity', v_inc.severity,
                                          'mentioned', to_jsonb(v_mention)),
          v_inc.severity || ':' || to_char(p_due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'))
  on conflict do nothing
  returning id into v_id;

  return v_id is not null;
end;
$$;

-- ── A held card never blocks its thread ─────────────────────────────────────
-- S04b body: an older row still inside a long hold — the flapping summary, or a PROBLEM held for
-- response hours (D-034) — doesn't hold back newer messages of the same incident. The ack's 10 s
-- hold still keeps its thread in order.
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
          and not (older.template in ('flap_summary', 'problem', 'problem_again')
                   and coalesce(older.hold_until > now(), false))
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

-- ── Ack: a held PROBLEM is set aside ────────────────────────────────────────
-- S02b body, plus (D-034): a PROBLEM card still held for response hours is cancelled before anything
-- else — someone is on it, so the card, the owner email and the ACKNOWLEDGED follow-ups never go.
-- Undo puts them back (same "Superseded: acknowledged first" marker).
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

-- ── The Admin saves the policies ────────────────────────────────────────────
-- One call saves every policy's steps and the reminder intervals (the board's save dialog), re-checks
-- the guardrails the page shows (§14.7, §15.5 — an S08 editor offers L0–L1; the rules hold for any
-- level), and writes one audit row with the before / after and the note. Refusals: 42501 not an
-- Admin; 22023 with the board's sentence and a hint code. Open incidents keep their plan (D-034).
create function public.save_escalation_policies(
  p_policies jsonb,
  p_down_reminder_min integer,
  p_problem_reminder_min integer,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_before jsonb;
  v_after jsonb;
  v_pol jsonb;
  v_policy public.escalation_policies%rowtype;
  v_step jsonb;
  v_level integer;
  v_prev integer;
  v_count integer;
  v_targets text[];
  v_channels text[];
  v_delay integer;
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception 'Only an Admin can change escalation policies' using errcode = '42501';
  end if;
  if v_note is null then
    raise exception 'Add a short note — it goes in the audit log with the change'
      using errcode = '22023', hint = 'note_required';
  end if;
  if length(v_note) > 500 then
    raise exception 'The note is too long' using errcode = '22023', hint = 'note_too_long';
  end if;
  if p_down_reminder_min is null or p_down_reminder_min not between 1 and 1440
     or p_problem_reminder_min is null or p_problem_reminder_min not between 1 and 1440 then
    raise exception 'Whole minutes above 0, e.g. 15' using errcode = '22023', hint = 'reminder_invalid';
  end if;
  if jsonb_typeof(p_policies) is distinct from 'array' then
    raise exception 'Nothing to save' using errcode = '22023', hint = 'invalid';
  end if;

  -- One save at a time, so the audit row's "before" is what this save changed.
  perform 1 from public.organisation_settings where singleton for update;

  select jsonb_build_object(
    'policies', (select jsonb_agg(jsonb_build_object('severity', p.severity, 'tier', p.tier,
                   'steps', (select jsonb_agg(jsonb_build_object('level', s.level, 'delayMin', s.delay_min,
                                'targets', s.targets, 'channels', s.channels) order by s.level)
                             from public.escalation_steps s where s.policy_id = p.id))
                 order by p.severity, p.tier)
                 from public.escalation_policies p),
    'downReminderMin', o.down_reminder_min, 'problemReminderMin', o.problem_reminder_min)
    into v_before
  from public.organisation_settings o;

  for v_pol in select * from jsonb_array_elements(p_policies) loop
    select * into v_policy from public.escalation_policies where id = (v_pol ->> 'policyId')::uuid for update;
    if not found then
      raise exception 'Policy not found' using errcode = 'P0002';
    end if;

    v_prev := null;
    v_count := 0;
    for v_step in
      select s from jsonb_array_elements(v_pol -> 'steps') s order by (s ->> 'level')::integer
    loop
      if jsonb_typeof(v_step -> 'level') is distinct from 'number'
         or jsonb_typeof(v_step -> 'delayMin') is distinct from 'number'
         or jsonb_typeof(v_step -> 'targets') is distinct from 'array'
         or jsonb_typeof(v_step -> 'channels') is distinct from 'array' then
        raise exception 'A step is missing its delay, people or channels' using errcode = '22023', hint = 'invalid';
      end if;
      v_level := (v_step ->> 'level')::integer;
      v_delay := (v_step ->> 'delayMin')::integer;
      v_targets := array(select jsonb_array_elements_text(v_step -> 'targets'));
      v_channels := array(select jsonb_array_elements_text(v_step -> 'channels'));
      if v_level is distinct from v_count then
        raise exception 'Steps must run L0, L1, … in order' using errcode = '22023', hint = 'levels';
      end if;
      -- S08 edits L0–L1; L2 and later come with S10 (D-034).
      if v_level > 1 then
        raise exception 'Only L0 and L1 can be set for now' using errcode = '22023', hint = 'too_many_steps';
      end if;
      if not (v_targets <@ array['owner', 'backup', 'admins', 'site_am', 'ceo']
              and v_channels <@ array['chat', 'space', 'email', 'voice']) then
        raise exception 'Unknown person or channel' using errcode = '22023', hint = 'invalid';
      end if;
      -- L0 is the owner by Chat @mention, the Alerts Space and email, at once (PRD §8: locked) —
      -- exactly what engine_open_incident sends, so "already told" at L1 is true.
      if v_level = 0 and not (v_delay = 0 and v_targets = array['owner']
                              and v_channels @> array['chat', 'space', 'email']
                              and v_channels <@ array['chat', 'space', 'email']) then
        raise exception 'L0 is pinned on every policy' using errcode = '22023', hint = 'l0_pinned';
      end if;
      if v_delay > 10080 then
        raise exception 'At most a week (10080 min)' using errcode = '22023', hint = 'step_too_late';
      end if;
      if cardinality(v_channels) = 0 then
        raise exception 'No channel ticked — this step notifies nobody.' using errcode = '22023', hint = 'no_channel';
      end if;
      if cardinality(v_targets) = 0 then
        raise exception 'Pick at least one person.' using errcode = '22023', hint = 'no_person';
      end if;
      if v_level > 0 and (v_delay is null or v_delay < 15) then
        raise exception 'Must be at least +15 min.' using errcode = '22023', hint = 'step_too_early';
      end if;
      if v_level > 0 and v_delay <= v_prev then
        raise exception 'Must be later than L% (+% min).', v_level - 1, v_prev
          using errcode = '22023', hint = 'step_not_later';
      end if;
      if 'voice' = any (v_channels) then
        raise exception 'Voice calls are off until approved' using errcode = '22023', hint = 'voice_off';
      end if;
      -- The CEO is paged only on Tier 1 DOWN from L2 (§15.5), which S10 builds.
      if 'ceo' = any (v_targets) then
        raise exception 'The CEO can be paged only from L2 onward, on Tier 1 DOWN.'
          using errcode = '22023', hint = 'ceo_not_allowed';
      end if;
      v_prev := v_delay;
      v_count := v_count + 1;
    end loop;

    if v_count = 0 then
      raise exception 'L0 is pinned on every policy' using errcode = '22023', hint = 'l0_pinned';
    end if;
    if v_policy.severity = 'down' and v_count < 2 then
      raise exception '% needs at least one step after L0 — otherwise nobody else is ever told.',
        'Tier ' || v_policy.tier || ' DOWN' using errcode = '22023', hint = 'down_needs_step';
    end if;

    delete from public.escalation_steps where policy_id = v_policy.id;
    insert into public.escalation_steps (policy_id, level, delay_min, targets, channels)
    select v_policy.id, (s ->> 'level')::smallint, (s ->> 'delayMin')::integer,
           array(select jsonb_array_elements_text(s -> 'targets')),
           array(select jsonb_array_elements_text(s -> 'channels'))
    from jsonb_array_elements(v_pol -> 'steps') s;
    update public.escalation_policies set updated_at = now() where id = v_policy.id;
  end loop;

  update public.organisation_settings
    set down_reminder_min = p_down_reminder_min, problem_reminder_min = p_problem_reminder_min
    where singleton
      and (down_reminder_min, problem_reminder_min) is distinct from (p_down_reminder_min, p_problem_reminder_min);

  select jsonb_build_object(
    'policies', (select jsonb_agg(jsonb_build_object('severity', p.severity, 'tier', p.tier,
                   'steps', (select jsonb_agg(jsonb_build_object('level', s.level, 'delayMin', s.delay_min,
                                'targets', s.targets, 'channels', s.channels) order by s.level)
                             from public.escalation_steps s where s.policy_id = p.id))
                 order by p.severity, p.tier)
                 from public.escalation_policies p),
    'downReminderMin', o.down_reminder_min, 'problemReminderMin', o.problem_reminder_min)
    into v_after
  from public.organisation_settings o;

  if v_after is distinct from v_before then
    insert into public.audit_log (actor_id, action, entity, before, after)
    values (auth.uid(), 'escalation.update', 'escalation', v_before,
            v_after || jsonb_build_object('note', v_note));
  end if;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke execute on function
  public.escalation_plan_for(smallint, public.severity),
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state, timestamptz),
  public.engine_cancel_held_problem(uuid, text),
  public.engine_cancel_ladder(uuid, text),
  public.engine_thread_live(uuid),
  public.engine_relapse_incident(uuid, public.severity, public.incident_trigger, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, boolean, jsonb, public.site_state, timestamptz),
  public.escalation_people(uuid, jsonb),
  public.engine_fire_step(uuid, smallint, timestamptz, jsonb),
  public.engine_remind(uuid, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.escalation_plan_for(smallint, public.severity),
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state, timestamptz),
  public.engine_cancel_held_problem(uuid, text),
  public.engine_cancel_ladder(uuid, text),
  public.engine_thread_live(uuid),
  public.engine_relapse_incident(uuid, public.severity, public.incident_trigger, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, boolean, jsonb, public.site_state, timestamptz),
  public.escalation_people(uuid, jsonb),
  public.engine_fire_step(uuid, smallint, timestamptz, jsonb),
  public.engine_remind(uuid, timestamptz, jsonb)
  to service_role;

revoke execute on function public.save_escalation_policies(jsonb, integer, integer, text) from public, anon;
grant execute on function public.save_escalation_policies(jsonb, integer, integer, text) to authenticated;
