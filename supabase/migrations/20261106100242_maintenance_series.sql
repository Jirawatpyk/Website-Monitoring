-- S14 (FR-10b, D-057): recurring maintenance.
--   · `maintenance_series`: a rule (weekly on chosen ISO weekdays, or monthly on day N or the 1st–4th
--     weekday), a Bangkok start time, a length ≤ 24 h, a first day and an optional last day. Staff read;
--     people write only through the RPCs below, each with its audit row.
--   · Occurrences are ordinary `maintenance_windows` rows (`series_id`, unique with `starts_at`) copying the
--     series' reason, creator and approver, so the engine, uptime, the pages, the reports and S09b's
--     STARTED / ENDED / DIDN'T START messages use them unchanged. They are worked out here in SQL from the
--     rule (never taken from a caller), 14 days ahead, only for an approved, uncancelled series: at create /
--     approve, and by the nightly pg_cron top-up. One that would overlap another window is skipped and
--     noted on the series.
--   · No messages yet: the series' own SCHEDULED / CANCELLED lines wait for the board (D-057).
--   · `maintenance_windows.rrule` (null-only since S09) goes: `series_id` replaces it.
set local lock_timeout = '5s';

-- ── The rule ────────────────────────────────────────────────────────────────────────────────────────
-- {"freq":"weekly","days":[2]} · {"freq":"monthly","day":15} · {"freq":"monthly","nth":2,"weekday":2}
create function public.valid_series_rule(p_rule jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- No casts: values are compared as jsonb with the allowed numbers, so a string ("1", "abc") is simply
  -- false — SQL may evaluate either side of an AND first, and a cast could raise instead (code review S14).
  -- CASE guards whatever needs an array or an object.
  select case
    when jsonb_typeof(p_rule) <> 'object' then false
    when p_rule ->> 'freq' = 'weekly' then
      case when jsonb_typeof(p_rule -> 'days') <> 'array' then false
      else jsonb_array_length(p_rule -> 'days') between 1 and 7
        and (select bool_and(d = any (select to_jsonb(g) from generate_series(1, 7) g))
             from jsonb_array_elements(p_rule -> 'days') d)
        and (select count(distinct d) = count(*) from jsonb_array_elements(p_rule -> 'days') d)
        and (select count(*) from jsonb_object_keys(p_rule)) = 2
      end
    when p_rule ->> 'freq' = 'monthly' then
      (p_rule ? 'day' and not p_rule ? 'nth' and not p_rule ? 'weekday'
        and (p_rule -> 'day') = any (select to_jsonb(g) from generate_series(1, 31) g)
        and (select count(*) from jsonb_object_keys(p_rule)) = 2)
      or (p_rule ? 'nth' and p_rule ? 'weekday' and not p_rule ? 'day'
        and (p_rule -> 'nth') = any (select to_jsonb(g) from generate_series(1, 4) g)
        and (p_rule -> 'weekday') = any (select to_jsonb(g) from generate_series(1, 7) g)
        and (select count(*) from jsonb_object_keys(p_rule)) = 3)
    else false
  end;
$$;

-- Whether a Bangkok calendar day matches the rule. A monthly day the month lacks (31 Apr) never matches.
create function private.series_matches(p_rule jsonb, p_day date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rule ->> 'freq' = 'weekly' then
      p_rule -> 'days' @> to_jsonb(extract(isodow from p_day)::int)
    when p_rule ? 'day' then
      extract(day from p_day)::int = (p_rule ->> 'day')::int
    else
      extract(isodow from p_day)::int = (p_rule ->> 'weekday')::int
      and (extract(day from p_day)::int - 1) / 7 + 1 = (p_rule ->> 'nth')::int
  end;
$$;

-- ── Table ───────────────────────────────────────────────────────────────────────────────────────────
create table public.maintenance_series (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  rule jsonb not null check (public.valid_series_rule(rule)),
  -- Bangkok wall-clock time each occurrence starts, and how long it lasts (an occurrence ≤ 24 h, D-057).
  start_time time not null,
  duration_min integer not null check (duration_min between 5 and 1440),
  -- Bangkok calendar days: the first an occurrence may fall on, and the last (null = no end).
  starts_on date not null,
  until_on date check (until_on is null or until_on >= starts_on),
  reason text not null check (btrim(reason) <> '' and length(reason) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  -- One line per action, as maintenance_windows.log: created / requested / approved / declined /
  -- cancelled, and each occurrence skipped for an overlap.
  log jsonb not null default '[]'::jsonb check (jsonb_typeof(log) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_at is null or declined_at is null)
);

create index maintenance_series_site_idx on public.maintenance_series (site_id);

create trigger maintenance_series_set_updated_at before update on public.maintenance_series
  for each row execute function private.set_updated_at();

alter table public.maintenance_series enable row level security;

-- As maintenance_windows: staff read, nobody writes directly.
create policy maintenance_series_select_staff on public.maintenance_series
  for select to authenticated
  using ((select public.is_staff()));

revoke all on public.maintenance_series from public, anon, authenticated;
grant select on public.maintenance_series to authenticated;
grant all on public.maintenance_series to service_role;

-- ── Occurrences ─────────────────────────────────────────────────────────────────────────────────────
-- set null: a site's deletion cascades to both tables, in any order; a series is never deleted otherwise.
alter table public.maintenance_windows
  add column series_id uuid references public.maintenance_series (id) on delete set null;
create unique index maintenance_windows_series_start on public.maintenance_windows (series_id, starts_at)
  where series_id is not null;
alter table public.maintenance_windows drop column rrule;

-- Adds the series' occurrences from `p_now` to 14 days on that don't exist yet: an approved, uncancelled
-- series on a live site only, never one starting in the next 5 min (the rule a series is made with, §32.1:
-- nobody is surprised by a window starting as they approve; noted on the series). An overlap with another
-- window skips that occurrence and notes it once on the series. Returns how many it added.
create function private.expand_series(p_series_id uuid, p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.maintenance_series%rowtype;
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_key text;
  v_skip boolean;
  v_id uuid;
  v_n integer := 0;
begin
  select * into s from public.maintenance_series where id = p_series_id for update;
  if not found or s.approved_at is null or s.cancelled_at is not null then
    return 0;
  end if;
  -- A site that stopped monitoring gets no new occurrences (db review S14); they come back with it.
  if not exists (select 1 from public.sites where id = s.site_id and is_active) then
    return 0;
  end if;
  for v_day in
    select d::date from generate_series(
      greatest(s.starts_on, (p_now at time zone 'Asia/Bangkok')::date),
      least(coalesce(s.until_on, 'infinity'::date), ((p_now + interval '14 days') at time zone 'Asia/Bangkok')::date),
      interval '1 day') d
  loop
    continue when not private.series_matches(s.rule, v_day);
    v_start := (v_day + s.start_time) at time zone 'Asia/Bangkok';
    v_end := v_start + make_interval(mins => s.duration_min);
    -- One spelling of the time whatever the session's TimeZone, so a skip is noted once (db review S14).
    v_key := to_char(v_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"');
    continue when v_start <= p_now;
    -- Too close to start (an approval at 00:57 for 01:00): noted, not silently dropped (engine review L2).
    if v_start < p_now + interval '5 minutes' then
      if not s.log @> jsonb_build_array(jsonb_build_object('action', 'skipped', 'starts_at', v_key)) then
        s.log := s.log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'skipped',
          'starts_at', v_key, 'reason', 'starts in less than 5 min'));
        update public.maintenance_series set log = s.log where id = s.id;
      end if;
      continue;
    end if;
    continue when exists (select 1 from public.maintenance_windows
                          where series_id = s.id and starts_at = v_start);
    -- Overlap checked first, so no subtransaction per night for a known clash (db review S14); the
    -- exception below is only the fallback for a window made meanwhile.
    if exists (select 1 from public.maintenance_windows w
               where w.site_id = s.site_id and w.kind = 'maintenance' and w.cancelled_at is null
                 and tstzrange(w.starts_at, coalesce(w.ended_at, w.ends_at)) && tstzrange(v_start, v_end)) then
      v_skip := true;
    else
      v_skip := false;
      begin
        insert into public.maintenance_windows
          (site_id, kind, starts_at, ends_at, reason, created_by, approved_by, approved_at, series_id, log)
        values (s.site_id, 'maintenance', v_start, v_end, s.reason, s.created_by, s.approved_by, s.approved_at,
                s.id, jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'created', 'series', s.id)))
        returning id into v_id;
        -- Its own audit row (System): the series' audited create / approve says who and why.
        insert into public.audit_log (action, entity, entity_id, after)
        values ('maintenance.create', 'maintenance_window', v_id,
                jsonb_build_object('site_id', s.site_id, 'starts_at', v_start, 'ends_at', v_end,
                                   'reason', s.reason, 'approved', true, 'series_id', s.id));
        v_n := v_n + 1;
      exception when exclusion_violation then
        v_skip := true;
      end;
    end if;
    if v_skip and not s.log @> jsonb_build_array(jsonb_build_object('action', 'skipped', 'starts_at', v_key)) then
      s.log := s.log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'skipped',
        'starts_at', v_key, 'reason', 'overlaps another window'));
      update public.maintenance_series set log = s.log where id = s.id;
      -- §32.13: one System row per skipped window.
      insert into public.audit_log (action, entity, entity_id, after)
      values ('maintenance.occurrence_skip', 'maintenance_series', s.id,
              jsonb_build_object('site_id', s.site_id, 'starts_at', v_start, 'ends_at', v_end,
                                 'reason', 'overlaps another window'));
    end if;
  end loop;
  return v_n;
