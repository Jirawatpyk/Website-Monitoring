-- S05 sites and monitors (FR-01, D-015, D-025): one audit row per change, the owner Chat-id rule,
-- the registration checklist at Start, Draft delete, monitor remove, and who may call the RPCs.
begin;
\ir _helpers.psql
select plan(41);

-- The ready-to-monitor check runs at commit and a test never commits: pg_temp.run fires the deferred
-- checks right after the statement, as a commit would.
create function pg_temp.run(p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated;
insert into ids values
  ('admin',   tests.create_user('admin@pgtap.test', 'admin')),
  ('arm',     tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy',    tests.create_user('ploy@pgtap.test', 'responder')),
  ('nok',     tests.create_user('nok@pgtap.test', 'responder')),
  ('bua',     tests.create_user('bua@pgtap.test', 'stakeholder'));
update public.profiles set google_chat_user_id = '1001' where id = (select id from ids where name = 'arm');
update public.profiles set google_chat_user_id = '1002' where id = (select id from ids where name = 'ploy');
update public.profiles set display_name = 'Nok' where id = (select id from ids where name = 'nok');

insert into public.clients (id, name, am_user_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'Client A', (select id from ids where name = 'bua'));
insert into public.clients (id, name, is_internal) values
  ('00000000-0000-0000-0000-0000000000c2', 'Internal', true);
insert into public.clients (id, name) values
  ('00000000-0000-0000-0000-0000000000c3', 'No AM yet');

create function pg_temp.site(p_name text, p_client text, p_primary text, p_backup text,
                             p_hosting text default 'Host', p_cred text default 'Vault › x')
returns jsonb language sql as $$
  select jsonb_build_object(
    'client_id', p_client, 'name', p_name, 'tier', 2,
    'primary_owner_id', (select id from ids where name = p_primary),
    'backup_owner_id', (select id from ids where name = p_backup),
    'hosting', p_hosting, 'credential_ref', p_cred)
$$;
create function pg_temp.mons(p_url text, p_keyword text default 'Brand')
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'is_primary', true, 'url', p_url,
    'must_contain', case when p_keyword is null then '[]'::jsonb else jsonb_build_array(p_keyword) end))
$$;
create temp table made (name text primary key, id uuid) on commit drop;
grant all on made to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

-- ── Who may call ─────────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(
  $$ select pg_temp.run($q$ select public.create_site(pg_temp.site('X', '00000000-0000-0000-0000-0000000000c1', 'arm', 'ploy'),
                               pg_temp.mons('https://x.pgtap.test/')) $q$) $$,
  '42501', null, 'a Responder cannot add a site');
reset role;
select tests.authenticate_as((select id from ids where name = 'bua'));
select throws_ok($$ select pg_temp.run($q$ select public.delete_site(gen_random_uuid()) $q$) $$, '42501', null,
  'a Stakeholder cannot delete a site');
reset role;

-- ── Create: one audit row per row, actor = the Admin ─────────────────────
select tests.authenticate_as((select id from ids where name = 'admin'));
select pg_temp.run($q$ insert into made values ('a', public.create_site(
  pg_temp.site('Site A', '00000000-0000-0000-0000-0000000000c1', 'arm', 'ploy'),
  pg_temp.mons('https://a.pgtap.test/') || jsonb_build_array(
    jsonb_build_object('is_primary', false, 'url', 'https://a.pgtap.test/contact')),
  true)) $q$);
reset role;

select is((select count(*)::int from public.audit_log
           where action = 'site.create' and entity_id = (select id from made where name = 'a')), 1,
  'creating a site writes one site.create row');
select is((select count(*)::int from public.audit_log a join public.monitors m on m.id = a.entity_id
           where a.action = 'monitor.create' and m.site_id = (select id from made where name = 'a')), 2,
  'each new monitor writes one monitor.create row');
select ok((select before is null and after ->> 'name' = 'Site A' and after ->> 'is_active' = 'true'
           from public.audit_log where action = 'site.create'
             and entity_id = (select id from made where name = 'a')),
  'site.create has no before and the new row as after');
select is((select actor_id from public.audit_log where action = 'site.create'
             and entity_id = (select id from made where name = 'a')),
          (select id from ids where name = 'admin'), 'the actor is the signed-in Admin');
