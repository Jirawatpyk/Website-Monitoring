-- S06b (spec §21, D-032): the Overview's live refresh and its Response 24h sparklines.

-- Realtime: the Overview subscribes to changes of these three tables and refreshes itself
-- (PRD §9: a status change on screen < 5 s). postgres_changes checks each subscriber's RLS, so only
-- staff (the tables' select policies, is_staff()) get the events; a client account gets none.
alter publication supabase_realtime add table public.site_status, public.incidents, public.monitor_status;

-- Response 24h (§21.5): per live site's primary monitor and 15-minute bucket of the last 24 h, the
-- checks, hard fails (TLS chain errors excluded, D-029) and p50 over passing checks, all locations
-- together. A bucket with no passing check has a null p50, so the line breaks there; a bucket with no
-- check at all has no row. Buckets are aligned to the quarter hour (Bangkok is UTC+7, so they line
-- up there too). Rechecks count, as in site_response_series. Security invoker: check_results' staff
-- RLS decides who reads. One grouped scan of a day of primary checks (check_results_monitor_idx);
-- the bounds on now() prune the partitions at run time. No parameters, so a plain sql function with a
-- generic plan is fine (cf. site_list_response_24h).
create function public.overview_response_24h()
returns table (
  site_id uuid,
  bucket_start timestamptz,
  checks integer,
  hard_fails integer,
  p50_ms integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.site_id,
    to_timestamp(floor(extract(epoch from cr.checked_at) / 900) * 900) as bucket_start,
    count(*)::integer,
    count(*) filter (
      where cr.outcome = 'fail' and coalesce(cr.error, '') not in (
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'
      )
    )::integer,
    round(percentile_cont(0.5) within group (order by cr.response_ms)
      filter (where cr.outcome = 'pass' and cr.response_ms is not null))::integer
  from public.monitors m
  join public.sites s on s.id = m.site_id and s.is_active
  join public.check_results cr on cr.monitor_id = m.id
  where m.is_primary
    and cr.checked_at >= to_timestamp(floor(extract(epoch from now() - interval '24 hours') / 900) * 900)
    and cr.checked_at < now() + interval '5 minutes'
  group by 1, 2
$$;

revoke execute on function public.overview_response_24h() from public, anon;
grant execute on function public.overview_response_24h() to authenticated, service_role;
