-- S04b relapse, flapping & auto-resolve (D-004, D-023, D-024, spec §16.1, §19.3–19.4): a relapse
-- joins the recovered incident once (overlapping runs harmless), severity only goes up, the flips
-- that tag flapping, the RECOVERED summary held 15 min and cancelled by a new drop, a template that
-- repeats on one incident, the < 5 min auto-resolve, and the engine's read RPCs.
begin;
\ir _helpers.psql
select plan(47);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('tao',  tests.create_user('tao@pgtap.test', 'admin'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'VOCA', 2,
   (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Fuji Links', 2,
   (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1', 'Paused', 2,
   (select id from ids where name = 'ploy'));
update public.sites set is_active = false where id = '00000000-0000-0000-0000-0000000000a3';
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true, 'https://voca.pgtap.test/'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'http', true, 'https://fuji.pgtap.test/'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a3', 'http', true, 'https://paused.pgtap.test/');

create temp table inc (name text primary key, id uuid) on commit drop;

-- ── VOCA (INC-0133): opens DOWN 03:12, the first flip ─────────────────────
insert into inc values ('voca', public.engine_open_incident(
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'hard_fail', 'down',
  '2026-09-21 03:12Z', '2026-09-21 03:12:40Z', '2026-09-21 03:12Z', '{}'::jsonb, true));
select results_eq(
  $$select episode_severity::text, flip_ok, cardinality(flips) from public.incidents i
    join public.site_status s on s.site_id = i.site_id where i.id = (select id from inc where name = 'voca')$$,
  $$values ('down', false, 1)$$,
  'opening records the episode severity and the OK → not-OK flip'
);

-- 03:19 first OK round: Monitoring, RECOVERED, the not-OK → OK flip.
select ok(public.engine_recover_incident((select id from inc where name = 'voca'), 'unacked', 'monitoring',
  '2026-09-21 03:19Z', '2026-09-21 03:19Z', '{}'::jsonb, true, null, null, true),
  'the first recovery succeeds');
select results_eq(
  $$select flip_ok, cardinality(flips) from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a1'$$,
  $$values (true, 2)$$, 'a full recovery is the 2nd flip'
);

-- 03:24 fails again: one relapse, even when two engine runs judge the same round.
select ok(public.engine_relapse_incident((select id from inc where name = 'voca'), 'down', 'hard_fail',
  '2026-09-21 03:24Z', '2026-09-21 03:24:40Z', '2026-09-21 03:24Z', '{"cause":"x"}'::jsonb, true, true),
  'a DOWN on a recovered incident joins it');
select ok(not public.engine_relapse_incident((select id from inc where name = 'voca'), 'down', 'hard_fail',
  '2026-09-21 03:24Z', '2026-09-21 03:24:41Z', '2026-09-21 03:24Z', '{"cause":"x"}'::jsonb, true, true),
  'the overlapping run gets false (state guard)');
select results_eq(
  $$select state::text, recovered_at is null, is_flapping from public.incidents where id = (select id from inc where name = 'voca')$$,
  $$values ('unacked', true, true)$$,
  'nobody had acked: back to Unacked, recovery cleared, tagged flapping'
);
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'down_again'),
  1, 'one DOWN AGAIN reply, Chat only'
);
select is(
  (select thread_key from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'down_again'),
  (select id::text from inc where name = 'voca'), 'in the incident''s thread'
);
select is(
  (select count(*)::int from public.incident_events where incident_id = (select id from inc where name = 'voca')
     and type = 'relapsed'),
  1, 'one relapsed event'
);
select results_eq(
  $$select flip_ok, cardinality(flips), ok_rounds::int from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a1'$$,
  $$values (false, 3, 0)$$, 'the relapse is the 3rd flip'
);

-- 03:35 recovers while flapping: no RECOVERED, one summary held until 03:50.
select ok(public.engine_recover_incident((select id from inc where name = 'voca'), 'unacked', 'monitoring',
  '2026-09-21 03:35Z', '2026-09-21 03:35Z', '{}'::jsonb, true, null, null, true, false, true),
  'the flapping incident recovers');
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'recovered'),
  2, 'no new RECOVERED rows while flapping (the 03:19 Chat + email stay the only ones)'
);
select results_eq(
  $$select channel::text, hold_until from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'flap_summary' order by channel$$,
  $$values ('email', '2026-09-21 03:50Z'::timestamptz), ('google_chat', '2026-09-21 03:50Z'::timestamptz)$$,
  'one summary to Chat and the owner, held until 15 min after the recovery'
);
-- (The sample's 03:50 is long past for the real clock: hold it 15 min from now to see the claim wait.)
update public.notifications set hold_until = now() + interval '15 minutes'
  where incident_id = (select id from inc where name = 'voca') and template = 'flap_summary';
select is(
  (select count(*)::int from public.claim_notifications('google_chat', 20, (select id from inc where name = 'voca'))
     where template = 'flap_summary'),
  0, 'the claim leaves the summary alone while it is held'
);
-- A newer Chat row of the same incident isn't stuck behind the held summary.
insert into public.notifications (incident_id, channel, template, thread_key, context)
values ((select id from inc where name = 'voca'), 'google_chat', 'note_test', (select id::text from inc where name = 'voca'), '{}');
select is(
  (select count(*)::int from public.claim_notifications('google_chat', 20, (select id from inc where name = 'voca'))
     where template = 'note_test'),
  1, 'a newer message isn''t held back by the held summary'
);
update public.notifications set status = 'cancelled' where template = 'note_test';

-- 03:38 drops again: the held summary is cancelled.
select ok(public.engine_relapse_incident((select id from inc where name = 'voca'), 'down', 'hard_fail',
  '2026-09-21 03:38Z', '2026-09-21 03:38:40Z', '2026-09-21 03:38Z', '{}'::jsonb, true, true),
  'a 2nd relapse joins it too');
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'flap_summary' and status = 'cancelled' and error = 'Superseded: down again'),
  2, 'a new drop cancels the held summary (Chat and email)'
);
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'down_again' and status <> 'cancelled'),
  2, 'the 2nd DOWN AGAIN is its own reply (dedupe key = round)'
);

