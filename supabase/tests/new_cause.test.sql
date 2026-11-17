-- S13 (D-067): engine_new_cause_incident — an expiry incident takes a more urgent PROBLEM as its cause.
begin;
\ir _helpers.psql
select plan(36);

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
select ok((select expiry_left from public.incidents where id = '00000000-0000-0000-0000-0000000000e1'),
  'and remembers its cause came from SSL (it may go back to it)');
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

-- D-067 (H2): a PROBLEM AGAIN writes the cause it carries now.
set local role service_role;
select ok(
  public.engine_relapse_incident('00000000-0000-0000-0000-0000000000e1', 'problem', 'keyword', now(), now() + interval '500 milliseconds', now(), '{}', false, false),
  'the recovered SSL incident relapses on a keyword'
);
reset role;
select is((select trigger::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e1'), 'keyword',
  'PROBLEM AGAIN writes the trigger: it no longer reads as open for SSL');

-- Engine re-review H3: a keyword PROBLEM AGAIN never came from an expiry — it has nothing to go back to.
set local role service_role;
select ok(
  not public.engine_cause_back_incident('00000000-0000-0000-0000-0000000000e1', null, 'ssl', now(), '{}'),
  'a keyword relapse doesn''t turn into SSL expiring (it recovers instead)'
);
reset role;
select ok(not (select expiry_left from public.incidents where id = '00000000-0000-0000-0000-0000000000e1'),
  'a PROBLEM AGAIN clears the flag: its cause is its own');
-- It took the keyword from SSL instead (as engine_new_cause_incident marks it).
update public.incidents set expiry_left = true where id = '00000000-0000-0000-0000-0000000000e1';
insert into public.site_status (site_id, status, since, last_evaluated_at, last_round_at)
values ('00000000-0000-0000-0000-0000000000a1', 'problem', now() - interval '1 day', now() - interval '3 minutes',
        now() - interval '3 minutes')
on conflict (site_id) do update set last_round_at = excluded.last_round_at, ok_rounds = 2;

-- D-067 item 4: the keyword cleared, the certificate still 13 days out — back to SSL, silently.
insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key, hold_until)
  values ('00000000-0000-0000-0000-0000000000e1', 'google_chat', 'problem_again',
          '00000000-0000-0000-0000-0000000000e1', '{"newCause": true}', 'new_cause:held', now() + interval '8 hours');
set local role service_role;
select ok(
  public.engine_cause_back_incident('00000000-0000-0000-0000-0000000000e1', null, 'ssl', now(),
    '{"cause": "SSL certificate expires in 13 days (Tue 6 Oct)"}'),
  'a keyword incident goes back to SSL expiring'
);
reset role;
select is((select trigger::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e1'), 'ssl',
  'it reads SSL expiring again');
select ok(
  exists (select 1 from public.incident_events
     where incident_id = '00000000-0000-0000-0000-0000000000e1' and type = 'new_cause'
       and (payload ->> 'back')::boolean and payload ->> 'was' = 'keyword' and payload ->> 'trigger' = 'ssl'),
  'the timeline says it went back, from what'
);
select is(
  (select count(*)::int from public.audit_log where entity_id = '00000000-0000-0000-0000-0000000000e1' and action = 'incident.cause_back'),
  1, 'one audit row'
);
select is(
  (select status::text from public.notifications where dedupe_key = 'new_cause:held'),
  'cancelled', 'a new-cause reply not sent yet is cancelled'
);
select ok(
  (select last_round_at = now() and ok_rounds = 0 from public.site_status
     where site_id = '00000000-0000-0000-0000-0000000000a1'),
  'the site''s round moves on with it (the next run judges the site, engine re-review H1)'
);

-- Engine re-review: a key page flipping is told once per 30 min.
update public.incidents set trigger = 'ssl' where id = '00000000-0000-0000-0000-0000000000e1';
insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
  values ('00000000-0000-0000-0000-0000000000e1', 'google_chat', 'problem_again',
          '00000000-0000-0000-0000-0000000000e1', '{"newCause": true, "trigger": "key_page"}', 'new_cause:earlier');
set local role service_role;
select ok(
  public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e1', null, 'key_page',
    now() + interval '3 minutes', '{}', true),
  'the key page takes over again'
);
reset role;
select is(
  (select count(*)::int from public.notifications where incident_id = '00000000-0000-0000-0000-0000000000e1'
     and channel = 'google_chat' and template = 'problem_again' and context ->> 'trigger' = 'key_page'
     and status <> 'cancelled'),
  1, 'no second reply within 30 min'
);
update public.incidents set trigger = 'ssl' where id = '00000000-0000-0000-0000-0000000000e1';

