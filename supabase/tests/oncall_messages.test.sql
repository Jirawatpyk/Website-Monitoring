-- On-call messages (S10 B2a, D-048 items 6, 10): every on-call event queues one Chat line in its
-- subject's thread, @mentioning everyone it tells, plus an email each (not for a rotation change or a
-- test alert); only active Admins and Responders; never a reason or the test token in `context`; the
-- day-before reminder once per shift and person.
begin;
\ir _helpers.psql
select plan(32);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
delete from public.oncall_events; delete from public.oncall_swaps; delete from public.oncall_shifts;
delete from public.oncall_rotation;
update public.profiles set is_active = false where role = 'admin';
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('nok',  tests.create_user('nok@pgtap.test', 'responder'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
-- The messages of the latest event of a kind (one transaction: same `at`, so by insert order): the Chat line's people, and who is emailed.
create function pg_temp.chat_people(p_kind text) returns text language sql as $$
  select string_agg((select i.name from ids i where i.id = (x ->> 'id')::uuid) || ':' || (x ->> 'role'), ' '
                    order by (select i.name from ids i where i.id = (x ->> 'id')::uuid))
  from public.notifications n, jsonb_array_elements(n.context -> 'people') x
  where n.channel = 'google_chat' and n.oncall_event_id =
    (select id from public.oncall_events where kind = p_kind order by at desc, ctid desc limit 1)
$$;
create function pg_temp.emailed(p_kind text) returns text language sql as $$
  select coalesce(string_agg((select i.name from ids i where i.id = n.user_id), ' ' order by
                  (select i.name from ids i where i.id = n.user_id)), '')
  from public.notifications n
  where n.channel = 'email' and n.oncall_event_id =
    (select id from public.oncall_events where kind = p_kind order by at desc, ctid desc limit 1)
$$;

-- ── Rotation ─────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select public.save_oncall_rotation(array[pg_temp.uid('ploy'), pg_temp.uid('nok'), pg_temp.uid('arm')]);
reset role;
select is(pg_temp.chat_people('rotation_changed'), 'arm:rotation nok:rotation ploy:rotation',
  'a rotation change @mentions everyone in it');
select is(pg_temp.emailed('rotation_changed'), '', 'Chat only');
select is((select thread_key from public.notifications n join public.oncall_events e on e.id = n.oncall_event_id
           where e.kind = 'rotation_changed' limit 1) like 'oncall-rotation-%', true, 'in its own thread');

create temp table wk (n int primary key, id uuid, who uuid) on commit drop;
grant select on wk to authenticated, service_role;
insert into wk select row_number() over (order by starts_at), id, user_id from public.oncall_shifts;

-- ── A swap: request → accept → approve ──────────────────────────────────
-- Arm (week 3) asks Nok (week 2), with a reason only the people involved may read.
create temp table sw (id uuid) on commit drop;
grant select, insert on sw to authenticated, service_role;
select tests.authenticate_as(pg_temp.uid('arm'));
insert into sw select public.request_oncall_swap((select id from wk where n = 3), (select id from wk where n = 2), 'Family trip');
reset role;
select is(pg_temp.chat_people('swap_requested'), 'nok:asked', 'the request @mentions the person asked');
select is(pg_temp.emailed('swap_requested'), 'nok', 'and emails them');
select is((select count(*)::int from public.notifications n join public.oncall_events e on e.id = n.oncall_event_id
           where e.swap_id = (select id from sw) and n.thread_key = 'oncall-swap-' || (select id from sw)), 2,
  'in the swap''s own thread');
select is((select count(*)::int from public.notifications where oncall_event_id is not null
           and context::text like '%Family trip%'), 0, 'no message carries the reason (staff read notifications)');

select tests.authenticate_as(pg_temp.uid('nok'));
select public.respond_oncall_swap((select id from sw), true);
reset role;
select is(pg_temp.chat_people('swap_accepted'), 'arm:requester tao:admin', 'accepted: the requester, and the Admin who approves next');
select is(pg_temp.emailed('swap_accepted'), 'arm tao', 'both emailed');

select tests.authenticate_as(pg_temp.uid('tao'));
select public.decide_oncall_swap((select id from sw), true);
reset role;
select is(pg_temp.chat_people('swap_approved'), 'arm:requester nok:asked', 'approved: both people');
select is(pg_temp.emailed('swap_approved'), 'arm nok', 'both emailed');

-- Declined by the person asked, with a reason: only the requester; withdrawn: only the person asked.
truncate sw;
select tests.authenticate_as(pg_temp.uid('ploy'));
insert into sw select public.request_oncall_swap((select id from wk where n = 4), (select id from wk where n = 5));
reset role;
select tests.authenticate_as((select who from wk where n = 5));
select public.respond_oncall_swap((select id from sw), false, 'Away that week');
reset role;
select is(pg_temp.emailed('swap_declined'), 'ploy', 'declined: the requester');
select is((select count(*)::int from public.notifications where oncall_event_id is not null
           and context::text like '%Away that week%'), 0, 'the answer note isn''t in any message either');

truncate sw;
select tests.authenticate_as(pg_temp.uid('ploy'));
insert into sw select public.request_oncall_swap((select id from wk where n = 4), (select id from wk where n = 5));
select public.withdraw_oncall_swap((select id from sw));
reset role;
select is(pg_temp.chat_people('swap_withdrawn'), (select i.name from ids i where i.id = (select who from wk where n = 5)) || ':asked',
  'withdrawn: the person asked');

-- ── Hand over ───────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select public.hand_over_oncall_shift((select id from wk where n = 1), pg_temp.uid('nok'), now() + interval '1 hour', 'Ploy is ill tonight');
reset role;
select is(pg_temp.chat_people('handed_over'), 'nok:new ploy:previous', 'a hand-over: the new person and the one who had it');
select is(pg_temp.emailed('handed_over'), 'nok ploy', 'both emailed');

-- ── Test alert ──────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('arm'));
select public.send_oncall_test();
reset role;
select is(pg_temp.chat_people('test_alert'), 'arm:self', 'a test alert mentions only the tester (spec §10)');
select is(pg_temp.emailed('test_alert'), '', 'Chat only');
select is((select n.thread_key from public.notifications n join public.oncall_events e on e.id = n.oncall_event_id
           where e.kind = 'test_alert' limit 1), 'oncall-test-' || pg_temp.uid('arm'), 'in the tester''s own "TEST — no action" thread');
select is((select count(*)::int from public.notifications n join public.oncall_checklist c on c.user_id = pg_temp.uid('arm')
           where n.oncall_event_id is not null and n.context::text like '%' || c.test_token || '%'), 0,
  'the test token isn''t in the message');

-- ── The day-before reminder ─────────────────────────────────────────────
select is(public.engine_oncall_reminders((select starts_at - interval '12 hours' from public.oncall_shifts where id = (select id from wk where n = 2))), 1,
  'a shift starting within a day reminds its person');
select is(public.engine_oncall_reminders((select starts_at - interval '11 hours' from public.oncall_shifts where id = (select id from wk where n = 2))), 0,
  'once only');
-- The shift changes hands after the reminder: the new person is reminded too.
update public.oncall_shifts set user_id = pg_temp.uid('ploy') where id = (select id from wk where n = 2);
select is(public.engine_oncall_reminders((select starts_at - interval '10 hours' from public.oncall_shifts where id = (select id from wk where n = 2))), 1,
  'a shift that changed hands reminds the new person');
-- An inactive person gets no reminder and no message.
update public.profiles set is_active = false
  where id = (select user_id from public.oncall_shifts where id = (select id from wk where n = 3));
select is(public.engine_oncall_reminders((select starts_at - interval '12 hours' from public.oncall_shifts where id = (select id from wk where n = 3))), 0,
  'an inactive person isn''t reminded');

-- ── Someone leaves the rotation: they're told too ──────────────────────
update public.profiles set is_active = true where id in (select id from ids);
select tests.authenticate_as(pg_temp.uid('tao'));
select public.save_oncall_rotation(array[pg_temp.uid('ploy'), pg_temp.uid('nok')]);
reset role;
select is(pg_temp.chat_people('rotation_changed'), 'arm:removed nok:rotation ploy:rotation',
  'a rotation change tells whoever was taken out');

-- ── An expired request tells both people ────────────────────────────────
truncate sw;
select tests.authenticate_as(pg_temp.uid('ploy'));
insert into sw select public.request_oncall_swap(
  (select id from public.oncall_shifts where user_id = pg_temp.uid('ploy') and starts_at > now() order by starts_at limit 1),
  (select id from public.oncall_shifts where user_id = pg_temp.uid('nok') and starts_at > now() order by starts_at limit 1));
reset role;
update public.oncall_shifts set starts_at = starts_at - interval '400 days', ends_at = ends_at - interval '400 days'
  where id = (select requester_shift_id from public.oncall_swaps where id = (select id from sw));
select public.oncall_extend_shifts(now() + interval '28 days');
select is(pg_temp.chat_people('swap_expired'), 'nok:asked ploy:requester', 'an expired request tells both people');

-- ── At most 5 swap requests in 10 minutes (security review B2a) ────────
update public.oncall_swaps set status = 'withdrawn' where status in ('waiting', 'accepted');
insert into public.oncall_swaps (requester_shift_id, counterpart_shift_id, requester_id, counterpart_id, status)
select a.id, b.id, a.user_id, b.user_id, 'withdrawn' from generate_series(1, 5) g,
  lateral (select * from public.oncall_shifts where user_id = pg_temp.uid('ploy') and starts_at > now() order by starts_at desc limit 1) a,
  lateral (select * from public.oncall_shifts where user_id = pg_temp.uid('nok') and starts_at > now() order by starts_at desc limit 1) b;
select tests.authenticate_as(pg_temp.uid('ploy'));
select throws_ok($$ select public.request_oncall_swap(
  (select id from public.oncall_shifts where user_id = pg_temp.uid('ploy') and starts_at > now() order by starts_at desc limit 1),
  (select id from public.oncall_shifts where user_id = pg_temp.uid('nok') and starts_at > now() order by starts_at desc limit 1)) $$,
  '55000', 'Too many swap requests — wait a few minutes', 'a sixth request inside 10 minutes is refused');
reset role;

-- ── Claiming: on-call rows only for a notifier that renders them; outages first ──
select is((select count(*)::int from public.claim_notifications('google_chat', 100) c where c.oncall_event_id is not null), 0,
  'the old dispatch (no p_oncall) never claims on-call rows');
update public.notifications set attempts = 0, next_retry_at = null where oncall_event_id is not null;
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1, pg_temp.uid('arm'));
select public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
  now(), now(), now(), '{}', true);
select is((select incident_id is not null from public.claim_notifications('google_chat', 1, null, true)), true,
  'a DOWN queued after on-call rows is claimed first');

-- ── Reminder edges, and no grant to a signed-in session ─────────────────
select is(public.engine_oncall_reminders(now() - interval '30 days'), 0, 'nothing for shifts more than a day away');
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok($$ select public.engine_oncall_reminders(now()) $$, '42501', null,
  'a signed-in session can''t run the reminders');
reset role;
select ok(not has_function_privilege('authenticated', 'private.queue_oncall_messages(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'private.oncall_recipients(uuid)', 'execute'),
  'nor queue messages or read recipients');

select * from finish();
rollback;
