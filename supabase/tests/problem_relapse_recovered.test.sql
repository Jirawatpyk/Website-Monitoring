-- D-038: a PROBLEM drop after a relapse emails its recovery (RECOVERED, the flap summary) only to
-- whoever was emailed about that drop; the first drop and a DOWN drop still email everyone already
-- emailed (S02b). Production 12 Oct 2026: a behind-WAF site flipped PROBLEM AGAIN ↔ RECOVERED ~100
-- times and each recovery emailed the owner.
begin;
\ir _helpers.psql
select plan(15);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
insert into ids values
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('tao',  tests.create_user('tao@pgtap.test', 'admin'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'WAF site', 1,
   (select id from ids where name = 'ploy'), (select id from ids where name = 'arm'));
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true, 'https://waf.pgtap.test/');

create temp table inc (id uuid) on commit drop;

-- One transaction has one now(), and the relapse's audit row (where the drop begins) is stamped with
-- it. Before each relapse, move the incident's messages so far into the past, as earlier engine runs
-- would have queued them; rows queued from the relapse on keep now().
create function pg_temp.earlier() returns void language sql as $$
  update public.notifications set created_at = created_at - interval '1 hour'
  where incident_id = (select id from inc)
$$;
create function pg_temp.n(p_template text, p_channel text, p_user text default null) returns int language sql as $$
  select count(*)::int from public.notifications n
  where n.incident_id = (select id from inc) and n.template = p_template and n.channel::text = p_channel
    and (p_user is null or n.user_id = (select id from ids where name = p_user))
$$;
-- The people emailed `p_template` in the current step (created at now()).
create function pg_temp.now_emailed(p_template text) returns uuid[] language sql as $$
  select coalesce(array_agg(distinct n.user_id order by n.user_id), '{}') from public.notifications n
  where n.incident_id = (select id from inc) and n.template = p_template and n.channel = 'email'
    and n.created_at = now()
$$;

insert into inc select public.engine_open_incident(
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'blocked_unverified', 'problem',
  '2026-09-12 06:00Z', '2026-09-12 06:00:40Z', '2026-09-12 06:00Z', '{}'::jsonb, true);

-- The first drop recovers: RECOVERED to Chat and to the owner emailed about the PROBLEM.
select ok(public.engine_recover_incident((select id from inc), 'unacked', 'monitoring',
  '2026-09-12 06:03Z', '2026-09-12 06:03Z', '{}'::jsonb, true, null, null, true), 'the first drop recovers');
select results_eq($$values (pg_temp.n('recovered', 'google_chat'), pg_temp.n('recovered', 'email'))$$,
  $$values (1, 1)$$, 'the first PROBLEM drop: RECOVERED in Chat and by email');

-- PROBLEM AGAIN, then it recovers: nobody was emailed about it, so Chat only.
select pg_temp.earlier();
select ok(public.engine_relapse_incident((select id from inc), 'problem', 'blocked_unverified',
  '2026-09-12 06:06Z', '2026-09-12 06:06:40Z', '2026-09-12 06:06Z', '{}'::jsonb, false, true), 'PROBLEM AGAIN');
select ok(public.engine_recover_incident((select id from inc), 'unacked', 'monitoring',
  '2026-09-12 06:09Z', '2026-09-12 06:09Z', '{}'::jsonb, true, null, null, true), 'recovers again');
select results_eq($$values (pg_temp.n('recovered', 'google_chat'), pg_temp.n('recovered', 'email'))$$,
  $$values (2, 1)$$, 'a PROBLEM relapse recovers in Chat only');

-- Muted: the relapse posts nothing (no AGAIN card); its recovery still emails nobody (engine review).
select pg_temp.earlier();
select ok(public.engine_relapse_incident((select id from inc), 'problem', 'blocked_unverified',
  '2026-09-12 06:12Z', '2026-09-12 06:12:40Z', '2026-09-12 06:12Z', '{}'::jsonb, false, false), 'a muted PROBLEM AGAIN');
select public.engine_recover_incident((select id from inc), 'unacked', 'monitoring',
  '2026-09-12 06:15Z', '2026-09-12 06:15Z', '{}'::jsonb, true, null, null, true);
