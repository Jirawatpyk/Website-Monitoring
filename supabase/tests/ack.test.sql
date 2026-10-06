-- Acknowledge + Undo (S02b, D-016): who may ack, the 10 s hold, Undo cancels everything held,
-- re-ack after Undo, the fallback email audience, and the attempts log's RLS.
begin;
\ir _helpers.psql
select plan(45);

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
-- Site A: Arm owns it, Ploy is backup. Site C: nobody owns it.
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'ploy')),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1', 'Site C', 2,
   null, null);

create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated;
insert into inc values
  ('a', public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
     now() - interval '90 seconds', now(), now(), '{"cause":"HTTP 500 (SIN, TYO)"}', true)),
  -- Muted: the incident opens but nothing was queued.
  ('c', public.engine_open_incident('00000000-0000-0000-0000-0000000000a3', null, 'hard_fail', 'down',
     now() - interval '90 seconds', now(), now(), '{}', false));

-- ── Who may acknowledge ──────────────────────────────────────────────────
select tests.as_anon();
select throws_ok(format('select public.ack_incident(%L)', (select id from inc where name = 'a')),
  '42501', null, 'anon can''t acknowledge');
reset role;

select tests.authenticate_as((select id from ids where name = 'mint'));
select throws_ok(format('select public.ack_incident(%L)', (select id from inc where name = 'a')),
  '42501', null, 'a Viewer can''t acknowledge');
reset role;
select tests.authenticate_as((select id from ids where name = 'bua'));
select throws_ok(format('select public.ack_incident(%L)', (select id from inc where name = 'a')),
  '42501', null, 'a Stakeholder can''t acknowledge');
reset role;
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok(format('select public.ack_incident(%L)', (select id from inc where name = 'a')),
  '42501', null, 'a Responder who doesn''t own the site can''t acknowledge (on call: S10)');
select throws_ok(format('select public.ack_incident(%L)', gen_random_uuid()),
  'P0002', null, 'an unknown incident is "not found"');
reset role;

-- ── Ack holds its messages for 10 s ──────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select is(public.ack_incident((select id from inc where name = 'a')), now() + interval '10 seconds',
  'the owner acknowledges; messages go out 10 s later');
reset role;

select is(
  (select state::text || '/' || (acked_by = (select id from ids where name = 'arm'))::text
   from public.incidents where id = (select id from inc where name = 'a')),
  'acknowledged/true',
  'the incident is Acknowledged under that person'
);
select results_eq(
  $$select channel::text, user_id, hold_until from public.notifications
    where template = 'acknowledged' order by channel$$,
  $$values ('email', (select id from ids where name = 'arm'), now() + interval '10 seconds'),
           ('google_chat', null::uuid, now() + interval '10 seconds')$$,
  'ACKNOWLEDGED is held for Chat and for everyone already emailed'
);
select is(
  (select context->>'ackedBy' from public.notifications where template = 'acknowledged' limit 1),
  'Arm',
  'the message names who acknowledged'
);
select is(
  (select count(*)::int from public.claim_notifications('google_chat', 10) where template = 'acknowledged'),
  0,
  'the notifier doesn''t claim a held message'
);

select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok(format('select public.ack_incident(%L)', (select id from inc where name = 'a')),
  '55000', null, 'an acknowledged incident can''t be acknowledged again');
reset role;

-- ── Undo ─────────────────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'ploy'));
select throws_ok(format('select public.undo_ack(%L)', (select id from inc where name = 'a')),
  '42501', null, 'only the person who acknowledged can undo');
reset role;

select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(format('select public.undo_ack(%L)', (select id from inc where name = 'a')),
  'the owner undoes inside the window');
reset role;
select is(
  (select state::text || '/' || coalesce(acked_by::text, 'nobody')
   from public.incidents where id = (select id from inc where name = 'a')),
  'unacked/nobody',
  'the incident is back to Unacked'
);
select is(
  (select string_agg(distinct status::text, ',') from public.notifications where template = 'acknowledged'),
  'cancelled',
  'every held ACKNOWLEDGED message is cancelled (T08: nothing is sent)'
);
select results_eq(
  format($$select type from public.incident_events where incident_id = %L
           and type in ('acknowledged', 'ack_undone') order by type$$, (select id from inc where name = 'a')),
  $$values ('ack_undone'), ('acknowledged')$$,
  'the timeline keeps the ack and its undo'
);
select results_eq(
  format($$select action, actor_id from public.audit_log where entity_id = %L
           and action like 'incident.ack%%' order by action$$, (select id from inc where name = 'a')),
  $$values ('incident.ack', (select id from ids where name = 'arm')),
           ('incident.ack_undone', (select id from ids where name = 'arm'))$$,
  'both are audited under the person'
);

