-- On-call routing (S10 B1a, D-048): Tier 1 outside response hours freezes the person on call as the
-- incident's L0 person (open, a D-021 raise that restarts the ladder, the first alert after a mute);
-- "Owner / on-call" resolves to them (inactive or nobody on call → the owner), L0's emails follow, the
-- L1 told-already set leaves them out, a relapse keeps them; the L0 pencil; on-call may acknowledge.
begin;
\ir _helpers.psql
select plan(39);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
delete from public.oncall_swaps; delete from public.oncall_events; delete from public.oncall_shifts;
update public.profiles set is_active = false where role = 'admin';
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('nok',  tests.create_user('nok@pgtap.test', 'responder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));

-- A (Tier 1): Arm owns, Ploy backs up. B (Tier 2): Arm owns, Ploy backs up.
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Site B', 2,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy'));

-- Nok is on call this week.
insert into public.oncall_shifts (user_id, starts_at, ends_at, slot)
values ((select id from ids where name = 'nok'), now() - interval '1 day', now() + interval '6 days', 1);

create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated;
create function pg_temp.open(p_site text, p_sev public.severity, p_outside boolean)
returns uuid language sql as $$
  select public.engine_open_incident(
    ('00000000-0000-0000-0000-0000000000' || p_site)::uuid, null,
    case when p_sev = 'down' then 'hard_fail'::public.incident_trigger else 'slow' end, p_sev,
    now() - interval '16 minutes', now() - interval '15 minutes', now(), '{}', true,
    null, null, null, p_outside)
$$;
create function pg_temp.l0(p_name text) returns uuid language sql as $$
  select l0_user_id from public.incidents where id = (select id from inc where name = p_name)
$$;
create function pg_temp.emailed(p_name text, p_template text) returns uuid[] language sql as $$
  select coalesce(array_agg(user_id order by user_id), '{}') from public.notifications
  where incident_id = (select id from inc where name = p_name) and channel = 'email' and template = p_template
    and status <> 'cancelled'
$$;
create function pg_temp.close(p_name text) returns void language sql as $$
  update public.incidents set state = 'resolved' where id = (select id from inc where name = p_name)
$$;

-- ── Freeze at open ────────────────────────────────────────────────────────
insert into inc values ('day', pg_temp.open('a1', 'down', false));
select is(pg_temp.l0('day'), null, 'Tier 1 inside response hours: no L0 person frozen (the owner)');
select is(pg_temp.emailed('day', 'down'), array[(select id from ids where name = 'arm')],
  'inside hours the owner gets the DOWN email');
select pg_temp.close('day');

insert into inc values ('night', pg_temp.open('a1', 'down', true));
select is(pg_temp.l0('night'), (select id from ids where name = 'nok'),
  'Tier 1 outside response hours: the person on call is frozen as L0');
select is(pg_temp.emailed('night', 'down'), array[(select id from ids where name = 'nok')],
  'the DOWN email goes to the person on call, not the owner');
select results_eq(
  $$select user_id, token from public.escalation_people((select id from inc where name = 'night'), '["owner"]')$$,
  $$values ((select id from ids where name = 'nok'), 'owner')$$,
  '"Owner / on-call" resolves to the person on call');

-- L1 = backup + Admin minus anyone already paged: Ploy (backup) is told, Nok isn't asked again.
select ok(public.engine_fire_step((select id from inc where name = 'night'), 1::smallint, now(), '{}'), 'L1 fires at night');
select is(
  (select payload->'mentioned' from public.incident_events
   where incident_id = (select id from inc where name = 'night') and type = 'step_fired'),
  to_jsonb(array[(select id from ids where name = 'ploy')]), 'L1 @mentions the backup');
select pg_temp.close('night');

-- "L1 · night": the backup is the person on call → L1 reaches only the Admin.
update public.oncall_shifts set user_id = (select id from ids where name = 'ploy');
insert into inc values ('bk', pg_temp.open('a1', 'down', true));
select ok(public.engine_fire_step((select id from inc where name = 'bk'), 1::smallint, now(), '{}'), 'L1 fires');
select is(
  (select array_agg(user_id order by user_id) from public.notifications
   where incident_id = (select id from inc where name = 'bk') and template = 'step_fired' and channel = 'email'),
  array[(select id from ids where name = 'tao')], 'L1 · night: the backup on call was paged at L0, so only the Admin is told');
select pg_temp.close('bk');
update public.oncall_shifts set user_id = (select id from ids where name = 'nok');

-- Tier 2 ignores the flag; PROBLEM on Tier 1 at night goes to on-call too (spec §8).
insert into inc values ('t2', pg_temp.open('b1', 'down', true));
select is(pg_temp.l0('t2'), null, 'Tier 2 outside hours keeps the owner (only Tier 1 has on-call)');
select pg_temp.close('t2');
insert into inc values ('pr', pg_temp.open('a1', 'problem', true));
select is(pg_temp.l0('pr'), (select id from ids where name = 'nok'), 'a Tier 1 PROBLEM at night pages on-call');

