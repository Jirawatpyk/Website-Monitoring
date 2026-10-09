-- S06 (D-031): check_rollups — the pg_cron jobs (rollups and the S02a partitions), what a rollup
-- counts, retention, RLS, and the two read functions (site_response_series, site_list_response_24h).
begin;
\ir _helpers.psql
select plan(28);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer')),
  ('cli',  tests.create_user('cli@pgtap.test', 'client'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Live', 1,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true, 'https://a.pgtap.test'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'http', false, 'https://a.pgtap.test/key');

-- ── Jobs (Done-when 1) ────────────────────────────────────────────────────
select results_eq(
  $$select jobname::text, schedule::text from cron.job
    where jobname in ('check-rollups-hourly', 'check-rollups-daily', 'check-results-partitions')
    order by jobname$$,
  $$values ('check-results-partitions', '17 19 * * *'), ('check-rollups-daily', '20 17 * * *'),
           ('check-rollups-hourly', '5 * * * *')$$,
  'pg_cron runs the hourly and daily rollups and the nightly partition job'
);
select isnt(
  to_regclass('private.check_results_' || to_char(now() at time zone 'UTC' + interval '1 month', 'YYYY_MM')),
  null,
  'next month''s check_results partition exists ahead of time'
);
create table private.check_results_2020_01 partition of public.check_results
  for values from ('2020-01-01 00:00+00') to ('2020-02-01 00:00+00');
select private.manage_check_results_partitions();
select is(
  to_regclass('private.check_results_2020_01'),
  null,
  'the partition job drops raw partitions older than 90 days'
);

-- ── What an hour rolls up to ──────────────────────────────────────────────
-- An hour inside this month (its partition exists); the key page monitor keeps the fixture away from
-- the read functions' primary-monitor checks below.
create temp table t (t0 timestamptz) on commit drop;
insert into t values (date_trunc('month', now()) + interval '1 day 3 hours');
insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, status_code, response_ms, error)
select '00000000-0000-0000-0000-0000000000d3', v.loc, t.t0 + v.off, 1, v.outcome::public.check_outcome, v.code, v.ms, v.err
from t, (values
  ('BKK', interval '1 min', 'pass', 200, 100, null),
  ('BKK', interval '2 min', 'pass', 200, 300, null),
  ('BKK', interval '3 min', 'fail', 503, 900, null),
  ('SIN', interval '1 min', 'pass', 200, 200, null),
  ('SIN', interval '2 min', 'fail', null, 50, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
  ('TYO', interval '1 min', 'blocked', 403, 80, null),
  -- the next hour: not in the rolled range
  ('BKK', interval '61 min', 'pass', 200, 5000, null)
) as v(loc, off, outcome, code, ms, err);

select is(
  (select private.rollup_check_results('hour', t0, t0 + interval '1 hour') from t),
  4,
  'one hour of one monitor gives a row per location plus one for all locations'
);
select results_eq(
  $$select location, checks, hard_fails, blocked, p50_ms, p95_ms from public.check_rollups
    where monitor_id = '00000000-0000-0000-0000-0000000000d3' and bucket = 'hour'
    order by location nulls last$$,
  $$values ('BKK'::text, 3, 1, 0, 200, 290), ('SIN', 2, 0, 0, 200, 200), ('TYO', 1, 0, 1, null::int, null::int),
           (null, 6, 1, 1, 200, 290)$$,
  'checks, hard fails (a TLS chain error is not one, D-029), blocked, p50 / p95 over passing checks'
);
select is(
  (select bucket_start from public.check_rollups
   where monitor_id = '00000000-0000-0000-0000-0000000000d3' and bucket = 'hour' limit 1),
  (select t0 from t),
  'an hour row starts on the hour'
);
select lives_ok(
  $$select private.rollup_check_results('hour', t0, t0 + interval '1 hour') from t$$,
  'rolling the same hour again works'
);
select is(
  (select count(*)::int from public.check_rollups where monitor_id = '00000000-0000-0000-0000-0000000000d3'),
  4,
  'and replaces its rows instead of adding more'
);
select is(
  (select private.rollup_check_results('hour', t0, t0 + interval '30 min') from t),
  0,
  'a half-finished hour is never written'
);
select private.rollup_check_results('day', t0, t0 + interval '1 day') from t;
select results_eq(
  $$select bucket_start, checks from public.check_rollups
    where monitor_id = '00000000-0000-0000-0000-0000000000d3' and bucket = 'day' and location is null$$,
  $$select date_trunc('day', t0 at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok', 7 from t$$,
  'a day row starts at Bangkok midnight and holds the whole day'
);

-- ── Retention (the day job) ───────────────────────────────────────────────
insert into public.check_rollups (monitor_id, location, bucket, bucket_start, checks, hard_fails, blocked) values
  ('00000000-0000-0000-0000-0000000000d3', null, 'hour', now() - interval '91 days', 1, 0, 0),
  ('00000000-0000-0000-0000-0000000000d3', null, 'hour', now() - interval '89 days', 1, 0, 0),
  ('00000000-0000-0000-0000-0000000000d3', null, 'day', now() - interval '2 years 1 day', 1, 0, 0),
  ('00000000-0000-0000-0000-0000000000d3', null, 'day', now() - interval '700 days', 1, 0, 0);
select private.run_check_rollups('day');
select results_eq(
  $$select bucket::text, bucket_start < now() - interval '88 days' from public.check_rollups
    where monitor_id = '00000000-0000-0000-0000-0000000000d3' and bucket_start < now() - interval '80 days'
    order by bucket, bucket_start$$,
  $$values ('day', true), ('hour', true)$$,
  'the day job keeps hour rows 90 days and day rows 2 years'
);
select lives_ok($$select private.run_check_rollups('hour')$$, 'the hour job runs');
-- a missed run is caught up: the newest hour row is 6 h old, so the next run rolls from there
delete from public.check_rollups where bucket = 'hour';
insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, status_code, response_ms) values
  ('00000000-0000-0000-0000-0000000000d3', 'SIN', date_trunc('hour', now()) - interval '5 hours 30 minutes', 1, 'pass', 200, 100);
insert into public.check_rollups (monitor_id, location, bucket, bucket_start, checks, hard_fails, blocked)
  values ('00000000-0000-0000-0000-0000000000d3', null, 'hour', date_trunc('hour', now()) - interval '7 hours', 1, 0, 0);
select private.run_check_rollups('hour');
select is(
  (select checks from public.check_rollups where bucket = 'hour' and location = 'SIN'
     and bucket_start = date_trunc('hour', now()) - interval '6 hours'),
  1,
  'the hour job catches up the hours after its newest row'
);

-- ── Read functions over the primary monitor ───────────────────────────────
insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, status_code, response_ms) values
  ('00000000-0000-0000-0000-0000000000d1', 'BKK', now() - interval '10 min', 1, 'pass', 200, 150),
  ('00000000-0000-0000-0000-0000000000d1', 'SIN', now() - interval '10 min', 1, 'pass', 200, 250),
  ('00000000-0000-0000-0000-0000000000d1', 'TYO', now() - interval '10 min', 1, 'fail', 504, 30000),
  ('00000000-0000-0000-0000-0000000000d1', 'BKK', now() - interval '25 hours', 1, 'pass', 200, 9000);
insert into public.check_rollups (monitor_id, location, bucket, bucket_start, checks, hard_fails, blocked, p50_ms, p95_ms) values
  ('00000000-0000-0000-0000-0000000000d1', null, 'hour', date_trunc('hour', now()) - interval '2 hours', 60, 0, 0, 310, 480),
  ('00000000-0000-0000-0000-0000000000d1', 'BKK', 'hour', date_trunc('hour', now()) - interval '2 hours', 20, 0, 0, 220, 300);

select tests.authenticate_as((select id from ids where name = 'mint'));
select results_eq(
  $$select checks, hard_fails, p50_ms from public.site_response_series(
      '00000000-0000-0000-0000-0000000000a1', now() - interval '24 hours', '15m')
    where location is null and bucket_start is null$$,
  $$values (3, 1, 200)$$,
  'a viewer gets the 24 h total of the primary monitor (key page and older checks left out)'
);
select is(
  (select count(*)::int from public.site_response_series(
     '00000000-0000-0000-0000-0000000000a1', now() - interval '24 hours', '15m')
   where location is not null and bucket_start is not null),
  3,
  'and one 15-min bucket per location'
);
select results_eq(
  $$select location, checks, p50_ms from public.site_response_series(
      '00000000-0000-0000-0000-0000000000a1', now() - interval '7 days', 'hour')
    order by location nulls last$$,
  $$values ('BKK'::text, 20, 220), (null, 60, 310)$$,
  'longer ranges read the primary monitor''s rollup rows'
);
select throws_ok(
  $$select * from public.site_response_series('00000000-0000-0000-0000-0000000000a1', now(), 'week')$$,
  '22023',
  null,
  'an unknown bucket is refused'
);
select throws_ok(
  $$select * from public.site_response_series('00000000-0000-0000-0000-0000000000a1', now() - interval '90 days', '15m')$$,
  '22023',
  null,
  'a raw range longer than a day is refused'
);
select results_eq(
  $$select site_id, p50_ms from public.site_list_response_24h()$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid, 200)$$,
  'the Sites list gets each live site''s 24 h p50 over passing primary checks'
);
select ok(
  (select count(*) from public.check_rollups) > 0,
  'a viewer reads check_rollups'
);

select tests.authenticate_as((select id from ids where name = 'arm'));
select ok(
  (select count(*) from public.check_rollups) > 0,
  'a responder reads check_rollups'
);

select throws_ok(
  $$delete from public.check_rollups$$, '42501', null, 'staff can''t change rollups (only the job writes)'
);
select throws_ok(
  $$select private.run_check_rollups('hour')$$, '42501', null, 'nor run the rollup job'
);

select tests.authenticate_as((select id from ids where name = 'cli'));
select is((select count(*)::int from public.check_rollups), 0, 'a client account sees no rollups (RLS)');
select is(
  (select count(*)::int from public.site_response_series(
     '00000000-0000-0000-0000-0000000000a1', now() - interval '24 hours', '15m')),
  0,
  'nor any response series'
);

select tests.as_anon();
select throws_ok($$select * from public.check_rollups$$, '42501', null, 'anon can''t read check_rollups');
select throws_ok(
  $$select * from public.site_response_series('00000000-0000-0000-0000-0000000000a1', now(), '15m')$$,
  '42501',
  null,
  'anon can''t call site_response_series'
);
select throws_ok($$select * from public.site_list_response_24h()$$, '42501', null, 'nor site_list_response_24h');

reset role;
select * from finish();
rollback;
