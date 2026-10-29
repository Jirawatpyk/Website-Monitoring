-- Escalation L0–L1 and response hours (S08, D-034): the seeded policies and settings, staff read and
-- nobody writes, the Admin's save and every guardrail, the plan an incident keeps, engine_fire_step
-- (once, only while waiting for an ack, minus anyone already told, FYI Admins), engine_remind
-- (once per due time), D-021 restarting the ladder, and the PROBLEM held for response hours.
begin;
\ir _helpers.psql
select plan(66);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
-- Only this file's people are active Admins (the dev seed has its own).
update public.profiles set is_active = false where role = 'admin';
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('bua',  tests.create_user('bua@pgtap.test', 'stakeholder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));

insert into public.clients (id, name, am_user_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'Client A', (select id from ids where name = 'bua'));
-- A (Tier 1): Arm owns, Ploy backs up. B (Tier 2): Tao owns, Ploy backs up. P (Tier 2): Arm / Ploy.
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Site B', 2,
   (select id from ids where name = 'tao'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Site P', 2,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy'));

create temp table pol (name text primary key, id uuid) on commit drop;
grant select on pol to anon, authenticated;
insert into pol select 'down' || tier, id from public.escalation_policies where severity = 'down';
insert into pol select 'problem', id from public.escalation_policies where severity = 'problem';

-- ── Seeds ─────────────────────────────────────────────────────────────────
select is((select count(*)::int from public.escalation_policies), 4,
  'four policies: Tier 1 / 2 / 3 DOWN and PROBLEM · all tiers');
select results_eq(
  $$select level, delay_min, targets, channels from public.escalation_steps
    where policy_id = (select id from pol where name = 'down1') order by level$$,
  $$values (0::smallint, 0, array['owner'], array['chat', 'space', 'email']),
           (1::smallint, 15, array['backup', 'admins'], array['chat', 'email']),
           (2::smallint, 30, array['ceo'], array['chat', 'email', 'voice']),
           (3::smallint, 60, array['ceo', 'site_am'], array['chat', 'email'])$$,
  'Tier 1 DOWN: L0 owner · L1 +15 backup + Admin · L2 +30 CEO (voice configured) · L3 +60 CEO + AM (S10)');
select results_eq(
  $$select level, delay_min, targets from public.escalation_steps
    where policy_id = (select id from pol where name = 'problem') order by level$$,
  $$values (0::smallint, 0, array['owner']), (1::smallint, 60, array['backup'])$$,
  'PROBLEM: L0 owner · L1 +60 the backup alone (spec §8)');
select is(
  (select response_start::text || '-' || response_end::text || ' ' || response_days::text || ' '
          || down_reminder_min || '/' || problem_reminder_min from public.organisation_settings),
  '09:00:00-18:00:00 {1,2,3,4,5} 15/60',
  'response hours Mon–Fri 09:00–18:00; reminders 15 / 60 min');
select ok((select count(*) from public.company_holidays where day between '2026-10-01' and '2027-12-31') >= 15,
  'the Thai public holidays are seeded');
select is((select count(*)::int from public.audit_log where action = 'holiday.create'),
  (select count(*)::int from public.company_holidays), 'each holiday has an audit row');

-- ── Reading and writing ───────────────────────────────────────────────────
select tests.as_anon();
select throws_ok('select * from public.escalation_policies', '42501', null, 'anon can''t read policies');
reset role;
select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.escalation_steps), 12, 'a Viewer reads the steps');
select is((select count(*)::int from public.company_holidays) > 0, true, 'and the holidays');
select throws_ok('update public.escalation_steps set delay_min = 5', '42501', null,
  'nobody updates the steps directly');
select throws_ok($$insert into public.company_holidays (day, name) values ('2027-02-02', 'x')$$,
  '42501', null, 'nobody inserts holidays through the API');
reset role;

