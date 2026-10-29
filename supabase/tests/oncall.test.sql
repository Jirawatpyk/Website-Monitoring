-- On-call (S10 PR B0; spec §2, §27; D-009, D-048): the rotation and its weekly shifts (Monday 09:00
-- Bangkok), who holds the shift now, the swap flow (the person asked accepts, then an Admin
-- approves; no Undo), the hand-over, the phone checklist and the test link, the new message subject,
-- and that nobody writes the tables directly.
begin;
\ir _helpers.psql
select plan(65);

-- ── Fixtures ─────────────────────────────────────────────────────────────
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('nok',  tests.create_user('nok@pgtap.test', 'responder')),
  ('bua',  tests.create_user('bua@pgtap.test', 'stakeholder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));
delete from public.oncall_swaps; delete from public.oncall_events; delete from public.oncall_shifts;
delete from public.oncall_rotation;

-- ── The week boundary ────────────────────────────────────────────────────
select is(public.oncall_week_start('2026-09-25 03:07:00+00'), '2026-09-21 02:00:00+00'::timestamptz,
  'Fri 25 Sep 10:07 Bangkok belongs to the week from Mon 21 Sep 09:00');
select is(public.oncall_week_start('2026-09-28 01:59:00+00'), '2026-09-21 02:00:00+00'::timestamptz,
  'Mon 28 Sep 08:59 Bangkok is still the week before');
select is(public.oncall_week_start('2026-09-28 02:00:00+00'), '2026-09-28 02:00:00+00'::timestamptz,
  'Mon 28 Sep 09:00 Bangkok starts the next week');

-- ── The rotation ─────────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok($$ select public.save_oncall_rotation(array[(select id from ids where name = 'ploy')]) $$,
  '42501', null, 'a Responder can''t change the rotation');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.save_oncall_rotation(array[(select id from ids where name = 'bua')]) $$,
  '22023', 'Only active Admins and Responders can be on call', 'a stakeholder can''t be on call');
select throws_ok($$ select public.save_oncall_rotation(array[(select id from ids where name = 'ploy'), (select id from ids where name = 'ploy')]) $$,
  '22023', 'Each person can be in the rotation once', 'nobody twice');
select lives_ok($$ select public.save_oncall_rotation(array[(select id from ids where name = 'ploy'), (select id from ids where name = 'nok'), (select id from ids where name = 'arm')], 'First rotation') $$,
  'the Admin saves Ploy, Nok, Arm');
reset role;
select ok((select count(*) from public.oncall_shifts) >= 4, 'four weeks ahead are scheduled');
select is((select starts_at from public.oncall_shifts order by starts_at limit 1), public.oncall_week_start(now()),
  'the first week starts this Monday 09:00');
select is((select array_agg(p.display_name order by s.starts_at) from (select * from public.oncall_shifts order by starts_at limit 4) s join public.profiles p on p.id = s.user_id),
  (select array[a.display_name, b.display_name, c.display_name, a.display_name] from public.profiles a, public.profiles b, public.profiles c
   where a.id = (select id from ids where name = 'ploy') and b.id = (select id from ids where name = 'nok') and c.id = (select id from ids where name = 'arm')),
  'weeks follow the order and wrap: Ploy, Nok, Arm, Ploy');
select is(public.oncall_person_at(now()), (select id from ids where name = 'ploy'), 'Ploy is on call now');
select is((select count(*)::int from public.audit_log where action = 'oncall.rotation'), 1, 'one audit row for the rotation');
select is((select count(*)::int from public.oncall_events where kind = 'rotation_changed'), 1, 'and one event for its messages');

create temp table wk (n int primary key, id uuid, who uuid) on commit drop;
grant select on wk to authenticated, service_role;
insert into wk select row_number() over (order by starts_at), id, user_id from public.oncall_shifts;

-- ── Swaps ────────────────────────────────────────────────────────────────
-- Arm (week 3) asks Nok (week 2).
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok($$ select public.request_oncall_swap((select id from wk where n = 3), (select id from wk where n = 2)) $$,
  '42501', null, 'only the week''s owner asks');
reset role;
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_ok($$ select public.request_oncall_swap((select id from wk where n = 1), (select id from wk where n = 2)) $$,
  '22023', 'The live shift can’t be swapped — hand it over in Users', 'the live week can''t be swapped');
reset role;
create temp table sw (id uuid) on commit drop;
grant select, insert on sw to authenticated, service_role;
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into sw select public.request_oncall_swap((select id from wk where n = 3), (select id from wk where n = 2), 'Family trip');
select throws_ok($$ select public.request_oncall_swap((select id from wk where n = 3), (select id from wk where n = 2)) $$,
  '22023', 'A swap is already waiting', 'one open request per week');
select throws_ok($$ select public.respond_oncall_swap((select id from sw), true) $$,
  '42501', null, 'the requester can''t accept their own request');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.decide_oncall_swap((select id from sw), true) $$,
  '55000', 'Approve unlocks once the person asked accepts', 'the Admin approves only after the person asked accepts');