select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(format('select public.undo_ack(%L)', (select id from inc where name = 'a')),
  '55000', null, 'a second Undo (double tap) is "nothing to undo", not "not yours"');
reset role;

-- Re-ack after Undo queues fresh messages (the cancelled ones don't block them).
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(format('select public.ack_incident(%L)', (select id from inc where name = 'a')),
  'acknowledging again after Undo works');
reset role;
select is(
  (select count(*)::int from public.notifications where template = 'acknowledged' and status = 'queued'),
  2,
  'with a new held Chat reply and email'
);

-- A message the notifier already claimed can't be undone.
update public.notifications set attempts = 1
  where template = 'acknowledged' and status = 'queued' and channel = 'google_chat';
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(format('select public.undo_ack(%L)', (select id from inc where name = 'a')),
  '55000', null, 'Undo is refused once a message is being sent');
reset role;

-- After 10 s it's too late.
update public.notifications set attempts = 0 where template = 'acknowledged' and status = 'queued';
update public.incidents set acked_at = now() - interval '11 seconds'
  where id = (select id from inc where name = 'a');
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(format('select public.undo_ack(%L)', (select id from inc where name = 'a')),
  '55000', null, 'Undo is refused after the 10 s window');
reset role;

-- ── Backup and Admin; a muted incident ───────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'admin'));
select lives_ok(format('select public.ack_incident(%L)', (select id from inc where name = 'c')),
  'an Admin acknowledges a site nobody owns');
reset role;
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'c')),
  0,
  'a muted incident posts no ACKNOWLEDGED (nothing was posted before)'
);

-- ── Fallback email audience (D-016) ──────────────────────────────────────
-- (While the incident still waits for an ack — a moved-on DOWN gets none, tested below.)
update public.incidents set state = 'escalated' where id = (select id from inc where name = 'a');
select is(
  public.queue_fallback_emails((select id from public.notifications
    where incident_id = (select id from inc where name = 'a') and channel = 'google_chat' and template = 'down')),
  1 + (select count(*)::int from public.profiles where role = 'admin' and is_active),
  'Chat failed: the DOWN is emailed to the backup and every active Admin'
);
select is(
  (select string_agg(p.display_name, ',') from public.notifications n join public.profiles p on p.id = n.user_id
   where n.incident_id = (select id from inc where name = 'a') and n.channel = 'email'
     and n.template = 'down' and not n.context ? 'fallback'),
  'Arm',
  'only the owner''s record copy is unmarked; every other DOWN email is a fallback'
);
select is(
  public.queue_fallback_emails((select id from public.notifications
    where incident_id = (select id from inc where name = 'a') and channel = 'google_chat' and template = 'down')),
  0,
  'running it again queues nothing'
);

-- The engine's and fallback's `on conflict do nothing` meet the partial unique index.
select lives_ok(
  format($$insert into public.notifications (incident_id, user_id, channel, template)
           values (%L, (select id from ids where name = 'arm'), 'email', 'down') on conflict do nothing$$,
         (select id from inc where name = 'a')),
  'a second live copy of a message is skipped by on conflict do nothing'
);
select is(
  (select count(*)::int from public.notifications
   where incident_id = (select id from inc where name = 'a') and channel = 'email' and template = 'down'
     and user_id = (select id from ids where name = 'arm')),
  1,
  'so each person still has one DOWN email'
);

-- Undo after the incident moved on (recovered) is "too late", not "not yours".
update public.incidents set state = 'monitoring', acked_at = now() where id = (select id from inc where name = 'a');
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(format('select public.undo_ack(%L)', (select id from inc where name = 'a')),
  '55000', null, 'Undo after the incident recovered is refused as too late');
reset role;

-- ── Deactivated people get nothing (security review M1) ──────────────────
insert into ids values ('gone', tests.create_user('gone@pgtap.test', 'responder'));
update public.profiles set is_active = false where id = (select id from ids where name = 'gone');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c1', 'Site D', 1,
   (select id from ids where name = 'gone'));
insert into inc values ('d', public.engine_open_incident('00000000-0000-0000-0000-0000000000a4', null,
  'hard_fail', 'down', now() - interval '90 seconds', now(), now(), '{}', true));
select is(
  (select count(*)::int from public.notifications
   where incident_id = (select id from inc where name = 'd') and channel = 'email'),
  0,
  'a deactivated owner gets no DOWN email'
);

-- ── One thread, in order; one incident's flush ───────────────────────────
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000c1', 'Site E', 1,
   (select id from ids where name = 'arm'));
insert into inc values ('e', public.engine_open_incident('00000000-0000-0000-0000-0000000000a5', null,
  'hard_fail', 'down', now() - interval '90 seconds', now(), now(), '{}', true));
