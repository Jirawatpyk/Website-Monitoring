-- D-078 PR 3a (spec §43): the `management` ladder token. The editor's guardrails (Tier 1 DOWN only, from
-- L2, no voice, someone tagged); `admins` leaves Management out on every policy while `every_admin`
-- (the client-update noAm mention) keeps them; L1 leaves Vee out, L2 @mentions Vee; the last Management
-- person can't go while a step names Management (§43.5).
begin;
\ir _helpers.psql
select plan(20);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
delete from public.oncall_events;
delete from public.oncall_swaps;
delete from public.oncall_shifts;
delete from public.oncall_rotation;
update public.profiles set is_active = false where role in ('admin', 'stakeholder');
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('vee',  tests.create_user('vee@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('bua',  tests.create_user('bua@pgtap.test', 'stakeholder')),
  ('ceo',  tests.create_user('ceo@pgtap.test', 'stakeholder'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
grant execute on function pg_temp.uid(text) to anon, authenticated, service_role;
update public.profiles p set google_chat_user_id = v.chat
  from (values ('tao', '300001'), ('vee', '300002'), ('arm', '300003'), ('ploy', '300004'), ('bua', '300005'),
               ('ceo', '300006')) v (name, chat)
  where p.id = pg_temp.uid(v.name);

insert into public.clients (id, name, am_user_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'Client A', pg_temp.uid('bua'));
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id)
select v.id, '00000000-0000-0000-0000-0000000000c1', v.name, v.tier, pg_temp.uid('arm'), pg_temp.uid('ploy')
from (values ('00000000-0000-0000-0000-0000000000a1'::uuid, 'Site A', 1::smallint),
             ('00000000-0000-0000-0000-0000000000b1'::uuid, 'Site B', 2::smallint)) v (id, name, tier);

create temp table pol (name text primary key, id uuid) on commit drop;
grant select on pol to anon, authenticated;
insert into pol select 'down' || tier, id from public.escalation_policies where severity = 'down';
create function pg_temp.step(p_level int, p_delay int, p_targets text[], p_channels text[], p_fyi boolean default false)
returns jsonb language sql as $$
  select jsonb_build_object('level', p_level, 'delayMin', p_delay, 'targets', p_targets, 'channels', p_channels, 'fyi', p_fyi);
$$;
create function pg_temp.policy(p_name text, p_steps jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('policyId', (select id from pol where name = p_name), 'steps', p_steps));
$$;
grant execute on function pg_temp.step(int, int, text[], text[], boolean) to authenticated;
grant execute on function pg_temp.policy(text, jsonb) to authenticated;
-- Tier 1 DOWN with L2 = Management (the §43.1 ladder)
create function pg_temp.t1_management(p_l2_channels text[] default array['chat', 'email']) returns jsonb language sql as $$
  select pg_temp.policy('down1', jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email']),
    pg_temp.step(2, 30, array['management'], p_l2_channels),
    pg_temp.step(3, 60, array['ceo', 'site_am'], array['chat', 'email'], true)));
$$;
grant execute on function pg_temp.t1_management(text[]) to authenticated;

-- ── Guardrails (§43.9) ────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.t1_management()),
  '22023', 'Nobody is Management yet — set someone on Users & roles', 'nobody tagged: refused');
reset role;
update public.profiles set is_management = true where id = pg_temp.uid('vee');
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.policy('down2', jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email']),
    pg_temp.step(2, 30, array['management'], array['chat', 'email'])))),
  '22023', 'Management is used only on Tier 1 DOWN', 'not on Tier 2');
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.policy('down1', jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'management'], array['chat', 'email']),
    pg_temp.step(2, 30, array['admins'], array['chat', 'email']),
    pg_temp.step(3, 60, array['ceo', 'site_am'], array['chat', 'email'], true)))),
  '22023', 'Management can be told only from L2', 'not before L2');
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$,
    pg_temp.t1_management(array['chat', 'email', 'voice'])),
  '22023', 'No voice on a Management step — they''re told by Chat @mention + email.', 'no voice');
select lives_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'D-078')$$, pg_temp.t1_management()),
  'Tier 1 DOWN L2 → Management saves');
reset role;

