-- Monitor fault by hand (S12b, spec §30, D-053 item 5, D-055): the hand check and the manual incident
-- only during the sweep fault, on live Tier 1 sites, by whoever may acknowledge; the manual incident
-- queues L0 (Chat now, email after D-047's grace) and never moves last_round_at; Escalate now and the
-- client-update reminder only while no engine run happened for 3 min, written so the engine's own
-- steps never repeat them (Done-when 2).
begin;
\ir _helpers.psql
select plan(50);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
update public.profiles set is_active = false where role in ('admin', 'stakeholder');
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('nok',  tests.create_user('nok@pgtap.test', 'responder')),
  ('thee', tests.create_user('thee@pgtap.test', 'stakeholder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
grant execute on function pg_temp.uid(text) to anon, authenticated, service_role;

insert into public.clients (id, name, am_user_id, is_internal) values
  ('00000000-0000-0000-0000-0000000000c1', 'realme', pg_temp.uid('thee'), false);
-- Arm owns every site, Ploy is the backup.
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id)
select v.id, '00000000-0000-0000-0000-0000000000c1', v.name, v.tier, pg_temp.uid('arm'), pg_temp.uid('ploy')
from (values ('00000000-0000-0000-0000-0000000000a1'::uuid, 'realme.link', 1::smallint),
             ('00000000-0000-0000-0000-0000000000a2'::uuid, 'MuvMi', 1::smallint),
             ('00000000-0000-0000-0000-0000000000a3'::uuid, 'Tier two', 2::smallint),
             ('00000000-0000-0000-0000-0000000000a4'::uuid, 'Muted', 1::smallint)) v (id, name, tier);
insert into public.monitors (site_id, type, url, is_primary)
values ('00000000-0000-0000-0000-0000000000a1', 'http', 'https://realme.example.test/', true),
       ('00000000-0000-0000-0000-0000000000a4', 'http', 'https://muted.example.test/', true);
-- The engine judged its last round at 02:17 (Bangkok).
insert into public.site_status (site_id, status, since, last_evaluated_at, last_round_at)
values ('00000000-0000-0000-0000-0000000000a1', 'ok', now() - interval '1 day', now() - interval '14 minutes',
        now() - interval '14 minutes');

create function pg_temp.beat(p_name text, p_age interval) returns void language sql as $$
  insert into public.agent_heartbeats (name, last_seen_at) values (p_name, now() - p_age)
  on conflict (name) do update set last_seen_at = excluded.last_seen_at;
$$;
create temp table sid on commit drop as select name, id from public.sites;
grant select on sid to anon, authenticated, service_role;
create function pg_temp.site(p text) returns uuid language sql as $$ select id from sid where name = p $$;
grant execute on function pg_temp.site(text) to anon, authenticated, service_role;

-- ── The engine is healthy: nothing by hand ─────────────────────────────────
select pg_temp.beat('engine-sweep', '30 seconds');
select pg_temp.beat('engine-run', '30 seconds');
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format('select public.record_hand_check(%L)', pg_temp.site('realme.link')), '55000',
  'monitoring is running', 'no hand check while the sweep runs');
select throws_ok(format('select public.open_manual_incident(%L, null, false)', pg_temp.site('realme.link')), '55000',
  'monitoring is running', 'no manual incident while the sweep runs');
reset role;

-- A sweep exactly 3 min old is the fault (D-053 amended).
select pg_temp.beat('engine-sweep', '3 minutes');
select pg_temp.beat('engine-run', '3 minutes');

-- ── Who may press (§30.3) ──────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('mint'));
select throws_ok(format('select public.record_hand_check(%L)', pg_temp.site('realme.link')), '42501',
  'not allowed', 'a Viewer reads the card only');
select tests.authenticate_as(pg_temp.uid('thee'));
select throws_ok(format('select public.record_hand_check(%L)', pg_temp.site('realme.link')), '42501',
  'not allowed', 'the AM reads the card only');
select tests.authenticate_as(pg_temp.uid('nok'));
select throws_ok(format('select public.open_manual_incident(%L, null, false)', pg_temp.site('realme.link')), '42501',
  'not allowed', 'a Responder on someone else''s site, not on call');
select tests.as_anon();
select throws_ok(format('select public.record_hand_check(%L)', pg_temp.site('realme.link')), '42501',
  null, 'anon can''t call it');
reset role;

select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format('select public.record_hand_check(%L)', pg_temp.site('Tier two')), '55000',
  'the hand check covers live Tier 1 sites only', 'Tier 2–3: not needed');
