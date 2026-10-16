-- D-047 (16 Oct 2026, INC-0015): a drop that recovers within 5 min sends no email. The alert email
-- waits out a 5-min grace; a recovery inside it cancels it, so no RECOVERED or RESOLVED email follows.
-- An ack or a failed Chat alert releases it at once. Chat is unchanged. One transaction has one now():
-- `tests.grace_elapsed` stands in for the 5 min passing.
begin;
\ir _helpers.psql
select plan(21);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('admin', tests.create_user('admin@pgtap.test', 'admin')),
  ('alex',  tests.create_user('alex@pgtap.test', 'responder')),
  ('tle',   tests.create_user('tle@pgtap.test', 'responder'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id)
select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, '00000000-0000-0000-0000-0000000000c1',
       'Site ' || n, 1, (select id from ids where name = 'alex'), (select id from ids where name = 'tle')
from generate_series(1, 7) n;

create temp table inc (name text primary key, id uuid) on commit drop;
grant select on inc to anon, authenticated;
create function pg_temp.open(p_name text, p_site int, p_severity public.severity, p_hold timestamptz default null)
returns void language sql as $$
  insert into inc values (p_name, public.engine_open_incident(
    ('00000000-0000-0000-0000-0000000000a' || p_site)::uuid, null,
    case when p_severity = 'down' then 'hard_fail' else 'slow' end::public.incident_trigger, p_severity,
    now() - interval '90 seconds', now(), now(), '{}', true, null, null, p_hold))
$$;
create function pg_temp.mail(p_name text, p_template text) returns text language sql as $$
  select string_agg(status::text || coalesce(' · ' || error, ''), ', ' order by created_at)
  from public.notifications
  where incident_id = (select id from inc where name = p_name) and channel = 'email' and template = p_template
$$;
create function pg_temp.recover(p_name text, p_from public.incident_state default 'unacked') returns boolean
language sql as $$
  select public.engine_recover_incident((select id from inc where name = p_name), p_from, 'monitoring',
    now(), now(), '{}'::jsonb, true, null, null, true)
$$;

-- ── A short DOWN (INC-0015: 1 min) ───────────────────────────────────────
select pg_temp.open('short', 1, 'down');
select results_eq(
  $$select channel::text, hold_until from public.notifications
    where incident_id = (select id from inc where name = 'short') order by channel$$,
  $$values ('email', now() + interval '5 minutes'), ('google_chat', null::timestamptz)$$,
  'the DOWN card goes at once; the owner''s email waits 5 min'
);
select is(
  (select count(*)::int from public.claim_notifications('email', 10, (select id from inc where name = 'short'))),
  0, 'the email isn''t claimed inside the grace'
);
select ok(pg_temp.recover('short'), 'it recovers inside the 5 min');
select is(pg_temp.mail('short', 'down'), 'cancelled · Recovered within 5 min — no email (D-047)',
  'the held DOWN email is cancelled, saying why');
select is(pg_temp.mail('short', 'recovered'), null, 'nobody was emailed, so no RECOVERED email');
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'short')
     and channel = 'google_chat' and template = 'recovered'),
  1, 'Chat still gets RECOVERED'
);
-- Two OK rounds, a root cause, Resolve: RESOLVED in Chat, no email.
select ok(public.engine_settle_incident((select id from inc where name = 'short'), 'monitoring',
  'needs_root_cause', now(), now()), 'settles');
select tests.authenticate_as((select id from ids where name = 'admin'));
select lives_ok(format($$select public.resolve_incident(%L, 'hosting', 'The server stopped responding for a minute', null)$$,
  (select id from inc where name = 'short')), 'an Admin resolves it');
reset role;
select results_eq(
  $$select channel::text from public.notifications
    where incident_id = (select id from inc where name = 'short') and template = 'resolved'$$,
  $$values ('google_chat')$$,
  'RESOLVED goes to Chat only: nobody was emailed about it'
);

-- ── Down past the grace ──────────────────────────────────────────────────
select pg_temp.open('long', 2, 'down');
select tests.grace_elapsed((select id from inc where name = 'long'));
select results_eq(
  format($$select template from public.claim_notifications('email', 10, %L)$$, (select id from inc where name = 'long')),
  $$values ('down')$$, 'still down after 5 min: the DOWN email goes'
);
update public.notifications set status = 'sent', sent_at = now()
  where incident_id = (select id from inc where name = 'long') and channel = 'email' and template = 'down';
select ok(pg_temp.recover('long'), 'then it recovers');
select is(pg_temp.mail('long', 'recovered'), 'queued', 'and the owner gets the RECOVERED email');

-- ── Acknowledged inside the grace ────────────────────────────────────────
select pg_temp.open('acked', 3, 'down');
select tests.authenticate_as((select id from ids where name = 'alex'));
select lives_ok(format('select public.ack_incident(%L)', (select id from inc where name = 'acked')), 'Alex acknowledges at once');
reset role;
select is(
  (select hold_until from public.notifications where incident_id = (select id from inc where name = 'acked')
     and channel = 'email' and template = 'down'),
  now(), 'someone took it: the held DOWN email goes now'
);
select results_eq(
  format($$select template from public.claim_notifications('email', 10, %L)$$, (select id from inc where name = 'acked')),
  $$values ('down')$$,
  'the DOWN email goes first; the ACKNOWLEDGED email waits for its Undo window behind it'
);

-- ── The Chat alert failed for good (D-016) ───────────────────────────────
select pg_temp.open('nochat', 4, 'down');
select public.queue_fallback_emails((select id from public.notifications
  where incident_id = (select id from inc where name = 'nochat') and channel = 'google_chat'));
select is(
  (select hold_until from public.notifications where incident_id = (select id from inc where name = 'nochat')
     and channel = 'email' and template = 'down' and user_id = (select id from ids where name = 'alex')),
  now(), 'Chat couldn''t deliver: the owner''s email is the alert and goes now'
);

-- ── PROBLEM: the same grace; a response-hours hold stays the longer one ──
select pg_temp.open('problem', 5, 'problem');
select ok(pg_temp.recover('problem'), 'a short PROBLEM recovers');
select is(pg_temp.mail('problem', 'problem'), 'cancelled · Recovered within 5 min — no email (D-047)',
  'its email is cancelled too');
select pg_temp.open('night', 6, 'problem', now() + interval '9 hours');
select is(
  (select hold_until from public.notifications where incident_id = (select id from inc where name = 'night')
     and channel = 'email'),
  now() + interval '9 hours', 'outside response hours the PROBLEM email keeps its 09:00 hold'
);

-- ── Flapping: every drop came back inside 5 min ──────────────────────────
select pg_temp.open('flap', 7, 'down');
select pg_temp.recover('flap');
select public.engine_relapse_incident((select id from inc where name = 'flap'), 'down', 'hard_fail',
  now(), now(), now(), '{}'::jsonb, true, true);
select public.engine_recover_incident((select id from inc where name = 'flap'), 'unacked', 'monitoring',
  now(), now(), '{}'::jsonb, true, null, null, true, false, true);
select is(
  (select count(*)::int from public.notifications where incident_id = (select id from inc where name = 'flap')
     and template = 'flap_summary' and channel = 'google_chat'),
  1, 'the flapping summary still goes to Chat'
);
select is(pg_temp.mail('flap', 'flap_summary'), null, 'but not by email: the owner was never emailed about it');

select * from finish();
rollback;
