-- Client-update track (S11, FR-20, D-052; spec §9, §16.2, §16.6): engine_client_update_due queues the
-- AM's Chat @mention + email once (acked or not), skips Tier 3, internal clients, PROBLEMs and an
-- incident whose thread has no alert yet, still fires on a muted site (T09, Done-when 4) and falls
-- back to the Admins with no active AM; mark_client_update — who may (Done-when 3), Not needed needs a
-- reason, and either mark meets the resolve gate.
begin;
\ir _helpers.psql
select plan(50);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
update public.profiles set is_active = false where role in ('admin', 'stakeholder');
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao',   tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',   tests.create_user('arm@pgtap.test', 'responder')),
  ('nok',   tests.create_user('nok@pgtap.test', 'responder')),
  ('bua',   tests.create_user('bua@pgtap.test', 'stakeholder')),
  ('thee',  tests.create_user('thee@pgtap.test', 'stakeholder')),
  ('mint',  tests.create_user('mint@pgtap.test', 'viewer'));

-- Client A (Bua), client B (Thee), an internal client, client D whose AM is inactive at the due time.
insert into public.clients (id, name, am_user_id, is_internal) values
  ('00000000-0000-0000-0000-0000000000c1', 'Client A', (select id from ids where name = 'bua'), false),
  ('00000000-0000-0000-0000-0000000000c2', 'Client B', (select id from ids where name = 'thee'), false),
  ('00000000-0000-0000-0000-0000000000c3', 'DxT', null, true),
  ('00000000-0000-0000-0000-0000000000c4', 'Client D', (select id from ids where name = 'thee'), false);
