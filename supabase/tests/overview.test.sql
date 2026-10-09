-- S06b (spec §21, D-032): the Overview's Realtime tables and overview_response_24h() — 15-minute
-- p50 per live site's primary monitor over the last 24 h; staff read through check_results' RLS.
begin;
\ir _helpers.psql
select plan(11);

-- Realtime publication
select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_status'),
  'site_status is in supabase_realtime'
);
select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'incidents'),
  'incidents is in supabase_realtime'
);
select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'monitor_status'),
  'monitor_status is in supabase_realtime'
);

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
   (select id from ids where name = 'arm'), true),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Draft', 2,
   (select id from ids where name = 'arm'), false);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true, 'https://a.pgtap.test'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'http', false, 'https://a.pgtap.test/key'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'http', true, 'https://b.pgtap.test');

-- Two whole quarter hours in the past: q1 = 2 h ago, q2 = 1 h ago (aligned to the quarter hour).
create temp table q on commit drop as
  select to_timestamp(floor(extract(epoch from now() - interval '2 hours') / 900) * 900) as q1,
         to_timestamp(floor(extract(epoch from now() - interval '1 hour') / 900) * 900) as q2;
grant select on q to authenticated, anon;

insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, status_code, response_ms, error)
select v.monitor_id::uuid, v.location, v.at, v.attempt, v.outcome::public.check_outcome, v.code, v.ms, v.err
from q, lateral (values
  -- q1: three passes (200, 300, 400 → p50 300), a hard fail and a TLS chain error (not a hard fail)
  ('00000000-0000-0000-0000-0000000000d1', 'BKK', q.q1 + interval '1 min', 1, 'pass', 200, 200, null),
  ('00000000-0000-0000-0000-0000000000d1', 'SIN', q.q1 + interval '2 min', 1, 'pass', 200, 300, null),
  ('00000000-0000-0000-0000-0000000000d1', 'TYO', q.q1 + interval '3 min', 1, 'pass', 200, 400, null),
  ('00000000-0000-0000-0000-0000000000d1', 'BKK', q.q1 + interval '4 min', 1, 'fail', 503, 90, null),
  ('00000000-0000-0000-0000-0000000000d1', 'TYO', q.q1 + interval '5 min', 1, 'fail', null, 120, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
  -- q2: only failures → a row with no p50 (the line breaks)
  ('00000000-0000-0000-0000-0000000000d1', 'BKK', q.q2 + interval '1 min', 1, 'fail', 500, 900, null),
  ('00000000-0000-0000-0000-0000000000d1', 'BKK', q.q2 + interval '1 min', 2, 'fail', 500, 950, null),
  -- older than 24 h, beyond Bangkok's clock allowance, a key page and a Draft: all left out
  ('00000000-0000-0000-0000-0000000000d1', 'SIN', now() - interval '25 hours', 1, 'pass', 200, 100, null),
  ('00000000-0000-0000-0000-0000000000d1', 'SIN', now() + interval '10 min', 1, 'pass', 200, 100, null),
  ('00000000-0000-0000-0000-0000000000d3', 'BKK', q.q1 + interval '1 min', 1, 'pass', 200, 999, null),
  ('00000000-0000-0000-0000-0000000000d2', 'BKK', q.q1 + interval '1 min', 1, 'pass', 200, 999, null)
) as v(monitor_id, location, at, attempt, outcome, code, ms, err);

select tests.authenticate_as((select id from ids where name = 'mint'));
select results_eq(
  $$select r.bucket_start = q.q1, r.checks, r.hard_fails, r.p50_ms
    from public.overview_response_24h() r, q order by r.bucket_start$$,
  $$values (true, 5, 1, 300), (false, 2, 2, null::integer)$$,
  'a viewer gets per-bucket checks, hard fails (TLS chain excluded) and the p50 of passing checks'
);
select is(
  (select count(distinct site_id)::int from public.overview_response_24h()),
  1,
  'only the live site''s primary monitor counts (key pages, Drafts, > 24 h and future stamps left out)'
);
select is(
  (select count(*)::int from public.overview_response_24h()
   where extract(epoch from bucket_start)::bigint % 900 <> 0),
  0,
  'buckets start on the quarter hour'
);

select tests.authenticate_as((select id from ids where name = 'arm'));
select is(
  (select count(*)::int from public.overview_response_24h()),
  2,
  'a responder reads every site''s line, as on Overview'
);

select tests.authenticate_as((select id from ids where name = 'cli'));
select is(
  (select count(*)::int from public.overview_response_24h()),
  0,
  'a client account sees no check results (RLS)'
);

select tests.as_anon();
select throws_ok(
  $$select * from public.overview_response_24h()$$,
  '42501', null, 'anon cannot call it'
);

reset role;
select is(
  (select prosecdef from pg_proc where oid = 'public.overview_response_24h()'::regprocedure),
  false,
  'it runs as the invoker, so check_results'' RLS applies'
);
select is(
  (select provolatile from pg_proc where oid = 'public.overview_response_24h()'::regprocedure),
  's',
  'it is stable'
);

select * from finish();
rollback;