select ok((select monitoring_started_at is not null from public.sites where id = (select id from made where name = 'a')),
  'starting stamps monitoring_started_at');

-- ── Update: before / after; a no-op writes nothing ───────────────────────
select tests.authenticate_as((select id from ids where name = 'admin'));
select lives_ok($$ select pg_temp.run($q$ select public.update_site((select id from made where name = 'a'),
  pg_temp.site('Site A', '00000000-0000-0000-0000-0000000000c1', 'arm', 'ploy', 'New host')) $q$) $$,
  'an Admin edits a site');
select lives_ok($$ select pg_temp.run($q$ select public.update_site((select id from made where name = 'a'),
  pg_temp.site('Site A', '00000000-0000-0000-0000-0000000000c1', 'arm', 'ploy', 'New host')) $q$) $$,
  'saving the same values again is fine');
reset role;
select is((select count(*)::int from public.audit_log
           where action = 'site.update' and entity_id = (select id from made where name = 'a')), 1,
  'an edit writes one site.update row; the no-op save writes none');
select ok((select before ->> 'hosting' = 'Host' and after ->> 'hosting' = 'New host' from public.audit_log
           where action = 'site.update' and entity_id = (select id from made where name = 'a')),
  'site.update carries before and after');

-- ── Script writes: audited with no actor ─────────────────────────────────
select set_config('request.jwt.claims', '', true);  -- a SQL editor session carries no JWT
update public.clients set language = 'th' where id = '00000000-0000-0000-0000-0000000000c3';
select ok((select actor_id is null from public.audit_log
           where action = 'client.update' and entity_id = '00000000-0000-0000-0000-0000000000c3'),
  'a change from a SQL script is audited with no actor');

-- ── D-015: owners need a Chat id; a Draft may leave them empty ───────────
select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok(
  $$ select pg_temp.run($q$ select public.create_site(pg_temp.site('B', '00000000-0000-0000-0000-0000000000c2', 'arm', 'nok'),
                               pg_temp.mons('https://b.pgtap.test/')) $q$) $$,
  'P0001', 'Owners need a Google Chat id: Nok', 'a backup without a Chat id is refused and named');
select throws_ok(
  $$ select pg_temp.run($q$ select public.create_site(pg_temp.site('B', '00000000-0000-0000-0000-0000000000c2', 'bua', 'arm'),
                               pg_temp.mons('https://b.pgtap.test/')) $q$) $$,
  'P0001', null, 'a Stakeholder cannot own a site');
select pg_temp.run($q$ insert into made values ('draft', public.create_site(
  jsonb_build_object('client_id', '00000000-0000-0000-0000-0000000000c2', 'name', 'Draft', 'tier', 3),
  pg_temp.mons('https://draft.pgtap.test/', null))) $q$);
select ok((select not is_active and primary_owner_id is null from public.sites
           where id = (select id from made where name = 'draft')),
  'a Draft saves with empty owners, no keyword, hosting or vault');
select throws_ok($$ select pg_temp.run($q$ select public.set_site_monitoring((select id from made where name = 'draft'), true) $q$) $$,
  'P0001', 'Not ready to monitor: Brand keyword, Primary owner, Backup owner, Hosting provider, Credential reference',
  'Start is refused and lists what is missing');
select throws_ok($$ select pg_temp.run($q$ select public.update_site((select id from made where name = 'a'),
  pg_temp.site('Site A', '00000000-0000-0000-0000-0000000000c1', 'arm', 'nok')) $q$) $$,
  'P0001', 'Owners need a Google Chat id: Nok', 'an edit to an owner without a Chat id is refused');
select throws_ok($$ select pg_temp.run($q$ select public.update_site((select id from made where name = 'a'),
  pg_temp.site('Site A', '00000000-0000-0000-0000-0000000000c1', 'arm', null)) $q$) $$,
  'P0001', 'Not ready to monitor: Backup owner', 'a live site cannot lose its backup');
reset role;

-- ── Start needs the AM on a client site ──────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok(
  $$ select pg_temp.run($q$ select public.create_site(pg_temp.site('C', '00000000-0000-0000-0000-0000000000c3', 'arm', 'ploy'),
                               pg_temp.mons('https://c.pgtap.test/'), true) $q$) $$,
  'P0001', 'Not ready to monitor: Account manager', 'a client without an AM cannot start');
