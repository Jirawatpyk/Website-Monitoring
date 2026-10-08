-- S05c: site_list_locations() — the Sites list's per-location glyphs. Latest final check per live
-- site's primary monitor and location from the last 15 min; staff read through check_results' RLS.
begin;
\ir _helpers.psql
select plan(8);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('arm',   tests.create_user('arm@pgtap.test', 'responder')),
  ('mint',  tests.create_user('mint@pgtap.test', 'viewer')),
  ('cli',   tests.create_user('cli@pgtap.test', 'client'));

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

insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, status_code, response_ms, error) values
  -- SIN: an older pass, then the latest round's check failed and its recheck passed → the recheck
  ('00000000-0000-0000-0000-0000000000d1', 'SIN', now() - interval '2 min', 1, 'pass', 200, 300, null),
  ('00000000-0000-0000-0000-0000000000d1', 'SIN', now() - interval '1 min', 1, 'fail', 500, 900, null),
  ('00000000-0000-0000-0000-0000000000d1', 'SIN', now() - interval '1 min', 2, 'pass', 200, 410, null),
  -- TYO: a chain error, kept with its code
  ('00000000-0000-0000-0000-0000000000d1', 'TYO', now() - interval '1 min', 1, 'fail', null, 120, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
  -- a result stamped beyond Bangkok's clock allowance is ignored
  ('00000000-0000-0000-0000-0000000000d1', 'TYO', now() + interval '10 min', 1, 'pass', 200, 50, null),
  -- BKK: only a check older than 15 min → no row
  ('00000000-0000-0000-0000-0000000000d1', 'BKK', now() - interval '20 min', 1, 'pass', 200, 200, null),
  -- a key page and a Draft's monitor are not in the list
  ('00000000-0000-0000-0000-0000000000d3', 'BKK', now() - interval '1 min', 1, 'fail', 500, 100, null),
  ('00000000-0000-0000-0000-0000000000d2', 'BKK', now() - interval '1 min', 1, 'pass', 200, 100, null);

select tests.authenticate_as((select id from ids where name = 'mint'));
select results_eq(
  $$select location, outcome::text, response_ms, error from public.site_list_locations() order by location$$,
  $$values ('SIN', 'pass', 410, null::text), ('TYO', 'fail', 120, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')$$,
  'a viewer gets the latest final check per location (recheck wins; > 15 min, key pages and Drafts left out)'
);
select is(
  (select count(distinct site_id)::int from public.site_list_locations()),
  1,
  'only the live site has rows'
);

select tests.authenticate_as((select id from ids where name = 'arm'));

-- a recheck stamped after its failed scheduled check (as the probes write it) wins
reset role;
insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, status_code, response_ms) values
  ('00000000-0000-0000-0000-0000000000d1', 'BKK', now() - interval '30 seconds', 1, 'fail', 503, 80),
  ('00000000-0000-0000-0000-0000000000d1', 'BKK', now() - interval '20 seconds', 2, 'pass', 200, 90);
select tests.authenticate_as((select id from ids where name = 'arm'));
select is(
  (select outcome::text from public.site_list_locations() where location = 'BKK'),
  'pass',
  'a later recheck supersedes its scheduled check'
);
select is(
  (select count(*)::int from public.site_list_locations()),
  3,
  'a responder reads every site''s glyphs, as on Overview'
);

select tests.authenticate_as((select id from ids where name = 'cli'));
select is(
  (select count(*)::int from public.site_list_locations()),
  0,
  'a client account sees no check results (RLS)'
);

select tests.as_anon();
select throws_ok(
  $$select * from public.site_list_locations()$$,
  '42501', null, 'anon cannot call it'
);

reset role;
select is(
  (select prosecdef from pg_proc where oid = 'public.site_list_locations()'::regprocedure),
  false,
  'it runs as the invoker, so check_results'' RLS applies'
);
select is(
  (select provolatile from pg_proc where oid = 'public.site_list_locations()'::regprocedure),
  's',
  'it is stable'
);

select * from finish();
rollback;