-- Arm owns every site; Nok owns none.
insert into public.sites (id, client_id, name, tier, primary_owner_id)
select v.id, v.client, v.name, v.tier, (select id from ids where name = 'arm')
from (values ('00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, 'Site A', 1::smallint),
             ('00000000-0000-0000-0000-0000000000a2'::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, 'Site M', 1::smallint),
             ('00000000-0000-0000-0000-0000000000a3'::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, 'Site T3', 3::smallint),
             ('00000000-0000-0000-0000-0000000000a4'::uuid, '00000000-0000-0000-0000-0000000000c3'::uuid, 'Site I', 1::smallint),
             ('00000000-0000-0000-0000-0000000000a5'::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, 'Site P', 1::smallint),
             ('00000000-0000-0000-0000-0000000000a6'::uuid, '00000000-0000-0000-0000-0000000000c4'::uuid, 'Site D', 2::smallint),
             ('00000000-0000-0000-0000-0000000000a7'::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, 'Site Q', 1::smallint)
     ) v (id, client, name, tier);

create function pg_temp.open(p_site uuid, p_severity public.severity default 'down') returns uuid
language sql as $$
  select public.engine_open_incident(p_site, null,
    case when p_severity = 'down' then 'hard_fail' else 'slow' end::public.incident_trigger, p_severity,
    now() - interval '16 minutes', now() - interval '15 minutes', now(), '{}', true);
$$;
create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated, service_role;
insert into inc values
  ('a',  pg_temp.open('00000000-0000-0000-0000-0000000000a1')),
  ('m',  pg_temp.open('00000000-0000-0000-0000-0000000000a2')),
  ('t3', pg_temp.open('00000000-0000-0000-0000-0000000000a3')),
  ('i',  pg_temp.open('00000000-0000-0000-0000-0000000000a4')),
  ('p',  pg_temp.open('00000000-0000-0000-0000-0000000000a5', 'problem')),
  ('d',  pg_temp.open('00000000-0000-0000-0000-0000000000a6')),
  ('q',  pg_temp.open('00000000-0000-0000-0000-0000000000a7'));
create function pg_temp.inc(p text) returns uuid language sql as $$ select id from inc where name = p $$;
grant execute on function pg_temp.inc(text) to anon, authenticated, service_role;

-- ── The track fires (acked or not) ─────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.ack_incident(pg_temp.inc('a'));
reset role;
-- INC-0142: the first failed check at 09:48:12, due 15 min later (10:03:12 Bangkok).
update public.incidents set started_at = '2026-09-25 02:48:12+00' where id = pg_temp.inc('a');

set local role service_role;
select ok(public.engine_client_update_due(pg_temp.inc('a'), '2026-09-25 03:03:12+00', '{"cause":"x"}'),
  'Tier 1 DOWN at 15 min: the track fires, though Arm acknowledged (§9)');
select ok(not public.engine_client_update_due(pg_temp.inc('a'), '2026-09-25 03:04:12+00'),
  'once: a later run does nothing');
reset role;

select is((select client_update_required::text || ' ' || client_update_due_at::text from public.incidents where id = pg_temp.inc('a')),
  'true 2026-09-25 03:03:12+00', 'the incident is required, due at the time given (D-002)');
select is((select array_agg(channel::text order by channel::text) from public.notifications
           where incident_id = pg_temp.inc('a') and template = 'client_update_due'),
  array['email', 'google_chat'], 'a Chat reply in the thread and one email');
select is((select user_id from public.notifications
           where incident_id = pg_temp.inc('a') and template = 'client_update_due' and channel = 'email'),
  (select id from ids where name = 'bua'), 'the email goes to Bua, the AM');
select is((select context->'mentioned' from public.notifications
           where incident_id = pg_temp.inc('a') and template = 'client_update_due' and channel = 'google_chat'),
  jsonb_build_array((select id from ids where name = 'bua')), 'the Chat reply @mentions Bua');
select is((select thread_key from public.notifications
           where incident_id = pg_temp.inc('a') and template = 'client_update_due' and channel = 'google_chat'),
  pg_temp.inc('a')::text, 'in the incident''s thread');
select is((select context->>'cause' || ' ' || (context->>'minutes') || ' ' || (context->>'am') from public.notifications
           where incident_id = pg_temp.inc('a') and template = 'client_update_due' and channel = 'google_chat'),
  'x 15 Bua', 'the context carries the runner''s facts, the minutes and the AM''s name');
select is((select at from public.incident_events where incident_id = pg_temp.inc('a') and type = 'client_update_due'),
  '2026-09-25 03:03:12+00'::timestamptz, 'the timeline row is stamped with the due time (10:03:12), not the run');
select is((select count(*)::int from public.audit_log
           where entity_id = pg_temp.inc('a') and action = 'incident.client_update_due' and actor_id is null),
  1, 'one audit row, by the system');
select is((select state::text from public.incidents where id = pg_temp.inc('a')), 'acknowledged',
  'the incident''s state doesn''t move');

-- ── It doesn't fire ────────────────────────────────────────────────────────
set local role service_role;
select ok(not public.engine_client_update_due(pg_temp.inc('t3'), now()), 'Tier 3: report only');
select ok(not public.engine_client_update_due(pg_temp.inc('i'), now()), 'an internal client: nobody to tell');
select ok(not public.engine_client_update_due(pg_temp.inc('p'), now()), 'a PROBLEM never');
reset role;
-- An incident opened while muted has no alert in its thread yet.
update public.notifications set status = 'cancelled' where incident_id = pg_temp.inc('q') and channel = 'google_chat';
set local role service_role;
select ok(not public.engine_client_update_due(pg_temp.inc('q'), now()),
  'no alert in the thread yet (opened while muted): it waits for the late alert');
reset role;
update public.incidents set state = 'resolved', resolved_at = now() where id = pg_temp.inc('q');
update public.notifications set status = 'sent', attempts = 1 where incident_id = pg_temp.inc('q') and channel = 'google_chat';
set local role service_role;
select ok(not public.engine_client_update_due(pg_temp.inc('q'), now()), 'a resolved incident never');
reset role;

-- ── Recovered in the minute it fell due: still fires ───────────────────────
update public.incidents set state = 'monitoring', recovered_at = now() - interval '2 minutes' where id = pg_temp.inc('i');
update public.clients set is_internal = false, am_user_id = (select id from ids where name = 'bua')
  where id = '00000000-0000-0000-0000-0000000000c3';
set local role service_role;
select ok(not public.engine_client_update_due(pg_temp.inc('i'), now() - interval '1 minute'),
  'recovered before it fell due: never');
select ok(not public.engine_client_update_due(pg_temp.inc('i'), now() + interval '1 minute'),
  'a due time still to come: not yet');
reset role;
update public.incidents set recovered_at = now() where id = pg_temp.inc('i');
-- The recovery's Chat reply went out before the AM had an email row; an older drop's (before the
-- latest relapse) is set aside.
insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key, created_at)
values (pg_temp.inc('i'), 'google_chat', 'recovered', pg_temp.inc('i')::text, '{"drop":1}', 'r1', now() - interval '1 hour'),
       (pg_temp.inc('i'), 'google_chat', 'recovered', pg_temp.inc('i')::text, '{"drop":2}', 'r2', now());
insert into public.audit_log (action, entity, entity_id, at)
values ('incident.relapsed', 'incident', pg_temp.inc('i'), now() - interval '30 minutes');
set local role service_role;
select ok(public.engine_client_update_due(pg_temp.inc('i'), now() - interval '1 minute'),
  'in Monitoring, the drop covered the due time (started + 15 min exactly): it fires (the runner decides that)');