create function pg_temp.policies(p_l1_delay integer, p_l1_channels text[] default array['chat', 'email'],
                                 p_l1_targets text[] default array['backup', 'admins'])
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'policyId', (select id from pol where name = 'down2'),
    'steps', jsonb_build_array(
      jsonb_build_object('level', 0, 'delayMin', 0, 'targets', array['owner'], 'channels', array['chat', 'space', 'email']),
      jsonb_build_object('level', 1, 'delayMin', p_l1_delay, 'targets', p_l1_targets, 'channels', p_l1_channels),
      jsonb_build_object('level', 2, 'delayMin', 30, 'targets', array['admins'], 'channels', array['chat', 'email']))));
$$;
grant execute on function pg_temp.policies(integer, text[], text[]) to authenticated;

select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok($$select public.save_escalation_policies(pg_temp.policies(20), 15, 60, 'x')$$,
  '42501', null, 'a Responder can''t save escalation policies');
reset role;
select tests.authenticate_as((select id from ids where name = 'bua'));
select throws_ok($$select public.save_escalation_policies(pg_temp.policies(20), 15, 60, 'x')$$,
  '42501', null, 'a Stakeholder can''t');
reset role;

select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$select public.save_escalation_policies(pg_temp.policies(10), 15, 60, 'faster')$$,
  '22023', 'Must be at least +15 min.', 'a step under +15 min is refused (§14.7)');
select throws_ok($$select public.save_escalation_policies(pg_temp.policies(20, array[]::text[]), 15, 60, 'x')$$,
  '22023', 'No channel ticked — this step notifies nobody.', 'a step with no channel is refused (§15.5)');
select throws_ok($$select public.save_escalation_policies(pg_temp.policies(20, array['chat'], array[]::text[]), 15, 60, 'x')$$,
  '22023', 'Pick at least one person.', 'a step with nobody is refused');
select throws_ok($$select public.save_escalation_policies(pg_temp.policies(20, array['chat'], array['ceo']), 15, 60, 'x')$$,
  '22023', null, 'the CEO can''t be on L1 (S10: Tier 1 from L2 only)');
select throws_ok($$select public.save_escalation_policies(pg_temp.policies(20, array['chat', 'voice']), 15, 60, 'x')$$,
  '22023', null, 'voice is off until approved');
select throws_ok($$select public.save_escalation_policies(pg_temp.policies(20), 15, 60, '  ')$$,
  '22023', 'Add a short note — it goes in the audit log with the change', 'a note is required');
select throws_ok($$select public.save_escalation_policies(pg_temp.policies(20), 0, 60, 'x')$$,
  '22023', 'Whole minutes above 0, e.g. 15', 'a reminder interval must be above 0');
select throws_ok(
  format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, jsonb_build_array(jsonb_build_object(
    'policyId', (select id from pol where name = 'down1'),
    'steps', jsonb_build_array(jsonb_build_object('level', 0, 'delayMin', 0, 'targets', array['owner'], 'channels', array['email']))))),
  '22023', 'L0 is pinned on every policy', 'L0 keeps Chat @mention and the Alerts Space');
select throws_ok(
  format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, jsonb_build_array(jsonb_build_object(
    'policyId', (select id from pol where name = 'down2'),
    'steps', jsonb_build_array(jsonb_build_object('level', 0, 'delayMin', 0, 'targets', array['owner'], 'channels', array['chat', 'space', 'email']))))),
  '22023', 'Tier 2 DOWN needs at least one step after L0 — otherwise nobody else is ever told.',
  'a DOWN policy needs a step after L0');
select lives_ok(
  format($$select public.save_escalation_policies(%L, 15, 60, 'backup only')$$, jsonb_build_array(jsonb_build_object(
    'policyId', (select id from pol where name = 'problem'),
    'steps', jsonb_build_array(jsonb_build_object('level', 0, 'delayMin', 0, 'targets', array['owner'], 'channels', array['chat', 'space', 'email']))))),
  'PROBLEM may have no step after L0 (a warning only)');
select lives_ok($$select public.save_escalation_policies(pg_temp.policies(20), 15, 45, 'L1 a bit later')$$,
  'the Admin saves L1 at +20 and the PROBLEM reminder at 45');
reset role;

select is((select delay_min from public.escalation_steps where policy_id = (select id from pol where name = 'down2') and level = 1),
  20, 'L1 now waits 20 min');