select throws_ok(format('select public.open_manual_incident(%L, %L, false)', pg_temp.site('realme.link'), repeat('x', 501)),
  '22001', 'note too long', 'the note is 500 characters at most');

select throws_ok(format('select public.open_manual_incident(%L, null, false)', pg_temp.site('MuvMi')), '55000',
  'the site has no home page monitor', 'no primary monitor: nothing the engine could recover it on');
select public.mute_site(pg_temp.site('Muted'), now() + interval '1 hour', 'planned work');
select throws_ok(format('select public.open_manual_incident(%L, null, false)', pg_temp.site('Muted')), '55000',
  'the site is muted or in maintenance', 'a mute stops new alerts, by hand too (§15.1)');
select throws_ok(format('select private.hand_check_site(%L)', pg_temp.site('realme.link')), '42501', null,
  'the private checks can''t be called directly');

-- ── Loads OK ───────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('arm'));
select isnt(public.record_hand_check(pg_temp.site('MuvMi')), null, 'the owner records Loads OK');
select isnt(public.record_hand_check(pg_temp.site('MuvMi')), null, 'and can press it again');
reset role;
select is((select count(*)::int from public.hand_checks where site_id = pg_temp.site('MuvMi') and outcome = 'ok'),
  2, 'one row per press');
select is((select count(*)::int from public.audit_log where entity_id = pg_temp.site('MuvMi')
           and action = 'site.hand_check' and actor_id = pg_temp.uid('arm')), 2, 'each logged with who pressed');
select is((select count(*)::int from public.incidents where site_id = pg_temp.site('MuvMi')), 0,
  'Loads OK opens nothing and sends nothing');

select tests.authenticate_as(pg_temp.uid('mint'));
select is((select count(*)::int from public.hand_checks), 2, 'staff read the hand checks');
select throws_ok('insert into public.hand_checks (site_id, checked_by, outcome) values (gen_random_uuid(), auth.uid(), ''ok'')',
  '42501', null, 'nobody writes hand_checks directly');
reset role;

-- ── Down — open incident ───────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
create temp table inc (id uuid) on commit drop;
grant all on inc to authenticated, service_role;
insert into inc select public.open_manual_incident(pg_temp.site('realme.link'), '  Home page shows a 502 error ', false);
select throws_ok(format('select public.open_manual_incident(%L, null, false)', pg_temp.site('realme.link')), '55000',
  'the site already has an open incident', 'one open incident per site');
reset role;
create function pg_temp.inc() returns uuid language sql as $$ select id from inc limit 1 $$;
grant execute on function pg_temp.inc() to anon, authenticated, service_role;

select is((select trigger::text || ' ' || severity::text || ' ' || state::text || ' ' || is_manual::text
           from public.incidents where id = pg_temp.inc()),
  'manual down unacked true', 'a DOWN, trigger Manual (hand check), Unacked');
select is((select started_at = now() and detected_at = now() from public.incidents where id = pg_temp.inc()),
  true, 'started and detected at the hand check');
select isnt((select monitor_id from public.incidents where id = pg_temp.inc()), null,
  'on the primary monitor, so the engine recovers it');
select is((select escalation_plan is not null from public.incidents where id = pg_temp.inc()), true,
  'the Tier 1 DOWN plan');
select is((select actor_id from public.incident_events where incident_id = pg_temp.inc() and type = 'detected'),
  pg_temp.uid('tao'), 'the detected event names who opened it');
select is((select payload ->> 'note' from public.incident_events where incident_id = pg_temp.inc() and type = 'detected'),
  'Home page shows a 502 error', 'with the note, trimmed');
select is((select status::text || ' ' || (last_round_at = now())::text
           from public.site_status where site_id = pg_temp.site('realme.link')),
  'down true', 'the site reads DOWN; its round clock moves to the hand check, so an older OK round never recovers it');
select is((select hold_until from public.notifications
           where incident_id = pg_temp.inc() and channel = 'google_chat' and template = 'down'),
  null, 'the L0 Chat line has no hold: the action sends it now');
select is((select bool_and(hold_until = now() + interval '5 minutes') from public.notifications
           where incident_id = pg_temp.inc() and channel = 'email' and template = 'down'),
  true, 'the L0 emails wait out the D-047 grace (D-055 item 2)');
select is((select outcome || ' ' || (incident_id = pg_temp.inc())::text from public.hand_checks
           where site_id = pg_temp.site('realme.link')),
  'down true', 'the hand check row links the incident');
