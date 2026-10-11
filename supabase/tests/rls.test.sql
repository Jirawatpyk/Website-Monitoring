-- RLS per role (PRD §3, D-007, D-012) and the append-only audit_log.
begin;
\ir _helpers.psql
select plan(41);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
-- Start from no sites or clients, whatever the dev seed loaded (rolled back at the end).
select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('admin',       tests.create_user('admin@pgtap.test', 'admin')),
  ('arm',         tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy',        tests.create_user('ploy@pgtap.test', 'responder')),
  ('bua',         tests.create_user('bua@pgtap.test', 'stakeholder')),
  ('mint',        tests.create_user('mint@pgtap.test', 'viewer')),
  ('former',      tests.create_user('former@pgtap.test', 'responder')),
  ('no_profile',  tests.create_user('noprofile@pgtap.test')),
  ('client_user', tests.create_user('client@pgtap.test', 'client'));
update public.profiles set is_active = false where id = (select id from ids where name = 'former');

insert into public.clients (id, name, am_user_id)
values ('00000000-0000-0000-0000-0000000000c1', 'Client A', (select id from ids where name = 'bua'));
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Site B', 2,
   (select id from ids where name = 'ploy'), null);
insert into public.monitors (site_id, type, is_primary, url)
values ('00000000-0000-0000-0000-0000000000a1', 'http', true, 'https://a.pgtap.test');
insert into public.audit_log (action, entity) values ('fixture', 'test');

-- ── anon reads nothing ───────────────────────────────────────────────────
select tests.as_anon();
select throws_ok('select * from public.sites', '42501', null, 'anon cannot read sites');
select throws_ok('select * from public.clients', '42501', null, 'anon cannot read clients');
select throws_ok('select * from public.monitors', '42501', null, 'anon cannot read monitors');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select * from public.audit_log', '42501', null, 'anon cannot read audit_log');
reset role;

-- ── no active profile reads nothing ──────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'former'));
select is_empty('select * from public.sites', 'inactive profile reads no sites');
select is_empty('select * from public.profiles', 'inactive profile reads no profiles (not even its own)');
select is_empty('select * from public.clients', 'inactive profile reads no clients');
select is_empty('select * from public.monitors', 'inactive profile reads no monitors');
reset role;
select tests.authenticate_as((select id from ids where name = 'no_profile'));
select is_empty('select * from public.sites', 'signed-in user without a profile reads no sites');
reset role;
select tests.authenticate_as((select id from ids where name = 'client_user'));
select is_empty('select * from public.sites', 'client role reads nothing until Phase 3');
reset role;

-- ── viewer: read-only ────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.sites), 2, 'viewer reads all sites');
select is_empty($$ update public.sites set notes = 'x' returning id $$, 'viewer cannot update sites');
select throws_ok(
  $$ insert into public.sites (client_id, name, tier)
     values ('00000000-0000-0000-0000-0000000000c1', 'New', 3) $$,
  '42501', null, 'viewer cannot insert sites');
select is_empty($$ delete from public.sites returning id $$, 'viewer cannot delete sites');
select is_empty($$ update public.monitors set timeout_ms = 5000 returning id $$,
  'viewer cannot update monitors');
select throws_ok($$ select public.write_audit('x', 'y', null) $$, '42501', null,
  'a viewer cannot write the audit log (read-only role)');
reset role;

-- ── stakeholder: read-only in S01 ────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'bua'));
select is((select count(*)::int from public.sites), 2, 'stakeholder reads all sites');
select is_empty($$ update public.sites set muted_until = now() returning id $$,
  'stakeholder cannot mute sites');
reset role;

-- ── responder: mutes own sites through mute_site only (D-012 as amended by D-036) ──
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(
  $$ update public.sites set muted_until = now() + interval '1 hour', mute_reason = 'deploy'
     where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'a direct write of the mute fields is refused (D-036)');
select lives_ok(
  $$ select public.mute_site('00000000-0000-0000-0000-0000000000a1', now() + interval '1 hour', 'deploy') $$,
  'responder can mute a site they own');
select throws_ok(
  $$ update public.sites set name = 'Renamed' where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'responder cannot change other fields of their own site');
select throws_ok(
  $$ select public.mute_site('00000000-0000-0000-0000-0000000000b1', now() + interval '1 hour', 'deploy') $$,
  '42501', null, 'responder cannot mute a site they do not own');
select is_empty($$ update public.monitors set timeout_ms = 5000 returning id $$,
  'responder cannot update monitors');
select throws_ok(
  $$ update public.sites set backup_owner_id = null where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'responder cannot change the owners of their own site');
select throws_ok(
  $$ insert into public.monitors (site_id, type, url)
     values ('00000000-0000-0000-0000-0000000000a1', 'http', 'https://x.pgtap.test') $$,
  '42501', null, 'responder cannot add monitors');
select throws_ok(
  $$ insert into public.clients (name) values ('New client') $$,
  '42501', null, 'responder cannot add clients');
select is_empty(
  $$ update public.profiles set role = 'admin' where id = auth.uid() returning id $$,
  'responder cannot promote themselves');
select ok(public.write_audit('site.mute', 'site', '00000000-0000-0000-0000-0000000000a1') is not null,
  'a signed-in user can write the audit log through write_audit');
select is_empty('select * from public.audit_log', 'only Admins read the audit log');
select throws_ok(
  $$ insert into public.audit_log (action, entity) values ('forged', 'site') $$,
  '42501', null, 'authenticated cannot insert into audit_log directly');
reset role;

-- ── admin: full write ────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'admin'));
select isnt_empty(
  $$ update public.sites set name = 'Site A2'
     where id = '00000000-0000-0000-0000-0000000000a1' returning id $$,
  'admin can change any site field');
select is((select actor_id from public.audit_log where action = 'site.mute' and after is null),
  (select id from ids where name = 'arm'), 'write_audit records the signed-in actor');

-- ── audit_log is append-only ─────────────────────────────────────────────
select throws_ok($$ update public.audit_log set action = 'x' $$, '42501', null,
  'authenticated cannot UPDATE audit_log');
select throws_ok($$ delete from public.audit_log $$, '42501', null,
  'authenticated cannot DELETE audit_log');
reset role;
select throws_ok($$ update public.audit_log set action = 'x' $$, '42501', 'audit_log is append-only',
  'not even the database owner can UPDATE audit_log');
select throws_ok($$ delete from public.audit_log $$, '42501', 'audit_log is append-only',
  'not even the database owner can DELETE from audit_log');

select tests.authenticate_as((select id from ids where name = 'former'));
select throws_ok($$ select public.write_audit('x', 'y', null) $$, '42501', null,
  'a user without an active profile cannot write the audit log');
select is_empty(
  $$ update public.profiles set is_active = true where id = auth.uid() returning id $$,
  'a deactivated user cannot reactivate themselves');
reset role;

set local role service_role;
select throws_ok($$ update public.audit_log set action = 'x' $$, '42501', null,
  'the service role cannot UPDATE audit_log');
select throws_ok($$ delete from public.audit_log $$, '42501', null,
  'the service role cannot DELETE from audit_log');
reset role;

select * from finish();
rollback;
