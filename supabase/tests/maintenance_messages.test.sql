-- Maintenance messages (S09b, spec §24, D-037): what each action queues and for whom (the actor
-- skipped, inactive people never), the request to every active Admin, reminders 12 h / 1 h, the
-- 10 s Undo, the engine's start / end / didn't start / not approved, the mute lines and the thread order.
begin;
\ir _helpers.psql
select plan(66);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
delete from public.maintenance_windows;
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('ann',  tests.create_user('ann@pgtap.test', 'admin')),
  ('zed',  tests.create_user('zed@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder'));
-- Only these people are active (the dev seed's profiles would join the Admins otherwise).
update public.profiles set is_active = false
  where id not in (select id from ids where name <> 'zed');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
-- A and D: Arm owns, Ploy backs up. B: Tao owns, no backup.
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Site D', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Site B', 2,
   (select id from ids where name = 'tao'), null);

create temp table win (name text primary key, id uuid) on commit drop;
grant select, insert on win to anon, authenticated, service_role;

-- Who a window's rows of one template go to, as "name:extra" sorted (extra = the dm or the role).
create function pg_temp.to_whom(p_window text, p_template text, p_key text default null)
returns text[]
language sql
as $$
  select coalesce(array_agg(coalesce(i.name, 'space') || ':' || coalesce(n.context ->> 'dm', n.context ->> 'role', n.context ->> 'kind')
                            order by coalesce(i.name, 'space'), n.created_at), '{}')
  from public.notifications n
  left join ids i on i.id = n.user_id
  where n.maintenance_window_id = (select id from win where name = p_window)
    and n.template = p_template and n.status <> 'cancelled'
    and (p_key is null or n.dedupe_key = p_key);
$$;

-- ── A Responder's request over 24 h (§24.1) ──────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('req', public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '2 days', now() + interval '2 days 30 hours', 'Move to a new hosting provider'));
reset role;
select is(pg_temp.to_whom('req', 'mw_line'), array['space:requested'], 'the request opens its Space thread');
select is(pg_temp.to_whom('req', 'mw_dm'), array['ann:requested', 'tao:requested'],
  'every active Admin is @mentioned with the request — not an inactive one (Done-when 1)');
select is(pg_temp.to_whom('req', 'mw_email'), array['ann:admin', 'ploy:backup', 'tao:admin'],
  'and emailed, with the backup; the asker gets no copy');
select is((select count(*)::int from public.notifications
           where maintenance_window_id = (select id from win where name = 'req') and hold_until is not null), 0,
  'a request posts at once (no Undo on create)');
select is((select array_agg(distinct thread_key) from public.notifications
           where maintenance_window_id = (select id from win where name = 'req')),
  array['mw-' || (select id from win where name = 'req')], 'one thread per window, Chat and email');
select is((select context ->> 'request' from public.notifications
           where maintenance_window_id = (select id from win where name = 'req') and template = 'mw_line'), 'true',
  'marked as a request thread');

-- ── Reminders (§24.2) ────────────────────────────────────────────────────
set local role service_role;
select is(public.engine_window_reminders(now() + interval '1 day'), 0, 'nothing a day before the start');
select is(public.engine_window_reminders(now() + interval '36 hours 1 minute'), 1, '12 h before: one reminder');
select is(public.engine_window_reminders(now() + interval '36 hours 2 minutes'), 0, 'once');
reset role;
select is(pg_temp.to_whom('req', 'mw_dm', 'reminder_12h'),
  array['ann:reminder_12h', 'arm:still_waiting', 'tao:reminder_12h'],
  'the Admins are reminded and the asker hears STILL WAITING');
select is(pg_temp.to_whom('req', 'mw_email', 'reminder_12h'), array['ann:admin', 'tao:admin'],
  'the 12 h reminder is emailed to the Admins only');
select is(pg_temp.to_whom('req', 'mw_line', 'reminder_12h'), '{}', 'reminders add no Space line');
set local role service_role;
select is(public.engine_window_reminders(now() + interval '47 hours 1 minute'), 1, '1 h before: the last reminder');
select is(public.engine_window_reminders(now() + interval '47 hours 2 minutes'), 0, 'once');
reset role;
select is(pg_temp.to_whom('req', 'mw_dm', 'reminder_1h'), array['ann:reminder_1h', 'tao:reminder_1h'],
  'the 1 h reminder goes to the Admins in Chat');
