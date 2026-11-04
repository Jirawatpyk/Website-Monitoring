-- "Down again" by hand and the engine-back line (S12b follow-up, D-055 items 6–7, spec §30.8): a
-- recovered DOWN relapses in its thread (ladder kept, D-004), a PROBLEM is raised to DOWN (D-021), a
-- still-open DOWN is refused; engine_mark_engine_back writes one line per stop on incidents with a
-- by-hand action.
begin;
\ir _helpers.psql
select plan(20);

select tests.clear_sites();
update public.profiles set is_active = false where role in ('admin', 'stakeholder');
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao', tests.create_user('tao@pgtap.test', 'admin')),
  ('arm', tests.create_user('arm@pgtap.test', 'responder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
grant execute on function pg_temp.uid(text) to anon, authenticated, service_role;

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client');
insert into public.sites (id, client_id, name, tier, primary_owner_id)
select v.id, '00000000-0000-0000-0000-0000000000c1', v.name, 1, pg_temp.uid('arm')
from (values ('00000000-0000-0000-0000-0000000000a1'::uuid, 'Recovered'),
             ('00000000-0000-0000-0000-0000000000a2'::uuid, 'Problem'),
             ('00000000-0000-0000-0000-0000000000a3'::uuid, 'Still down')) v (id, name);
insert into public.monitors (site_id, type, url, is_primary)
select id, 'http', 'https://' || id || '.example.test/', true from public.sites where name in ('Recovered', 'Problem', 'Still down');

create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated, service_role;
insert into inc values
  ('rec', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
     now() - interval '40 min', now() - interval '39 min', now() - interval '40 min', '{"cause":"x"}', true)),
  ('prob', public.engine_open_incident('00000000-0000-0000-0000-0000000000a2', null, 'slow', 'problem',
     now() - interval '40 min', now() - interval '39 min', now() - interval '40 min', '{"summary":"slow"}', true)),
  ('down', public.engine_open_incident('00000000-0000-0000-0000-0000000000a3', null, 'hard_fail', 'down',
     now() - interval '10 min', now() - interval '9 min', now() - interval '10 min', '{"cause":"x"}', true));
create function pg_temp.inc(p text) returns uuid language sql as $$ select id from inc where name = p $$;
grant execute on function pg_temp.inc(text) to anon, authenticated, service_role;
-- The first incident recovered 20 min ago; its L1 had fired.
select public.engine_recover_incident(pg_temp.inc('rec'), 'unacked', 'monitoring', now() - interval '20 min',
  now() - interval '20 min', '{}', false);
update public.incidents set escalation_level = 1 where id = pg_temp.inc('rec');

create function pg_temp.beats(p_age interval) returns void language sql as $$
  insert into public.agent_heartbeats (name, last_seen_at)
  values ('engine-sweep', now() - p_age), ('engine-run', now() - p_age)
  on conflict (name) do update set last_seen_at = excluded.last_seen_at;
$$;

-- ── Refusals ─────────────────────────────────────────────────────────────────
select pg_temp.beats('30 seconds');
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format('select public.report_down_by_hand(%L, null, false)', pg_temp.inc('rec')), '55000',
  'monitoring is running', 'not while the sweep runs');
reset role;
select pg_temp.beats('5 minutes');
select tests.authenticate_as(pg_temp.uid('mint'));
select throws_ok(format('select public.report_down_by_hand(%L, null, false)', pg_temp.inc('rec')), '42501',
  'not allowed', 'a Viewer reads only');
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format('select public.report_down_by_hand(%L, null, false)', pg_temp.inc('down')), '55000',
  'the site is down already', 'a DOWN still open is the alert already');
select throws_ok(format('select public.report_down_by_hand(%L, %L, false)', pg_temp.inc('rec'), repeat('x', 501)),
  '22001', 'note too long', 'the note is 500 characters at most');

-- ── A recovered DOWN relapses (D-004) ───────────────────────────────────────
select is(public.report_down_by_hand(pg_temp.inc('rec'), ' 502 again ', false), 'relapse', 'Down again on a recovered incident');
reset role;
select is((select state::text || ' ' || escalation_level from public.incidents where id = pg_temp.inc('rec')),
  'unacked 1', 'waits for an ack again, the level it reached kept (D-004)');
select ok((select manual_at = now() from public.incidents where id = pg_temp.inc('rec')), 'manual_at is the press');
select is((select actor_id from public.incident_events where incident_id = pg_temp.inc('rec') and type = 'relapsed'),
  pg_temp.uid('tao'), 'the relapse names who reported it');
select is((select payload ->> 'note' from public.incident_events where incident_id = pg_temp.inc('rec') and type = 'relapsed'),
  '502 again', 'with the note');
select is((select count(*)::int from public.notifications where incident_id = pg_temp.inc('rec')
           and template = 'down_again' and channel = 'google_chat' and hold_until is null),
  1, 'DOWN AGAIN in its thread, at once');
select is((select status::text from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a1'),
  'down', 'the site reads DOWN');
select ok((select last_round_at < now() - interval '19 min' from public.site_status
           where site_id = '00000000-0000-0000-0000-0000000000a1'), 'its round clock stays the engine''s');
select is((select count(*)::int from public.hand_checks where incident_id = pg_temp.inc('rec')), 1,
  'a hand-check row links it');

-- ── A PROBLEM is raised to DOWN (D-021) ─────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select is(public.report_down_by_hand(pg_temp.inc('prob'), null, false), 'raise', 'Down on a PROBLEM raises it');
reset role;
select is((select severity::text || ' ' || state::text from public.incidents where id = pg_temp.inc('prob')),
  'down unacked', 'DOWN, waiting for an ack');
select is((select actor_id from public.incident_events where incident_id = pg_temp.inc('prob') and type = 'escalated_to_down'),
  pg_temp.uid('tao'), 'the raise names who reported it');
select is((select count(*)::int from public.audit_log where action = 'incident.hand_down' and actor_id = pg_temp.uid('tao')),
  2, 'each logged');

-- ── The engine back (§30.8) ─────────────────────────────────────────────────
set local role service_role;
select is(public.engine_mark_engine_back(now() - interval '5 minutes'), 2,
  'one line on each incident with a by-hand action');
select is(public.engine_mark_engine_back(now() - interval '5 minutes'), 0, 'once per stop');
reset role;
select is((select count(*)::int from public.incident_events where incident_id = pg_temp.inc('down') and type = 'engine_back'),
  0, 'none on an incident nobody touched by hand');

select * from finish();
rollback;
