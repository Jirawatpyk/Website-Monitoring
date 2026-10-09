-- Notes, root cause, Resolve + Undo (S07, D-033, T10): who may act, the three conditions checked in
-- SQL, the 10 s hold, Undo, the RESOLVED audience, NOTE per note, the held flap summary, and the
-- S06-review guard on engine_relapse_incident.
begin;
\ir _helpers.psql
select plan(47);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('admin', tests.create_user('admin@pgtap.test', 'admin')),
  ('arm',   tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy',  tests.create_user('ploy@pgtap.test', 'responder')),
  ('nok',   tests.create_user('nok@pgtap.test', 'responder')),
  ('bua',   tests.create_user('bua@pgtap.test', 'stakeholder')),
  ('mint',  tests.create_user('mint@pgtap.test', 'viewer'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
-- Site A: Arm owns it, Ploy is backup. Site B: Arm owns it (a PROBLEM incident). Site C: muted.
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Site B', 2,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1', 'Site C', 2,
   null, null);

create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated;
insert into inc values
  ('a', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
     now() - interval '30 minutes', now() - interval '29 minutes', now() - interval '29 minutes',
     '{"cause":"HTTP 500 (SIN, TYO)"}', true)),
  ('b', public.engine_open_incident('00000000-0000-0000-0000-0000000000a2', null, 'keyword', 'problem',
     now() - interval '20 minutes', now() - interval '20 minutes', now() - interval '20 minutes',
     '{"cause":"Keyword missing"}', true)),
  ('c', public.engine_open_incident('00000000-0000-0000-0000-0000000000a3', null, 'hard_fail', 'down',
     now() - interval '30 minutes', now() - interval '29 minutes', now() - interval '29 minutes',
     '{}', false));

-- Ploy (backup) also got an email about A, as an ack or fallback would have sent; a sent DOWN email.
insert into public.notifications (incident_id, user_id, channel, template, thread_key, status)
values ((select id from inc where name = 'a'), (select id from ids where name = 'ploy'), 'email',
        'acknowledged', (select id from inc where name = 'a')::text, 'sent');
update public.notifications set status = 'sent', sent_at = now() where template = 'down';

-- ── Who may act ──────────────────────────────────────────────────────────
select tests.as_anon();
select throws_ok(format($$select public.add_incident_note(%L, 'hi')$$, (select id from inc where name = 'a')),
  '42501', null, 'anon can''t add a note');
reset role;
select tests.authenticate_as((select id from ids where name = 'mint'));
select throws_ok(format($$select public.add_incident_note(%L, 'hi')$$, (select id from inc where name = 'a')),
  '42501', null, 'a Viewer can''t add a note');
select throws_ok(format($$select public.save_root_cause(%L, 'hosting', 'x', null)$$, (select id from inc where name = 'a')),
  '42501', null, 'a Viewer can''t write the root cause');
reset role;
select tests.authenticate_as((select id from ids where name = 'bua'));
select throws_ok(format($$select public.add_incident_note(%L, 'hi')$$, (select id from inc where name = 'a')),
  '42501', null, 'a Stakeholder can''t add a note');
select throws_ok(format($$select public.resolve_incident(%L, 'hosting', 'x', null)$$, (select id from inc where name = 'a')),
  '42501', null, 'a Stakeholder can''t resolve');
reset role;
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok(format($$select public.save_root_cause(%L, 'hosting', 'x', null)$$, (select id from inc where name = 'a')),
  '42501', null, 'a Responder who doesn''t own the site can''t write the root cause');
select throws_ok(format($$select public.resolve_incident(%L, 'hosting', 'x', null)$$, (select id from inc where name = 'a')),
  '42501', null, 'a Responder who doesn''t own the site can''t resolve');
select throws_ok(format($$select public.add_incident_note(%L, 'hi')$$, gen_random_uuid()),
  'P0002', null, 'an unknown incident is "not found"');
reset role;

-- ── Notes ────────────────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_ok(format($$select public.add_incident_note(%L, '   ')$$, (select id from inc where name = 'a')),
  '22023', null, 'an empty note is refused');
select throws_ok(format($$select public.add_incident_note(%L, %L)$$, (select id from inc where name = 'a'), repeat('x', 2001)),
  '22023', null, 'a note over 2,000 characters is refused');
select lives_ok(format($$select public.add_incident_note(%L, '  Host is restarting the app server ')$$,
  (select id from inc where name = 'a')), 'the backup adds a note');
select lives_ok(format($$select public.add_incident_note(%L, 'Back in 5 min')$$,
  (select id from inc where name = 'a')), 'and a second one');
reset role;
select results_eq(
  format($$select payload->>'text', actor_id from public.incident_events
           where incident_id = %L and type = 'note' order by payload->>'text' desc$$,
         (select id from inc where name = 'a')),
  $$values ('Host is restarting the app server', (select id from ids where name = 'ploy')),
           ('Back in 5 min', (select id from ids where name = 'ploy'))$$,
  'both notes are on the timeline, trimmed, under who wrote them'
);
select results_eq(
  $$select channel::text, context->>'text', context->>'by', hold_until is null, user_id is null
    from public.notifications where template = 'note' order by context->>'text' desc$$,
  $$values ('google_chat', 'Host is restarting the app server', 'Ploy', true, true),
           ('google_chat', 'Back in 5 min', 'Ploy', true, true)$$,
  'each note is its own NOTE reply in the thread, not held, no email (§16.5)'
);
select is(
  (select count(*)::int from public.audit_log where action = 'incident.note'),
  2, 'each note writes an audit row'
);
select tests.authenticate_as((select id from ids where name = 'admin'));
select lives_ok(format($$select public.add_incident_note(%L, 'Muted note')$$, (select id from inc where name = 'c')),
  'an Admin notes a muted incident');
reset role;
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'c')),
  0, 'a muted incident has no thread, so no NOTE reply'
);