select is(pg_temp.to_whom('req', 'mw_email', 'reminder_1h'), '{}', 'and by Chat only');

-- A request made under 12 h before its start gets only the 1 h reminder; under 1 h, none.
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('late', public.create_maintenance('00000000-0000-0000-0000-0000000000d1',
  now() + interval '6 hours', now() + interval '36 hours', 'Late request'));
insert into win values ('later', public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '50 minutes', now() + interval '26 hours', 'Very late request'));
reset role;
set local role service_role;
select is(public.engine_window_reminders(now() + interval '1 minute'), 0,
  'no 12 h reminder for a request made 6 h ahead, none at all for one made 50 min ahead');
select is(public.engine_window_reminders(now() + interval '5 hours 1 minute'), 1, 'the late one gets the 1 h reminder');
reset role;
select is((select reminded_12h_at is null and reminded_1h_at is not null from public.maintenance_windows
           where id = (select id from win where name = 'late')), true, 'only the 1 h one');

-- ── Approve, held 10 s, and Undo (§24.3, §24.8) ──────────────────────────
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.approve_maintenance((select id from win where name = 'req'),
  (select ends_at from public.maintenance_windows where id = (select id from win where name = 'req')));
reset role;
select is(pg_temp.to_whom('req', 'mw_dm', (select undo_key from public.maintenance_windows where id = (select id from win where name = 'req'))),
  array['arm:approved'], 'the asker gets the answer');
select is(pg_temp.to_whom('req', 'mw_email', (select undo_key from public.maintenance_windows where id = (select id from win where name = 'req'))),
  array['arm:owner', 'ploy:backup'], 'the approval reaches the owner and the backup (Admins hear only what changes a request)');
select is((select bool_and(hold_until = now() + interval '10 seconds') from public.notifications n
           join public.maintenance_windows w on w.id = n.maintenance_window_id and n.dedupe_key = w.undo_key
           where w.id = (select id from win where name = 'req')), true, 'held 10 s for Undo');
select is((select (log -> -1 ->> 'posts_at')::timestamptz from public.maintenance_windows
           where id = (select id from win where name = 'req')), now() + interval '10 seconds',
  'the log line notes when it posts');

select tests.authenticate_as((select id from ids where name = 'ann'));
select throws_ok($$ select public.undo_window_action((select id from win where name = 'req')) $$,
  '42501', null, 'only the person who did it can undo it');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select lives_ok($$ select public.undo_window_action((select id from win where name = 'req')) $$, 'Tao undoes it');
reset role;
select is((select approved_at is null and undo_key is null from public.maintenance_windows
           where id = (select id from win where name = 'req')), true, 'the request waits again');
select is((select count(*)::int from public.notifications
           where maintenance_window_id = (select id from win where name = 'req') and status = 'cancelled' and error = 'Undone'),
  4, 'and the four held messages are cancelled');
select is((select log -> -1 ->> 'action' from public.maintenance_windows where id = (select id from win where name = 'req')),
  'undone', 'a log line says so (never rewritten)');
select is((select count(*)::int from public.audit_log
           where action = 'maintenance.undo' and entity_id = (select id from win where name = 'req')), 1,
  'and one audit row');

-- ── Decline: the asker gets the reason (§24.3) ───────────────────────────
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.decline_maintenance((select id from win where name = 'late'), 'Split it into two nights');
reset role;
select is((select context ->> 'reason' from public.notifications
           where maintenance_window_id = (select id from win where name = 'late') and template = 'mw_dm'
             and context ->> 'dm' = 'declined'), 'Split it into two nights', 'DECLINED carries the reason to the asker');

-- ── A scheduled window: owner and backup minus the actor (§24.5) ─────────
select tests.authenticate_as((select id from ids where name = 'ploy'));
insert into win values ('sched', public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '5 days', now() + interval '5 days 2 hours', 'WordPress plugin updates'));
reset role;
select is(pg_temp.to_whom('sched', 'mw_line'), array['space:scheduled'], 'MAINTENANCE SCHEDULED in its own thread');
select is(pg_temp.to_whom('sched', 'mw_email'), array['arm:owner'], 'the owner is emailed; Ploy scheduled it');
select is(pg_temp.to_whom('sched', 'mw_dm'), '{}', 'no mention lines');

