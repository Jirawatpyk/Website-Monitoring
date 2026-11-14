-- S16 Users & access (D-062, spec §14.9): invite = an allowlist row, revoke, a role change and a
-- deactivation that won't save until every place the person is used has someone new (Done-when 2),
-- reactivate by inviting again, the Chat id, devices and signing out, my_access 'ended', and the
-- refused sign-in row. Every change writes its audit row.
begin;
\ir _helpers.psql
select plan(75);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
delete from public.oncall_events;
delete from public.oncall_swaps;
delete from public.oncall_shifts;
delete from public.oncall_rotation;
update public.profiles set is_active = false where true;
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('nok',  tests.create_user('nok@pgtap.test', 'responder')),
  ('thee', tests.create_user('thee@pgtap.test', 'stakeholder')),
  ('ceo',  tests.create_user('ceo@pgtap.test', 'stakeholder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
grant execute on function pg_temp.uid(text) to anon, authenticated, service_role;
update public.profiles p set google_chat_user_id = v.chat
  from (values ('tao', '100001'), ('arm', '100002'), ('ploy', '100003'), ('nok', '100004')) v (name, chat)
  where p.id = pg_temp.uid(v.name);

insert into public.clients (id, name, am_user_id, is_internal) values
  ('00000000-0000-0000-0000-0000000000c1', 'Fuji', pg_temp.uid('thee'), false);
-- Nok owns Fuji Links, backs up Fuji Shop (Arm owns it).
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Fuji Links', 1,
   pg_temp.uid('nok'), pg_temp.uid('arm')),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Fuji Shop', 2,
   pg_temp.uid('arm'), pg_temp.uid('nok'));
-- Rotation Nok, Ploy: Nok on call now, Ploy next week, Nok the week after; Ploy asked to swap.
insert into public.oncall_rotation (user_id, position) values (pg_temp.uid('nok'), 1), (pg_temp.uid('ploy'), 2);
insert into public.oncall_shifts (id, user_id, starts_at, ends_at, slot) values
  ('00000000-0000-0000-0000-0000000000f1', pg_temp.uid('nok'), now() - interval '1 day', now() + interval '6 days', 1),
  ('00000000-0000-0000-0000-0000000000f2', pg_temp.uid('ploy'), now() + interval '6 days', now() + interval '13 days', 2),
  ('00000000-0000-0000-0000-0000000000f3', pg_temp.uid('nok'), now() + interval '13 days', now() + interval '20 days', 1);
insert into public.oncall_swaps (requester_shift_id, counterpart_shift_id, requester_id, counterpart_id)
values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3',
        pg_temp.uid('ploy'), pg_temp.uid('nok'));

