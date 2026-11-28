-- D-079: an incident on a site whose monitoring was stopped resolves without 2 OK rounds (none can come);
-- a drop still in progress ends at the stop. Everything else in the gate still holds.
begin;
\ir _helpers.psql
select plan(10);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('admin', tests.create_user('admin@pgtap.test', 'admin')),
  ('arm',   tests.create_user('arm@pgtap.test', 'responder')),
  ('nok',   tests.create_user('nok@pgtap.test', 'responder'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Cando', 2,
   (select id from ids where name = 'arm'));

create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated;
insert into inc values
  ('p', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'tls_chain', 'problem',
     now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours',
     '{"cause":"TLS chain misconfigured"}', true));

-- ── Still monitored: the 2-OK-rounds condition holds ─────────────────────
select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok(format($$select public.resolve_incident(%L, 'hosting', 'x', null)$$, (select id from inc where name = 'p')),
  '55000', 'It needs 2 OK rounds in a row before it can be resolved', 'a monitored site still needs its 2 OK rounds');

-- ── Monitoring stopped an hour ago, after a stop → start two hours ago (the latest stop counts) ──
-- audit_log is append-only and the row trigger stamps now(): write the stop with triggers off and its
-- audit rows by hand, backdated, as the trigger would have.
reset role;
set local session_replication_role = replica;
update public.sites set is_active = false where id = '00000000-0000-0000-0000-0000000000a1';
set local session_replication_role = origin;
insert into public.audit_log (action, entity, entity_id, before, after, at) values
  ('site.update', 'site', '00000000-0000-0000-0000-0000000000a1', '{"is_active": true}', '{"is_active": false}',
   now() - interval '150 minutes'),
  ('site.update', 'site', '00000000-0000-0000-0000-0000000000a1', '{"is_active": false}', '{"is_active": true}',
   now() - interval '120 minutes'),
  ('site.update', 'site', '00000000-0000-0000-0000-0000000000a1', '{"is_active": true}', '{"is_active": false}',
   now() - interval '60 minutes');

select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok(format($$select public.resolve_incident(%L, 'hosting', 'x', null)$$, (select id from inc where name = 'p')),
  '42501', 'This role can''t resolve this incident', 'the stop doesn''t widen who may resolve');

select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok(format($$select public.resolve_incident(%L, 'unknown', 'x', null)$$, (select id from inc where name = 'p')),
  '55000', 'Unknown keeps the incident open — pick a category', 'a root cause is still needed');

select lives_ok(format($$select public.resolve_incident(%L, 'hosting', 'Client-hosted; monitoring stopped', null)$$,
  (select id from inc where name = 'p')), 'resolves without OK rounds once monitoring stopped');

reset role;
select is((select state::text from public.incidents where id = (select id from inc where name = 'p')),
  'resolved', 'the incident is resolved');
select is(
  (select at from public.incident_events where incident_id = (select id from inc where name = 'p')
     and type = 'monitoring_stopped'),
  now() - interval '60 minutes',
  'the open drop ends at the latest stop, not at the resolve');
select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok(format($$select public.undo_resolve(%L)$$, (select id from inc where name = 'p')),
  '55000', 'This resolve closed the outage of a site whose monitoring is stopped — it can''t be undone',
  'Undo refuses a resolve that ended a stopped site''s drop');
reset role;
select is(
  (select count(*)::int from public.audit_log where entity_id = (select id from inc where name = 'p')
     and action = 'incident.resolved'),
  1, 'one incident.resolved audit row');

-- ── A recovered incident on a stopped site: no stop event (its drop already ended) ─────────
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Tubtong', 2,
   (select id from ids where name = 'arm'));
insert into inc values
  ('r', public.engine_open_incident('00000000-0000-0000-0000-0000000000a2', null, 'hard_fail', 'down',
     now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', '{}', true));
select ok(public.engine_recover_incident((select id from inc where name = 'r'), 'unacked', 'monitoring',
  now() - interval '90 minutes', now() - interval '90 minutes', '{}'::jsonb, true), 'it recovered');
update public.sites set is_active = false where id = '00000000-0000-0000-0000-0000000000a2';

select tests.authenticate_as((select id from ids where name = 'admin'));
select public.resolve_incident((select id from inc where name = 'r'), 'deploy', 'A deploy', null);
reset role;
select is(
  (select count(*)::int from public.incident_events where incident_id = (select id from inc where name = 'r')
     and type = 'monitoring_stopped'),
  0, 'a drop that already ended gets no stop event');

select * from finish();
rollback;
