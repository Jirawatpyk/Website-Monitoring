-- Schema behaviour: updated_at triggers, constraints, delete rules, audit_log TRUNCATE.
begin;
\ir _helpers.psql
select plan(9);

delete from public.monitors;
delete from public.sites;
delete from public.clients;
create temp table ids (name text primary key, id uuid) on commit drop;
insert into ids values
  ('arm', tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder'));
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
        (select id from ids where name = 'arm'));
insert into public.monitors (site_id, type, is_primary, url)
values ('00000000-0000-0000-0000-0000000000a1', 'http', true, 'https://a.pgtap.test');

-- now() is fixed inside a transaction, so compare against a back-dated value
update public.sites set updated_at = '2000-01-01' where id = '00000000-0000-0000-0000-0000000000a1';
select ok((select updated_at > '2000-01-02' from public.sites
           where id = '00000000-0000-0000-0000-0000000000a1'), 'updated_at is set on every update');

select throws_ok(
  $$ insert into public.monitors (site_id, type, is_primary, url)
     values ('00000000-0000-0000-0000-0000000000a1', 'http', true, 'https://b.pgtap.test') $$,
  '23505', null, 'a site has at most one primary monitor');
select lives_ok(
  $$ insert into public.monitors (site_id, type, is_primary, url)
     values ('00000000-0000-0000-0000-0000000000a1', 'ssl', false, 'https://a.pgtap.test') $$,
  'a site can have more non-primary monitors');
select throws_ok(
  $$ update public.sites set backup_owner_id = primary_owner_id
     where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'primary and backup owner must be different people');
select throws_ok(
  $$ insert into public.monitors (site_id, type, url)
     values ('00000000-0000-0000-0000-0000000000a1', 'http', 'ftp://x') $$,
  '23514', null, 'monitor URLs are http(s) only');
select throws_ok(
  $$ delete from public.sites where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23503', null, 'a site with monitors cannot be deleted by accident');
select throws_ok(
  $$ delete from public.profiles where id = (select id from ids where name = 'arm') $$,
  '23503', null, 'a profile that owns a site cannot be deleted (reassign first)');
select throws_ok(
  $$ delete from public.clients where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '23503', null, 'a client with sites cannot be deleted');
select throws_ok($$ truncate public.audit_log $$, '42501', 'audit_log is append-only',
  'audit_log cannot be truncated');

select * from finish();
rollback;