-- ── Start, end early, a late Undo (§24.4, §24.8) ─────────────────────────
select tests.authenticate_as((select id from ids where name = 'tao'));
insert into win values ('now_b', public.create_maintenance('00000000-0000-0000-0000-0000000000b1',
  now(), now() + interval '2 hours', 'Server patch'));
reset role;
set local role service_role;
select public.engine_log_windows(now());
reset role;
select is(pg_temp.to_whom('now_b', 'mw_line'), array['space:scheduled', 'space:started'],
  'MAINTENANCE STARTED replies in the thread');
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.end_window_early((select id from win where name = 'now_b'), 'Patch done');
reset role;
update public.maintenance_windows set undo_until = now() - interval '1 second'
  where id = (select id from win where name = 'now_b');
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_like($$ select public.undo_window_action((select id from win where name = 'now_b')) $$,
  '%Too late to undo%', 'an Undo after its 10 s is refused');
reset role;

-- ── Mutes: Chat only; someone else's mute reaches owner and backup; an open incident's thread ──
insert into public.notifications (incident_id, channel, template, thread_key, status, sent_at)
select public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
         now() - interval '20 minutes', now() - interval '19 minutes', now(), '{}', false),
       'google_chat', 'down', 'x', 'sent', now();
select tests.authenticate_as((select id from ids where name = 'tao'));
insert into win values ('mute_a', public.mute_site('00000000-0000-0000-0000-0000000000a1',
  now() + interval '4 hours', 'Redeploying build'));
reset role;
select is(pg_temp.to_whom('mute_a', 'mw_line'), array['space:muted'], 'MUTED in its own thread');
select is((select array_agg(m ->> 'name' order by m ->> 'name') from public.notifications n,
             jsonb_array_elements(n.context -> 'mention') m
           where n.maintenance_window_id = (select id from win where name = 'mute_a') and n.template = 'mw_dm'
             and n.user_id is null),
  array['Arm', 'Ploy'], 'Tao muted someone else''s site: one reply @mentions the owner and the backup together');
select is(pg_temp.to_whom('mute_a', 'mw_email'), '{}', 'mutes are Chat only');
select is((select context ->> 'acked' from public.notifications
           where incident_id is not null and template = 'muted'), 'false',
  'the open incident''s thread gets the line too (keeps escalating)');

-- A mute that runs out with an incident it silenced names it (§24.7).
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('mute_d', public.mute_site('00000000-0000-0000-0000-0000000000d1',
  now() + interval '1 hour', 'Known flaky'));
reset role;
create temp table silent on commit drop as
select public.engine_open_incident('00000000-0000-0000-0000-0000000000d1', null, 'hard_fail', 'down',
  now() - interval '2 minutes', now() - interval '1 minute', now(), '{}', false) as id;
set local role service_role;
select public.engine_log_windows(now() + interval '61 minutes');
reset role;
select is((select (context ->> 'incident')::int from public.notifications
           where maintenance_window_id = (select id from win where name = 'mute_d') and context ->> 'kind' = 'mute_ended'),
  (select number::int from public.incidents where id = (select id from silent)), 'MUTE ENDED names the incident that posts now');
select is(pg_temp.to_whom('mute_d', 'mw_email'), '{}', 'still Chat only');

-- ── Didn't start / not approved (§24.2, §24.6) ───────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('busy', public.create_maintenance('00000000-0000-0000-0000-0000000000d1',
  now() + interval '3 hours', now() + interval '5 hours', 'Night work'));
reset role;
set local role service_role;
select public.engine_log_windows(now() + interval '3 hours 1 minute');
reset role;
select is((select context ->> 'incidentId' from public.notifications
           where maintenance_window_id = (select id from win where name = 'busy') and context ->> 'kind' = 'didnt_start'
             and template = 'mw_line'),
  (select id::text from silent),
  'DIDN''T START names the incident it couldn''t start over');
-- A request Arm asked for and an Admin approved: its didn't-start email reaches the approver too.
select tests.authenticate_as((select id from ids where name = 'tao'));
insert into win values ('busy2', public.create_maintenance('00000000-0000-0000-0000-0000000000d1',
  now() + interval '6 hours', now() + interval '7 hours', 'Second try'));