end;
$$;

-- A pure check the table constraint calls as whoever writes (the service role in tests and tools), so
-- it lives in public with execute for them; it reads nothing.
revoke execute on function public.valid_series_rule(jsonb) from public, anon;
grant execute on function public.valid_series_rule(jsonb) to authenticated, service_role;
revoke execute on function private.series_matches(jsonb, date),
  private.expand_series(uuid, timestamptz) from public, anon, authenticated;

-- The nightly top-up (and the engine's, if it ever needs one): every live series, 14 days ahead.
create function public.engine_expand_series(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in
    select id from public.maintenance_series
    where approved_at is not null and cancelled_at is null
      and (until_on is null or until_on >= (p_now at time zone 'Asia/Bangkok')::date)
  loop
    v_n := v_n + private.expand_series(v_id, p_now);
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.engine_expand_series(timestamptz) from public, anon, authenticated;
grant execute on function public.engine_expand_series(timestamptz) to service_role;

select cron.schedule(
  'maintenance-series-expand',
  '15 17 * * *', -- 00:15 Bangkok
  $$select public.engine_expand_series(now())$$
);

-- ── RPCs ────────────────────────────────────────────────────────────────────────────────────────────
create function private.series_log(p_series_id uuid, p_action text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.maintenance_series
    set log = log || jsonb_build_array(
      jsonb_build_object('at', now(), 'action', p_action,
                         'by', (select display_name from public.profiles where id = auth.uid()))
      || case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end)
    where id = p_series_id;
$$;

revoke execute on function private.series_log(uuid, text, text) from public, anon, authenticated;

-- A series (Acknowledge-to-pause rule, private.can_pause): an Admin's is approved on create and its
-- occurrences are added at once; a Responder's waits for an Admin and has none until then (D-057).
create function public.create_maintenance_series(
  p_site_id uuid,
  p_rule jsonb,
  p_start_time time,
  p_duration_min integer,
  p_starts_on date,
  p_until_on date,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_admin boolean := coalesce(public.current_app_role() = 'admin', false);
  v_reason text;
  v_id uuid;
begin
  if not exists (select 1 from public.sites where id = p_site_id) then
    raise exception 'site not found' using errcode = 'P0002';
  end if;
  if not private.can_pause(p_site_id) then
    raise exception 'This role can''t set maintenance on this site' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sites where id = p_site_id and is_active) then
    raise exception 'Maintenance and mutes are for live sites — start monitoring first'
      using errcode = '22023', hint = 'site_not_live';
  end if;
  v_reason := private.require_reason(p_reason);
  if p_rule is null or not public.valid_series_rule(p_rule) then
    raise exception 'Pick weekdays, a day of the month, or which weekday of the month'
      using errcode = '22023', hint = 'bad_rule';
  end if;
  if p_start_time is null or p_duration_min is null or p_duration_min not between 5 and 1440 then
    raise exception 'Each occurrence lasts 5 min to 24 h' using errcode = '22023', hint = 'bad_length';
  end if;
  if p_starts_on is null or p_starts_on < (v_now at time zone 'Asia/Bangkok')::date then
    raise exception 'The first day is in the past' using errcode = '22023', hint = 'starts_in_past';
  end if;
  if p_until_on is not null and p_until_on < p_starts_on then
    raise exception 'The last day is before the first' using errcode = '22023', hint = 'ends_before_start';
  end if;
  -- A year ahead at most, each way: the first day, and the last (security review S14, L1).
  if p_starts_on > (v_now at time zone 'Asia/Bangkok')::date + 366
     or (p_until_on is not null and p_until_on > p_starts_on + 366 * 2) then
    raise exception 'Pick days within the next year or two' using errcode = '22023', hint = 'too_far';
  end if;
  if not exists (select 1 from generate_series(p_starts_on,
                   least(coalesce(p_until_on, p_starts_on + 366), p_starts_on + 366), interval '1 day') d
                 where private.series_matches(p_rule, d::date)
                   and (d::date + p_start_time) at time zone 'Asia/Bangkok' >= v_now + interval '5 minutes') then
    raise exception 'No occurrence falls between those days — at least 5 min from now'
      using errcode = '22023', hint = 'no_occurrence';
  end if;

  insert into public.maintenance_series
    (site_id, rule, start_time, duration_min, starts_on, until_on, reason, created_by, approved_by, approved_at)
  values (p_site_id, p_rule, p_start_time, p_duration_min, p_starts_on, p_until_on, v_reason, auth.uid(),
          case when v_admin then auth.uid() end, case when v_admin then v_now end)
  returning id into v_id;
  perform private.series_log(v_id, case when v_admin then 'created' else 'requested' end, v_reason);
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  select auth.uid(), case when v_admin then 'maintenance.series_create' else 'maintenance.series_request' end,
         'maintenance_series', s.id,
         jsonb_build_object('site_id', s.site_id, 'rule', s.rule, 'start_time', s.start_time,
                            'duration_min', s.duration_min, 'starts_on', s.starts_on, 'until_on', s.until_on,
                            'reason', s.reason, 'approved', s.approved_at is not null)
  from public.maintenance_series s where s.id = v_id;
  perform private.expand_series(v_id, v_now);
  return v_id;
end;
$$;

-- An Admin approves (its occurrences are added at once) or declines a waiting series.
create function public.decide_maintenance_series(p_series_id uuid, p_approve boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.maintenance_series%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not coalesce(public.current_app_role() = 'admin', false) then
    raise exception 'Only an Admin approves a series' using errcode = '42501';
  end if;
  select * into s from public.maintenance_series where id = p_series_id for update;
  if not found then
    raise exception 'series not found' using errcode = 'P0002';
  end if;
  if s.approved_at is not null or s.declined_at is not null or s.cancelled_at is not null then
    raise exception 'This series was decided already' using errcode = '22023', hint = 'already_decided';
  end if;
  if not p_approve then
    v_reason := private.require_reason(p_reason);
  end if;
  update public.maintenance_series
    set approved_at = case when p_approve then now() end,
        approved_by = case when p_approve then auth.uid() end,
        declined_at = case when p_approve then null else now() end
    where id = s.id;
  perform private.series_log(s.id, case when p_approve then 'approved' else 'declined' end, v_reason);
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case when p_approve then 'maintenance.series_approve' else 'maintenance.series_decline' end,
          'maintenance_series', s.id, jsonb_build_object('state', 'waiting'),
          jsonb_build_object('state', case when p_approve then 'approved' else 'declined' end,
                             'site_id', s.site_id, 'reason', v_reason));
  if p_approve then
    perform private.expand_series(s.id, now());
  end if;
end;
$$;

-- Cancels a series and its occurrences that haven't started, quietly (no per-window CANCELLED, D-057);
-- one that is running finishes. The series' asker, the site's owner / backup, or an Admin.
create function public.cancel_maintenance_series(p_series_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.maintenance_series%rowtype;
  v_reason text;
  v_n integer;
  v_gone jsonb;
begin
  select * into s from public.maintenance_series where id = p_series_id for update;
  if not found then
    raise exception 'series not found' using errcode = 'P0002';
  end if;
  -- The site's owner / backup or an Admin; the asker only while still an active Responder (as
  -- withdraw_request, S09b; security review S14, M1).
  if not (private.can_pause(s.site_id)
          or (coalesce(public.current_app_role() = 'responder', false) and s.created_by = auth.uid())) then
    raise exception 'This role can''t cancel this series' using errcode = '42501';
  end if;
  if s.cancelled_at is not null or s.declined_at is not null then
    raise exception 'This series is over already' using errcode = '22023', hint = 'already_over';
  end if;
  v_reason := private.require_reason(p_reason);
  update public.maintenance_series set cancelled_at = now(), cancelled_by = auth.uid() where id = s.id;
  perform private.series_log(s.id, 'cancelled', v_reason);
  with gone as (
    update public.maintenance_windows w
      -- Only cancelled: every engine loop skips a cancelled row, and start_logged keeps meaning "it ran"
      -- (engine review S14, L1). "Not started" is the engine's start_logged, not the clock: one whose start
      -- has come but isn't logged yet is cancelled too (M1); the engine locks a row it is starting.
      set cancelled_at = now(),
          log = w.log || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'cancelled',
            'by', (select display_name from public.profiles where id = auth.uid()),
            'reason', v_reason, 'series', s.id))
    where w.series_id = s.id and w.cancelled_at is null and not w.start_logged
    returning w.id, w.starts_at
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object('id', id, 'starts_at', starts_at)), '[]'::jsonb)
    into v_n, v_gone from gone;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  -- §32.7 / §32.13: the asker taking back a series still waiting withdraws it; anything else cancels.
  values (auth.uid(),
          case when s.approved_at is null and s.created_by = auth.uid() then 'maintenance.series_withdraw'
               else 'maintenance.series_cancel' end,
          'maintenance_series', s.id,
          jsonb_build_object('state', case when s.approved_at is null then 'waiting' else 'approved' end),
          jsonb_build_object('state', 'cancelled', 'site_id', s.site_id, 'reason', v_reason,
                             'occurrences_cancelled', v_gone));
  return v_n;
end;
$$;

revoke execute on function public.create_maintenance_series(uuid, jsonb, time, integer, date, date, text),
  public.decide_maintenance_series(uuid, boolean, text), public.cancel_maintenance_series(uuid, text)
  from public, anon;
grant execute on function public.create_maintenance_series(uuid, jsonb, time, integer, date, date, text),
  public.decide_maintenance_series(uuid, boolean, text), public.cancel_maintenance_series(uuid, text)
  to authenticated;
