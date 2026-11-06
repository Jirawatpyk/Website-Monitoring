-- Recurring maintenance (S14, FR-10b, D-057): the rule, the days it falls on, occurrences as ordinary
-- windows 14 days ahead (approved series only), overlap skipped and noted, approval once, a quiet cancel
-- of what hasn't started, who may do what, and one audit row per change.
begin;
\ir _helpers.psql
select plan(42);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('nok',  tests.create_user('nok@pgtap.test', 'responder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), true);
create temp table s (name text primary key, id uuid) on commit drop;
grant select, insert on s to authenticated, service_role;

-- ── The rule ─────────────────────────────────────────────────────────────
select ok(public.valid_series_rule('{"freq":"weekly","days":[2,4]}'), 'weekly on chosen weekdays');
select ok(public.valid_series_rule('{"freq":"monthly","day":31}'), 'monthly on day N');
select ok(public.valid_series_rule('{"freq":"monthly","nth":2,"weekday":2}'), 'monthly on the 2nd Tuesday');
select ok(not public.valid_series_rule('{"freq":"weekly","days":[]}'), 'no weekday is refused');
select ok(not public.valid_series_rule('{"freq":"weekly","days":[2,2]}'), 'a weekday twice is refused');
select ok(not public.valid_series_rule('{"freq":"weekly","days":[8]}'), 'weekday 8 is refused');
select ok(not public.valid_series_rule('{"freq":"monthly","nth":5,"weekday":1}'), 'a 5th weekday is refused (v1)');
select ok(not public.valid_series_rule('{"freq":"monthly","day":15,"nth":1}'), 'day and nth together are refused');
select ok(not public.valid_series_rule('{"freq":"daily"}'), 'another frequency is refused');

-- ── The days it falls on (Bangkok calendar) ──────────────────────────────
select is((select count(*)::int from generate_series('2026-11-01'::date, '2026-11-30', '1 day') d
           where private.series_matches('{"freq":"weekly","days":[2]}', d::date)), 4, 'every Tuesday of Nov 2026');
select ok(not exists (select 1 from generate_series('2026-04-01'::date, '2026-04-30', '1 day') d
          where private.series_matches('{"freq":"monthly","day":31}', d::date)), 'day 31 skips April');
select is((select array_agg(d::date) from generate_series('2026-11-01'::date, '2026-12-31', '1 day') d
           where private.series_matches('{"freq":"monthly","nth":2,"weekday":2}', d::date)),
  array['2026-11-10', '2026-12-08']::date[], 'the 2nd Tuesday of each month');

-- ── Who may create; an Admin's series is approved and its occurrences added at once ──
select tests.authenticate_as((select id from ids where name = 'mint'));
select throws_ok($$ select public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '01:00', 120, current_date + 1, null, 'Updates') $$,
  '42501', null, 'a Viewer can''t');
reset role;
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok($$ select public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '01:00', 120, current_date + 1, null, 'Updates') $$,
  '42501', null, 'nor a Responder who doesn''t own the site');
reset role;

select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '01:00', 120, current_date + 1, null, ' ') $$,
  '22023', null, 'a reason is required');
select throws_ok($$ select public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '01:00', 1441, current_date + 1, null, 'Updates') $$,
  '22023', null, 'an occurrence lasts at most 24 h');
select throws_ok($$ select public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"monthly","day":31}', '01:00', 60, '2027-04-01', '2027-04-30', 'Updates') $$,
  '22023', null, 'refused when no occurrence falls between the days');
insert into s values ('daily', public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '01:00', 120, current_date + 1, null, 'Plugin updates'));
reset role;

select ok((select approved_at is not null from public.maintenance_series where id = (select id from s where name = 'daily')),
  'an Admin''s series is approved on create');
select is((select count(*)::int from public.maintenance_windows where series_id = (select id from s where name = 'daily')),
  (select count(*)::int from generate_series(current_date + 1, ((now() + interval '14 days') at time zone 'Asia/Bangkok')::date, '1 day') d
   where ((d::date + time '01:00') at time zone 'Asia/Bangkok') >= now() + interval '5 minutes'),
  'its occurrences for the next 14 days exist as windows');
select ok((select bool_and(kind = 'maintenance' and approved_at is not null and reason = 'Plugin updates'
                           and ends_at - starts_at = interval '2 hours'
                           and to_char(starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '01:00')
           from public.maintenance_windows where series_id = (select id from s where name = 'daily')),
  'each occurrence is an approved window at 01:00 Bangkok for 2 h, with the series'' reason');
select is((select action from public.audit_log where entity_id = (select id from s where name = 'daily')),
  'maintenance.series_create', 'one audit row');

set local role service_role;
select is(public.engine_expand_series(now()), 0, 'the top-up adds nothing that exists already');
select is(public.engine_expand_series(now() + interval '1 day'), 1, 'and the next day''s occurrence a day later');
reset role;

-- ── An overlap skips that occurrence and notes it once ───────────────────
-- A second, overlapping series (Arm asks; Tao approves): the daily one holds every 01:00–03:00.
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into s values ('overlap', public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '02:00', 60, current_date + 1, null, 'Backups'));
reset role;
select is((select count(*)::int from public.maintenance_windows where series_id = (select id from s where name = 'overlap')),
  0, 'a Responder''s series waits for an Admin: no occurrences yet');
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok($$ select public.decide_maintenance_series((select id from s where name = 'overlap'), true, null) $$,
  '42501', null, 'only an Admin approves');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select lives_ok($$ select public.decide_maintenance_series((select id from s where name = 'overlap'), true, null) $$,
  'an Admin approves it');
