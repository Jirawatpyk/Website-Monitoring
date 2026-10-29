-- Escalation L2–L3 (S10, D-048; spec §8, §14.1, §14.7, §15.5, §16.5): the seeded L2 / L3 steps, the
-- editor's guardrails (Done-when 2), the CEO token, L2 to the CEO, the Tier 1 L3 FYI that still goes
-- after an ack and not after a recovery (T05), the Tier 2–3 L2 reminder to the Admin, an ack leaving
-- a queued FYI alone, and a muted site still getting its L3 FYI (T09 re-check, Done-when 4).
begin;
\ir _helpers.psql
select plan(36);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
update public.profiles set is_active = false where role in ('admin', 'stakeholder');
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('bua',  tests.create_user('bua@pgtap.test', 'stakeholder')),
  ('ceo',  tests.create_user('ceo@pgtap.test', 'stakeholder'));

insert into public.clients (id, name, am_user_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'Client A', (select id from ids where name = 'bua'));
-- A, M (Tier 1) and B (Tier 2): Arm owns, Ploy backs up, Bua is the AM.
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id)
select v.id, '00000000-0000-0000-0000-0000000000c1', v.name, v.tier,
       (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')
from (values ('00000000-0000-0000-0000-0000000000a1'::uuid, 'Site A', 1::smallint),
             ('00000000-0000-0000-0000-0000000000a2'::uuid, 'Site M', 1::smallint),
             ('00000000-0000-0000-0000-0000000000b1'::uuid, 'Site B', 2::smallint)) v (id, name, tier);

create temp table pol (name text primary key, id uuid) on commit drop;
grant select on pol to anon, authenticated;
insert into pol select 'down' || tier, id from public.escalation_policies where severity = 'down';

-- ── Seeds ─────────────────────────────────────────────────────────────────
select results_eq(
  $$select level, delay_min, targets, channels, fyi from public.escalation_steps
    where policy_id = (select id from pol where name = 'down2') order by level$$,
  $$values (0::smallint, 0, array['owner'], array['chat', 'space', 'email'], false),
           (1::smallint, 15, array['backup', 'admins'], array['chat', 'email'], false),
           (2::smallint, 30, array['admins'], array['chat', 'email'], false)$$,
  'Tier 2 DOWN: L2 +30 a reminder to the Admin by Chat + email, no CEO (§16.5)');
select is((select fyi from public.escalation_steps where policy_id = (select id from pol where name = 'down1') and level = 3),
  true, 'Tier 1 L3 is the FYI step');

-- ── Guardrails (Done-when 2) ──────────────────────────────────────────────
-- Tier 1 DOWN as seeded, with one step replaced or dropped.
create function pg_temp.t1(p_steps jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('policyId', (select id from pol where name = 'down1'), 'steps', p_steps));
$$;
create function pg_temp.step(p_level int, p_delay int, p_targets text[], p_channels text[], p_fyi boolean default false)
returns jsonb language sql as $$
  select jsonb_build_object('level', p_level, 'delayMin', p_delay, 'targets', p_targets, 'channels', p_channels, 'fyi', p_fyi);
$$;
grant execute on function pg_temp.t1(jsonb) to authenticated;
grant execute on function pg_temp.step(int, int, text[], text[], boolean) to authenticated;

select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, jsonb_build_array(jsonb_build_object(
    'policyId', (select id from pol where name = 'down2'), 'steps', jsonb_build_array(
      pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
      pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email']),
      pg_temp.step(2, 30, array['ceo'], array['chat', 'email']))))),
  '22023', 'The CEO is paged only on Tier 1 DOWN — remove CEO from this step.', 'no CEO on Tier 2–3');
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.t1(jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'ceo'], array['chat', 'email']),
    pg_temp.step(2, 30, array['ceo'], array['chat', 'email']),
    pg_temp.step(3, 60, array['ceo', 'site_am'], array['chat', 'email'], true)))),
  '22023', 'The CEO can be paged only from L2 onward.', 'no CEO before L2');
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.t1(jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email']),
    pg_temp.step(2, 30, array['ceo'], array['chat', 'email']),
    pg_temp.step(3, 60, array['ceo', 'site_am'], array['chat', 'email', 'voice'], true)))),
  '22023', 'Only the L2 CEO step can carry a voice call, and it stays off until approved.',
  'no voice on the CEO + AM step');
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.t1(jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email', 'voice']),
    pg_temp.step(2, 30, array['ceo'], array['chat', 'email']),
    pg_temp.step(3, 60, array['ceo', 'site_am'], array['chat', 'email'], true)))),
  '22023', 'Only the L2 CEO step can carry a voice call, and it stays off until approved.',
  'no voice on a step without the CEO');
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.t1(jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email']),
    pg_temp.step(2, 30, array['ceo'], array['chat', 'email', 'voice'])))),
  '22023', 'The CEO + AM FYI step can’t be removed from Tier 1 DOWN', 'the FYI step can''t be removed');
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, jsonb_build_array(jsonb_build_object(
    'policyId', (select id from pol where name = 'down2'), 'steps', jsonb_build_array(
      pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
      pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email']),
      pg_temp.step(2, 60, array['site_am'], array['chat', 'email'], true))))),
  '22023', 'Only Tier 1 DOWN has the CEO + AM FYI step', 'no FYI step on Tier 2–3');
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.t1(jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email']),
    pg_temp.step(2, 30, array['ceo'], array['voice']),
    pg_temp.step(3, 60, array['ceo', 'site_am'], array['chat', 'email'], true)))),
  '22023', 'No channel ticked — this step notifies nobody.', 'voice alone notifies nobody (off until approved)');
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.t1(jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email']),
    pg_temp.step(2, 30, array['ceo'], array['chat', 'email']),
    pg_temp.step(3, 60, array['ceo'], array['chat', 'email'], true)))),
  '22023', null, 'CEO + Site AM stay on the FYI step');
