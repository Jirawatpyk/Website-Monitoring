-- S05c (spec §20): the Sites list's BKK / SIN / TYO glyphs — the latest check of each live site's
-- primary monitor per location, from the last 15 min (Tier 3 checks every 5 min). A recheck starts
-- after its scheduled check, so it supersedes it; `attempt desc` only breaks an exact tie.
-- Security invoker: check_results' own RLS decides who reads (staff). One index probe per
-- monitor and location (check_results_monitor_location_idx); the two bounds on now() prune the
-- partitions at run time (the upper one allows Bangkok's ±5 min clock, as Ingest does).
-- No parameters, so a plain sql function with a generic plan is fine here (cf. engine_checks).

create function public.site_list_locations()
returns table (
  site_id uuid,
  location text,
  outcome public.check_outcome,
  error text,
  response_ms integer,
  checked_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.site_id, l.code, c.outcome, c.error, c.response_ms, c.checked_at
  from public.monitors m
  join public.sites s on s.id = m.site_id and s.is_active
  cross join public.probe_locations l
  cross join lateral (
    select cr.outcome, cr.error, cr.response_ms, cr.checked_at
    from public.check_results cr
    where cr.monitor_id = m.id
      and cr.location = l.code
      and cr.checked_at > now() - interval '15 minutes'
      and cr.checked_at < now() + interval '5 minutes'
    order by cr.checked_at desc, cr.attempt desc
    limit 1
  ) c
  where m.is_primary
$$;

revoke execute on function public.site_list_locations() from public, anon;
grant execute on function public.site_list_locations() to authenticated;