select lives_ok(
  $$ select pg_temp.run($q$ insert into made values ('internal', public.create_site(
       pg_temp.site('Internal site', '00000000-0000-0000-0000-0000000000c2', 'ploy', 'arm'),
       pg_temp.mons('https://internal.pgtap.test/'), true)) $q$) $$,
  'an internal site needs no AM');

-- ── Duplicate primary URL ────────────────────────────────────────────────
select throws_ok(
  $$ select pg_temp.run($q$ select public.create_site(pg_temp.site('Dup', '00000000-0000-0000-0000-0000000000c2', 'arm', 'ploy'),
                               pg_temp.mons('https://A.pgtap.test')) $q$) $$,
  '23505', null, 'the same primary URL (case, trailing slash) is refused');

-- ── Monitors: key-page cap, primary stays, remove with / without history ──
select throws_ok(
  $$ select pg_temp.run($q$ select public.save_monitors((select id from made where name = 'a'), jsonb_build_array(
       jsonb_build_object('url', 'https://a.pgtap.test/1'), jsonb_build_object('url', 'https://a.pgtap.test/2'),
       jsonb_build_object('url', 'https://a.pgtap.test/3')), '{}') $q$) $$,
  'P0001', 'At most 3 key pages per site', 'a fourth key page is refused');
select throws_ok(
  $$ select pg_temp.run($q$ select public.save_monitors((select id from made where name = 'a'), '[]',
       array[(select id from public.monitors where site_id = (select id from made where name = 'a') and is_primary)]) $q$) $$,
  'P0001', 'The primary monitor can''t be removed', 'the primary cannot be removed');
select throws_ok(
  $$ select pg_temp.run($q$ select public.save_monitors((select id from made where name = 'a'), jsonb_build_array(jsonb_build_object(
       'id', (select id from public.monitors where site_id = (select id from made where name = 'a') and is_primary),
       'url', 'https://a.pgtap.test/', 'must_contain', '[]'::jsonb)), '{}') $q$) $$,
  'P0001', 'Not ready to monitor: Brand keyword', 'a live site keeps its brand keyword');
reset role;

-- History on the key page: one check result.
insert into public.check_results (monitor_id, location, checked_at, outcome)
select id, 'SIN', now(), 'pass' from public.monitors
where site_id = (select id from made where name = 'a') and not is_primary;

select tests.authenticate_as((select id from ids where name = 'admin'));
select lives_ok(
  $$ select pg_temp.run($q$ select public.save_monitors((select id from made where name = 'a'), '[]',
       array(select id from public.monitors where site_id = (select id from made where name = 'a') and not is_primary)) $q$) $$,
  'removing a key page with history works');
reset role;
select ok((select removed_at is not null and not enabled from public.monitors
           where site_id = (select id from made where name = 'a') and not is_primary),
  'a key page with history is kept, removed and off');
select is((select count(*)::int from public.audit_log a join public.monitors m on m.id = a.entity_id
           where a.action = 'monitor.update' and m.site_id = (select id from made where name = 'a')
             and a.after ->> 'removed_at' is not null), 1,
  'the removal writes one monitor.update row');

select tests.authenticate_as((select id from ids where name = 'admin'));
select lives_ok(
  $$ select pg_temp.run($q$ select public.save_monitors((select id from made where name = 'internal'),
       jsonb_build_array(jsonb_build_object('url', 'https://internal.pgtap.test/x')), '{}') $q$) $$,
  'an Admin adds a key page');
select lives_ok(
  $$ select pg_temp.run($q$ select public.save_monitors((select id from made where name = 'internal'), '[]',
       array(select id from public.monitors where site_id = (select id from made where name = 'internal') and not is_primary)) $q$) $$,
  'removing a key page without history works');
reset role;
select is((select count(*)::int from public.monitors
           where site_id = (select id from made where name = 'internal') and not is_primary), 0,
  'a key page without history is deleted');
select ok(exists (select 1 from public.audit_log where action = 'monitor.delete' and before ->> 'url' = 'https://internal.pgtap.test/x'),
  'the delete writes monitor.delete with the old row as before');