reset role;
select tests.authenticate_as((select id from ids where name = 'nok'));
select lives_ok($$ select public.respond_oncall_swap((select id from sw), true) $$, 'Nok accepts (no reason needed)');
select throws_ok($$ select public.respond_oncall_swap((select id from sw), true) $$,
  '55000', 'This request is closed', 'and can''t answer twice');
reset role;
select is((select user_id from public.oncall_shifts where id = (select id from wk where n = 2)), (select id from ids where name = 'nok'),
  'nothing changes in the rotation before the Admin approves (§27.1)');
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.decide_oncall_swap((select id from sw), false, '  ') $$,
  '22023', 'Say why — both of them see this', 'the Admin''s decline needs a reason');
select lives_ok($$ select public.decide_oncall_swap((select id from sw), true) $$, 'the Admin approves');
reset role;
select is((select array[(select user_id from public.oncall_shifts where id = (select id from wk where n = 2)),
                        (select user_id from public.oncall_shifts where id = (select id from wk where n = 3))]),
  array[(select id from ids where name = 'arm'), (select id from ids where name = 'nok')], 'the weeks swapped');
-- One transaction has one now(): compare the set, not the order.
select is((select array_agg(action order by action) from public.audit_log where entity = 'oncall_swap'),
  array['oncall.swap_accept', 'oncall.swap_approve', 'oncall.swap_request'], 'every step is in the audit log');
select is((select array_agg(kind order by at, kind) from public.oncall_events where swap_id = (select id from sw)),
  array['swap_accepted', 'swap_approved', 'swap_requested'], 'and has its event for the messages');

-- A second request, declined by the person asked without a reason, another withdrawn.
delete from sw;
select tests.authenticate_as((select id from ids where name = 'nok'));
insert into sw select public.request_oncall_swap((select id from wk where n = 3), (select id from wk where n = 4));
reset role;
select tests.authenticate_as((select id from ids where name = 'ploy'));
select lives_ok($$ select public.respond_oncall_swap((select id from sw), false) $$, 'Ploy declines — the reason is optional (§27.4)');
reset role;
delete from sw;
select tests.authenticate_as((select id from ids where name = 'nok'));
insert into sw select public.request_oncall_swap((select id from wk where n = 3), (select id from wk where n = 4));
select lives_ok($$ select public.withdraw_oncall_swap((select id from sw)) $$, 'the requester withdraws while it is open');
reset role;
select is((select status from public.oncall_swaps where id = (select id from sw)), 'withdrawn', 'withdrawn');

-- ── Hand over the live shift ─────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_ok($$ select public.hand_over_oncall_shift((select id from wk where n = 1), (select id from ids where name = 'nok'), now(), 'Sick') $$,
  '42501', null, 'only an Admin hands a shift over');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.hand_over_oncall_shift((select id from wk where n = 1), (select id from ids where name = 'nok'), now(), ' ') $$,
  '22023', 'Add a short reason — both of them see it', 'a reason is required');
select lives_ok($$ select public.hand_over_oncall_shift((select id from wk where n = 1), (select id from ids where name = 'nok'), now() + interval '1 hour', 'Ploy is sick') $$,
  'the Admin hands the live shift to Nok from an hour from now');
reset role;
select is(public.oncall_person_at(now() + interval '2 hours'), (select id from ids where name = 'nok'), 'Nok has it from then');
select is(public.oncall_person_at(now() + interval '30 minutes'), (select id from ids where name = 'ploy'), 'Ploy until then');

