-- S20 (FR-15, D-072): monthly client reports — every staff role reads, nobody but the reports cron
-- (service role) writes; one draft per client and month; the PDF bucket is private and PDF-only.
begin;
\ir _helpers.psql
select plan(17);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated, service_role;
insert into ids values
  ('tao', tests.create_user('tao@pgtap.test', 'admin')),
  ('arm', tests.create_user('arm@pgtap.test', 'responder')),
  ('ceo', tests.create_user('ceo@pgtap.test', 'stakeholder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer')),
  ('gone', tests.create_user('gone@pgtap.test', 'viewer')),
  ('nobody', tests.create_user('nobody@pgtap.test')),
  ('cli', tests.create_user('cli@pgtap.test', 'client'));
update public.profiles set is_active = false where id = (select id from ids where name = 'gone');
with c as (insert into public.clients (name) values ('pgTAP Airways') returning id)
insert into ids select 'ba', id from c;

-- The cron writes as the service role.
set local role service_role;
insert into public.client_reports (client_id, month, figures, storage_path)
select id, '2026-08-01', '{"uptime":0.9997}', id || '/2026-08.pdf' from ids where name = 'ba';
select is((select count(*)::int from public.client_reports), 1, 'the service role writes a draft');
select throws_ok(
  $$insert into public.client_reports (client_id, month, figures, storage_path)
    select id, '2026-08-01', '{}', id || '/2026-08.pdf' from ids where name = 'ba'$$,
  '23505', null, 'one draft per client and month');
select throws_ok(
  $$insert into public.client_reports (client_id, month, figures, storage_path)
    select id, '2026-08-15', '{}', id || '/2026-08.pdf' from ids where name = 'ba'$$,
  '23514', null, 'the month is its first day');
select throws_ok(
  $$insert into public.client_reports (client_id, month, figures, storage_path)
    select id, '2026-09-01', '{}', gen_random_uuid() || '/2026-09.pdf' from ids where name = 'ba'$$,
  '23514', null, 'the file path is this client''s own <client id>/<YYYY-MM>.pdf only');
reset role;

-- Every active staff role reads.
select tests.authenticate_as((select id from ids where name = 'tao'));
select is((select count(*)::int from public.client_reports), 1, 'an Admin reads it');
select tests.authenticate_as((select id from ids where name = 'arm'));
select is((select count(*)::int from public.client_reports), 1, 'a Responder reads it');
select tests.authenticate_as((select id from ids where name = 'ceo'));
select is((select count(*)::int from public.client_reports), 1, 'a Stakeholder reads it');
select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.client_reports), 1, 'a Viewer reads it');

-- …and nobody writes.
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok(
  $$insert into public.client_reports (client_id, month, figures, storage_path)
    select id, '2026-07-01', '{}', id || '/2026-07.pdf' from ids where name = 'ba'$$,
  '42501', null, 'not even an Admin inserts');
select throws_ok($$update public.client_reports set figures = '{}'$$, '42501', null, 'nor updates');
select throws_ok($$delete from public.client_reports$$, '42501', null, 'nor deletes');

-- No active profile, or no session: nothing.
select tests.authenticate_as((select id from ids where name = 'gone'));
select is((select count(*)::int from public.client_reports), 0, 'a deactivated person reads nothing');
select tests.authenticate_as((select id from ids where name = 'nobody'));
select is((select count(*)::int from public.client_reports), 0, 'someone with no profile reads nothing');
select tests.authenticate_as((select id from ids where name = 'cli'));
select is((select count(*)::int from public.client_reports), 0, 'the Phase 3 client role reads nothing yet');
select tests.as_anon();
select throws_ok($$select count(*) from public.client_reports$$, '42501', null, 'anon is refused');
reset role;

select is(
  (select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'client-reports'),
  '(f,5242880,{application/pdf})', 'the bucket is private, PDF only, 5 MB');
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  0, 'no storage policies: files only through the app');

select * from finish();
rollback;
