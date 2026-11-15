-- Fill check_chain_streaks for the streaks already running, once, after the trigger exists
-- (20261115120001): the old walk, per monitor and location whose newest check (90 days kept) is a chain
-- error — the first check after the last one that wasn't. Overwrites what the trigger may have started
-- since it was created (the walk sees every row). A handful of rows (Cando Asia on 15 Nov), through
-- check_results_monitor_location_cover_idx. Its own file, apart from the trigger's lock.
set local lock_timeout = '5s';

with pairs as (
  select m.id as monitor_id, l.code as location
  from public.monitors m
  cross join public.probe_locations l
),
latest as (
  select p.monitor_id, p.location,
    (select cr.outcome = 'fail' and coalesce(cr.error, '') in
              ('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT')
     from public.check_results cr
     where cr.monitor_id = p.monitor_id and cr.location = p.location
       and cr.checked_at > now() - interval '90 days'
     order by cr.checked_at desc, cr.attempt desc
     limit 1) as chained
  from pairs p
),
starts as (
  select lt.monitor_id, lt.location,
    (select min(cr.checked_at)
     from public.check_results cr
     where cr.monitor_id = lt.monitor_id and cr.location = lt.location
       and cr.checked_at > coalesce(
         (select max(g.checked_at) from public.check_results g
          where g.monitor_id = lt.monitor_id and g.location = lt.location
            and g.checked_at > now() - interval '90 days'
            and not (g.outcome = 'fail' and coalesce(g.error, '') in
                       ('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'))),
         now() - interval '90 days')) as since
  from latest lt
  where lt.chained
)
insert into public.check_chain_streaks (monitor_id, location, since)
select monitor_id, location, since from starts where since is not null
on conflict (monitor_id, location) do update set since = excluded.since;
