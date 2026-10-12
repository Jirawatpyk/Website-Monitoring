-- S06b (spec §21, D-032): the Overview's Realtime tables and overview_response_24h() — 15-minute
-- p50 per live site's primary monitor over the last 24 h; staff read through check_results' RLS.
begin;
\ir _helpers.psql
select plan(15);

-- Realtime publication: exactly these public tables, so adding another (monitor_status,
-- notifications, incident_events, profiles …) has to be a reviewed change. S09b adds
-- maintenance_windows (/maintenance, D-037).
select set_eq(
  $$select tablename::text from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'$$,
  array['site_status', 'incidents', 'maintenance_windows'],
  'supabase_realtime publishes exactly site_status, incidents and maintenance_windows'
);
select is(
  (select bool_and(c.relrowsecurity) from pg_class c
   where c.oid in ('public.site_status'::regclass, 'public.incidents'::regclass,
                   'public.maintenance_windows'::regclass)),
  true,
  'the published tables keep RLS on (Realtime filters events by it)'
);
select ok(
  not has_table_privilege('anon', 'public.site_status', 'select')
  and not has_table_privilege('anon', 'public.incidents', 'select'),
  'anon cannot select the published tables'
);
select ok(
  not has_function_privilege('anon', 'public.overview_response_24h()', 'execute')
  and has_function_privilege('authenticated', 'public.overview_response_24h()', 'execute'),
  'overview_response_24h: authenticated may execute, anon may not'
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

-- One row in each published table: what Realtime would send is what each person may select.
insert into public.site_status (site_id, status, since) values ('00000000-0000-0000-0000-0000000000a1', 'down', now());
insert into public.incidents (site_id, monitor_id, trigger, severity, episode_severity, state, started_at, detected_at)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'hard_fail', 'down', 'down',
          'unacked', now() - interval '5 min', now() - interval '4 min');

select tests.authenticate_as((select id from ids where name = 'cli'));
select is(
  (select count(*)::int from public.site_status) + (select count(*)::int from public.incidents),
  0,
  'a client account selects nothing from the published tables, so Realtime sends it no changes'
);

select tests.authenticate_as((select id from ids where name = 'mint'));
select is(
  (select count(*)::int from public.site_status) + (select count(*)::int from public.incidents),
  2,
  'a viewer selects them (and gets their changes)'
);
select results_eq(
  $$select r.bucket_starts = array[q.q1, q.q2], r.checks, r.hard_fails, r.p50_ms
    from public.overview_response_24h() r, q$$,
  $$values (true, array[5, 2], array[1, 2], array[300, null]::integer[])$$,
  'a viewer gets one row per site: buckets oldest first, checks, hard fails (TLS chain excluded), p50 of passes'
);
select is(
  (select count(*)::int from public.overview_response_24h()),
  1,
  'only the live site''s primary monitor counts (key pages, Drafts, > 24 h and future stamps left out)'
);
select is(
  (select count(*)::int from public.overview_response_24h() r, unnest(r.bucket_starts) b
   where extract(epoch from b)::bigint % 900 <> 0),
  0,
  'buckets start on the quarter hour'
);

select tests.authenticate_as((select id from ids where name = 'arm'));
select is(
  (select count(*)::int from public.overview_response_24h()),
  1,
  'a responder reads every site''s line, as on Overview'
);

select tests.authenticate_as((select id from ids where name = 'cli'));
select is(
  (select count(*)::int from public.overview_response_24h()),
  0,
  'a client account sees no check results (RLS)'
);

reset role;
update public.profiles set is_active = false where id = (select id from ids where name = 'mint');
select tests.authenticate_as((select id from ids where name = 'mint'));
select is(
  (select count(*)::int from public.overview_response_24h()),
  0,
  'a deactivated staff account gets no rows'
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