-- ── Stop, then delete ────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok($$ select pg_temp.run($q$ select public.delete_site((select id from made where name = 'a')) $q$) $$,
  'P0001', 'Stop monitoring before deleting', 'a live site cannot be deleted');
select lives_ok($$ select pg_temp.run($q$ select public.set_site_monitoring((select id from made where name = 'a'), false) $q$) $$,
  'Stop monitoring returns a site to Draft');
select throws_ok($$ select pg_temp.run($q$ select public.delete_site((select id from made where name = 'a')) $q$) $$,
  'P0001', 'The site has monitoring history and stays for the record', 'a stopped site with history stays');
select lives_ok($$ select pg_temp.run($q$ select public.delete_site((select id from made where name = 'draft')) $q$) $$,
  'a Draft without history is deleted');
reset role;
select is((select count(*)::int from public.audit_log
           where action = 'site.delete' and entity_id = (select id from made where name = 'draft')), 1,
  'deleting a site writes one site.delete row');

-- ── Responder mute on a live site is not re-checked (D-012) ──────────────
update public.sites set primary_owner_id = (select id from ids where name = 'arm'),
  backup_owner_id = (select id from ids where name = 'nok')
  where id = (select id from made where name = 'internal');  -- a script: not limited
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok($$ select public.mute_site((select id from made where name = 'internal'),
                     now() + interval '1 hour', 'Deploy') $$,
  'an owner can still mute a live site whose backup has no Chat id');
reset role;

-- ── A monitor with an open incident stays; refused headers never reach the table ──
select set_config('request.jwt.claims', '', true);  -- a script puts linked owners back
update public.sites set primary_owner_id = (select id from ids where name = 'ploy'),
  backup_owner_id = (select id from ids where name = 'arm') where id = (select id from made where name = 'internal');
select tests.authenticate_as((select id from ids where name = 'admin'));
select pg_temp.run($q$ select public.save_monitors((select id from made where name = 'internal'),
  jsonb_build_array(jsonb_build_object('url', 'https://internal.pgtap.test/y')), '{}') $q$);
reset role;
insert into public.incidents (site_id, monitor_id, state, severity, episode_severity, trigger, started_at, detected_at)
select (select id from made where name = 'internal'), m.id, 'unacked', 'problem', 'problem', 'key_page', now(), now()
from public.monitors m where m.url = 'https://internal.pgtap.test/y';
select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok(
  $$ select pg_temp.run($q$ select public.save_monitors((select id from made where name = 'internal'), '[]',
       array(select id from public.monitors where url = 'https://internal.pgtap.test/y')) $q$) $$,
  'P0001', 'This monitor has an open incident — resolve it first', 'a key page with an open incident cannot be removed');
select throws_ok(
  $$ select pg_temp.run($q$ select public.save_monitors((select id from made where name = 'internal'),
       jsonb_build_array(jsonb_build_object('url', 'https://internal.pgtap.test/z',
         'headers', jsonb_build_array(jsonb_build_object('name', 'X-Api-Key', 'value', 'k')))), '{}') $q$) $$,
  'P0001', 'A custom header can''t set that name or value', 'save_monitors refuses a credential-like header name');
reset role;
select set_config('request.jwt.claims', '', true);

select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok(
  $$ update public.monitors set headers = '[{"name": "Cookie", "value": "x"}]'
     where site_id = (select id from made where name = 'internal') and is_primary $$,
  'P0001', 'A custom header can''t set that name or value', 'a direct update cannot store a refused header either');
reset role;
select set_config('request.jwt.claims', '', true);

-- ── Edit site keeps notes it doesn't send ────────────────────────────────
select set_config('request.jwt.claims', '', true);  -- a SQL script
update public.sites set notes = 'Keep me' where id = (select id from made where name = 'internal');
select tests.authenticate_as((select id from ids where name = 'admin'));
select pg_temp.run($q$ select public.update_site((select id from made where name = 'internal'),
  pg_temp.site('Internal site', '00000000-0000-0000-0000-0000000000c2', 'ploy', 'arm', 'Host 2')) $q$);
reset role;
select is((select notes from public.sites where id = (select id from made where name = 'internal')), 'Keep me',
  'update_site leaves notes alone when the form has no notes field');

select * from finish();
rollback;