select is((select problem_reminder_min from public.organisation_settings), 45, 'the reminder interval is saved');
select is(
  (select after->>'note' from public.audit_log where action = 'escalation.update' and after->>'note' = 'L1 a bit later'
   and (after->>'problemReminderMin')::int = 45),
  'L1 a bit later', 'one audit row carries the note');
select is((select count(*)::int from public.audit_log where action = 'escalation.update'
                                  and after->>'note' in ('backup only', 'L1 a bit later')), 2,
  'one audit row per save');

-- Back to the seeded ladder for the engine cases.
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.save_escalation_policies(pg_temp.policies(15), 15, 60, 'back');
select public.save_escalation_policies(jsonb_build_array(jsonb_build_object(
  'policyId', (select id from pol where name = 'problem'),
  'steps', jsonb_build_array(
    jsonb_build_object('level', 0, 'delayMin', 0, 'targets', array['owner'], 'channels', array['chat', 'space', 'email']),
    jsonb_build_object('level', 1, 'delayMin', 60, 'targets', array['backup'], 'channels', array['chat', 'email'])))),
  15, 60, 'back');
reset role;

-- ── The plan an incident keeps ────────────────────────────────────────────
create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated;
insert into inc values
  ('a', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
     now() - interval '16 minutes', now() - interval '15 minutes', now(), '{}', true)),
  ('b', public.engine_open_incident('00000000-0000-0000-0000-0000000000b1', null, 'hard_fail', 'down',
     now() - interval '16 minutes', now() - interval '15 minutes', now(), '{}', true));