-- 04:04 last recovery: the summary that will go at 04:19.
select ok(public.engine_recover_incident((select id from inc where name = 'voca'), 'unacked', 'monitoring',
  '2026-09-21 04:04Z', '2026-09-21 04:04Z', '{}'::jsonb, true, null, null, true, false, true),
  'the last recovery');
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'flap_summary' and status = 'queued' and hold_until = '2026-09-21 04:19Z'),
  2, 'the summary waits for 04:19'
);

-- Flips older than 30 min are dropped.
select public.engine_record_flip('00000000-0000-0000-0000-0000000000a1', '2026-09-21 04:40Z', false);
select is(
  (select flips from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a1'),
  array['2026-09-21 04:40Z'::timestamptz], 'only the last 30 min of flips are kept'
);
select public.engine_record_flip('00000000-0000-0000-0000-0000000000a1', '2026-09-21 04:41Z', false);
select is(
  (select cardinality(flips) from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'the same direction again is not a flip'
);

-- A stale round can't move the flips back.
select public.engine_record_flip('00000000-0000-0000-0000-0000000000a1', '2026-09-21 03:00Z', true);
select is(
  (select flip_ok from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a1'),
  false, 'an older round doesn''t toggle the flip direction'
);

-- ── Acknowledged, escalated and D-023 ────────────────────────────────────
update public.incidents set acked_at = '2026-09-21 04:10Z', acked_by = (select id from ids where name = 'ploy')
  where id = (select id from inc where name = 'voca');
select ok(public.engine_relapse_incident((select id from inc where name = 'voca'), 'problem', 'key_page',
  '2026-09-21 04:45Z', '2026-09-21 04:45:40Z', '2026-09-21 04:45Z', '{}'::jsonb, false, true),
  'a key page failing after the home page came back rejoins (D-023)');
select results_eq(
  $$select state::text, severity::text, episode_severity::text from public.incidents where id = (select id from inc where name = 'voca')$$,
  $$values ('acknowledged', 'down', 'problem')$$,
  'acked earlier: back to Acknowledged; severity stays DOWN for the record, the episode is a PROBLEM'
);
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'problem_again'),
  1, 'PROBLEM AGAIN is queued'
);
-- The home page fails again during that PROBLEM drop (still Acknowledged, not recovered): DOWN AGAIN.
select ok(not public.engine_relapse_incident((select id from inc where name = 'voca'), 'problem', 'key_page',
  '2026-09-21 04:46Z', '2026-09-21 04:46:40Z', '2026-09-21 04:46Z', '{}'::jsonb, false, true),
  'another PROBLEM during the open PROBLEM drop is no relapse');
select ok(public.engine_relapse_incident((select id from inc where name = 'voca'), 'down', 'hard_fail',
  '2026-09-21 04:47Z', '2026-09-21 04:47:40Z', '2026-09-21 04:47Z', '{}'::jsonb, false, true),
  'the home page down again during the D-023 PROBLEM drop joins as DOWN AGAIN (engine review H1)');
select ok(not public.engine_relapse_incident((select id from inc where name = 'voca'), 'down', 'hard_fail',
  '2026-09-21 04:47Z', '2026-09-21 04:47:41Z', '2026-09-21 04:47Z', '{}'::jsonb, false, true),
  'the overlapping run gets false (the drop is DOWN now)');
select results_eq(
  $$select state::text, episode_severity::text from public.incidents where id = (select id from inc where name = 'voca')$$,
  $$values ('acknowledged', 'down')$$,
  'still Acknowledged; the drop in progress is DOWN'
);
select ok(public.engine_recover_incident((select id from inc where name = 'voca'), 'acknowledged', 'monitoring',
  '2026-09-21 04:50Z', '2026-09-21 04:50Z', '{}'::jsonb, true, null, null, true),
  'recovers again');
update public.incidents set acked_at = null, acked_by = null, escalation_level = 1
  where id = (select id from inc where name = 'voca');
select ok(public.engine_relapse_incident((select id from inc where name = 'voca'), 'down', 'hard_fail',
  '2026-09-21 04:55Z', '2026-09-21 04:55:40Z', '2026-09-21 04:55Z', '{}'::jsonb, false, true), 'relapses');
select is(
  (select state::text from public.incidents where id = (select id from inc where name = 'voca')),
  'escalated', 'a level had fired: back to Escalated (D-004)'
);
select ok(not public.engine_relapse_incident((select id from inc where name = 'voca'), 'down', 'hard_fail',
  '2026-09-21 04:56Z', '2026-09-21 04:56:40Z', '2026-09-21 04:56Z', '{}'::jsonb, false, true),
  'an incident that hasn''t recovered can''t relapse');

-- Chat failed on a 2nd DOWN AGAIN: the fallback email keeps its round's key.
select ok(
  public.queue_fallback_emails((select id from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'down_again' and dedupe_key = '2026-09-21T04:55:00Z')) > 0
  and not exists (select 1 from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'down_again' and channel = 'email' and dedupe_key <> '2026-09-21T04:55:00Z'),
  'the fallback email (Admins, no backup set) keeps the round''s dedupe key'
);
select ok(
  exists (select 1 from public.notifications where incident_id = (select id from inc where name = 'voca')
     and template = 'down_again' and channel = 'email' and user_id = (select id from ids where name = 'ploy')),
  'the AGAIN fallback also reaches the person it mentions (the owner, nobody acked) — D-024'
);

-- ── Auto-resolve (spec §16.1) ────────────────────────────────────────────
insert into inc values ('fuji', public.engine_open_incident(
  '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2', 'slow', 'problem',
  '2026-09-25 09:48Z', '2026-09-25 09:50:05Z', '2026-09-25 09:50Z', '{}'::jsonb, true));
select throws_ok(
  $$select public.engine_recover_incident((select id from inc where name = 'fuji'), 'unacked', 'monitoring',
    '2026-09-25 09:51Z', '2026-09-25 09:51Z', '{}'::jsonb, true, null, null, true, true)$$,
  'P0001', 'auto-resolve must go to resolved', 'auto-resolve only goes to Resolved'
);
select ok(public.engine_recover_incident((select id from inc where name = 'fuji'), 'unacked', 'resolved',
  '2026-09-25 09:51Z', '2026-09-25 09:51Z', '{"autoResolved":true}'::jsonb, true, null, null, true, true),
  'a short PROBLEM nobody acked auto-resolves');
select results_eq(
  $$select state::text, auto_resolved, resolved_at from public.incidents where id = (select id from inc where name = 'fuji')$$,
  $$values ('resolved', true, '2026-09-25 09:51Z'::timestamptz)$$,
  'Resolved, flagged for the hidden list, resolved at the recovery'
);
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'fuji')
     and template = 'recovered'),
  2, 'it still gets RECOVERED in Chat and by email'
);
select is(
  (select count(*)::int from public.incident_events where incident_id = (select id from inc where name = 'fuji')
     and type = 'auto_resolved'),
  1, 'the timeline says it resolved itself'
);
insert into inc values ('fuji2', public.engine_open_incident(
  '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2', 'hard_fail', 'down',
  '2026-09-25 10:00Z', '2026-09-25 10:00:40Z', '2026-09-25 10:00Z', '{}'::jsonb, false));