-- The refusal's detail (the places still waiting), or null when it saved.
create function pg_temp.detail_of(p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return coalesce(v, sqlerrm);
end;
$$;
grant execute on function pg_temp.detail_of(text) to authenticated;

-- A signed-in user on one device (the API's claims carry the session).
create function pg_temp.as_session(p_user uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function pg_temp.as_session(uuid, uuid) to authenticated;

-- ── Invite ────────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('arm'));
select throws_ok($$select public.invite_user('new@pgtap.test', 'responder')$$, '42501',
  'Only an Admin can invite people', 'a Responder can''t invite');
reset role;

select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok($$select public.invite_user('new@gmail.test', 'responder')$$, '22023',
  'Only addresses on the company''s Google Workspace domain can sign in', 'an address off the company domains is refused');
select throws_ok($$select public.invite_user('not an address', 'responder')$$, '22023',
  'Enter their primary Google address, e.g. name@company', 'a malformed address is refused');
select throws_ok($$select public.invite_user('new@pgtap.test', 'client')$$, '22023',
  'Pick Admin, Responder, Stakeholder or Viewer', 'client is Phase 3');
select is(public.invite_user(' New@PGTAP.test ', 'responder'), 'invited', 'an invite is an allowlist row');
select throws_ok($$select public.invite_user('new@pgtap.test', 'viewer')$$, '23505',
  'That address is already invited — revoke it first to pick another role', 'one invite per address');
select throws_ok($$select public.invite_user('arm@pgtap.test', 'viewer')$$, '23505',
  'Arm already has access', 'a person with access isn''t invited again');
reset role;
select is((select role::text from private.allowed_emails where email = 'new@pgtap.test'), 'responder',
  'stored lower-case with the role');
select is((select after from public.audit_log where action = 'user.invite' order by at desc limit 1),
  '{"email": "new@pgtap.test", "role": "responder"}'::jsonb, 'user.invite keeps the company address and role');

-- ── Revoke ────────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok($$select public.revoke_invite('new@pgtap.test', '  ')$$, '22023',
  'Add a short reason — it goes in the audit log', 'revoking needs a reason');
select throws_ok($$select public.revoke_invite('arm@pgtap.test', 'wrong')$$, '55000',
  'They have signed in already — deactivate them instead', 'someone who signed in is deactivated, not revoked');
select lives_ok($$select public.revoke_invite('new@pgtap.test', 'Wrong address')$$, 'an Admin revokes an invite');
reset role;
select ok(not exists (select 1 from private.allowed_emails where email = 'new@pgtap.test'), 'the allowlist row is gone');
select is((select before ->> 'email' from public.audit_log where action = 'user.invite_revoke' order by at desc limit 1),
  'new@pgtap.test', 'user.invite_revoke names the address');

-- ── Change Nok's role: every place first (Done-when 2) ───────────────────
select tests.authenticate_as(pg_temp.uid('nok'));
select throws_ok(format('select public.change_user_role(%L, ''viewer'')', pg_temp.uid('arm')), '42501',
  'Only an Admin can change roles', 'a Responder can''t change roles');
reset role;
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format('select public.change_user_role(%L, ''viewer'')', pg_temp.uid('tao')), '22023',
  'You can''t change your own access — ask another Admin', 'nobody changes their own role');
select throws_ok(format('select public.change_user_role(%L, ''responder'')', pg_temp.uid('nok')), '22023',
  'They are responder already', 'the same role is refused');
select is(pg_temp.detail_of(format('select public.change_user_role(%L, ''stakeholder'')', pg_temp.uid('nok'))),
  'backup:00000000-0000-0000-0000-0000000000a2,owner:00000000-0000-0000-0000-0000000000a1,'
    || 'shift:00000000-0000-0000-0000-0000000000f1,shift:00000000-0000-0000-0000-0000000000f3',
  'Responder → Stakeholder waits for the site, the backup and both shifts (the rotation and the swap need no pick)');
select is(pg_temp.detail_of(format(
  'select public.change_user_role(%L, ''stakeholder'', %L)', pg_temp.uid('nok'),
  jsonb_build_object('owners', jsonb_build_object('00000000-0000-0000-0000-0000000000a1', pg_temp.uid('ploy'))))),
  'backup:00000000-0000-0000-0000-0000000000a2,shift:00000000-0000-0000-0000-0000000000f1,'
    || 'shift:00000000-0000-0000-0000-0000000000f3',
  'one place picked: still refused, nothing saved');
reset role;
select is((select primary_owner_id from public.sites where id = '00000000-0000-0000-0000-0000000000a1'),
  pg_temp.uid('nok'), 'a refused change leaves the site as it was');
select is((select status from public.oncall_swaps limit 1), 'waiting', '… and the swap open');
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format('select public.change_user_role(%L, ''stakeholder'', %L)', pg_temp.uid('nok'),
  jsonb_build_object('owners', jsonb_build_object('00000000-0000-0000-0000-0000000000a1', pg_temp.uid('thee')))),
  'P0001', 'Only an active Admin or Responder can own a site: Thee', 'a new owner must be able to own a site');
select lives_ok(format('select public.change_user_role(%L, ''stakeholder'', %L)', pg_temp.uid('nok'),
  jsonb_build_object(
    'owners', jsonb_build_object('00000000-0000-0000-0000-0000000000a1', pg_temp.uid('ploy')),
    'backups', jsonb_build_object('00000000-0000-0000-0000-0000000000a2', pg_temp.uid('ploy')),
    'shifts', pg_temp.uid('arm'))),
  'with every place picked it saves');