select is(
  (select escalation_plan->>'severity' || ' T' || (escalation_plan->>'tier') || ' every '
          || (escalation_plan->>'reminderMin') || ' · L1 +' || (escalation_plan #>> '{steps,1,delayMin}')
   from public.incidents where id = (select id from inc where name = 'a')),
  'down T1 every 15 · L1 +15', 'a DOWN keeps the Tier 1 DOWN policy and the reminder interval');

-- ── engine_fire_step ──────────────────────────────────────────────────────
select ok(public.engine_fire_step((select id from inc where name = 'a'), 1::smallint, now(), '{"elapsedMin":15}'),
  'L1 fires');
select ok(not public.engine_fire_step((select id from inc where name = 'a'), 1::smallint, now(), '{}'),
  'a second call does nothing (overlapping engine runs)');
select is((select state::text || ' L' || escalation_level from public.incidents where id = (select id from inc where name = 'a')),
  'escalated L1', 'the incident is Escalated · L1');
select results_eq(
  $$select channel::text, user_id, (context->>'asFyi')::boolean from public.notifications
    where incident_id = (select id from inc where name = 'a') and template = 'step_fired' order by channel, (context->>'asFyi')$$,
  $$values ('email', (select id from ids where name = 'ploy'), false),
           ('email', (select id from ids where name = 'tao'), true),
           ('google_chat', null::uuid, null::boolean)$$,
  'L1: one Chat reply, an email to the backup and an FYI email to the Admin');
select is(
  (select payload->'mentioned' = to_jsonb(array[(select id from ids where name = 'ploy')])
          and payload->'fyi' = to_jsonb(array[(select id from ids where name = 'tao')])
   from public.incident_events where incident_id = (select id from inc where name = 'a') and type = 'step_fired'),
  true, 'the backup is @mentioned, the Admin is FYI ("Tao FYI")');
select is((select count(*)::int from public.audit_log where action = 'incident.escalated'
           and entity_id = (select id from inc where name = 'a')), 1, 'the escalation is audited');

-- Site B: the Admin owns it, so L0 told him already — L1 is the backup alone, @mentioned.
select ok(public.engine_fire_step((select id from inc where name = 'b'), 1::smallint, now(), '{}'),
  'L1 fires on Site B');
select is(
  (select array_agg(user_id order by user_id) from public.notifications
   where incident_id = (select id from inc where name = 'b') and template = 'step_fired' and channel = 'email'),
  array[(select id from ids where name = 'ploy')], 'minus anyone already paged: the Admin who owns it isn''t told again');

-- After an ack, nothing more fires or reminds.
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.ack_incident((select id from inc where name = 'b'));
reset role;
select ok(not public.engine_remind((select id from inc where name = 'b'), now(), '{}'),
  'no reminder once acknowledged');

-- ── engine_remind ─────────────────────────────────────────────────────────
select ok(public.engine_remind((select id from inc where name = 'a'), date_trunc('minute', now()), '{"elapsedMin":30}'),
  'a reminder is queued');
select ok(not public.engine_remind((select id from inc where name = 'a'), date_trunc('minute', now()), '{}'),
  'once per due time');
select is(
  (select context->'mentioned' @> to_jsonb(array[(select id from ids where name = 'arm'), (select id from ids where name = 'ploy')])
          and not (context->'mentioned' @> to_jsonb(array[(select id from ids where name = 'tao')]))
   from public.notifications where incident_id = (select id from inc where name = 'a') and template = 'reminder'),
  true, 'the reminder @mentions the owner and the backup, not the FYI Admin');

-- ── D-021: a PROBLEM raised to DOWN starts the DOWN ladder ─────────────────
insert into inc values ('p', public.engine_open_incident('00000000-0000-0000-0000-0000000000d1', null, 'slow', 'problem',
  now() - interval '2 hours', now() - interval '61 minutes', now(), '{}', true));
select public.engine_fire_step((select id from inc where name = 'p'), 1::smallint, now(), '{}');
select public.engine_escalate_incident((select id from inc where name = 'p'), now(), now(), '{}', true);
select is(
  (select state::text || ' L' || escalation_level || ' ' || (escalation_plan->>'severity')
   from public.incidents where id = (select id from inc where name = 'p')),
  'unacked L0 down', 'unacked, it goes back to L0 on the DOWN policy');
select ok(public.engine_fire_step((select id from inc where name = 'p'), 1::smallint, now(), '{}'),
  'the DOWN L1 fires in its turn');
select is(
  (select array_agg(user_id order by user_id) from public.notifications
   where incident_id = (select id from inc where name = 'p') and template = 'step_fired' and channel = 'email'
     and context->>'severity' = 'down'),
  (select array_agg(id order by id) from ids where name in ('ploy', 'tao')),
  'the DOWN L1 tells the backup again (a new ladder) and the Admin');

-- ── PROBLEM held for response hours ──────────────────────────────────────
-- Site P's DOWN is set aside; a fresh PROBLEM opens outside response hours.
update public.incidents set state = 'resolved' where id in (select id from inc);
delete from inc;
insert into inc values ('h', public.engine_open_incident('00000000-0000-0000-0000-0000000000d1', null, 'slow', 'problem',
  now() - interval '5 minutes', now(), now(), '{}', true, null, null, now() + interval '9 hours'));

select is(
  (select count(*)::int from public.notifications
   where incident_id = (select id from inc where name = 'h') and template = 'problem' and hold_until = now() + interval '9 hours'),
  2, 'the PROBLEM card and the owner email are held until the next opening');
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.add_incident_note((select id from inc where name = 'h'), 'looking');
reset role;
select is(
  (select count(*)::int from public.claim_notifications('google_chat', 20, (select id from inc where name = 'h'))),
  1, 'a held card doesn''t block its thread (the note goes)');

select tests.authenticate_as((select id from ids where name = 'arm'));
select public.ack_incident((select id from inc where name = 'h'));
reset role;
select is(
  (select string_agg(template || ':' || status, ',' order by template, channel) from public.notifications
   where incident_id = (select id from inc where name = 'h') and template in ('problem', 'acknowledged')),
  'problem:cancelled,problem:cancelled', 'an ack while it is held cancels it and sends no ACKNOWLEDGED');
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.undo_ack((select id from inc where name = 'h'));
reset role;
select is(
  (select count(*)::int from public.notifications
   where incident_id = (select id from inc where name = 'h') and template = 'problem' and status = 'queued'),
  2, 'Undo puts the held card back');

select public.engine_recover_incident((select id from inc where name = 'h'), 'unacked', 'resolved',
  now(), now(), '{}', true, null, null, true, true);
select is(
  (select string_agg(template || ':' || status, ',' order by template, channel) from public.notifications
   where incident_id = (select id from inc where name = 'h') and template in ('problem', 'recovered')),
  'problem:cancelled,problem:cancelled', 'cleared before 09:00: nothing is posted, not even RECOVERED (§19.6)');

-- PROBLEM AGAIN outside response hours waits too (engine review H2).
insert into inc values ('r', public.engine_open_incident('00000000-0000-0000-0000-0000000000d1', null, 'slow', 'problem',
  now() - interval '30 minutes', now() - interval '20 minutes', now(), '{}', true));
select public.engine_recover_incident((select id from inc where name = 'r'), 'unacked', 'monitoring',
  now(), now(), '{}', true);
select public.engine_relapse_incident((select id from inc where name = 'r'), 'problem', 'slow', now(), now(), now(),
  '{}', false, true, null, null, now() + interval '9 hours');
select is(
  (select hold_until from public.notifications where incident_id = (select id from inc where name = 'r') and template = 'problem_again'),
  now() + interval '9 hours', 'PROBLEM AGAIN at night is held until the next opening');
update public.incidents set state = 'resolved' where id = (select id from inc where name = 'r');

-- RECOVERED still follows a DOWN that was tried and is waiting for a retry (engine review H1).
insert into inc values ('w', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
  now() - interval '5 minutes', now() - interval '4 minutes', now(), '{}', true));