reset role;
select is((select count(*)::int from public.maintenance_windows where series_id = (select id from s where name = 'overlap')),
  0, 'every occurrence overlaps the daily series: none added');
select ok((select jsonb_array_length(log) > 2 from public.maintenance_series where id = (select id from s where name = 'overlap'))
          and (select log @> '[{"action":"skipped"}]' from public.maintenance_series where id = (select id from s where name = 'overlap')),
  'each skip is noted on the series');
set local role service_role;
select is(public.engine_expand_series(now()), 0, 'the top-up tries again');
reset role;
select is((select count(*)::int from public.maintenance_series s2, jsonb_array_elements(s2.log) e
           where s2.id = (select id from s where name = 'overlap') and e ->> 'action' = 'skipped'),
  (select count(distinct e ->> 'starts_at')::int from public.maintenance_series s2, jsonb_array_elements(s2.log) e
   where s2.id = (select id from s where name = 'overlap') and e ->> 'action' = 'skipped'),
  'and notes each skip only once');

-- ── Who may decide, cancel and expand (security review S14) ──────────────
select tests.authenticate_as((select id from ids where name = 'mint'));
select throws_ok($$ select public.decide_maintenance_series((select id from s where name = 'overlap'), false, 'No') $$,
  '42501', null, 'a Viewer can''t decide a series');
select throws_ok($$ select public.engine_expand_series(now()) $$, '42501', null, 'nor run the top-up');
reset role;
-- Nok asks for a series on a site he doesn't own: refused at create, so give him one as the asker.
insert into s values ('nok', gen_random_uuid());
insert into public.maintenance_series (id, site_id, rule, start_time, duration_min, starts_on, reason, created_by)
values ((select id from s where name = 'nok'), '00000000-0000-0000-0000-0000000000a1', '{"freq":"monthly","day":1}',
        '03:00', 60, current_date + 1, 'Asked before he moved teams', (select id from ids where name = 'nok'));
update public.profiles set role = 'viewer' where id = (select id from ids where name = 'nok');
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok($$ select public.cancel_maintenance_series((select id from s where name = 'nok'), 'x') $$,
  '42501', null, 'the asker, no longer a Responder, can''t cancel it');
reset role;
update public.profiles set role = 'responder', is_active = false where id = (select id from ids where name = 'nok');
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok($$ select public.cancel_maintenance_series((select id from s where name = 'nok'), 'x') $$,
  '42501', null, 'nor once deactivated');
reset role;
update public.profiles set is_active = true where id = (select id from ids where name = 'nok');
select tests.authenticate_as((select id from ids where name = 'nok'));
select lives_ok($$ select public.cancel_maintenance_series((select id from s where name = 'nok'), 'Not needed') $$,
  'an active Responder who asked may withdraw it');
reset role;
select tests.as_anon();
select throws_ok($$ select public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"monthly","day":1}', '03:00', 60, current_date + 1, null, 'x') $$, '42501', null, 'anon can''t create one');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"monthly","day":1}', '03:00', 60, current_date + 1, current_date + 1000, 'x') $$,
  '22023', null, 'days more than two years ahead are refused');
reset role;

-- ── Cancel: what hasn't started is cancelled quietly ─────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select ok(public.cancel_maintenance_series((select id from s where name = 'daily'), 'No longer needed') > 0,
  'the site''s owner cancels the series');
reset role;
select ok(not exists (select 1 from public.maintenance_windows
                      where series_id = (select id from s where name = 'daily') and cancelled_at is null),
  'its occurrences that hadn''t started are cancelled');
select is((select count(*)::int from public.notifications n join public.maintenance_windows w on w.id = n.maintenance_window_id
           where w.series_id = (select id from s where name = 'daily')), 0, 'without a message each');
select is((select jsonb_array_length(after -> 'occurrences_cancelled') from public.audit_log
           where action = 'maintenance.series_cancel' and entity_id = (select id from s where name = 'daily')),
  (select count(*)::int from public.maintenance_windows where series_id = (select id from s where name = 'daily')),
  'the cancel''s audit row lists each occurrence it cancelled');
select is((select count(*)::int from public.audit_log a join public.maintenance_windows w on w.id = a.entity_id
           where a.action = 'maintenance.create' and w.series_id = (select id from s where name = 'daily')),
  (select count(*)::int from public.maintenance_windows where series_id = (select id from s where name = 'daily')),
  'and each occurrence has its own create row');

select * from finish();
rollback;