-- ── Checklist and test link ──────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'ploy'));
select public.set_oncall_checklist(true, true);
select public.send_oncall_test();
reset role;
create temp table tok (t uuid) on commit drop;
grant select on tok to authenticated;
insert into tok select test_token from public.oncall_checklist where user_id = (select id from ids where name = 'ploy');
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_like($$ select public.confirm_oncall_test((select t from tok)) $$,
  'This test was for % — open it on %’s phone.', 'someone else opening the link ticks nothing (§27.8)');
reset role;
select tests.authenticate_as((select id from ids where name = 'ploy'));
select isnt(public.confirm_oncall_test((select t from tok)), null, 'Ploy opening it on her phone ticks it');
select throws_ok($$ select test_token from public.oncall_checklist $$, '42501', null, 'nobody reads the link''s token');
reset role;

-- ── The database keeps it sound (db review M1–M3) ───────────────────────
select throws_ok($$ insert into public.oncall_shifts (user_id, starts_at, ends_at)
                    values ((select id from ids where name = 'arm'), now() + interval '1 day', now() + interval '2 days') $$,
  '23P01', null, 'two people can''t be on call at once');
-- Weeks 2 and 3 were swapped above (Arm ↔ Nok): week 5 still follows the slot order — Nok, the 2nd slot.
set local role service_role;
select public.oncall_extend_shifts((select max(ends_at) from public.oncall_shifts) + interval '7 days');
reset role;
select is((select slot from public.oncall_shifts order by starts_at desc limit 1),
  ((select slot from public.oncall_shifts where slot is not null order by starts_at desc offset 1 limit 1) % 3 + 1)::smallint,
  'the next week takes the next slot, whatever a swap did to the people');
select ok((select min(starts_at) from public.oncall_shifts) >= public.oncall_week_start(now()), 'no week is made in the past');

-- ── Security review (M1–M3, L4–L7) ──────────────────────────────────────
-- M1: reasons only for the people involved and Admins.
select tests.authenticate_as((select id from ids where name = 'mint'));
select throws_ok($$ select reason from public.oncall_swaps $$, '42501', null, 'a Viewer can''t read a swap''s reason');
select throws_ok($$ select handover_reason from public.oncall_shifts $$, '42501', null, 'nor a hand-over''s reason');
select throws_ok($$ select payload from public.oncall_events $$, '42501', null, 'nor an event''s payload');
reset role;
create temp table sw1 (k text primary key, id uuid) on commit drop;
grant select on sw1 to authenticated;
insert into sw1 select 'swap', id from public.oncall_swaps where reason = 'Family trip';
insert into sw1 select 'shift', id from public.oncall_shifts where handover_reason = 'Ploy is sick';
select tests.authenticate_as((select id from ids where name = 'arm'));
select is((select reason from public.oncall_notes((select id from sw1 where k = 'swap'))), 'Family trip', 'the requester reads the reason');
reset role;
select tests.authenticate_as((select id from ids where name = 'ploy'));
select is((select count(*)::int from public.oncall_notes((select id from sw1 where k = 'swap'))), 0, 'someone else gets nothing');
select is((select handover_reason from public.oncall_notes(null, (select id from sw1 where k = 'shift'))),
  'Ploy is sick', 'the person who handed over reads the hand-over reason');
reset role;
-- M2: only people who can be on call act; L7: who is on call is for staff.
select tests.authenticate_as((select id from ids where name = 'bua'));
select throws_ok($$ select public.request_oncall_swap((select id from wk where n = 3), (select id from wk where n = 4)) $$,
  '42501', null, 'a stakeholder can''t ask for a swap');