update public.notifications set attempts = 1, next_retry_at = now() + interval '2 minutes'
  where incident_id = (select id from inc where name = 'w') and channel = 'google_chat';
insert into public.notification_attempts (notification_id, attempt, ok, error)
  select id, 1, false, 'Chat 503' from public.notifications
  where incident_id = (select id from inc where name = 'w') and channel = 'google_chat';
update public.notifications set status = 'sent', attempts = 1
  where incident_id = (select id from inc where name = 'w') and channel = 'email';
select public.engine_recover_incident((select id from inc where name = 'w'), 'unacked', 'monitoring',
  now(), now(), '{}', true);
select is(
  (select string_agg(channel::text, ',' order by channel::text) from public.notifications
   where incident_id = (select id from inc where name = 'w') and template = 'recovered'),
  'email,google_chat', 'a DOWN set aside for a retry still gets RECOVERED in Chat and by email');
update public.incidents set state = 'resolved' where id = (select id from inc where name = 'w');

-- An ack stops the chain: a reminder still waiting is set aside, and Undo brings it back.
insert into inc values ('k', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
  now() - interval '31 minutes', now() - interval '30 minutes', now(), '{}', true));
select public.engine_remind((select id from inc where name = 'k'), date_trunc('minute', now()), '{}');
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.ack_incident((select id from inc where name = 'k'));
reset role;
select is(
  (select status::text from public.notifications where incident_id = (select id from inc where name = 'k') and template = 'reminder'),
  'cancelled', 'the ack cancels a reminder that hasn''t gone');
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.undo_ack((select id from inc where name = 'k'));
reset role;
select is(
  (select status::text from public.notifications where incident_id = (select id from inc where name = 'k') and template = 'reminder'),
  'queued', 'Undo puts it back');
update public.incidents set state = 'resolved' where id = (select id from inc where name = 'k');

-- Muted when it opened: no first alert, so no ladder (spec §15.1).
insert into inc values ('m', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
  now() - interval '31 minutes', now() - interval '30 minutes', now(), '{}', false));
select ok(not public.engine_fire_step((select id from inc where name = 'm'), 1::smallint, now(), '{}'),
  'no L1 for an incident whose first alert never went');
select ok(not public.engine_remind((select id from inc where name = 'm'), now(), '{}'), 'and no reminder');

-- A recovery sets a waiting reminder aside too; a failed reminder never falls back to email.
insert into inc values ('v', public.engine_open_incident('00000000-0000-0000-0000-0000000000b1', null, 'hard_fail', 'down',
  now() - interval '31 minutes', now() - interval '30 minutes', now(), '{}', true));
select public.engine_remind((select id from inc where name = 'v'), date_trunc('minute', now()), '{}');
select is(
  public.queue_fallback_emails((select id from public.notifications
    where incident_id = (select id from inc where name = 'v') and template = 'reminder')),
  0, 'a reminder is Chat only: no fallback email');
