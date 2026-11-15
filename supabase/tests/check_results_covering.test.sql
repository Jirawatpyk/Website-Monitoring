-- The cold-load fix (15 Nov 2026): the covering indexes that let the Overview and Probes read a day of
-- checks from the index alone, and each partition vacuumed after every 10 k inserts so those reads skip
-- the table — on the partitions that exist and on each one the partition job makes.
begin;
\ir _helpers.psql
select plan(10);

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
select is(
  (select pg_get_indexdef('public.check_results_monitor_location_cover_idx'::regclass)),
  'CREATE INDEX check_results_monitor_location_cover_idx ON ONLY public.check_results USING btree (monitor_id, location, checked_at DESC) INCLUDE (attempt, outcome, error, response_ms)',
  'the per-monitor-and-location walk is covered (the TLS chain Since, the newest check per location)'
);
select ok(to_regclass('public.check_results_monitor_idx') is null
          and to_regclass('public.check_results_monitor_location_idx') is null,
  'the old indexes are gone: one index written per check for each key, not two');

select is(
  (select count(*) from pg_catalog.pg_inherits h
   where h.inhparent in ('public.check_results_monitor_cover_idx'::regclass,
                         'public.check_results_checked_at_location_idx'::regclass,
                         'public.check_results_monitor_location_cover_idx'::regclass)),
  (select count(*) * 3 from partitions),
  'every partition''s index is attached to the parent''s (built per partition, then attached)'
);
select throws_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, error)
    select id, 'SIN', now(), 1, 'fail', repeat('x', 501) from public.monitors limit 1$$,
  '23514', null,
  'an error over 500 characters is refused (it would also break the covering index rows)'
);

-- The job puts a hand-changed partition back.
do $$
begin
  execute format('alter table private.%I set (autovacuum_vacuum_insert_threshold = 50)',
    (select max(relname) from partitions));
end;
$$;

select ok((select count(*) > 0 from partitions), 'check_results has partitions');
select is(
  (select count(*) from partitions
   where not (opts @> array['autovacuum_vacuum_insert_threshold=10000', 'autovacuum_vacuum_insert_scale_factor=0'])),
  1::bigint,
  'every existing partition is vacuumed after every 10 k inserts, but the one changed by hand above'
);

-- Four months on, the job also drops this month's partition (90 days) — fine, the test rolls back.
select lives_ok(
  $$select private.manage_check_results_partitions(now() + interval '4 months')$$,
  'the partition job makes later months'
);
select is(
  (select count(*) from partitions
   where not (opts @> array['autovacuum_vacuum_insert_threshold=10000', 'autovacuum_vacuum_insert_scale_factor=0'])),
  0::bigint,
  'a partition the job makes gets both vacuum settings, and the hand-changed one is put back'
);

select * from finish();
rollback;
