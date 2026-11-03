-- Monitor fault (S12a, D-053): the Vercel side's beats and the VPS watchdog's are agent_heartbeats rows
-- staff read and only the service role writes; `probe_location_missing` is an Admin alert kind that emails
-- every active Admin, one open at a time.
begin;
\ir _helpers.psql
select plan(9);

select tests.clear_sites();
delete from public.agent_heartbeats;
update public.profiles set is_active = false where role = 'admin';
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated, service_role;
insert into ids values
  ('tao', tests.create_user('tao@pgtap.test', 'admin')),
  ('alex', tests.create_user('alex@pgtap.test', 'admin')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));

set local role service_role;
select lives_ok($$insert into public.agent_heartbeats (name, last_seen_at) values
  ('engine-sweep', now()), ('notifier', now()), ('crawler', now()), ('vps-watchdog', now())$$,
  'the service role stamps engine-sweep, notifier, crawler and vps-watchdog');
select throws_ok($$insert into public.agent_heartbeats (name, last_seen_at) values ('probe-sin', now())$$,
  '23514', null, 'an unknown beat name is refused (probes beat in probe_locations)');
reset role;

select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.agent_heartbeats), 4, 'a Viewer reads the beats (the Probes page)');
select throws_ok($$update public.agent_heartbeats set last_seen_at = now()$$, '42501', null,
  'a signed-in person can''t stamp a beat');
reset role;

set local role service_role;
select lives_ok($$select public.open_system_alert('probe_location_missing', '{"location":"SIN"}'::jsonb)$$,
  'the engine opens probe_location_missing');
reset role;
select is((select count(*)::int from public.notifications n join public.system_alerts a on a.id = n.system_alert_id
           where a.kind = 'probe_location_missing' and n.channel = 'email'),
  2, 'one email per active Admin (spec §19.5), no Chat');
select is((select count(*)::int from public.notifications n join public.system_alerts a on a.id = n.system_alert_id
           where a.kind = 'probe_location_missing' and n.channel = 'google_chat'),
  0, 'no page');
set local role service_role;
select lives_ok($$select public.open_system_alert('probe_location_missing', '{"location":"SIN"}'::jsonb)$$,
  'a second open while one is open does nothing more');
reset role;
select is((select count(*)::int from public.system_alerts where kind = 'probe_location_missing' and cleared_at is null),
  1, 'one open at a time');

select * from finish();
rollback;
