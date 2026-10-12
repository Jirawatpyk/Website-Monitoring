-- Maintenance windows and mute (S09, D-036): who may do what, the guardrails (§14.5 guard, 24 h mute,
-- over 24 h waits for an Admin), one audit row per change, no direct writes, window states, the
-- engine's window log, T09 (a mute never stops an open incident's ladder) and the late alert after a mute.
begin;
\ir _helpers.psql
select plan(95);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
delete from public.maintenance_windows;
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('nok',  tests.create_user('nok@pgtap.test', 'responder')),
  ('bua',  tests.create_user('bua@pgtap.test', 'stakeholder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
-- A: Arm owns, Ploy backs up (OK). D: Arm owns (DOWN, open incident). B: Tao owns (OK, Nok can't touch).
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Site D', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Site B', 2,
   (select id from ids where name = 'tao'), null);

create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated, service_role;
insert into inc values ('d', public.engine_open_incident('00000000-0000-0000-0000-0000000000d1', null,
  'hard_fail', 'down', now() - interval '20 minutes', now() - interval '19 minutes', now(), '{}', true));

create temp table win (name text primary key, id uuid) on commit drop;
grant select, insert on win to anon, authenticated, service_role;

-- ── Nobody writes the table or the mute fields directly ──────────────────
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ insert into public.maintenance_windows (site_id, kind, starts_at, ends_at, reason)
  values ('00000000-0000-0000-0000-0000000000a1', 'mute', now(), now() + interval '1 hour', 'x') $$,
  '42501', null, 'even an Admin can''t insert a window directly');
select throws_ok($$ update public.sites set muted_until = now() + interval '1 hour'
  where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'even an Admin can''t write the mute fields directly (D-036)');
reset role;

-- ── Who may mute ─────────────────────────────────────────────────────────
select tests.as_anon();
select throws_ok($$ select public.mute_site('00000000-0000-0000-0000-0000000000a1', now() + interval '1 hour', 'x') $$,
  '42501', null, 'anon can''t mute');
reset role;
select tests.authenticate_as((select id from ids where name = 'mint'));
select throws_ok($$ select public.mute_site('00000000-0000-0000-0000-0000000000a1', now() + interval '1 hour', 'x') $$,
  '42501', null, 'a Viewer can''t mute');
select is((select count(*)::int from public.maintenance_windows), 0, 'a Viewer reads windows (none yet)');
reset role;
select tests.authenticate_as((select id from ids where name = 'bua'));
select throws_ok($$ select public.mute_site('00000000-0000-0000-0000-0000000000a1', now() + interval '1 hour', 'x') $$,
  '42501', null, 'a Stakeholder can''t mute');
reset role;
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok($$ select public.mute_site('00000000-0000-0000-0000-0000000000a1', now() + interval '1 hour', 'x') $$,
  '42501', null, 'a Responder can''t mute a site they don''t own');
reset role;

-- ── Mute guardrails ──────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_like($$ select public.mute_site('00000000-0000-0000-0000-0000000000a1', now() + interval '1 hour', '  ') $$,
  '%reason%', 'a mute needs a reason');
select throws_like($$ select public.mute_site('00000000-0000-0000-0000-0000000000a1', now() + interval '25 hours', 'deploy') $$,
  '%at most 24 h%', 'a 25 h mute is refused (Done-when 4)');
insert into win values ('mute_a', public.mute_site('00000000-0000-0000-0000-0000000000a1',
  now() + interval '4 hours', 'Redeploying build'));
select ok((select id from win where name = 'mute_a') is not null, 'the backup owner mutes their site for 4 h');
select throws_like($$ select public.mute_site('00000000-0000-0000-0000-0000000000a1', now() + interval '1 hour', 'again') $$,
  '%already muted%', 'one mute at a time');
reset role;
select is((select muted_until from public.sites where id = '00000000-0000-0000-0000-0000000000a1'),
  now() + interval '4 hours', 'the site row mirrors the mute');
select is((select muted_at from public.sites where id = '00000000-0000-0000-0000-0000000000a1'),
  now(), 'and records when it started (Since)');
select is((select mute_reason from public.sites where id = '00000000-0000-0000-0000-0000000000a1'),
  'Redeploying build', 'with its reason');
select is((select count(*)::int from public.audit_log where entity_id = '00000000-0000-0000-0000-0000000000a1'
            and action like 'site.%mute%'), 1, 'one audit row for the mute (the row-change trigger stays quiet)');
select is((select action from public.audit_log where entity_id = '00000000-0000-0000-0000-0000000000a1'
            and action like 'site.%mute%'), 'site.mute', 'it is site.mute');
select is(public.window_state(w), 'active', 'the mute is active') from public.maintenance_windows w
  where w.id = (select id from win where name = 'mute_a');

-- ── Edit, end early ──────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_like(format('select public.edit_window_end(%L, now() + interval ''30 hours'', ''longer'')',
  (select id from win where name = 'mute_a')), '%at most 24 h%', 'a mute can''t be edited past 24 h');
select lives_ok(format('select public.edit_window_end(%L, now() + interval ''8 hours'', ''needs longer'')',
  (select id from win where name = 'mute_a')), 'the owner moves the mute''s end');
reset role;
select is((select muted_until from public.sites where id = '00000000-0000-0000-0000-0000000000a1'),
  now() + interval '8 hours', 'the site row follows the new end');
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_like(format('select public.end_window_early(%L, '''')', (select id from win where name = 'mute_a')),
  '%reason%', 'ending early needs a reason');
select lives_ok(format('select public.end_window_early(%L, ''Fixed'')', (select id from win where name = 'mute_a')),
  'the owner ends the mute early');
reset role;
select is((select muted_until from public.sites where id = '00000000-0000-0000-0000-0000000000a1'), null,
  'the site is no longer muted');
select is(public.window_state(w), 'ended', 'the mute has ended') from public.maintenance_windows w
  where w.id = (select id from win where name = 'mute_a');
select is((select array_agg(action order by at, action) from public.audit_log
            where entity_id = '00000000-0000-0000-0000-0000000000a1' and action like 'site.%mute%'),
  array['site.mute', 'site.mute', 'site.mute_end'], 'mute, edit and end each log one row (§23.11 names)');

-- ── Maintenance: the §14.5 guard (Done-when 2) ───────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok($$ select public.create_maintenance('00000000-0000-0000-0000-0000000000d1', now(),
  now() + interval '2 hours', 'Hotfix') $$, '22023', null,
  'maintenance can''t start now on a DOWN site with an open incident');
select lives_ok($$ select public.mute_site('00000000-0000-0000-0000-0000000000d1', now() + interval '1 hour',
  'Known outage, host restarting') $$, 'Mute instead is allowed');
select lives_ok($$ select public.create_maintenance('00000000-0000-0000-0000-0000000000d1',
  now() + interval '1 day', now() + interval '1 day 2 hours', 'Planned migration') $$,
  'a window later is allowed (it doesn''t overlap now)');
select throws_like($$ select public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() - interval '1 hour', now() + interval '1 hour', 'x') $$, '%in the past%', 'a start in the past is refused');
reset role;

-- ── Over 24 h waits for an Admin (Done-when 4) ───────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('long', public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '2 days', now() + interval '2 days 30 hours', 'Data-centre move'));
reset role;
select is(public.window_state(w), 'waiting', 'a Responder''s 30 h window waits for approval')
  from public.maintenance_windows w where w.id = (select id from win where name = 'long');
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(format('select public.approve_maintenance(%L, (select ends_at from public.maintenance_windows where id = %1$L))', (select id from win where name = 'long')),
  '42501', null, 'a Responder can''t approve');
select throws_like($$ select public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '2 days 1 hour', now() + interval '2 days 3 hours', 'overlap') $$,
  '%overlaps%', 'windows on one site don''t overlap');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select lives_ok(format('select public.approve_maintenance(%L, (select ends_at from public.maintenance_windows where id = %1$L))', (select id from win where name = 'long')),
  'an Admin approves it');
select throws_like(format('select public.approve_maintenance(%L, (select ends_at from public.maintenance_windows where id = %1$L))', (select id from win where name = 'long')),
  '%isn''t waiting%', 'once');
insert into win values ('admin_long', public.create_maintenance('00000000-0000-0000-0000-0000000000b1',
  now() + interval '1 hour', now() + interval '3 days', 'Server replacement'));
reset role;
select is(public.window_state(w), 'scheduled', 'the approved window is scheduled')
  from public.maintenance_windows w where w.id = (select id from win where name = 'long');
select is(public.window_state(w), 'scheduled', 'an Admin''s own 3-day window needs no approval')
  from public.maintenance_windows w where w.id = (select id from win where name = 'admin_long');
select is((select count(*)::int from public.audit_log where action = 'maintenance.approve'
            and entity_id = (select id from win where name = 'long')), 1,
  'the approval is logged');

-- Unapproved by its start → it never starts.
-- (its approval's 10 s Undo long over, S09b)
update public.maintenance_windows set approved_at = null, approved_by = null, undo_until = null
  where id = (select id from win where name = 'long');
select is(public.window_state(w, now() + interval '3 days'), 'not_approved',
  'a window nobody approved before its start doesn''t start')
  from public.maintenance_windows w where w.id = (select id from win where name = 'long');

-- Chaining 24 h windows end to end still needs an Admin (security review M1).
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('chain1', public.create_maintenance('00000000-0000-0000-0000-0000000000d1',
  now() + interval '10 days', now() + interval '11 days', 'Part 1'));
insert into win values ('chain2', public.create_maintenance('00000000-0000-0000-0000-0000000000d1',
  now() + interval '11 days', now() + interval '12 days', 'Part 2'));
reset role;
select is(public.window_state(w), 'scheduled', 'the first 24 h window is approved on its own')
  from public.maintenance_windows w where w.id = (select id from win where name = 'chain1');
select is(public.window_state(w), 'waiting', 'a second one back to back waits for an Admin')
  from public.maintenance_windows w where w.id = (select id from win where name = 'chain2');

-- A new site can't arrive muted.
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ insert into public.sites (name, tier, muted_until) values ('Muted at birth', 3, now() + interval '9 days') $$,
  '42501', null, 'a site can''t be created muted');
reset role;

-- The engine sets an unapproved window aside at its start, so its time is free again (db review H1).
update public.maintenance_windows set starts_at = now() - interval '1 minute', ends_at = now() + interval '29 hours'
  where id = (select id from win where name = 'long');
set local role service_role;
select public.engine_log_windows(now());
reset role;
select is(public.window_state(w), 'not_approved', 'still reads "not approved"')
  from public.maintenance_windows w where w.id = (select id from win where name = 'long');
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok($$ select public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '1 hour', now() + interval '3 hours', 'Smaller job') $$, 'and its time can be booked again');
reset role;

-- ── Cancel ───────────────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok(format('select public.cancel_window(%L, ''no'')', (select id from win where name = 'admin_long')),
  '42501', null, 'a Responder can''t cancel a window on a site they don''t own');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select lives_ok(format('select public.cancel_window(%L, ''Postponed'')', (select id from win where name = 'admin_long')),
  'the Admin cancels their window');
reset role;
select is(public.window_state(w), 'cancelled', 'it is cancelled')
  from public.maintenance_windows w where w.id = (select id from win where name = 'admin_long');

-- ── The engine logs a window's start and end once ────────────────────────
insert into public.maintenance_windows (id, site_id, kind, starts_at, ends_at, reason, approved_at)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'maintenance',
        now() - interval '2 hours', now() - interval '1 minute', 'Done already', now() - interval '3 hours');
set local role service_role;
select public.engine_log_windows(now());
select public.engine_log_windows(now());
reset role;
select is((select array_agg(action order by action) from public.audit_log
            where entity_id = '00000000-0000-0000-0000-0000000000e1'),
  array['maintenance.end', 'maintenance.start'], 'start and end logged once each, as System');

-- ── T09: a mute after the first alert never stops the ladder (Done-when 1) ─
-- Site D's incident alerted at open; it was muted above (Mute instead).
select ok(public.engine_thread_live((select id from inc where name = 'd')), 'the incident''s thread is live');
set local role service_role;
select ok(public.engine_fire_step((select id from inc where name = 'd'), 1::smallint, now(), '{"elapsedMin":15}'),
  'L1 still fires while the site is muted');
select ok(public.engine_remind((select id from inc where name = 'd'), now() + interval '15 minutes', '{}'),
  'and the reminder');
reset role;
select is((select state::text from public.incidents where id = (select id from inc where name = 'd')), 'escalated',
  'muting is not an acknowledgement');

-- ── The late alert after a mute ends (D-036) ─────────────────────────────
-- Site A is muted again, then goes down: the incident opens with nothing queued.
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('mute_a2', public.mute_site('00000000-0000-0000-0000-0000000000a1',
  now() + interval '1 hour', 'Known flaky'));
reset role;
insert into inc values ('a', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null,
  'hard_fail', 'down', now() - interval '2 minutes', now() - interval '1 minute', now(), '{"cause":"HTTP 500"}', false));
set local role service_role;
select is((select count(*)::int from public.engine_silent_incidents(now())
           where incident_id = (select id from inc where name = 'a')), 0, 'still muted: not listed');
select ok(not public.engine_post_late_alert((select id from inc where name = 'a'), now()),
  'and nothing is posted while muted');
reset role;
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.end_window_early((select id from win where name = 'mute_a2'), 'Done');
reset role;
set local role service_role;
-- S09b (§24.8): a mute a person ended waits out its 10 s Undo before its incident posts.
select is((select count(*)::int from public.engine_silent_incidents(now())
           where incident_id = (select id from inc where name = 'a')), 0, 'mute ended: not listed inside its Undo');
select is((select count(*)::int from public.engine_silent_incidents(now() + interval '11 seconds')
           where incident_id = (select id from inc where name = 'a')), 1, 'mute over: the silent incident is listed');
select ok(public.engine_post_late_alert((select id from inc where name = 'a'), now()), 'its first alert posts');
select ok(not public.engine_post_late_alert((select id from inc where name = 'a'), now()), 'once');
reset role;
select is((select array_agg(channel::text || ':' || template order by channel::text) from public.notifications
            where incident_id = (select id from inc where name = 'a')),
  array['email:down', 'google_chat:down'], 'the DOWN card and the owner email');
select is((select alerted_at from public.incidents where id = (select id from inc where name = 'a')), now(),
  'the ladder counts from now');

-- A run that read the incident before the late alert was stamped can't fire L1 early (engine review M5).
set local role service_role;
select ok(not public.engine_fire_step((select id from inc where name = 'a'), 1::smallint, now() - interval '1 minute', '{}'),
  'a level due before the late alert doesn''t fire');
reset role;

-- A PROBLEM that alerted, raised to DOWN while muted (D-021): its DOWN card is still owed (engine review M3).
insert into inc values ('b', public.engine_open_incident('00000000-0000-0000-0000-0000000000b1', null,
  'slow', 'problem', now() - interval '30 minutes', now() - interval '29 minutes', now(), '{}', true));
set local role service_role;
select ok(public.engine_escalate_incident((select id from inc where name = 'b'), now(), now(), '{}', false),
  'raised to DOWN with its card held back by a mute');
select ok(not public.engine_thread_live((select id from inc where name = 'b')),
  'the PROBLEM card doesn''t make the DOWN ladder live');
select is((select severity::text from public.engine_silent_incidents(now())
           where incident_id = (select id from inc where name = 'b')), 'down',
  'once the mute is over it is listed as a silent DOWN');
reset role;

-- ── Spec §23 (D-036 amended) ─────────────────────────────────────────────
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'Site F', 2,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy'));

select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_like($$ select public.mute_site('00000000-0000-0000-0000-0000000000f1', now() + interval '2 minutes', 'x') $$,
  '%at least 5 min%', 'a new end is at least 5 min away');
-- A request (3 days), withdrawn by its asker.
insert into win values ('req', public.create_maintenance('00000000-0000-0000-0000-0000000000f1',
  now() + interval '5 days', now() + interval '8 days', 'Server move'));
select throws_like(format('select public.cancel_window(%L, ''no'')', (select id from win where name = 'req')),
  '%withdraw it instead%', 'a request is withdrawn, not cancelled');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_like(format('select public.edit_window_end(%L, now() + interval ''7 days'', ''shorter'')', (select id from win where name = 'req')),
  '%decline it%', 'Admins don''t edit a request');
select throws_ok(format('select public.withdraw_request(%L, ''no'')', (select id from win where name = 'req')),
  '42501', null, 'an Admin declines rather than withdraws');
reset role;
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(format('select public.edit_window_end(%L, now() + interval ''5 days 20 hours'', ''one night'')', (select id from win where name = 'req')),
  'the asker edits the request down to 20 h');
reset role;
select is(public.window_state(w), 'waiting', 'a request edited down to 24 h or less still waits')
  from public.maintenance_windows w where w.id = (select id from win where name = 'req');
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(format('select public.withdraw_request(%L, ''Not needed'')', (select id from win where name = 'req')),
  'the asker withdraws it');
reset role;
select is(public.window_state(w), 'withdrawn', 'Recent: Withdrawn')
  from public.maintenance_windows w where w.id = (select id from win where name = 'req');
select is((select array_agg(l ->> 'action' order by ord) from public.maintenance_windows w,
           jsonb_array_elements(w.log) with ordinality as x(l, ord) where w.id = (select id from win where name = 'req')),
  array['requested', 'edited', 'withdrawn'], 'every action adds a log line');

-- Another request, declined by the Admin.
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('req2', public.create_maintenance('00000000-0000-0000-0000-0000000000f1',
  now() + interval '5 days', now() + interval '8 days', 'Server move'));
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_like(format('select public.decline_maintenance(%L, '' '')', (select id from win where name = 'req2')),
  '%reason%', 'declining needs a reason');
select lives_ok(format('select public.decline_maintenance(%L, ''Split it into two nights'')', (select id from win where name = 'req2')),
  'the Admin declines it with a reason');
reset role;
select is(public.window_state(w), 'declined', 'Recent: Declined')
  from public.maintenance_windows w where w.id = (select id from win where name = 'req2');
select is((select count(*)::int from public.audit_log where action in ('maintenance.request', 'maintenance.withdraw', 'maintenance.decline') and entity_id in (select id from win where name in ('req', 'req2'))),
  4, 'request ×2, withdraw and decline are logged with §23.11 names');

-- A running window is ended, not cancelled; a mute can't start during maintenance; maintenance now ends a mute.
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('mute_f', public.mute_site('00000000-0000-0000-0000-0000000000f1', now() + interval '2 hours', 'Noisy'));
insert into win values ('now_f', public.create_maintenance('00000000-0000-0000-0000-0000000000f1',
  now(), now() + interval '1 hour', 'Hotfix deploy'));
reset role;
select is(public.window_state(w), 'ended', 'maintenance starting now ends the running mute')
  from public.maintenance_windows w where w.id = (select id from win where name = 'mute_f');
select is((select muted_until from public.sites where id = '00000000-0000-0000-0000-0000000000f1'), null,
  'and the site is no longer muted');
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_like($$ select public.mute_site('00000000-0000-0000-0000-0000000000f1', now() + interval '1 hour', 'again') $$,
  '%in maintenance%', 'no mute during the site''s maintenance');
select throws_like(format('select public.cancel_window(%L, ''no'')', (select id from win where name = 'now_f')),
  '%end it now instead%', 'a running window is ended with End now, never cancelled');
select throws_like($$ select public.create_maintenance('00000000-0000-0000-0000-0000000000f1',
  now() + interval '30 minutes', now() + interval '2 hours', 'overlap') $$, '%overlaps%',
  'one maintenance window per site at a time');
reset role;

-- An incident waiting only for its root cause doesn't block maintenance (D-036 as amended).
update public.incidents set state = 'needs_root_cause' where id = (select id from inc where name = 'd');
update public.site_status set status = 'ok' where site_id = '00000000-0000-0000-0000-0000000000d1';
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok($$ select public.create_maintenance('00000000-0000-0000-0000-0000000000d1', now(), now() + interval '1 hour', 'Night work') $$,
  'needs root cause doesn''t block a window now');
reset role;

-- A scheduled window whose start comes while the site is DOWN doesn't start (§23.10).
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', 'Site G', 2, (select id from ids where name = 'arm'));
insert into public.maintenance_windows (id, site_id, kind, starts_at, ends_at, reason, approved_at)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f2', 'maintenance',
        now() - interval '1 minute', now() + interval '2 hours', 'Planned', now() - interval '1 day');
insert into inc values ('g', public.engine_open_incident('00000000-0000-0000-0000-0000000000f2', null,
  'hard_fail', 'down', now() - interval '3 minutes', now() - interval '2 minutes', now(), '{}', true));
set local role service_role;
select public.engine_log_windows(now());
reset role;
select is(public.window_state(w), 'didnt_start', 'the window didn''t start — the site was DOWN')
  from public.maintenance_windows w where w.id = '00000000-0000-0000-0000-0000000000e2';
select alike((select outcome_detail from public.maintenance_windows where id = '00000000-0000-0000-0000-0000000000e2'),
  'INC-%', 'it names the incident');

-- ── Review round 2 ───────────────────────────────────────────────────────
-- Security M1: a short bridge between two long windows still chains them — the third waits.
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c1', 'Site H', 2,
   (select id from ids where name = 'arm'), null);
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('h1', public.create_maintenance('00000000-0000-0000-0000-0000000000f3',
  now() + interval '20 days', now() + interval '20 days 22 hours', 'A'));
insert into win values ('h2', public.create_maintenance('00000000-0000-0000-0000-0000000000f3',
  now() + interval '20 days 22 hours', now() + interval '21 days', 'B'));
insert into win values ('h3', public.create_maintenance('00000000-0000-0000-0000-0000000000f3',
  now() + interval '21 days', now() + interval '21 days 22 hours', 'C'));
select throws_like($$ select public.create_maintenance('00000000-0000-0000-0000-0000000000f3',
  now(), now() + interval '30 hours', 'now and long') $$, '%later start%',
  'a Responder''s window over 24 h can''t start now');
reset role;
select is(public.window_state(w), 'waiting', 'the window after a bridge still waits for an Admin')
  from public.maintenance_windows w where w.id = (select id from win where name = 'h3');

-- Security M2: the Admin approves the request they saw.
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_like(format('select public.approve_maintenance(%L, now())', (select id from win where name = 'h3')),
  '%changed%', 'a request changed since the Admin looked is refused');
reset role;

-- Security L1 / L4: only the asker or the site's owner / backup withdraws; nobody but an Admin declines.
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok(format('select public.withdraw_request(%L, ''x'')', (select id from win where name = 'h3')),
  '42501', null, 'a Responder of another site can''t withdraw it');
select throws_ok(format('select public.decline_maintenance(%L, ''x'')', (select id from win where name = 'h3')),
  '42501', null, 'a Responder can''t decline');
reset role;
select tests.authenticate_as((select id from ids where name = 'mint'));
select throws_ok(format('select public.withdraw_request(%L, ''x'')', (select id from win where name = 'h3')),
  '42501', null, 'a Viewer can''t withdraw');
reset role;

-- Engine review: a Responder may shorten an approved window (only lengthening past 24 h needs an Admin).
select tests.authenticate_as((select id from ids where name = 'tao'));
insert into win values ('h4', public.create_maintenance('00000000-0000-0000-0000-0000000000f3',
  now() + interval '25 days', now() + interval '28 days', 'Long, Admin''s own'));
reset role;
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(format('select public.edit_window_end(%L, now() + interval ''27 days'', ''shorter'')', (select id from win where name = 'h4')),
  'the owner shortens an approved 3-day window');
reset role;

-- Engine review L-J: the scheduled start goes ahead on a site whose incident only needs its root cause,
-- and ends a running mute there.
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000c1', 'Site J', 2, (select id from ids where name = 'arm'));
insert into inc values ('j', public.engine_open_incident('00000000-0000-0000-0000-0000000000f4', null,
  'hard_fail', 'down', now() - interval '3 hours', now() - interval '3 hours', now(), '{}', true));
update public.incidents set state = 'needs_root_cause' where id = (select id from inc where name = 'j');
update public.site_status set status = 'ok' where site_id = '00000000-0000-0000-0000-0000000000f4';
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('mute_j', public.mute_site('00000000-0000-0000-0000-0000000000f4', now() + interval '3 hours', 'Noisy'));
reset role;
insert into public.maintenance_windows (id, site_id, kind, starts_at, ends_at, reason, approved_at)
values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f4', 'maintenance',
        now() - interval '1 minute', now() + interval '1 hour', 'Night work', now() - interval '1 day');
set local role service_role;
select public.engine_log_windows(now());
reset role;
select is(public.window_state(w), 'active', 'a scheduled window starts on a site whose incident only needs its root cause')
  from public.maintenance_windows w where w.id = '00000000-0000-0000-0000-0000000000e3';
select is(public.window_state(w), 'ended', 'and the running mute there ends')
  from public.maintenance_windows w where w.id = (select id from win where name = 'mute_j');

-- Engine review M-A: a PROBLEM AGAIN held back by a mute on an incident that already alerted DOWN
-- isn't a silent incident — no new card, the ladder keeps its clock.
select is((select count(*)::int from public.engine_silent_incidents(now())
           where incident_id = (select id from inc where name = 'j')), 0,
  'an incident that alerted DOWN is never "silent"');

-- Engine review L-J: a reminder due before the late alert doesn't go.
set local role service_role;
select ok(not public.engine_remind((select id from inc where name = 'a'), now() - interval '1 minute', '{}'),
  'a reminder due before the late alert doesn''t go');
reset role;

select * from finish();
rollback;