reset role;
select is((select context || jsonb_build_object('key', dedupe_key) from public.notifications
           where incident_id = pg_temp.inc('i') and channel = 'email' and template = 'recovered'
             and user_id = (select id from ids where name = 'bua')),
  '{"drop":2,"key":"r2"}'::jsonb, 'recovered in that minute: the AM gets this recovery''s RECOVERED email too');
select ok((select r.created_at > c.created_at
           from public.notifications r, public.notifications c
           where r.incident_id = pg_temp.inc('i') and r.channel = 'email' and r.template = 'recovered'
             and c.incident_id = pg_temp.inc('i') and c.channel = 'email' and c.template = 'client_update_due'),
  'queued after the client-update email, so it goes second');
select is((select count(*)::int from public.notifications
           where incident_id = pg_temp.inc('a') and template = 'recovered'),
  0, 'a DOWN incident still open gets no RECOVERED email from the track');

-- ── T09: a muted site still gets its client update (Done-when 4) ──────────
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.mute_site('00000000-0000-0000-0000-0000000000a2', now() + interval '1 hour', 'Deploy');
reset role;
set local role service_role;
select ok(not public.engine_client_update_due(pg_temp.inc('m'),
            (select started_at + interval '14 minutes' from public.incidents where id = pg_temp.inc('m'))),
  'a due time under 15 min after the first failed check: refused, whatever the runner says');
-- The runner's due time is a JS Date (milliseconds); started_at has microseconds.
update public.incidents set started_at = now() - interval '16 minutes' + interval '123 microseconds'
  where id = pg_temp.inc('m');
select ok(public.engine_client_update_due(pg_temp.inc('m'),
            (select date_trunc('milliseconds', started_at) + interval '15 minutes' from public.incidents where id = pg_temp.inc('m'))),
  'a muted site with an open incident still gets its client-update mention (§15.1), at 15 min to the millisecond');
reset role;

-- ── No active AM → the Admins (D-052 item 2) ───────────────────────────────
update public.profiles set is_active = false where id = (select id from ids where name = 'thee');
-- D-023: D's drop went on as a PROBLEM AGAIN held until 09:00 (outside response hours).
update public.incidents set episode_severity = 'problem' where id = pg_temp.inc('d');
insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key, hold_until)
values (pg_temp.inc('d'), 'google_chat', 'problem_again', pg_temp.inc('d')::text, '{}', 'again', now() + interval '1 hour');
select ok(not public.engine_thread_live(pg_temp.inc('d')), 'the held PROBLEM AGAIN: the drop''s own thread check says no');
set local role service_role;
select ok(public.engine_client_update_due(pg_temp.inc('d'), now()), 'Tier 2 at 60 min inside hours: the DOWN alert went, so a held PROBLEM AGAIN doesn''t hold it back');
reset role;
select is((select array_agg(user_id) from public.notifications
           where incident_id = pg_temp.inc('d') and template = 'client_update_due' and channel = 'email'),
  array[(select id from ids where name = 'tao')], 'the AM is inactive: Tao, the Admin, gets the email');
select is((select (context->>'noAm') || ' ' || (context->>'minutes') from public.notifications
           where incident_id = pg_temp.inc('d') and template = 'client_update_due' and channel = 'google_chat'),
  'true 60', 'and the message says the client has no AM');
update public.profiles set is_active = true where id = (select id from ids where name = 'thee');

-- ── A PROBLEM drop's recovery: no RECOVERED email from the track (D-038) ──
insert into inc values ('q2', pg_temp.open('00000000-0000-0000-0000-0000000000a7'));
update public.incidents set state = 'monitoring', recovered_at = now(), episode_severity = 'problem'
  where id = pg_temp.inc('q2');
insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
values (pg_temp.inc('q2'), 'google_chat', 'recovered', pg_temp.inc('q2')::text, '{}', 'rq');
set local role service_role;
select ok(public.engine_client_update_due(pg_temp.inc('q2'), now() - interval '1 minute'),
  'recovered from a PROBLEM drop in the minute it fell due: the track fires');
reset role;
select is((select count(*)::int from public.notifications
           where incident_id = pg_temp.inc('q2') and channel = 'email' and template = 'recovered'),
  0, 'but no RECOVERED email: a PROBLEM drop emails only who was emailed about it');

-- ── Who may mark it (§16.6, Done-when 3) ───────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'mint'));
select throws_ok($$select public.mark_client_update(pg_temp.inc('a'), false, null)$$, '42501', null,
  'a Viewer can''t mark it');
select tests.authenticate_as((select id from ids where name = 'thee'));
select throws_ok($$select public.mark_client_update(pg_temp.inc('a'), false, null)$$, '42501', null,
  'the AM of another client can''t mark it');
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok($$select public.mark_client_update(pg_temp.inc('a'), false, null)$$, '42501', null,
  'a Responder who doesn''t own the site can''t mark it');
