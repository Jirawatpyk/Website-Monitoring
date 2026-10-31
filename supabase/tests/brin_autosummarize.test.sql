-- BRIN autosummarize on every check_results partition's index (db-reviewer, D-051 review): the ones
-- that exist, and each one the partition job makes.
begin;
\ir _helpers.psql
select plan(6);

create temp view brin_children as
  select c.relname, coalesce(c.reloptions, '{}') as opts
  from pg_catalog.pg_inherits h
  join pg_catalog.pg_class c on c.oid = h.inhrelid
  where h.inhparent = 'public.check_results_checked_at_brin'::regclass;

select ok((select count(*) > 0 from brin_children), 'the partitions have BRIN child indexes');
select is(
  (select count(*) from brin_children where not ('autosummarize=on' = any (opts))),
  0::bigint,
  'every existing partition summarizes as it fills'
);

select lives_ok(
  $$select private.summarize_check_results_brin()$$,
  'the nightly backstop summarizes every partition''s new ranges'
);
select is(
  (select count(*) from cron.job where jobname = 'check-results-brin-summarize'),
  1::bigint,
  'the backstop runs nightly'
);

-- Four months on, the job also drops this month's partition (90 days) — fine, the test rolls back.
select lives_ok(
  $$select private.manage_check_results_partitions(now() + interval '4 months')$$,
  'the partition job makes later months'
);
select is(
  (select count(*) from brin_children where not ('autosummarize=on' = any (opts))),
  0::bigint,
  'a partition the job makes gets autosummarize too, and running it again is harmless'
);

select * from finish();
rollback;
