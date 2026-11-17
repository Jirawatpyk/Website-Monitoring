-- S13 (D-067): engine_new_cause_incident — an expiry incident takes a more urgent PROBLEM as its cause.
begin;
\ir _helpers.psql
select plan(12);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values ('arm', tests.create_user('arm@pgtap.test', 'responder'));
update public.profiles set google_chat_user_id = '100000000000000000001' where id = (select id from ids where name = 'arm');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'DxT AI', 3,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true, 'https://a.pgtap.test');
insert into public.incidents (id, site_id, monitor_id, trigger, severity, episode_severity, state, started_at, detected_at, escalation_plan)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000d1', 'ssl', 'problem', 'problem', 'acknowledged',
          now() - interval '2 days', now() - interval '2 days',
          public.escalation_plan_for(3::smallint, 'problem'));
-- The SSL card is still held for the opening (a Tier 3 PROBLEM at night).
insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
  values ('00000000-0000-0000-0000-0000000000e1', 'google_chat', 'problem',
          '00000000-0000-0000-0000-0000000000e1', '{}', now() + interval '8 hours');

set local role service_role;
select ok(
  public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1',
    'keyword', now(), '{"cause": "Found “บาคาร่า” on / (as Googlebot)", "summary": "x"}', true),
  'an acknowledged SSL incident takes a keyword as its new cause'
);
reset role;

select is((select trigger::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e1'), 'keyword',
  'the incident now reads Keyword');
select is((select state::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e1'), 'acknowledged',
  'its state is kept (the ladder carries on)');
select is(
  (select payload ->> 'was' from public.incident_events where incident_id = '00000000-0000-0000-0000-0000000000e1' and type = 'new_cause'),
  'ssl', 'the timeline says what it was'
);
select is(
  (select after ->> 'trigger' from public.audit_log where entity_id = '00000000-0000-0000-0000-0000000000e1' and action = 'incident.new_cause'),
  'keyword', 'one audit row, before → after'
);
select is(
  (select count(*)::int from public.notifications where incident_id = '00000000-0000-0000-0000-0000000000e1'
     and template = 'problem_again' and channel = 'google_chat' and hold_until is null
     and (context ->> 'newCause')::boolean and dedupe_key like 'new_cause:%'),
  1, 'one Chat reply, posted now'
);
select ok(
  (select hold_until <= now() from public.notifications where incident_id = '00000000-0000-0000-0000-0000000000e1' and template = 'problem'),
  'the held SSL card is released so the reply doesn''t wait behind it'
);
select is(
  (select count(*)::int from public.notifications where incident_id = '00000000-0000-0000-0000-0000000000e1'
     and template = 'problem_again' and channel = 'email'
     and user_id = (select id from ids where name = 'arm') and hold_until > now()),
  1, 'the owner (L0) gets the email after the 5-min grace'
);

set local role service_role;
select ok(
  not public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e1', null, 'slow', now(), '{}', true),
  'once the cause is no longer an expiry, nothing more switches'
);
reset role;
update public.incidents set trigger = 'ssl' where id = '00000000-0000-0000-0000-0000000000e1';
set local role service_role;
select ok(
  not public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e1', null, 'domain', now(), '{}', true),
  'another expiry is not a new cause'
);
reset role;
update public.incidents set state = 'monitoring' where id = '00000000-0000-0000-0000-0000000000e1';
set local role service_role;
select ok(
  not public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e1', null, 'keyword', now(), '{}', true),
  'a recovered incident relapses instead (PROBLEM AGAIN)'
);
reset role;

select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(
  $$select public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e1', null, 'keyword', now(), '{}', true)$$,
  '42501', null, 'a signed-in session can''t call it'
);

select * from finish();
rollback;