select tests.as_anon();
select throws_ok($$select public.mark_client_update(pg_temp.inc('a'), false, null)$$, '42501', null,
  'anon can''t call it');
reset role;
-- On call is not "own sites" (D-052 item 4): Nok as the L0 person of A acknowledges, but can't mark.
update public.incidents set l0_user_id = (select id from ids where name = 'nok') where id = pg_temp.inc('m');
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok($$select public.mark_client_update(pg_temp.inc('m'), false, null)$$, '42501', null,
  'the person on call who doesn''t own the site can''t mark it');
reset role;
update public.incidents set l0_user_id = null where id = pg_temp.inc('m');
-- A deactivated AM whose session still holds a token.
update public.profiles set is_active = false where id = (select id from ids where name = 'bua');
select tests.authenticate_as((select id from ids where name = 'bua'));
select throws_ok($$select public.mark_client_update(pg_temp.inc('a'), false, null)$$, '42501', null,
  'a deactivated AM can''t mark it');
reset role;
update public.profiles set is_active = true where id = (select id from ids where name = 'bua');
-- Only the engine fires the track.
select ok(not has_function_privilege('authenticated', 'public.engine_client_update_due(uuid,timestamptz,jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.engine_client_update_due(uuid,timestamptz,jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'private.can_client_update(uuid)', 'execute'),
  'signed-in people and anon can''t fire the track or call the permission helper');
-- An AM who is a Responder (not owning the site) marks their own client's update.
update public.clients set am_user_id = (select id from ids where name = 'nok') where id = '00000000-0000-0000-0000-0000000000c4';
select tests.authenticate_as((select id from ids where name = 'nok'));
select lives_ok($$select public.mark_client_update(pg_temp.inc('d'), false, 'Emailed the client')$$,
  'a Responder who is the client''s AM marks it');
reset role;

-- ── Not needed needs a reason ───────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok($$select public.mark_client_update(pg_temp.inc('m'), true, '   ')$$, '22023', null,
  'Not needed with a blank reason is refused');
select throws_ok($$select public.mark_client_update(pg_temp.inc('m'), false, repeat('x', 501))$$, '22001', null,
  'a note over 500 characters is refused');
select throws_ok($$select public.mark_client_update(pg_temp.inc('t3'), false, null)$$, '55000', null,
  'nothing to mark while the track hasn''t fired');

-- ── The AM marks it; the owner says not needed; an Admin marks one ─────────
select tests.authenticate_as((select id from ids where name = 'bua'));
select lives_ok($$select public.mark_client_update(pg_temp.inc('a'), false, '  Called MuvMi ops, ETA shared ')$$,
  'Bua, the client''s AM, marks it with a note');
select throws_ok($$select public.mark_client_update(pg_temp.inc('a'), false, null)$$, '55000', null,
  'only once');
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok($$select public.mark_client_update(pg_temp.inc('m'), true, 'Client reported it to us first')$$,
  'Arm, the owner, marks it not needed with a reason');
select tests.authenticate_as((select id from ids where name = 'tao'));
select lives_ok($$select public.mark_client_update(pg_temp.inc('i'), false, null)$$, 'an Admin marks one, no note');
reset role;

select is((select client_updated_by::text || ' ' || client_update_note || ' ' || client_update_not_needed::text
           from public.incidents where id = pg_temp.inc('a')),
  (select id from ids where name = 'bua')::text || ' Called MuvMi ops, ETA shared false',
  'who, the trimmed note, marked');
select is((select type || ' ' || (payload->>'by') from public.incident_events where incident_id = pg_temp.inc('m') and actor_id is not null and type like 'client_update%'),
  'client_update_not_needed Arm', 'the timeline says not needed, by Arm');
select is((select (after->>'not_needed') from public.audit_log where entity_id = pg_temp.inc('m') and action = 'incident.client_update'),
  'true', 'the audit row records it');

-- ── Either mark meets the resolve gate (§16.2) ────────────────────────────
update public.incidents set state = 'needs_root_cause', recovered_at = now() - interval '5 minutes',
  root_cause_category = 'hosting', root_cause = 'Disk full'
  where id in (pg_temp.inc('a'), pg_temp.inc('m'));
insert into public.incident_events (incident_id, type, at)
  select id, 'ok_two_rounds', now() from inc where name in ('a', 'm');
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok($$select public.resolve_incident(pg_temp.inc('a'), 'hosting', 'Disk full', null)$$,
  'marked → it can be resolved');
select lives_ok($$select public.resolve_incident(pg_temp.inc('m'), 'hosting', 'Disk full', null)$$,
  'not needed → it can be resolved');
reset role;

select * from finish();
rollback;