select public.engine_recover_incident((select id from inc where name = 'v'), 'unacked', 'monitoring',
  now(), now(), '{}', true);
select is(
  (select status::text from public.notifications where incident_id = (select id from inc where name = 'v') and template = 'reminder'),
  'cancelled', 'a recovery cancels a reminder that hasn''t gone');
update public.incidents set state = 'resolved' where id = (select id from inc where name = 'v');

-- A held PROBLEM card: no ladder until its hour.
insert into inc values ('q', public.engine_open_incident('00000000-0000-0000-0000-0000000000d1', null, 'slow', 'problem',
  now() - interval '3 hours', now() - interval '2 hours', now(), '{}', true, null, null, now() + interval '1 hour'));
select ok(not public.engine_fire_step((select id from inc where name = 'q'), 1::smallint, now(), '{}'),
  'no L1 while the PROBLEM card waits for response hours');
update public.notifications set hold_until = now() - interval '1 minute'
  where incident_id = (select id from inc where name = 'q') and template = 'problem';
select ok(public.engine_fire_step((select id from inc where name = 'q'), 1::smallint, now(), '{}'),
  'L1 once the card''s hour has come');
-- D-021 sets the PROBLEM ladder aside.
select public.engine_escalate_incident((select id from inc where name = 'q'), now(), now(), '{}', true);
select is(
  (select count(*)::int from public.notifications
   where incident_id = (select id from inc where name = 'q') and template = 'step_fired' and status = 'queued'),
  0, 'a PROBLEM raised to DOWN drops its L1 messages still waiting');
update public.incidents set state = 'resolved' where id = (select id from inc where name = 'q');

-- S08 limits on the save.
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok(
  format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, jsonb_build_array(jsonb_build_object(
    'policyId', (select id from pol where name = 'down1'),
    'steps', jsonb_build_array(
      jsonb_build_object('level', 0, 'delayMin', 0, 'targets', array['owner', 'backup'], 'channels', array['chat', 'space', 'email']),
      jsonb_build_object('level', 1, 'delayMin', 15, 'targets', array['admins'], 'channels', array['chat']))))),
  '22023', 'L0 is pinned on every policy', 'L0 names the owner only (what the first alert really reaches)');
select throws_ok(
  format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, jsonb_build_array(jsonb_build_object(
    'policyId', (select id from pol where name = 'down1'),
    'steps', jsonb_build_array(
      jsonb_build_object('level', 0, 'delayMin', 0, 'targets', array['owner'], 'channels', array['chat', 'space', 'email']),
      jsonb_build_object('level', 1, 'delayMin', 15, 'targets', array['backup'], 'channels', array['chat']),
      jsonb_build_object('level', 2, 'delayMin', 30, 'targets', array['admins'], 'channels', array['chat']),
      jsonb_build_object('level', 3, 'delayMin', 45, 'targets', array['admins'], 'channels', array['chat']),
      jsonb_build_object('level', 4, 'delayMin', 60, 'targets', array['admins'], 'channels', array['chat']))))),
  '22023', 'At most four steps, L0–L3', 'a fifth step is refused (S10: L0–L3)');
select throws_ok(
  format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, jsonb_build_array(jsonb_build_object(
    'policyId', (select id from pol where name = 'down1'),
    'steps', jsonb_build_array(jsonb_build_object('level', 0, 'targets', array['owner'], 'channels', array['chat']))))),
  '22023', 'A step is missing its delay, people or channels', 'a step without a delay is refused cleanly');
reset role;

-- The engine's functions are the service role's only.
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok(format('select public.engine_fire_step(%L, 1::smallint, now())', (select id from inc where name = 'm')),
  '42501', null, 'a signed-in Admin can''t fire a step');
select throws_ok(format('select public.engine_remind(%L, now())', (select id from inc where name = 'm')),
  '42501', null, 'or queue a reminder');
reset role;
select tests.as_anon();
select throws_ok(format('select public.engine_fire_step(%L, 1::smallint, now())', (select id from inc where name = 'm')),
  '42501', null, 'nor can anon');
reset role;

select * from finish();
rollback;