-- ── Relapse keeps the person; a D-021 raise re-freezes unless acknowledged ──
select public.engine_recover_incident((select id from inc where name = 'pr'), 'unacked', 'monitoring', now(), now(), '{}', false);
update public.oncall_shifts set user_id = (select id from ids where name = 'ploy');
select public.engine_relapse_incident((select id from inc where name = 'pr'), 'problem', 'slow', now(), now(), now(), '{}', false, true);
select is(pg_temp.l0('pr'), (select id from ids where name = 'nok'), 'a relapse keeps the frozen L0 person');
select is(pg_temp.emailed('pr', 'problem_again'), '{}'::uuid[],
  'the relapse emails no L0 person already emailed (Nok had the PROBLEM email)');
select public.engine_escalate_incident((select id from inc where name = 'pr'), now(), now(), '{}', true, null, null, false, true);
select is(pg_temp.l0('pr'), (select id from ids where name = 'ploy'),
  'a D-021 raise restarts the ladder: L0 is whoever is on call now');
select is(pg_temp.emailed('pr', 'down'), array[(select id from ids where name = 'ploy')],
  'and the DOWN email goes to them');
-- A relapse does email an L0 person not emailed yet: the PROBLEM email went to Nok, the frozen
-- person is now Ploy — a DOWN AGAIN reaches Ploy only if she wasn't emailed; she was (DOWN).
select public.engine_recover_incident((select id from inc where name = 'pr'), 'unacked', 'monitoring', now(), now(), '{}', false);
update public.notifications set status = 'cancelled'
  where incident_id = (select id from inc where name = 'pr') and user_id = (select id from ids where name = 'ploy');
select public.engine_relapse_incident((select id from inc where name = 'pr'), 'down', 'hard_fail', now(), now(), now() + interval '1 minute', '{}', false, true);
select is(pg_temp.emailed('pr', 'down_again'), array[(select id from ids where name = 'ploy')],
  'a relapse emails the L0 person not emailed about the incident yet');
select pg_temp.close('pr');

insert into inc values ('ak', pg_temp.open('a1', 'problem', true));
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.ack_incident((select id from inc where name = 'ak'));
reset role;
update public.oncall_shifts set user_id = (select id from ids where name = 'nok');
select public.engine_escalate_incident((select id from inc where name = 'ak'), now(), now(), '{}', true, null, null, false, true);
select is(pg_temp.l0('ak'), (select id from ids where name = 'ploy'), 'an acknowledged raise keeps its L0 person');
select pg_temp.close('ak');

-- ── Nobody on call, or the person on call deactivated → the owner ──────────
delete from public.oncall_shifts;
insert into inc values ('none', pg_temp.open('a1', 'down', true));
select is(pg_temp.l0('none'), null, 'nobody on call: no L0 person frozen');
select is(pg_temp.emailed('none', 'down'), array[(select id from ids where name = 'arm')], 'the owner is emailed');
select pg_temp.close('none');

insert into public.oncall_shifts (user_id, starts_at, ends_at, slot)
values ((select id from ids where name = 'nok'), now() - interval '1 day', now() + interval '6 days', 1);
insert into inc values ('gone', pg_temp.open('a1', 'down', true));
update public.profiles set is_active = false where id = (select id from ids where name = 'nok');
select results_eq(
  $$select user_id from public.escalation_people((select id from inc where name = 'gone'), '["owner"]')$$,
  $$values ((select id from ids where name = 'arm'))$$,
  'the frozen on-call person deactivated: "Owner / on-call" falls back to the owner');
update public.profiles set is_active = true where id = (select id from ids where name = 'nok');
select pg_temp.close('gone');

-- ── The first alert after a mute re-freezes at that moment ─────────────────
insert into inc values ('mu', pg_temp.open('a1', 'down', false));
update public.notifications set status = 'cancelled' where incident_id = (select id from inc where name = 'mu');
select ok(public.engine_post_late_alert((select id from inc where name = 'mu'), now(), null, true), 'the late alert goes');
select is(pg_temp.l0('mu'), (select id from ids where name = 'nok'), 'the late alert outside hours pages on-call');
select ok((select id from ids where name = 'nok') = any (pg_temp.emailed('mu', 'down')), 'and emails them');
select pg_temp.close('mu');

-- ── Access: the on-call person acts on Tier 1 ──────────────────────────────
insert into inc values ('acc', pg_temp.open('a1', 'down', true));
insert into inc values ('acc2', pg_temp.open('b1', 'down', true));
select tests.authenticate_as((select id from ids where name = 'nok'));
select lives_ok($$select public.ack_incident((select id from inc where name = 'acc'))$$,
  'the person on call acknowledges a Tier 1 incident they don''t own');
select throws_ok($$select public.ack_incident((select id from inc where name = 'acc2'))$$, '42501', null,
  'but not a Tier 2 one');
reset role;
-- Next week Ploy is on call, yet Nok still acts on the incident L0 paged them for.
update public.oncall_shifts set user_id = (select id from ids where name = 'ploy');
select tests.authenticate_as((select id from ids where name = 'nok'));
select lives_ok($$select public.add_incident_note((select id from inc where name = 'acc'), 'on it')$$,
  'the frozen L0 person keeps access after the shift changes');
