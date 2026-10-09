-- S06b (spec §21, D-032): the Overview's live refresh and its Response 24h sparklines.

-- Realtime: the Overview subscribes to changes of site_status and incidents and refreshes itself
-- (PRD §9: a status change on screen < 5 s). site_status changes with every round and every status;
-- incidents with every ack, recovery and new incident. monitor_status is left out: the engine updates
-- it every round for every monitor too, and nothing on the Overview needs its events (db review M2).
-- postgres_changes checks each subscriber's RLS on INSERT and UPDATE, so only staff (the tables'
-- select policies, is_staff()) get those payloads. A DELETE is not checked against RLS and carries the
-- primary key only (default replica identity — keep it, never `replica identity full`), so the
-- Overview subscribes to INSERT and UPDATE only. Guarded, in case a project already published one.
do $$
declare
  t text;
begin
  foreach t in array array['site_status', 'incidents'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Response 24h (§21.5): one row per live site — its primary monitor's 15-minute buckets of the last
-- 24 h, oldest first, as arrays: bucket start, checks, hard fails (TLS chain errors excluded, D-029)
-- and the p50 of passing checks (null when none passed, so the line breaks there). A bucket with no
-- check has no entry. One row per site keeps the answer far below PostgREST's max_rows (1,000;
-- 17 sites × 96 buckets would be cut silently, db review H1). Buckets are aligned to the quarter hour
-- (Bangkok is UTC+7, so they line up there too); rechecks count, as in site_response_series.
-- Security invoker: check_results' staff RLS decides who reads. The lateral reads each primary
-- monitor's day through check_results_monitor_id_checked_at_idx, skipping key pages; the bounds on
-- now() prune the partitions at run time. No parameters, so a plain sql function is fine.
create function public.overview_response_24h()
returns table (
  site_id uuid,
  bucket_starts timestamptz[],
  checks integer[],
  hard_fails integer[],
  p50_ms integer[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.site_id,
    array_agg(b.bucket_start order by b.bucket_start),
    array_agg(b.checks order by b.bucket_start),
    array_agg(b.hard_fails order by b.bucket_start),
    array_agg(b.p50_ms order by b.bucket_start)
  from public.monitors m
  join public.sites s on s.id = m.site_id and s.is_active
  cross join lateral (
    select date_bin('15 minutes', cr.checked_at, timestamptz 'epoch') as bucket_start,
      count(*)::integer as checks,
      count(*) filter (
        where cr.outcome = 'fail' and coalesce(cr.error, '') not in (
          'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'
        )
      )::integer as hard_fails,
      round(percentile_cont(0.5) within group (order by cr.response_ms)
        filter (where cr.outcome = 'pass' and cr.response_ms is not null))::integer as p50_ms
    from public.check_results cr
    where cr.monitor_id = m.id
      and cr.checked_at >= date_bin('15 minutes', now() - interval '24 hours', timestamptz 'epoch')
      and cr.checked_at < now() + interval '5 minutes'
    group by 1
  ) b
  where m.is_primary
  group by m.site_id
$$;

revoke execute on function public.overview_response_24h() from public, anon;
grant execute on function public.overview_response_24h() to authenticated, service_role;