select ok((select id from inc where name = 'fuji2') is not null, 'a resolved incident is no longer open: a new one opens');
select ok(not public.engine_recover_incident((select id from inc where name = 'fuji2'), 'unacked', 'resolved',
  '2026-09-25 10:02Z', '2026-09-25 10:02Z', '{}'::jsonb, false, null, null, true, true),
  'a DOWN never auto-resolves');

-- ── The engine's read RPCs ───────────────────────────────────────────────
insert into public.check_results (id, monitor_id, location, checked_at, outcome) values
  ('00000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-0000000000d1', 'SIN', '2026-10-07 09:00:05Z', 'pass'),
  ('00000000-0000-0000-0000-000000000e02', '00000000-0000-0000-0000-0000000000d1', 'TYO', '2026-10-07 09:00:05Z', 'pass'),
  ('00000000-0000-0000-0000-000000000e03', '00000000-0000-0000-0000-0000000000d2', 'SIN', '2026-10-07 09:01:05Z', 'pass'),
  ('00000000-0000-0000-0000-000000000e04', '00000000-0000-0000-0000-0000000000d3', 'SIN', '2026-10-07 09:01:05Z', 'pass');
select results_eq(
  $$select id::text from public.engine_checks('2026-10-07 08:59Z', null, null, 2)$$,
  $$values ('00000000-0000-0000-0000-000000000e03'), ('00000000-0000-0000-0000-000000000e02')$$,
  'engine_checks: newest first, active sites only, one page'
);
select results_eq(
  $$select id::text from public.engine_checks('2026-10-07 08:59Z', '2026-10-07 09:00:05Z',
    '00000000-0000-0000-0000-000000000e02', 2)$$,
  $$values ('00000000-0000-0000-0000-000000000e01')$$,
  'the next page starts after the last row (keyset)'
);
select is(
  (select count(*)::int from public.engine_monitor_status()), 0,
  'engine_monitor_status reads the active sites'' carries'
);
select ok(
  not has_function_privilege('authenticated', 'public.engine_relapse_incident(uuid, public.severity, public.incident_trigger, timestamptz, timestamptz, timestamptz, jsonb, boolean, boolean, jsonb, public.site_state, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.engine_checks(timestamptz, timestamptz, uuid, integer)', 'execute')
  and has_function_privilege('service_role', 'public.engine_checks(timestamptz, timestamptz, uuid, integer)', 'execute'),
  'the new functions are the service role''s only'
);

select * from finish();
rollback;
