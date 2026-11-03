-- Probes & heartbeat page reads (S12a, D-053): results per location and hour, and silences > 3 min,
-- over the last 24 h; staff read through check_results' RLS, anon can't call them.
begin;
\ir _helpers.psql
select plan(6);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated, service_role;
insert into ids values
  ('arm', tests.create_user('arm@pgtap.test', 'responder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer')),
  ('site', '00000000-0000-0000-0000-0000000000a1');
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Probe page site', 1,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000a1', 'http', true, 'https://a.pgtap.test');

-- SIN every minute for the last 30 min except a 5-minute silence; TYO twice; an old BKK row out of range.
insert into public.check_results (monitor_id, location, checked_at, outcome)
select m.id, 'SIN', date_trunc('minute', now()) - make_interval(mins => g), 'pass'
from public.monitors m, generate_series(1, 30) g
where m.site_id = (select id from ids where name = 'site') and g not between 11 and 15;
insert into public.check_results (monitor_id, location, checked_at, outcome)
select m.id, l, now() - interval '2 minutes', 'pass'
from public.monitors m, (values ('TYO'), ('TYO')) v(l)
where m.site_id = (select id from ids where name = 'site');
insert into public.check_results (monitor_id, location, checked_at, outcome)
select m.id, 'BKK', now() - interval '25 hours', 'pass'
from public.monitors m where m.site_id = (select id from ids where name = 'site');

select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select sum(results)::int from public.probe_activity_24h() where location = 'SIN'), 25,
  'a Viewer counts SIN''s results of the last 24 h');
select is((select sum(results)::int from public.probe_activity_24h() where location = 'TYO'), 2, 'and TYO''s');
select is((select count(*)::int from public.probe_activity_24h() where location = 'BKK'), 0,
  'a result older than 24 h is left out');
select is((select count(*)::int from public.probe_gaps_24h()), 1, 'one silence over 3 min');
select is((select gap_end - gap_start from public.probe_gaps_24h() where location = 'SIN'), interval '6 minutes',
  'from SIN''s last result before it to its first after');
reset role;

select tests.as_anon();
select throws_ok($$select * from public.probe_activity_24h()$$, '42501', null, 'anon can''t call it');
reset role;

select * from finish();
rollback;