select is((select count(*)::int from public.audit_log
           where entity_id = pg_temp.inc() and action = 'incident.opened' and actor_id = pg_temp.uid('tao')),
  1, 'opened, logged as Tao');

-- ── Escalate now: only once no engine run of any kind for 3 min (D-055 item 1) ──
select pg_temp.beat('engine-run', '1 minute');
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format('select public.escalate_now(%L, 1::smallint)', pg_temp.inc()), '55000', 'the engine is running',
  'a Bangkok batch still runs the engine: the ladder runs on its own');
select throws_ok(format('select public.send_client_update_reminder(%L)', pg_temp.inc()), '55000',
  'the engine is running', 'and so does the client-update track');
reset role;
select pg_temp.beat('engine-run', '4 minutes');

select tests.authenticate_as(pg_temp.uid('thee'));
select throws_ok(format('select public.escalate_now(%L, 1::smallint)', pg_temp.inc()), '42501', 'not allowed',
  'the AM can''t escalate');
select tests.authenticate_as(pg_temp.uid('tao'));
select is(public.escalate_now(pg_temp.inc(), 1::smallint) ->> 'level', '1', 'Escalate now sends L1');
select throws_ok(format('select public.escalate_now(%L, 1::smallint)', pg_temp.inc()), '55000', 'the incident moved on',
  'two people pressing L1 at once send one level, not two');
reset role;

select is((select state::text || ' ' || escalation_level from public.incidents where id = pg_temp.inc()),
  'escalated 1', 'the incident is Escalated · L1');
select is((select actor_id from public.incident_events where incident_id = pg_temp.inc() and type = 'step_fired'),
  pg_temp.uid('tao'), 'the step names who sent it');
select is((select payload ->> 'byHand' from public.incident_events where incident_id = pg_temp.inc() and type = 'step_fired'),
  'true', 'by hand');
select ok((select count(*) > 0 from public.notifications where incident_id = pg_temp.inc()
           and template = 'step_fired' and dedupe_key = 'down:L1'), 'L1 queued under the engine''s own key');

-- Engine back: its ladder finds L1 sent.
set local role service_role;
select ok(not public.engine_fire_step(pg_temp.inc(), 1::smallint, now(), '{}'),
  'the engine never sends L1 again (Done-when 2)');
reset role;
select tests.authenticate_as(pg_temp.uid('tao'));
select is(public.escalate_now(pg_temp.inc(), 2::smallint) ->> 'level', '2', 'the next press sends L2');

-- ── The client-update reminder by hand (§30.7) ─────────────────────────────
select ok(public.send_client_update_reminder(pg_temp.inc()), 'sent before its due time (D-055 item 3)');
select throws_ok(format('select public.send_client_update_reminder(%L)', pg_temp.inc()), '55000',
  'the reminder went already', 'once');
reset role;
select is((select client_update_required::text || ' ' || (client_update_due_at = date_trunc('milliseconds', started_at) + interval '15 minutes')::text
           from public.incidents where id = pg_temp.inc()),
  'true true', 'required, due 15 min after it opened');
select is((select user_id from public.notifications where incident_id = pg_temp.inc()
           and template = 'client_update_due' and channel = 'email'), pg_temp.uid('thee'), 'Thee, the AM, is emailed');
-- Engine back 20 min later: its track would fire now.
update public.incidents set started_at = now() - interval '20 minutes' where id = pg_temp.inc();
set local role service_role;
select ok(not public.engine_client_update_due(pg_temp.inc(), now()),
  'the engine''s track never sends it again (Done-when 2)');
reset role;

select tests.authenticate_as(pg_temp.uid('nok'));
select throws_ok(format('select public.escalate_now(%L, 3::smallint)', pg_temp.inc()), '42501', 'not allowed',
  'a Responder on someone else''s site can''t escalate');
select throws_ok(format('select public.send_client_update_reminder(%L)', pg_temp.inc()), '42501', 'not allowed',
  'nor send the reminder');
select tests.authenticate_as(pg_temp.uid('mint'));
select throws_ok(format('select public.send_client_update_reminder(%L)', pg_temp.inc()), '42501', 'not allowed',
  'a Viewer can''t send the reminder');
select tests.authenticate_as(pg_temp.uid('tao'));
select public.ack_incident(pg_temp.inc());
select throws_ok(format('select public.escalate_now(%L, 3::smallint)', pg_temp.inc()), '55000',
  'only an incident waiting for an ack escalates', 'Acknowledge stops Escalate now (§30.6)');
reset role;

select * from finish();
rollback;