reset role;
select is((select role::text from public.profiles where id = pg_temp.uid('nok')), 'stakeholder', 'Nok is a Stakeholder');
select is((select role::text from private.allowed_emails where email = 'nok@pgtap.test'), 'stakeholder',
  'the allowlist row follows the role');
select is((select primary_owner_id from public.sites where id = '00000000-0000-0000-0000-0000000000a1'),
  pg_temp.uid('ploy'), 'Ploy owns Fuji Links');
select is((select backup_owner_id from public.sites where id = '00000000-0000-0000-0000-0000000000a2'),
  pg_temp.uid('ploy'), 'Ploy backs up Fuji Shop');
select is((select array_agg(user_id order by position) from public.oncall_rotation), array[pg_temp.uid('ploy')],
  'Nok left the rotation, Ploy moved to the top');
select ok(not exists (select 1 from public.oncall_shifts where user_id = pg_temp.uid('nok') and ends_at > now()),
  'Nok has no shift left');
select is((select count(*)::int from public.oncall_shifts where user_id = pg_temp.uid('arm') and ends_at > now()), 2,
  'Arm took the rest of the live shift and the week after');
select is((select status from public.oncall_swaps limit 1), 'admin_declined', 'the open swap closed');
select is((select before || after from public.audit_log where action = 'user.role_change' order by at desc limit 1),
  '{"role": "stakeholder"}'::jsonb, 'user.role_change: before responder, after stakeholder');
select ok(exists (select 1 from public.audit_log where action = 'site.update' and entity_id = '00000000-0000-0000-0000-0000000000a1'),
  'the owner change writes its own site row');

-- ── Deactivate the AM ────────────────────────────────────────────────────
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000e001', pg_temp.uid('thee'), now(), now());
select tests.authenticate_as(pg_temp.uid('tao'));
select is(pg_temp.detail_of(format('select public.deactivate_user(%L)', pg_temp.uid('thee'))),
  'am:00000000-0000-0000-0000-0000000000c1', 'deactivating the AM waits for a new AM');
select throws_ok(format('select public.deactivate_user(%L, %L)', pg_temp.uid('thee'),
  jsonb_build_object('am', pg_temp.uid('mint'))), '22023',
  'A Site AM must be an active Admin, Responder or Stakeholder', 'a Viewer can''t be an AM');
select lives_ok(format('select public.deactivate_user(%L, %L)', pg_temp.uid('thee'),
  jsonb_build_object('am', pg_temp.uid('ceo'))), 'with a new AM it saves');
reset role;
select ok((select not is_active from public.profiles where id = pg_temp.uid('thee')), 'Thee is inactive');
select ok(not exists (select 1 from private.allowed_emails where email = 'thee@pgtap.test'), 'the allowlist row is gone');
select ok((select banned_until > now() + interval '50 years' from auth.users where id = pg_temp.uid('thee')),
  'the auth user is banned');
select ok(not exists (select 1 from auth.sessions where user_id = pg_temp.uid('thee')), 'their sessions are gone');
select is((select am_user_id from public.clients where id = '00000000-0000-0000-0000-0000000000c1'),
  pg_temp.uid('ceo'), 'the client has its new AM');
select is((select after ->> 'devices_signed_out' from public.audit_log where action = 'user.deactivate' order by at desc limit 1),
  '1', 'user.deactivate counts the devices signed out');

-- ── Inviting a deactivated address gives their access back ─────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select is(public.invite_user('thee@pgtap.test', 'viewer'), 'reactivated', 'invited again: reactivated');
reset role;
select ok((select is_active and role = 'viewer' from public.profiles where id = pg_temp.uid('thee')),
  'Thee is back, as a Viewer');
select ok((select banned_until is null from auth.users where id = pg_temp.uid('thee')), 'and no longer banned');