-- Engine re-review M2: a PROBLEM AGAIN on a DOWN incident keeps its trigger.
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'VOCA', 1,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'http', true, 'https://b.pgtap.test');
insert into public.incidents (id, site_id, monitor_id, trigger, severity, episode_severity, state, started_at, detected_at, recovered_at)
  values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2',
          '00000000-0000-0000-0000-0000000000d2', 'manual', 'down', 'down', 'monitoring',
          now() - interval '1 hour', now() - interval '1 hour', now() - interval '10 minutes');
set local role service_role;
select ok(
  public.engine_relapse_incident('00000000-0000-0000-0000-0000000000e2', 'problem', 'key_page', now(), now(), now(), '{}', false, false),
  'a key page fails after the DOWN came back (PROBLEM AGAIN)'
);
reset role;
select is((select trigger::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e2'), 'manual',
  'the DOWN incident keeps its trigger (a hand-opened DOWN stays manual)');

-- Tao, 17 Nov: a DOWN incident whose PROBLEM drop is SSL takes a new cause too, its trigger kept.
set local role service_role;
select ok(
  public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e2', null, 'keyword', now(), '{}', false,
    p_was => 'ssl'),
  'a DOWN incident back up on SSL takes the keyword as its new cause'
);
select ok(
  not public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e2', null, 'keyword', now(), '{}', false),
  'without the expiry its drop carried, it doesn''t'
);
reset role;
select ok(
  (select trigger = 'manual' and expiry_left from public.incidents where id = '00000000-0000-0000-0000-0000000000e2'),
  'its trigger stays manual, and it may go back to SSL'
);
set local role service_role;
select ok(
  not public.engine_cause_back_incident('00000000-0000-0000-0000-0000000000e1', null, 'domain', now(), '{}'),
  'an expiry incident has nothing to go back to'
);
reset role;

-- D-067 item 3: an incident open only for an expiry doesn't stop a window or a mute.
select is(private.site_busy('00000000-0000-0000-0000-0000000000a1'), null, 'an SSL incident leaves the site free');
update public.incidents set trigger = 'keyword' where id = '00000000-0000-0000-0000-0000000000e1';
select is(private.site_busy('00000000-0000-0000-0000-0000000000a1'), 'INC-' || lpad(
  (select number::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e1'), 4, '0'),
  'a keyword incident still blocks it');

-- D-067 item 2: a D-023 drop of a DOWN takes no new cause.
update public.incidents set trigger = 'ssl', severity = 'down', episode_severity = 'problem'
  where id = '00000000-0000-0000-0000-0000000000e1';
set local role service_role;
select ok(
  not public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e1', null, 'keyword', now(), '{}', true),
  'a DOWN incident whose home page is back takes no new cause'
);
reset role;

-- D-067 item 5: a first card a mute silenced goes after it, worded with the cause it carries now.
update public.incidents set severity = 'problem', state = 'unacked', acked_at = null
  where id = '00000000-0000-0000-0000-0000000000e1';
delete from public.notifications where incident_id = '00000000-0000-0000-0000-0000000000e1';
insert into public.incident_events (incident_id, type, payload, at) values
  ('00000000-0000-0000-0000-0000000000e1', 'new_cause', '{"cause": "Found “บาคาร่า” on /", "trigger": "keyword"}', now() + interval '4 minutes');
set local role service_role;
select ok(public.engine_post_late_alert('00000000-0000-0000-0000-0000000000e1', now() + interval '5 minutes'),
  'the late card is queued');
reset role;
select is(
  (select context ->> 'cause' from public.notifications where incident_id = '00000000-0000-0000-0000-0000000000e1'
     and channel = 'google_chat' and template = 'problem'),
  'Found “บาคาร่า” on /', 'worded with the new cause, not the SSL it opened with'
);

select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(
  $$select public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e1', null, 'keyword', now(), '{}', true)$$,
  '42501', null, 'a signed-in session can''t call it'
);

select * from finish();
rollback;
