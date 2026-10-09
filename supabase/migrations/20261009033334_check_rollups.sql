-- S06 (D-031): check_rollups — hourly and daily response figures per monitor, per location and for
-- all locations together (location null). Site detail's 7 d / 30 d / 90 d chart and stats read
-- these; 24 h reads the raw checks. No uptime column: uptime is DOWN minutes from incidents (spec §5).
-- Hour rows are kept 90 days (the raw checks' retention), day rows 2 years (PRD §11).

create type public.rollup_bucket as enum ('hour', 'day');

create table public.check_rollups (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors (id) on delete cascade,
  -- null = every location together (its p50 / p95 can't be derived from the per-location ones)
  location text references public.probe_locations (code) on delete restrict,
  bucket public.rollup_bucket not null,
  -- an hour in UTC, or a day starting at Bangkok midnight
  bucket_start timestamptz not null,
  checks integer not null check (checks >= 0),
  -- D-029: a TLS chain error is never a hard fail
  hard_fails integer not null check (hard_fails between 0 and checks),
  blocked integer not null check (blocked between 0 and checks),
  -- over passing checks; null when none passed
  p50_ms integer check (p50_ms >= 0),
  p95_ms integer check (p95_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- monitor, bucket, start first: the read path (one monitor's buckets from a time on)
  constraint check_rollups_key unique nulls not distinct (monitor_id, bucket, bucket_start, location)
);

-- the day job's retention deletes
create index check_rollups_bucket_start_idx on public.check_rollups (bucket, bucket_start);

-- The rollup job reads a time range across every monitor; the existing indexes start with monitor_id,
-- so without this it scans the whole month's partition (db review M1). BRIN is tiny on append-only
-- data in time order and applies to every partition, present and future.
set local lock_timeout = '5s';
create index check_results_checked_at_brin on public.check_results
  using brin (checked_at) with (pages_per_range = 32);

create trigger check_rollups_set_updated_at before update on public.check_rollups
  for each row execute function private.set_updated_at();

alter table public.check_rollups enable row level security;

-- Like check_results: people read (staff), only the rollup job writes.
create policy check_rollups_select_staff on public.check_rollups
  for select to authenticated
  using ((select public.is_staff()));

revoke all on public.check_rollups from public, anon, authenticated;
grant select on public.check_rollups to authenticated;
grant all on public.check_rollups to service_role;

-- The bucket a time falls in.
create function private.rollup_bucket_start(p_bucket public.rollup_bucket, p_at timestamptz)
returns timestamptz
language sql
immutable
as $$
  select case p_bucket
    when 'hour' then pg_catalog.date_trunc('hour', p_at)
    else pg_catalog.timezone('Asia/Bangkok', pg_catalog.date_trunc('day', pg_catalog.timezone('Asia/Bangkok', p_at)))
  end
$$;

-- Rolls the complete buckets between p_from and p_to up from check_results (both ends are floored to
-- a bucket start, so the bucket in progress is never written half-full). Re-running replaces the
-- rows, so late results are picked up by the next run over the same buckets. Returns rows written.
create function private.rollup_check_results(
  p_bucket public.rollup_bucket,
  p_from timestamptz,
  p_to timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := private.rollup_bucket_start(p_bucket, p_from);
  v_to timestamptz := private.rollup_bucket_start(p_bucket, p_to);
  v_rows integer;
begin
  if v_to <= v_from then
    return 0;
  end if;

  insert into public.check_rollups as r
    (monitor_id, location, bucket, bucket_start, checks, hard_fails, blocked, p50_ms, p95_ms)
  select
    c.monitor_id,
    c.location,
    p_bucket,
    c.bucket_start,
    count(*)::integer,
    count(*) filter (where c.hard_fail)::integer,
    count(*) filter (where c.outcome = 'blocked')::integer,
    round(percentile_cont(0.5) within group (order by c.response_ms)
      filter (where c.outcome = 'pass' and c.response_ms is not null))::integer,
    round(percentile_cont(0.95) within group (order by c.response_ms)
      filter (where c.outcome = 'pass' and c.response_ms is not null))::integer
  from (
    select
      cr.monitor_id,
      cr.location,
      cr.outcome,
      cr.response_ms,
      private.rollup_bucket_start(p_bucket, cr.checked_at) as bucket_start,
      -- D-029 / isHardFailCheck (@dxt/shared): a failure that isn't a certificate-chain error
      cr.outcome = 'fail' and coalesce(cr.error, '') not in (
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'
      ) as hard_fail
    from public.check_results cr
    where cr.checked_at >= v_from
      and cr.checked_at < v_to
  ) c
  group by grouping sets ((c.monitor_id, c.location, c.bucket_start), (c.monitor_id, c.bucket_start))
  on conflict on constraint check_rollups_key do update set
    checks = excluded.checks,
    hard_fails = excluded.hard_fails,
    blocked = excluded.blocked,
    p50_ms = excluded.p50_ms,
    p95_ms = excluded.p95_ms
  where (r.checks, r.hard_fails, r.blocked, r.p50_ms, r.p95_ms)
    is distinct from (excluded.checks, excluded.hard_fails, excluded.blocked, excluded.p50_ms, excluded.p95_ms);

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- What the pg_cron jobs run: the hour job re-rolls the last 3 complete hours (a Bangkok batch can
-- land a few minutes late); the day job re-rolls the last 2 Bangkok days, then applies retention.
-- Either goes further back to the bucket after its newest row when runs were missed (a restart, a
-- maintenance window), never more than the raw checks' 90 days.
create function private.run_check_rollups(p_bucket public.rollup_bucket, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step interval := case p_bucket when 'hour' then interval '1 hour' else interval '1 day' end;
  v_from timestamptz := p_now - case p_bucket when 'hour' then interval '3 hours' else interval '2 days' end;
  v_newest timestamptz;
  v_rows integer;
begin
  select max(bucket_start) into v_newest from public.check_rollups where bucket = p_bucket;
  if v_newest is not null then
    v_from := greatest(least(v_from, v_newest + v_step), p_now - interval '90 days');
  end if;
  if p_bucket = 'hour' then
    v_rows := private.rollup_check_results('hour', v_from, p_now);
  else
    v_rows := private.rollup_check_results('day', v_from, p_now);
    delete from public.check_rollups where bucket = 'hour' and bucket_start < p_now - interval '90 days';
    delete from public.check_rollups where bucket = 'day' and bucket_start < p_now - interval '2 years';
  end if;
  return v_rows;
end;
$$;

revoke execute on function private.rollup_bucket_start(public.rollup_bucket, timestamptz),
  private.rollup_check_results(public.rollup_bucket, timestamptz, timestamptz),
  private.run_check_rollups(public.rollup_bucket, timestamptz)
  from public, anon, authenticated;

-- The checks already stored (at most 90 days).
select private.rollup_check_results('hour', now() - interval '90 days');
select private.rollup_check_results('day', now() - interval '90 days');

select cron.schedule(
  'check-rollups-hourly',
  '5 * * * *', -- 5 min past every hour
  $$select private.run_check_rollups('hour')$$
);

select cron.schedule(
  'check-rollups-daily',
  '20 17 * * *', -- 00:20 Bangkok, after the day has closed
  $$select private.run_check_rollups('day')$$
);

-- Site detail's response series for a site's primary monitor from p_from to now: per location and
-- for all locations (location null), per bucket and over the whole range (bucket_start null).
-- p_bucket '15m' reads the raw checks (the 24 h view, exact); 'hour' / 'day' read check_rollups, whose
-- rows have no whole-range total (the app weighs the buckets, D-031). The range is bounded per bucket
-- (15m ≤ 25 h, hour ≤ 8 d, day ≤ 91 d) so no caller can make it scan 90 days of raw checks.
-- Counts include rechecks (attempt 2): a failed check and its failed recheck are two hard fails. Security invoker: the tables'
-- staff RLS decides who reads. plpgsql + execute … using so each call is planned with its p_from and
-- prunes the partitions (supabase/CLAUDE.md, S04b engine_checks).
create function public.site_response_series(p_site_id uuid, p_from timestamptz, p_bucket text)
returns table (
  location text,
  bucket_start timestamptz,
  checks integer,
  hard_fails integer,
  p50_ms integer,
  p95_ms integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_from < now() - (case p_bucket when '15m' then interval '25 hours' when 'hour' then interval '8 days'
                                    else interval '91 days' end) then
    raise exception 'Range too long for bucket %', p_bucket using errcode = '22023';
  end if;
  if p_bucket = '15m' then
    return query execute $q$
      select c.location, c.bucket_start, count(*)::integer,
        count(*) filter (where c.hard_fail)::integer,
        round(percentile_cont(0.5) within group (order by c.response_ms)
          filter (where c.outcome = 'pass' and c.response_ms is not null))::integer,
        round(percentile_cont(0.95) within group (order by c.response_ms)
          filter (where c.outcome = 'pass' and c.response_ms is not null))::integer
      from (
        select cr.location, cr.outcome, cr.response_ms,
          to_timestamp(floor(extract(epoch from cr.checked_at) / 900) * 900) as bucket_start,
          cr.outcome = 'fail' and coalesce(cr.error, '') not in (
            'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'
          ) as hard_fail
        from public.monitors m
        join public.check_results cr on cr.monitor_id = m.id
        where m.site_id = $1 and m.is_primary
          and cr.checked_at >= $2
          and cr.checked_at < now() + interval '5 minutes'
      ) c
      group by grouping sets ((c.location, c.bucket_start), (c.bucket_start), (c.location), ())
      having count(*) > 0 -- the () total exists even over no rows
    $q$ using p_site_id, p_from;
  elsif p_bucket in ('hour', 'day') then
    return query execute $q$
      select r.location, r.bucket_start, r.checks, r.hard_fails, r.p50_ms, r.p95_ms
      from public.monitors m
      join public.check_rollups r on r.monitor_id = m.id
      where m.site_id = $1 and m.is_primary
        and r.bucket = $3::public.rollup_bucket
        and r.bucket_start >= $2
    $q$ using p_site_id, p_from, p_bucket;
  else
    raise exception 'Unknown bucket %', p_bucket using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.site_response_series(uuid, timestamptz, text) from public, anon;
grant execute on function public.site_response_series(uuid, timestamptz, text) to authenticated, service_role;

-- The Sites list's "Response 24h": p50 of each live site's primary monitor over its passing checks of
-- the last 24 h. One grouped scan of a day of primary checks (index check_results_monitor_idx).
-- No parameters, so a plain sql function with a generic plan is fine (cf. engine_checks).
create function public.site_list_response_24h()
returns table (site_id uuid, p50_ms integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.site_id,
    round(percentile_cont(0.5) within group (order by cr.response_ms))::integer
  from public.monitors m
  join public.sites s on s.id = m.site_id and s.is_active
  join public.check_results cr on cr.monitor_id = m.id
  where m.is_primary
    and cr.outcome = 'pass'
    and cr.response_ms is not null
    and cr.checked_at > now() - interval '24 hours'
    and cr.checked_at < now() + interval '5 minutes'
  group by m.site_id
$$;

revoke execute on function public.site_list_response_24h() from public, anon;
grant execute on function public.site_list_response_24h() to authenticated, service_role;