-- ── Google Chat user id (D-015) ──────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('arm'));
select throws_ok(format('select public.set_chat_user_id(%L, ''987'')', pg_temp.uid('ploy')), '42501',
  'Only an Admin can change someone else''s Chat id', 'a Responder edits only their own');
select throws_ok(format('select public.set_chat_user_id(%L, ''12a'')', pg_temp.uid('arm')), '22023',
  'A Chat user id is digits only', 'digits only');
select throws_ok(format('select public.set_chat_user_id(%L, '''')', pg_temp.uid('arm')), '55000',
  'Owners of live sites need a Chat id: Fuji Links, Fuji Shop', 'an owner of a live site can''t clear it');
select lives_ok(format('select public.set_chat_user_id(%L, '' 765432 '')', pg_temp.uid('arm')), 'a person sets their own');
reset role;
select is((select after from public.audit_log where action = 'profile.chat_id' order by at desc limit 1),
  '{"change": "changed"}'::jsonb, 'profile.chat_id keeps no digits');

-- ── Devices and signing out (Done-when 3, SQL half) ─────────────────────
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent) values
  ('00000000-0000-0000-0000-00000000e101', pg_temp.uid('arm'), now() - interval '2 days', now(), 'Laptop'),
  ('00000000-0000-0000-0000-00000000e102', pg_temp.uid('arm'), now() - interval '1 day', now(), 'Phone'),
  ('00000000-0000-0000-0000-00000000e103', pg_temp.uid('arm'), now() - interval '1 hour', now(), 'Tablet');
select pg_temp.as_session(pg_temp.uid('arm'), '00000000-0000-0000-0000-00000000e101');
select is((select count(*)::int from public.list_sessions(pg_temp.uid('arm')) where is_current), 1, 'this device is marked');
select throws_ok($$select public.sign_out_my_device('00000000-0000-0000-0000-00000000e101')$$, '22023',
  'That''s this device — use Sign out', 'this device signs out with the Sign out button');
select lives_ok($$select public.sign_out_my_device('00000000-0000-0000-0000-00000000e102')$$, 'one other device');
select is(public.sign_out_my_other_devices(), 1, 'every other device: the tablet');
reset role;
select is((select array_agg(id) from auth.sessions where user_id = pg_temp.uid('arm')),
  array['00000000-0000-0000-0000-00000000e101'::uuid], 'this device stays signed in');
select is((select after from public.audit_log where action = 'session.sign_out_others' order by at desc limit 1),
  '{"devices": 1}'::jsonb, 'session.sign_out_others counts the devices');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000e104', pg_temp.uid('arm'), now(), now());
select pg_temp.as_session(pg_temp.uid('ploy'), null);
select throws_ok(format('select * from public.list_sessions(%L)', pg_temp.uid('arm')), '42501',
  'Only an Admin can see someone else''s devices', 'only an Admin sees another person''s devices');
reset role;
select tests.authenticate_as(pg_temp.uid('tao'));
select is(public.sign_out_user_everywhere(pg_temp.uid('arm')), 2, 'an Admin signs Arm out everywhere');
reset role;
select pg_temp.as_session(pg_temp.uid('arm'), '00000000-0000-0000-0000-00000000e101');
select is((select status from public.my_access()), 'ended', 'a token whose session is gone reads ended');
reset role;
select tests.authenticate_as(pg_temp.uid('arm'));
select is((select status from public.my_access()), 'active', 'a token without a session claim is not checked');
reset role;
select is((select count(*)::int from public.audit_log where action in ('session.sign_out_device', 'session.sign_out_all')
  and entity_id = pg_temp.uid('arm')), 2, 'each sign-out writes its row');

-- ── The rotation: never empty, and nobody skipped after a removal (db review M3, M4) ──
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format('select public.deactivate_user(%L, %L)', pg_temp.uid('ploy'), jsonb_build_object(
    'owners', jsonb_build_object('00000000-0000-0000-0000-0000000000a1', pg_temp.uid('tao')),
    'backups', jsonb_build_object('00000000-0000-0000-0000-0000000000a2', pg_temp.uid('tao')),
    'shifts', pg_temp.uid('arm'))), '55000',
  'They are the only person in the on-call rotation — add someone on On-call first', 'the rotation never ends up empty');
reset role;
insert into ids values ('beam', tests.create_user('beam@pgtap.test', 'responder')),
                       ('cher', tests.create_user('cher@pgtap.test', 'responder'));
insert into public.oncall_rotation (user_id, position) values (pg_temp.uid('beam'), 2), (pg_temp.uid('cher'), 3);
-- The last week made was Beam's (slot 2).
insert into public.oncall_shifts (user_id, starts_at, ends_at, slot)
values (pg_temp.uid('beam'), now() + interval '20 days', now() + interval '27 days', 2);
select tests.authenticate_as(pg_temp.uid('tao'));
select lives_ok(format('select public.deactivate_user(%L, %L)', pg_temp.uid('beam'),
  jsonb_build_object('shifts', pg_temp.uid('ploy'))), 'Beam (rotation, a week ahead) is deactivated');
reset role;
select is((select array_agg(user_id order by position) from public.oncall_rotation),
  array[pg_temp.uid('ploy'), pg_temp.uid('cher')], 'Ploy, Cher keep their order');
select is((select user_id from public.oncall_shifts where starts_at = now() + interval '20 days'), pg_temp.uid('ploy'),
  'Beam''s week went to Ploy');
select public.oncall_extend_shifts(now() + interval '30 days');
select is((select user_id from public.oncall_shifts where starts_at = now() + interval '27 days'), pg_temp.uid('cher'),
  'the next week made goes to Cher, who came after Beam — nobody is skipped');

-- ── A signed-out session stops the Admin functions too (security review L1) ──
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000e201', pg_temp.uid('tao'), now(), now());
select pg_temp.as_session(pg_temp.uid('tao'), '00000000-0000-0000-0000-00000000e201');
select is((select status from public.my_access()), 'active', 'a live session reads active');
reset role;
delete from auth.sessions where id = '00000000-0000-0000-0000-00000000e201';
select pg_temp.as_session(pg_temp.uid('tao'), '00000000-0000-0000-0000-00000000e201');
select throws_ok($$select public.invite_user('late@pgtap.test', 'viewer')$$, '42501',
  'Only an Admin can invite people', 'a token whose session is gone can''t act as an Admin');
reset role;
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok($$select public.sign_out_my_other_devices()$$, '42501', 'Sign in again to continue',
  'without a session claim "this device" is unknown: nothing is signed out');
-- One Chat id per person (security review L2).
select throws_ok(format('select public.set_chat_user_id(%L, ''100003'')', pg_temp.uid('tao')), '23505',
  'That Chat id belongs to someone else', 'a Chat id already in use is refused');
reset role;
select is((select count(*)::int from public.audit_log where action = 'user.deactivate' and entity_id = pg_temp.uid('beam')), 1,
  'Beam''s deactivation is logged');
select ok(exists (select 1 from public.audit_log where action = 'oncall.rotation' and after ->> 'note' = 'Beam was deactivated'),
  'and so is the rotation change');

-- ── A refused sign-in is logged (D-062 item 7) ──────────────────────────
select is(public.hook_before_user_created('{"user": {"email": "stranger@pgtap.test", "app_metadata": {"provider": "google"}}}')
  -> 'error' ->> 'http_code', '403', 'an address not on the list is refused');
select is((select after from public.audit_log where action = 'signin.refused' and after ->> 'email' = 'stranger@pgtap.test'),
  '{"email": "stranger@pgtap.test", "reason": "not_invited"}'::jsonb, 'with the company address');
select public.hook_before_user_created('{"user": {"email": "someone@gmail.test", "app_metadata": {"provider": "google"}}}');
select is((select after from public.audit_log where action = 'signin.refused' and after ->> 'domain' = 'gmail.test'),
  '{"domain": "gmail.test", "reason": "domain"}'::jsonb, 'off the company domains: the domain only');

select * from finish();
rollback;