insert into public.notifications (incident_id, channel, template, thread_key, created_at)
values ((select id from inc where name = 'e'), 'google_chat', 'recovered',
        (select id from inc where name = 'e')::text, now() + interval '1 second');
select results_eq(
  format($$select incident_id, template from public.claim_notifications('google_chat', 10, %L)$$,
    (select id from inc where name = 'e')),
  format($$values (%L::uuid, 'down'::text)$$, (select id from inc where name = 'e')),
  'the flush of one incident claims only its rows, and a reply waits for the DOWN before it'
);
select is(
  (select count(*)::int from public.claim_notifications('google_chat', 10,
    (select id from inc where name = 'e'))),
  0,
  'while the DOWN is still queued (retrying), the later reply stays behind it'
);
select is(
  (select count(*)::int from public.claim_notifications('email', 10,
    (select id from inc where name = 'e'))),
  1,
  'the email thread has its own order: the DOWN email goes'
);

-- A DOWN whose incident has moved on gets no fallback.
update public.incidents set state = 'acknowledged' where id = (select id from inc where name = 'e');
select is(
  public.queue_fallback_emails((select id from public.notifications
    where incident_id = (select id from inc where name = 'e') and channel = 'google_chat' and template = 'down')),
  0,
  'no fallback for a DOWN that is no longer the news'
);
select ok(
  not exists (select 1 from pg_proc where proname = 'claim_notifications' and pronargs = 2),
  'the old two-argument claim is gone'
);

-- ── A DOWN in backoff doesn't hold the ack back; Undo puts it back (engine review r2) ──
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000c1', 'Site F', 1,
   (select id from ids where name = 'arm'));
insert into inc values ('f', public.engine_open_incident('00000000-0000-0000-0000-0000000000a6', null,
  'hard_fail', 'down', now() - interval '90 seconds', now(), now(), '{}', true));
-- The Chat DOWN failed once and waits for its +2 min retry.
update public.notifications set attempts = 1, next_retry_at = now() + interval '2 minutes'
  where incident_id = (select id from inc where name = 'f') and channel = 'google_chat';
insert into public.notification_attempts (notification_id, attempt, ok, error)
select id, 1, false, 'HTTP 500' from public.notifications
where incident_id = (select id from inc where name = 'f') and channel = 'google_chat';

select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(format('select public.ack_incident(%L)', (select id from inc where name = 'f')),
  'the owner acks while the Chat DOWN waits for a retry');
reset role;
select results_eq(
  format($$select template, status::text from public.notifications
           where incident_id = %L and channel = 'google_chat' order by template$$, (select id from inc where name = 'f')),
  $$values ('acknowledged', 'queued'), ('down', 'cancelled')$$,
  'the retrying DOWN is set aside, so ACKNOWLEDGED isn''t stuck behind its backoff'
);
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(format('select public.undo_ack(%L)', (select id from inc where name = 'f')), 'Undo');
reset role;
select is(
  (select status::text from public.notifications
   where incident_id = (select id from inc where name = 'f') and channel = 'google_chat' and template = 'down'),
  'queued',
  'Undo puts the DOWN back, as if the ack never happened'
);

-- A judged round never moves back (overlapping engine runs).
select public.engine_record_round('00000000-0000-0000-0000-0000000000a6', now() + interval '1 minute', now(), 1::smallint);
select public.engine_record_round('00000000-0000-0000-0000-0000000000a6', now(), now(), 0::smallint);
select is(
  (select ok_rounds from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a6'),
  1::smallint,
  'a run with an older snapshot doesn''t move site_status back to an older round'
);

-- ── Delivery log RLS ─────────────────────────────────────────────────────
insert into public.notification_attempts (notification_id, attempt, ok, error)
select id, 1, false, 'HTTP 500' from public.notifications
where incident_id = (select id from inc where name = 'a') and channel = 'google_chat' and template = 'down';

select tests.authenticate_as((select id from ids where name = 'admin'));
select is((select count(*)::int from public.notification_attempts), 2, 'an Admin reads the attempts log');
select throws_ok(
  $$select public.queue_fallback_emails(gen_random_uuid())$$,
  '42501', null, 'only the service role queues fallback emails'
);
reset role;
select tests.authenticate_as((select id from ids where name = 'arm'));
select is_empty('select * from public.notification_attempts', 'a Responder can''t read the attempts log');
select throws_ok(
  $$insert into public.notification_attempts (notification_id, attempt, ok) values (gen_random_uuid(), 1, true)$$,
  '42501', null, 'nobody writes the attempts log through the API'
);
reset role;

select * from finish();
rollback;