-- ── Root cause ───────────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(format($$select public.save_root_cause(%L, 'aliens', 'x', null)$$, (select id from inc where name = 'a')),
  '22023', null, 'a category outside the nine is refused');
select throws_ok(format($$select public.save_root_cause(%L, 'hosting', '  ', null)$$, (select id from inc where name = 'a')),
  '22023', null, '"What happened" is required');
select lives_ok(format($$select public.save_root_cause(%L, 'hosting', 'Host rebooted the app server', '')$$,
  (select id from inc where name = 'a')), 'the owner saves a draft while it is still down');
reset role;
select is(
  (select root_cause_category || '/' || root_cause || '/' || coalesce(root_cause_fix, 'null') || '/' || state::text
   from public.incidents where id = (select id from inc where name = 'a')),
  'hosting/Host rebooted the app server/null/unacked',
  'the root cause is stored; an empty fix is null; the state is unchanged'
);
select is(
  (select (payload->>'first')::text || '/' || (payload->>'state') from public.incident_events
   where incident_id = (select id from inc where name = 'a') and type = 'root_cause'),
  'true/unacked',
  'the timeline can tell a first save while still down (a draft)'
);

-- ── Resolve: the three conditions (T10) ──────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_like(format($$select public.resolve_incident(%L, 'hosting', 'Host rebooted', null)$$, (select id from inc where name = 'a')),
  '%2 OK rounds%', 'still down: OK for 2 rounds is not met');
reset role;

-- Recovered and settled: Needs root cause (as engine_recover + engine_settle leave it).
update public.incidents set state = 'needs_root_cause', recovered_at = now() - interval '3 minutes'
  where id in ((select id from inc where name = 'a'), (select id from inc where name = 'b'));
update public.incidents set client_update_required = true where id = (select id from inc where name = 'a');

select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_like(format($$select public.resolve_incident(%L, 'hosting', 'Host rebooted', null)$$, (select id from inc where name = 'a')),
  '%client update%', 'client update required and not marked: not met');
reset role;
update public.incidents set client_update_required = false where id = (select id from inc where name = 'a');

select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_like(format($$select public.resolve_incident(%L, 'unknown', 'Still looking', null)$$, (select id from inc where name = 'a')),
  'Unknown keeps the incident open%', '"Unknown — keep investigating" doesn''t count');
select throws_ok(format($$select public.resolve_incident(%L, null, 'x', null)$$, (select id from inc where name = 'a')),
  '22023', null, 'no category: refused');

-- A flapping summary held for 15 min (as engine_recover_incident queues it).
reset role;
insert into public.notifications (incident_id, channel, template, thread_key, dedupe_key, hold_until)
values ((select id from inc where name = 'a'), 'google_chat', 'flap_summary',
        (select id from inc where name = 'a')::text, 'r1', now() + interval '12 minutes');

select tests.authenticate_as((select id from ids where name = 'arm'));
select is(public.resolve_incident((select id from inc where name = 'a'), 'hosting', 'Host rebooted the app server', 'Host restarted it'),
  now() + interval '10 seconds', 'all three met: resolved; messages go out 10 s later');