-- An Admin's own window, approved on create: they aren't "the approver" (message-check L2).
insert into win values ('busy3', public.create_maintenance('00000000-0000-0000-0000-0000000000d1',
  now() + interval '8 hours', now() + interval '9 hours', 'Third try'));
reset role;
update public.maintenance_windows set created_by = (select id from ids where name = 'arm')
  where id = (select id from win where name = 'busy2');
set local role service_role;
select public.engine_log_windows(now() + interval '6 hours 1 minute');
select public.engine_log_windows(now() + interval '8 hours 1 minute');
reset role;
select is(pg_temp.to_whom('busy2', 'mw_email', 'didnt_start'), array['arm:owner', 'ploy:backup', 'tao:approver'],
  'DIDN''T START emails the owner, the backup and whoever approved it');
select is(pg_temp.to_whom('busy3', 'mw_email', 'didnt_start'), array['arm:owner', 'ploy:backup'],
  'an Admin''s own window: no approver copy (they made it)');
set local role service_role;
select public.engine_log_windows(now() + interval '2 days 1 minute');
reset role;
select is(pg_temp.to_whom('req', 'mw_dm', 'not_approved'), array['arm:not_approved'], 'NOT APPROVED to the asker');

-- ── Undo can't do what the RPCs refuse (security review M1) ─────────────
-- Cancel a 20 h window, add another 20 h right after it, then undo the cancel: 40 h back to back.
select tests.authenticate_as((select id from ids where name = 'ploy'));
insert into win values ('w1', public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '10 days', now() + interval '10 days 20 hours', 'Part one'));
select public.cancel_window((select id from win where name = 'w1'), 'Rework');
select public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '10 days 20 hours 30 minutes', now() + interval '11 days 16 hours 30 minutes', 'Part two');
select throws_like($$ select public.undo_window_action((select id from win where name = 'w1')) $$,
  '%Over 24 h%', 'an Undo that would chain past 24 h is refused for a Responder');
reset role;

-- ── The engine waits out an approval's Undo (db review M1) ──────────────
update public.incidents set state = 'monitoring', recovered_at = now()
  where site_id = '00000000-0000-0000-0000-0000000000a1' and state in ('unacked', 'escalated', 'acknowledged');
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('soon', public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '3 seconds', now() + interval '30 hours', 'Starts in a moment'));
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.approve_maintenance((select id from win where name = 'soon'),
  (select ends_at from public.maintenance_windows where id = (select id from win where name = 'soon')));
reset role;
set local role service_role;
select public.engine_log_windows(now() + interval '5 seconds');
reset role;
select is((select start_logged from public.maintenance_windows where id = (select id from win where name = 'soon')), false,
  'inside the approval''s Undo the engine doesn''t start it');
set local role service_role;
select public.engine_log_windows(now() + interval '11 seconds');
reset role;
select is((select start_logged from public.maintenance_windows where id = (select id from win where name = 'soon')), true,
  'and starts it once the Undo is over');

-- ── A Draft gets no window or mute (code review: it stays deletable) ────
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'Draft F', 1,
   (select id from ids where name = 'tao'), false);
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_like($$ select public.mute_site('00000000-0000-0000-0000-0000000000f1', now() + interval '1 hour', 'x') $$,
  '%live sites%', 'a Draft can''t be muted');
select throws_like($$ select public.create_maintenance('00000000-0000-0000-0000-0000000000f1', now() + interval '1 day', now() + interval '1 day 2 hours', 'x') $$,
  '%live sites%', 'nor get maintenance');
reset role;

-- ── A DOWN incident whose drop is a PROBLEM now (D-023) posts once (engine review H1) ──
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'Site E', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy'));
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into win values ('mute_e', public.mute_site('00000000-0000-0000-0000-0000000000e1',
  now() + interval '1 hour', 'Known flaky'));
reset role;
create temp table mixed on commit drop as
select public.engine_open_incident('00000000-0000-0000-0000-0000000000e1', null, 'hard_fail', 'down',
  now() - interval '2 minutes', now() - interval '1 minute', now(), '{}', false) as id;
grant select on mixed to service_role;
update public.incidents set episode_severity = 'problem' where id = (select id from mixed);
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.end_window_early((select id from win where name = 'mute_e'), 'Done');
reset role;
set local role service_role;
select ok(public.engine_post_late_alert((select id from mixed), now() + interval '11 seconds'),
  'its first alert posts (the PROBLEM card of the drop in progress)');