-- ── Who the tokens name (3a) ──────────────────────────────────────────────
create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated, service_role;
insert into inc values
  ('a', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
     now() - interval '31 minutes', now() - interval '30 minutes', now(), '{}', true)),
  ('b', public.engine_open_incident('00000000-0000-0000-0000-0000000000b1', null, 'hard_fail', 'down',
     now() - interval '31 minutes', now() - interval '30 minutes', now(), '{}', true));
select is((select array_agg(user_id) from public.escalation_people((select id from inc where name = 'a'), '["admins"]')),
  array[pg_temp.uid('tao')], 'Tier 1: the ladder''s Admins leave Management out');
select is((select array_agg(user_id) from public.escalation_people((select id from inc where name = 'b'), '["admins"]')),
  array[pg_temp.uid('tao')], 'Tier 2 too (3a)');
select is((select array_agg(user_id) from public.escalation_people((select id from inc where name = 'a'), '["management"]')),
  array[pg_temp.uid('vee')], 'the management token names Vee');
select is((select count(*)::int from public.escalation_people((select id from inc where name = 'a'), '["every_admin"]')),
  2, 'every_admin (the client-update noAm mention) still names both Admins');

-- ── The ladder: L1 without Vee, L2 to Vee ─────────────────────────────────
set local role service_role;
select ok(public.engine_fire_step((select id from inc where name = 'a'), 1::smallint, now(), '{"elapsedMin":15}'), 'L1');
select ok(public.engine_fire_step((select id from inc where name = 'a'), 2::smallint, now(), '{"elapsedMin":30}'), 'L2');
reset role;
select ok(not exists (select 1 from public.notifications where incident_id = (select id from inc where name = 'a')
                        and dedupe_key = 'down:L1' and user_id = pg_temp.uid('vee')),
  'L1 tells the backup and Tao, not Vee');
select is((select payload->'mentioned' from public.incident_events
           where incident_id = (select id from inc where name = 'a') and type = 'step_fired' and payload->>'level' = '2'),
  jsonb_build_array(pg_temp.uid('vee')), 'L2 @mentions Management');

-- ── The last Management person can't go while a step names it (§43.5) ─────
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_like(format($$select public.set_management(%L, false, 'leaving')$$, pg_temp.uid('vee')),
  'Can''t remove: Tier 1 DOWN L2 goes to Management and % is the last one.%', 'remove refused');
select throws_like(format($$select public.change_user_role(%L, 'responder')$$, pg_temp.uid('vee')),
  'Can''t remove: Tier 1 DOWN L2 goes to Management%', 'a role change refused too');
select throws_like(format($$select public.deactivate_user(%L)$$, pg_temp.uid('vee')),
  'Can''t remove: Tier 1 DOWN L2 goes to Management%', 'a deactivation refused too (db review)');
-- every_admin is never a policy token (db review)
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.policy('down1', jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'every_admin'], array['chat', 'email']),
    pg_temp.step(2, 30, array['management'], array['chat', 'email']),
    pg_temp.step(3, 60, array['ceo', 'site_am'], array['chat', 'email'], true)))),
  '22023', 'Unknown person or channel', 'every_admin refused in a policy');
-- With Tao tagged too, Vee can go: someone is left (the allow branch)
reset role;
update public.profiles set is_management = true where id = pg_temp.uid('tao');
select tests.authenticate_as(pg_temp.uid('tao'));
select lives_ok(format($$select public.set_management(%L, false, 'Tao stays')$$, pg_temp.uid('vee')),
  'removal allowed while another Management person remains');
reset role;

-- ── The client-update noAm mention still reaches every Admin (3a) ─────────
update public.clients set am_user_id = null where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set is_management = true where id = pg_temp.uid('vee');
update public.profiles set is_management = false where id = pg_temp.uid('tao');
select is((select count(*)::int from public.escalation_people((select id from inc where name = 'a'), '["every_admin"]')),
  2, 'noAm: Tao and Vee (Management) both');

-- ── The role-change email says the tag went with the role (PR 3b) ─────────
update public.profiles set is_management = true where id = pg_temp.uid('tao');
select tests.authenticate_as(pg_temp.uid('tao'));
select public.change_user_role(pg_temp.uid('vee'), 'responder');
reset role;
select is((select facts->'left_management' from public.account_events
           where user_id = pg_temp.uid('vee') and kind = 'role_changed'),
  'true'::jsonb, 'role change away from Admin: left_management');

select * from finish();
rollback;