reset role;
select is(
  (select state::text || '/' || (resolved_by = (select id from ids where name = 'arm'))::text || '/' || root_cause_fix
   from public.incidents where id = (select id from inc where name = 'a')),
  'resolved/true/Host restarted it',
  'Resolved under that person, with the root cause'
);
select results_eq(
  $$select channel::text, user_id, hold_until, context->>'resolvedBy' from public.notifications
    where template = 'resolved' order by channel, user_id$$,
  $$select * from (values
      ('email', (select id from ids where name = 'arm'), now() + interval '10 seconds', 'Arm'),
      ('email', (select id from ids where name = 'ploy'), now() + interval '10 seconds', 'Arm'),
      ('google_chat', null::uuid, now() + interval '10 seconds', 'Arm')) v
    order by 1, 2$$,
  'RESOLVED held 10 s in the thread and to everyone already emailed'
);
select is(
  (select status::text || '/' || error from public.notifications where template = 'flap_summary'),
  'cancelled/Superseded: resolved',
  'the held flap summary is cancelled (S04b carry-over)'
);
select is(
  (select count(*)::int from public.claim_notifications('google_chat', 10) where template = 'resolved'),
  0, 'the notifier doesn''t claim a held RESOLVED'
);
select ok(
  exists (select 1 from public.audit_log where action = 'incident.resolved'
          and entity_id = (select id from inc where name = 'a') and after->>'state' = 'resolved'),
  'resolve writes an audit row'
);
select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_like(format($$select public.resolve_incident(%L, 'hosting', 'x', null)$$, (select id from inc where name = 'a')),
  '%already resolved%', 'a resolved incident can''t be resolved again');
select throws_like(format($$select public.save_root_cause(%L, 'hosting', 'x', null)$$, (select id from inc where name = 'a')),
  '%already resolved%', 'nor its root cause edited here');
reset role;

-- ── Undo ─────────────────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_ok(format('select public.undo_resolve(%L)', (select id from inc where name = 'a')),
  '42501', null, 'only the person who resolved can undo');
reset role;
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(format('select public.undo_resolve(%L)', (select id from inc where name = 'a')),
  'the resolver undoes inside the window');
reset role;
select is(
  (select state::text || '/' || coalesce(resolved_by::text, 'nobody') || '/' || root_cause_category
   from public.incidents where id = (select id from inc where name = 'a')),
  'needs_root_cause/nobody/hosting',
  'back to Needs root cause; the root cause stays saved'
);
select is(
  (select string_agg(distinct status::text, ',') from public.notifications where template = 'resolved'),
  'cancelled', 'every held RESOLVED is cancelled — nothing is sent'
);
select is(
  (select status::text from public.notifications where template = 'flap_summary'),
  'queued', 'the summary it set aside is due again'
);

-- Resolve again, then the window passes.
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(format($$select public.resolve_incident(%L, 'hosting', 'Host rebooted', null)$$,
  (select id from inc where name = 'a')), 'resolve again after Undo');
reset role;
select is(
  (select count(*)::int from public.notifications where template = 'resolved' and status = 'queued'),
  3, 'fresh RESOLVED messages are held again'
);
update public.incidents set resolved_at = now() - interval '11 seconds' where id = (select id from inc where name = 'a');
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_like(format('select public.undo_resolve(%L)', (select id from inc where name = 'a')),
  '%window has closed%', 'too late after 10 s');
reset role;

-- B (a PROBLEM): resolved by the backup; meanwhile the site opens a new incident → no undo.
select tests.authenticate_as((select id from ids where name = 'ploy'));
select lives_ok(format($$select public.resolve_incident(%L, 'deploy', 'Broken deploy, rolled back', null)$$,
  (select id from inc where name = 'b')), 'the backup resolves a PROBLEM');
reset role;
select ok(
  public.engine_open_incident('00000000-0000-0000-0000-0000000000a2', null, 'hard_fail', 'down',
    now(), now(), now(), '{}', true) is not null,
  'the site goes down again: a new incident'
);
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_like(format('select public.undo_resolve(%L)', (select id from inc where name = 'b')),
  '%new incident%', 'Undo refused: the site has a new incident');
reset role;

-- ── S06 review L2: a DOWN never relapses a PROBLEM incident ──────────────
update public.incidents set state = 'monitoring', recovered_at = now()
  where site_id = '00000000-0000-0000-0000-0000000000a2' and state <> 'resolved';
update public.incidents set severity = 'problem', episode_severity = 'problem'
  where site_id = '00000000-0000-0000-0000-0000000000a2' and state = 'monitoring';
select is(
  public.engine_relapse_incident(
    (select id from public.incidents where site_id = '00000000-0000-0000-0000-0000000000a2' and state = 'monitoring'),
    'down', 'hard_fail', now(), now(), now(), '{}', false, true),
  false,
  'engine_relapse_incident refuses a DOWN on a PROBLEM incident (that is engine_escalate_incident, D-021)'
);
select is(
  public.engine_relapse_incident(
    (select id from public.incidents where site_id = '00000000-0000-0000-0000-0000000000a2' and state = 'monitoring'),
    'problem', 'keyword', now(), now(), now(), '{}', false, true),
  true,
  'a PROBLEM relapse on it still goes through'
);

select * from finish();
rollback;