select throws_ok($$ select public.send_oncall_test() $$, '42501', null, 'nor send a test alert');
reset role;
select tests.as_anon();
select throws_ok($$ select public.oncall_person_at(now()) $$, '42501', null, 'anon can''t ask who is on call');
reset role;
set local role service_role;
select isnt(public.oncall_person_at(now()), null, 'the service role finds the on-call person without JWT claims');
reset role;
-- L5: a signed-in session never extends the weeks.
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.oncall_extend_shifts(now() + interval '60 days') $$, '42501', null, 'only the service role extends the weeks');
reset role;
-- L4: a null answer is refused.
delete from sw;
select tests.authenticate_as((select id from ids where name = 'nok'));
insert into sw select public.request_oncall_swap((select id from wk where n = 3), (select id from wk where n = 4), 'Wedding');
reset role;
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_ok($$ select public.respond_oncall_swap((select id from sw), null) $$, '22023', 'Accept or decline', 'the person asked must accept or decline');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.decide_oncall_swap((select id from sw), null) $$, '22023', 'Approve or decline', 'the Admin must approve or decline');
-- M3: a hand-over closes the open swap on that week, logged and told.
select lives_ok($$ select public.hand_over_oncall_shift((select id from wk where n = 4), (select id from ids where name = 'arm'), now(), 'Ploy is away') $$,
  'the Admin hands week 4 to Arm');
reset role;
select is((select array[(select status from public.oncall_swaps where id = (select id from sw)),
                        (select count(*)::text from public.audit_log where action = 'oncall.swap_admin_decline' and entity_id = (select id from sw)),
                        (select count(*)::text from public.oncall_events where kind = 'swap_admin_declined' and swap_id = (select id from sw))]),
  array['admin_declined', '1', '1'], 'the open swap is declined, with its audit row and event');
-- L6: one test a minute; a confirmed link works once.
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_ok($$ select public.send_oncall_test() $$, '55000', null, 'a second test within a minute is refused');
reset role;
select tests.authenticate_as((select id from ids where name = 'ploy'));
select is(public.confirm_oncall_test((select t from tok)),
  (select test_received_at from public.oncall_checklist where user_id = auth.uid()), 'opening the link again shows the same receipt');
select throws_ok($$ select public.set_oncall_checklist(null, true) $$, '22023', 'Tick or untick each item', 'a null checklist item is refused');
reset role;
-- Week 4 was handed to Arm above ("Ploy is away").
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok($$ select public.request_oncall_swap((select id from wk where n = 4), (select id from wk where n = 3), repeat('x', 501)) $$,
  '22023', 'The reason is too long (500 characters at most)', 'a reason over 500 characters is refused with its own message');
-- An approved swap clears the hand-over of a week that changed hands: Nok never sees "Ploy is away".
reset role;
delete from sw;
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into sw select public.request_oncall_swap((select id from wk where n = 4), (select id from wk where n = 3));
reset role;
select tests.authenticate_as((select id from ids where name = 'nok'));
select public.respond_oncall_swap((select id from sw), true);
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select lives_ok($$ select public.decide_oncall_swap((select id from sw), true) $$, 'the Admin approves Arm ↔ Nok on weeks 4 and 3');
reset role;
select tests.authenticate_as((select id from ids where name = 'nok'));
select is((select handover_reason from public.oncall_notes(null, (select id from wk where n = 4))), null,
  'Nok, who now has week 4, doesn''t see the earlier hand-over reason');
reset role;
-- A request still open when its week starts expires on the next extend (the cron).
insert into public.oncall_swaps (requester_shift_id, counterpart_shift_id, requester_id, counterpart_id)
values ((select id from wk where n = 1), (select id from wk where n = 2), (select who from wk where n = 1),
        (select user_id from public.oncall_shifts where id = (select id from wk where n = 2)));
set local role service_role;
select public.oncall_extend_shifts(now());
reset role;
select is((select array[status, (select count(*)::text from public.oncall_events e where e.swap_id = w.id and e.kind = 'swap_expired')]
           from public.oncall_swaps w where w.requester_shift_id = (select id from wk where n = 1)),
  array['expired', '1'], 'an open request on a started week expires, with its event');

-- ── Nobody writes directly; staff read ───────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ update public.oncall_shifts set user_id = auth.uid() $$, '42501', null, 'not even an Admin edits shifts directly');
reset role;
select tests.authenticate_as((select id from ids where name = 'mint'));
select ok((select count(*) from public.oncall_shifts) > 0, 'a Viewer reads the rotation');
reset role;
select tests.as_anon();
select throws_ok('select * from public.oncall_shifts', '42501', null, 'anon reads nothing');
reset role;

select * from finish();
rollback;