select results_eq($$values (pg_temp.n('recovered', 'google_chat'), pg_temp.n('recovered', 'email'))$$,
  $$values (3, 1)$$, 'a muted PROBLEM relapse: still no RECOVERED email');

-- Flapping: the held summary is Chat only as well.
select pg_temp.earlier();
select public.engine_relapse_incident((select id from inc), 'problem', 'blocked_unverified',
  '2026-09-12 06:18Z', '2026-09-12 06:18:40Z', '2026-09-12 06:18Z', '{}'::jsonb, true, true);
select public.engine_recover_incident((select id from inc), 'unacked', 'monitoring',
  '2026-09-12 06:21Z', '2026-09-12 06:21Z', '{}'::jsonb, true, null, null, true, false, true);
select results_eq($$values (pg_temp.n('flap_summary', 'google_chat'), pg_temp.n('flap_summary', 'email'))$$,
  $$values (1, 0)$$, 'a flapping PROBLEM relapse: the summary in Chat only');

-- The PROBLEM AGAIN card failed and fell back to email: whoever got that email hears it recovered.
select pg_temp.earlier();
select public.engine_relapse_incident((select id from inc), 'problem', 'blocked_unverified',
  '2026-09-12 06:24Z', '2026-09-12 06:24:40Z', '2026-09-12 06:24Z', '{}'::jsonb, false, true);
select ok(public.queue_fallback_emails((select id from public.notifications where incident_id = (select id from inc)
  and template = 'problem_again' and created_at = now())) > 0, 'the fallback emails go');
create temp table fallback on commit drop as select pg_temp.now_emailed('problem_again') as who;
select public.engine_recover_incident((select id from inc), 'unacked', 'monitoring',
  '2026-09-12 06:27Z', '2026-09-12 06:27Z', '{}'::jsonb, true, null, null, true);
select is(pg_temp.now_emailed('recovered'), (select who from fallback),
  'everyone the fallback emailed gets RECOVERED, nobody else');

-- An escalation step emailed during the drop: its people hear it recovered.
select pg_temp.earlier();
select public.engine_relapse_incident((select id from inc), 'problem', 'blocked_unverified',
  '2026-09-12 06:30Z', '2026-09-12 06:30:40Z', '2026-09-12 06:30Z', '{}'::jsonb, false, true);
update public.notifications set status = 'sent', sent_at = now()
  where incident_id = (select id from inc) and channel = 'google_chat' and status = 'queued';
select ok(public.engine_fire_step((select id from inc), 1::smallint, now(), '{}'), 'L1 fires');
create temp table step on commit drop as select pg_temp.now_emailed('step_fired') as who;
select ok(cardinality((select who from step)) > 0, 'L1 emails someone');
-- It went out (a step still waiting at recovery is set aside, and its person hears nothing).
update public.notifications set status = 'sent', sent_at = now()
  where incident_id = (select id from inc) and template = 'step_fired' and status = 'queued';
select public.engine_recover_incident((select id from inc), 'escalated', 'monitoring',
  '2026-09-12 07:31Z', '2026-09-12 07:31Z', '{}'::jsonb, true, null, null, true);
select is(pg_temp.now_emailed('recovered'), (select who from step),
  'the step''s people get RECOVERED, nobody else');

-- A DOWN drop still emails RECOVERED to everyone emailed (D-021 raises the open PROBLEM, then it recovers).
select pg_temp.earlier();
select public.engine_relapse_incident((select id from inc), 'problem', 'blocked_unverified',
  '2026-09-12 07:40Z', '2026-09-12 07:40:40Z', '2026-09-12 07:40Z', '{}'::jsonb, false, true);
select ok(public.engine_escalate_incident((select id from inc), '2026-09-12 07:41Z', '2026-09-12 07:41Z',
  '{}'::jsonb, true), 'the PROBLEM drop goes DOWN');
select public.engine_recover_incident((select id from inc), 'unacked', 'monitoring',
  '2026-09-12 07:46Z', '2026-09-12 07:46Z', '{}'::jsonb, true, null, null, true);
select is(pg_temp.now_emailed('recovered'),
  (select array_agg(distinct user_id order by user_id) from public.notifications
   where incident_id = (select id from inc) and channel = 'email' and status <> 'cancelled'
     and template <> 'recovered'),
  'a DOWN drop after relapses emails RECOVERED to everyone already emailed');

select * from finish();
rollback;