select throws_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'x')$$, pg_temp.t1(jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 60, array['ceo', 'site_am'], array['chat', 'email'], true)))),
  '22023', null, 'L0 and the FYI alone are refused (the FYI can''t come before L2)');
select lives_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'CEO a little later')$$, pg_temp.t1(jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email']),
    pg_temp.step(2, 35, array['ceo'], array['chat', 'email', 'voice']),
    pg_temp.step(3, 60, array['ceo', 'site_am'], array['chat', 'email'], true)))),
  'the Admin moves the CEO step to +35 (voice stays configured)');
select lives_ok(format($$select public.save_escalation_policies(%L, 15, 60, 'back')$$, pg_temp.t1(jsonb_build_array(
    pg_temp.step(0, 0, array['owner'], array['chat', 'space', 'email']),
    pg_temp.step(1, 15, array['backup', 'admins'], array['chat', 'email']),
    pg_temp.step(2, 30, array['ceo'], array['chat', 'email', 'voice']),
    pg_temp.step(3, 60, array['ceo', 'site_am'], array['chat', 'email'], true)))),
  'and back');
reset role;
select is((select st->>'fyi' from public.audit_log, jsonb_array_elements(after->'policies') p, jsonb_array_elements(p->'steps') st
           where action = 'escalation.update' and after->>'note' = 'CEO a little later'
             and p->>'tier' = '1' and p->>'severity' = 'down' and st->>'level' = '3'),
  'true', 'the audit row keeps the FYI flag');

-- ── The plan, the CEO token ───────────────────────────────────────────────
create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated, service_role;
insert into inc values
  ('a', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
     now() - interval '61 minutes', now() - interval '60 minutes', now(), '{}', true)),
  ('b', public.engine_open_incident('00000000-0000-0000-0000-0000000000b1', null, 'hard_fail', 'down',
     now() - interval '31 minutes', now() - interval '30 minutes', now(), '{}', true));

