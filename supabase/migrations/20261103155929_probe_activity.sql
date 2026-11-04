-- S12a (D-053): what the Probes & heartbeat page reads about the last 24 h, from our own check results.
-- Security invoker: check_results' own RLS decides who reads (staff). Each is one scan of a day of
-- checks through the BRIN index on checked_at (~37k rows at 3 locations × ~9 checks a minute).

-- "Results written per hour · last 24 h": one row per location and hour that had any result.
create function public.probe_activity_24h()
returns table (location text, hour timestamptz, results integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select cr.location, date_trunc('hour', cr.checked_at), count(*)::integer
  from public.check_results cr
  where cr.checked_at > now() - interval '24 hours'
    and cr.checked_at < now() + interval '5 minutes'
  group by 1, 2
$$;

-- "Gaps · 24h": a location's silences of more than 3 min (the heartbeat grace, spec §15.3) between two
-- of its results — gap_start is its last result before, gap_end its first after. A silence still going
-- on has no end yet: the page shows that one from probe_locations.last_heartbeat_at.
create function public.probe_gaps_24h()
returns table (location text, gap_start timestamptz, gap_end timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.location, g.prev_at, g.checked_at
  from (
    select cr.location, cr.checked_at,
      lag(cr.checked_at) over (partition by cr.location order by cr.checked_at) as prev_at
    from public.check_results cr
    where cr.checked_at > now() - interval '24 hours'
      and cr.checked_at < now() + interval '5 minutes'
  ) g
  where g.checked_at - g.prev_at > interval '3 minutes'
  order by g.prev_at
$$;

revoke execute on function public.probe_activity_24h() from public, anon;
grant execute on function public.probe_activity_24h() to authenticated, service_role;
revoke execute on function public.probe_gaps_24h() from public, anon;
grant execute on function public.probe_gaps_24h() to authenticated, service_role;