select tests.authenticate_as((select id from ids where name = 'mint'));
select throws_ok($$select public.ack_incident((select id from inc where name = 'acc2'))$$, '42501', null,
  'a Viewer still can''t');
reset role;

-- Mute yes, maintenance no: on call doesn't hand over the site's windows (security review L1).
update public.oncall_shifts set user_id = (select id from ids where name = 'nok');
select tests.authenticate_as((select id from ids where name = 'nok'));
select lives_ok($$select public.mute_site('00000000-0000-0000-0000-0000000000a1', now() + interval '1 hour', 'deploy rollback')$$,
  'the person on call mutes a Tier 1 site');
select throws_ok($$select public.create_maintenance('00000000-0000-0000-0000-0000000000a1', now() + interval '1 day',
  now() + interval '1 day 1 hour', 'patch')$$, '42501', null, 'but schedules no maintenance on a site they don''t own');
reset role;

-- The frozen person demoted to Viewer while the incident is open: "Owner / on-call" is the owner again,
-- and so is the AGAIN fallback (security review L2).
select pg_temp.close('acc');
insert into inc values ('dem', pg_temp.open('a1', 'down', true));
update public.profiles set role = 'viewer' where id = (select id from ids where name = 'nok');
select results_eq(
  $$select user_id from public.escalation_people((select id from inc where name = 'dem'), '["owner"]')$$,
  $$values ((select id from ids where name = 'arm'))$$,
  'a demoted L0 person no longer counts: the owner is paged');
update public.profiles set role = 'responder' where id = (select id from ids where name = 'nok');

-- Nobody signed in runs the engine or its helpers (security review L3).
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok($$select public.engine_l0_people((select id from inc where name = 'dem'))$$, '42501', null,
  'a Responder can''t call engine_l0_people');
select throws_ok($$select public.engine_queue_l0_emails((select id from inc where name = 'dem'), 'down', '{}', now(), null, false)$$,
  '42501', null, 'nor engine_queue_l0_emails');
select throws_ok($$select public.engine_post_late_alert((select id from inc where name = 'dem'), now(), null, true)$$,
  '42501', null, 'nor the engine functions with the new parameter');
select tests.as_anon();
select throws_ok($$select public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
  now(), now(), now(), '{}', true, null, null, null, true)$$, '42501', null, 'nor anon');
reset role;

-- ── The L0 pencil ─────────────────────────────────────────────────────────
create function pg_temp.save_l0(p_targets text[], p_channels text[]) returns void language sql as $$
  select public.save_escalation_policies(jsonb_build_array(jsonb_build_object(
    'policyId', (select id from public.escalation_policies where severity = 'down' and tier = 2),
    'steps', jsonb_build_array(
      jsonb_build_object('level', 0, 'delayMin', 0, 'targets', p_targets, 'channels', p_channels),
      jsonb_build_object('level', 1, 'delayMin', 15, 'targets', array['backup', 'admins'], 'channels', array['chat', 'email']),
      jsonb_build_object('level', 2, 'delayMin', 30, 'targets', array['admins'], 'channels', array['chat', 'email'])))),
    15, 60, 'pencil')
$$;
select tests.authenticate_as((select id from ids where name = 'tao'));
select lives_ok($$select pg_temp.save_l0(array['owner', 'site_am'], array['chat', 'space', 'email'])$$,
  'the pencil adds a person to L0');
select throws_ok($$select pg_temp.save_l0(array['owner'], array['chat', 'email'])$$, '22023', 'L0 is pinned on every policy',
  'Chat + Alerts Space stay on L0');
reset role;
-- Site B (Tier 2) now has L0 owner + Site AM: a new DOWN emails both.
update public.clients set am_user_id = (select id from ids where name = 'ploy') where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.close('acc2');
insert into inc values ('pen', pg_temp.open('b1', 'down', false));
select is(pg_temp.emailed('pen', 'down'),
  (select array_agg(id order by id) from ids where name in ('arm', 'ploy')), 'L0 emails everyone the pencil names');
select pg_temp.close('pen');
-- L0 without email: the Chat card only.
select tests.authenticate_as((select id from ids where name = 'tao'));
select pg_temp.save_l0(array['owner'], array['chat', 'space']);
reset role;
insert into inc values ('nomail', pg_temp.open('b1', 'down', false));
select is(pg_temp.emailed('nomail', 'down'), '{}'::uuid[], 'L0 with email unticked emails nobody');
select pg_temp.close('nomail');

-- An incident with no plan (opened before S08) still emails its owner.
select pg_temp.close('dem');
insert into inc values ('old', pg_temp.open('a1', 'down', false));
update public.incidents set escalation_plan = null where id = (select id from inc where name = 'old');
delete from public.notifications where incident_id = (select id from inc where name = 'old');
select is(public.engine_queue_l0_emails((select id from inc where name = 'old'), 'down', '{}', now(), null, false), 1,
  'no plan: L0 is the owner, by email');
select pg_temp.close('old');

select * from finish();
rollback;
