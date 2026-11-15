-- The cold-load fix (15 Nov 2026): the covering indexes that let the Overview and Probes read a day of
-- checks from the index alone, and each partition vacuumed after every 10 k inserts so those reads skip
-- the table — on the partitions that exist and on each one the partition job makes.
begin;
\ir _helpers.psql
select plan(7);

create temp view partitions as
  select c.relname, coalesce(c.reloptions, '{}') as opts
  from pg_catalog.pg_inherits i
  join pg_catalog.pg_class c on c.oid = i.inhrelid
  where i.inhparent = 'public.check_results'::regclass;

select is(
  (select pg_get_indexdef('public.check_results_monitor_cover_idx'::regclass)),
  'CREATE INDEX check_results_monitor_cover_idx ON ONLY public.check_results USING btree (monitor_id, checked_at DESC) INCLUDE (outcome, error, response_ms)',
  'the per-monitor day is covered: outcome, error and response time in the index'
);
select is(
  (select pg_get_indexdef('public.check_results_checked_at_location_idx'::regclass)),
  'CREATE INDEX check_results_checked_at_location_idx ON ONLY public.check_results USING btree (checked_at) INCLUDE (location)',
  'a day per location is covered (Probes)'
);
select ok(to_regclass('public.check_results_monitor_idx') is null,
  'the old per-monitor index is gone: one index written per check, not two');

select ok((select count(*) > 0 from partitions), 'check_results has partitions');
select is(
  (select count(*) from partitions
   where not ('autovacuum_vacuum_insert_scale_factor=0' = any (opts)
              and 'autovacuum_vacuum_insert_threshold=10000' = any (opts))),
  0::bigint,
  'every existing partition is vacuumed after every 10 k inserts'
);

-- Four months on, the job also drops this month's partition (90 days) — fine, the test rolls back.
select lives_ok(
  $$select private.manage_check_results_partitions(now() + interval '4 months')$$,
  'the partition job makes later months'
);
select is(
  (select count(*) from partitions
   where not ('autovacuum_vacuum_insert_scale_factor=0' = any (opts))),
  0::bigint,
  'a partition the job makes gets the vacuum setting too, and running it again is harmless'
);

select * from finish();
rollback;