select is((select count(*)::int from public.engine_silent_incidents(now() + interval '12 seconds')
           where incident_id = (select id from mixed)), 0, 'then it is no longer silent');
select lives_ok($$ select public.engine_post_late_alert((select id from mixed), now() + interval '12 seconds') $$,
  'a second run doesn''t trip the unique index');
select ok(not public.engine_post_late_alert((select id from mixed), now() + interval '13 seconds'), 'and posts nothing');
reset role;

-- ── A held action posts at once when its actor moves on (§24.12) ───────
select tests.authenticate_as((select id from ids where name = 'ploy'));
insert into win values ('now_post', public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '20 days', now() + interval '20 days 2 hours', 'Post now'));
select public.cancel_window((select id from win where name = 'now_post'), 'Moved');
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.post_window_action_now((select id from win where name = 'now_post')) $$,
  '42501', null, 'only the person who did it can post it now');
reset role;
select tests.authenticate_as((select id from ids where name = 'ploy'));
select lives_ok($$ select public.post_window_action_now((select id from win where name = 'now_post')) $$,
  'the actor posts it now');
reset role;
select is((select bool_and(hold_until = now()) from public.notifications
           where maintenance_window_id = (select id from win where name = 'now_post') and context ->> 'kind' = 'cancelled'),
  true, 'its messages are released at once');
select is((select undo_until = now() and (log -> -1 ->> 'posts_at')::timestamptz = now() from public.maintenance_windows
           where id = (select id from win where name = 'now_post')),
  true, 'no Undo any more, and the log line shows it posted now');
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_like($$ select public.undo_window_action((select id from win where name = 'now_post')) $$,
  '%Too late to undo%', 'Undo is refused after it was posted — too late, not "not you"');
select throws_ok($$ select public.post_window_action_now((select id from win where name = 'now_post')) $$,
  '22023', null, 'posting it a second time is refused (nothing held any more)');
reset role;

-- Past its 10 s, or already claimed by the notifier: nothing changes (db review L2).
select tests.authenticate_as((select id from ids where name = 'ploy'));
insert into win values ('late_post', public.create_maintenance('00000000-0000-0000-0000-0000000000a1',
  now() + interval '22 days', now() + interval '22 days 2 hours', 'Late post'));
select public.cancel_window((select id from win where name = 'late_post'), 'Moved');
reset role;
-- One of its rows already went out; the window's 10 s ran out.
update public.notifications set status = 'sent'
  where id = (select id from public.notifications
              where maintenance_window_id = (select id from win where name = 'late_post')
                and context ->> 'kind' = 'cancelled' and status = 'queued' limit 1);
create temp table late_before on commit drop as
  select id, status, hold_until from public.notifications
  where maintenance_window_id = (select id from win where name = 'late_post');
update public.maintenance_windows set undo_until = now() - interval '1 second'
  where id = (select id from win where name = 'late_post');
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_ok($$ select public.post_window_action_now((select id from win where name = 'late_post')) $$,
  '22023', null, 'past its 10 s it is refused, so the app doesn''t dispatch again (security review L1)');
reset role;
select results_eq(
  $$select id, status, hold_until from public.notifications
    where maintenance_window_id = (select id from win where name = 'late_post') order by id$$,
  $$select id, status, hold_until from late_before order by id$$,
  'and touches nothing — not the claimed row, not the held ones');

-- ── Grants ───────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated',
  'public.engine_queue_window_messages(uuid, text, uuid, timestamptz, text, jsonb)', 'execute'),
  'people can''t queue window messages themselves');
select ok(not has_function_privilege('authenticated', 'private.window_undo_begin(public.maintenance_windows, text)', 'execute'),
  'nor start an Undo');
select ok(has_function_privilege('authenticated', 'public.undo_window_action(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.undo_window_action(uuid)', 'execute'),
  'Undo is for signed-in people');

-- ── Thread order: a window's replies wait for its opening line ───────────
set local role service_role;
create temp table claimed on commit drop as select * from public.claim_notifications('google_chat', 200);
reset role;
select is((select array_agg(template) from claimed where maintenance_window_id = (select id from win where name = 'req')),
  array['mw_line'], 'one row per window thread at a time');

select * from finish();
rollback;