select is((select escalation_plan #>> '{steps,3,fyi}' from public.incidents where id = (select id from inc where name = 'a')),
  'true', 'the incident''s plan keeps the FYI flag');
select is((select array_agg(token) from public.escalation_people((select id from inc where name = 'a'), '["ceo"]')),
  array['ceo'], 'the CEO token names the stakeholder who manages no client (D-032), not the AM');
select is((select user_id from public.escalation_people((select id from inc where name = 'a'), '["ceo"]')),
  (select id from ids where name = 'ceo'), 'that person');

-- ── T05: no ack → L1, L2 (CEO), L3 ────────────────────────────────────────
set local role service_role;
select ok(public.engine_fire_step((select id from inc where name = 'a'), 1::smallint, now(), '{"elapsedMin":15}'), 'L1');
select ok(public.engine_fire_step((select id from inc where name = 'a'), 2::smallint, now(), '{"elapsedMin":30}'), 'L2');
reset role;
select is((select payload->'mentioned' from public.incident_events
           where incident_id = (select id from inc where name = 'a') and type = 'step_fired' and payload->>'level' = '2'),
  jsonb_build_array((select id from ids where name = 'ceo')), 'L2 @mentions the CEO');
select is((select array_agg(channel::text order by channel::text) from public.notifications
           where incident_id = (select id from inc where name = 'a') and dedupe_key = 'down:L2'),
  array['email', 'google_chat'], 'by Chat and email; voice is configured but nothing is queued for it');
set local role service_role;
select ok(public.engine_fire_step((select id from inc where name = 'a'), 3::smallint, now(), '{"elapsedMin":60}'),
  'L3 with nobody acknowledging');
reset role;
select is((select (payload->>'fyiStep') || ' ' || jsonb_array_length(payload->'mentioned') from public.incident_events
           where incident_id = (select id from inc where name = 'a') and type = 'step_fired' and payload->>'level' = '3'),
  'true 2', 'the FYI mentions CEO + AM, the CEO again though L2 told them');
set local role service_role;
select public.engine_remind((select id from inc where name = 'a'), date_trunc('minute', now()), '{"elapsedMin":75}');
reset role;
select is((select context->'mentioned' ?| array[(select id from ids where name = 'ceo')::text, (select id from ids where name = 'bua')::text]
           from public.notifications where incident_id = (select id from inc where name = 'a') and template = 'reminder'),
  false, 'STILL DOWN after L2 / L3 doesn''t @mention the CEO or the AM (told once, never asked to act)');

-- ── Ack at +5: L2 stops, L3 still sends the FYI ───────────────────────────
insert into inc values ('m', public.engine_open_incident('00000000-0000-0000-0000-0000000000a2', null, 'hard_fail', 'down',
  now() - interval '61 minutes', now() - interval '60 minutes', now(), '{}', true));
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.ack_incident((select id from inc where name = 'm'));
reset role;
set local role service_role;
select ok(not public.engine_fire_step((select id from inc where name = 'm'), 1::smallint, now(), '{}'), 'no L1 after the ack');
select ok(not public.engine_fire_step((select id from inc where name = 'm'), 2::smallint, now(), '{}'), 'no L2 after the ack');
select ok(public.engine_fire_step((select id from inc where name = 'm'), 3::smallint, now(), '{"elapsedMin":60}'),
  'the L3 FYI still goes at +60 while it is down');
reset role;
select is((select state::text from public.incidents where id = (select id from inc where name = 'm')), 'acknowledged',
  'and the incident stays Acknowledged');
select is((select payload->>'ackedBy' from public.incident_events
           where incident_id = (select id from inc where name = 'm') and type = 'step_fired'),
  'Arm', 'the FYI says who acknowledged');

-- An FYI already queued when someone acks still goes.
update public.incidents set state = 'unacked', acked_at = null, acked_by = null, escalation_level = 2
  where id = (select id from inc where name = 'a');
delete from public.notifications where incident_id = (select id from inc where name = 'a') and dedupe_key = 'down:L3';
delete from public.incident_events where incident_id = (select id from inc where name = 'a') and payload->>'level' = '3';
set local role service_role;
select public.engine_fire_step((select id from inc where name = 'a'), 3::smallint, now(), '{}');
reset role;
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.ack_incident((select id from inc where name = 'a'));
reset role;
select is((select count(*)::int from public.notifications
           where incident_id = (select id from inc where name = 'a') and dedupe_key = 'down:L3' and status = 'queued'),
  3, 'an ack leaves the queued FYI (Chat + two emails) alone');

-- Recovered by +60 → nothing is sent.
update public.incidents set state = 'monitoring', escalation_level = 1 where id = (select id from inc where name = 'm');
delete from public.incident_events where incident_id = (select id from inc where name = 'm') and type = 'step_fired';
set local role service_role;
select ok(not public.engine_fire_step((select id from inc where name = 'm'), 3::smallint, now(), '{}'),
  'recovered by then (Monitoring): no FYI');
reset role;

-- ── Tier 2–3 L2: a reminder to the Admin ──────────────────────────────────
set local role service_role;
select ok(public.engine_fire_step((select id from inc where name = 'b'), 1::smallint, now(), '{}'), 'Tier 2 L1');
select ok(public.engine_fire_step((select id from inc where name = 'b'), 2::smallint, now(), '{"elapsedMin":30}'), 'Tier 2 L2');
reset role;
select is((select (payload->>'reminder') || ' ' || (payload->'mentioned' = jsonb_build_array((select id from ids where name = 'tao')))
           from public.incident_events
           where incident_id = (select id from inc where name = 'b') and type = 'step_fired' and payload->>'level' = '2'),
  'true true', 'L2 reminds Tao, already told at L1 (REMINDER · L2, §16.5)');
select is((select array_agg(channel::text order by channel::text) from public.notifications
           where incident_id = (select id from inc where name = 'b') and dedupe_key = 'down:L2'),
  array['email', 'google_chat'], 'by Chat and email');

-- ── T09: a muted site still gets its L3 FYI (Done-when 4) ─────────────────
update public.incidents set state = 'acknowledged', escalation_level = 2 where id = (select id from inc where name = 'm');
delete from public.notifications where incident_id = (select id from inc where name = 'm') and dedupe_key = 'down:L3';
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.mute_site('00000000-0000-0000-0000-0000000000a2', now() + interval '1 hour', 'Deploy');
reset role;
set local role service_role;
select ok(public.engine_fire_step((select id from inc where name = 'm'), 3::smallint, now(), '{}'),
  'the L3 FYI fires on a muted site (muting is not an acknowledgement, §15.1)');
reset role;

select * from finish();
rollback;
