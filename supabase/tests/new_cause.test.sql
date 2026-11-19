-- S13 (D-067): engine_new_cause_incident — an expiry incident takes a more urgent PROBLEM as its cause.
begin;
\ir _helpers.psql
select plan(81);

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
update public.incidents set trigger = 'ssl', cause_trigger = null where id = '00000000-0000-0000-0000-0000000000e1';
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
update public.incidents set trigger = 'ssl', cause_trigger = null where id = '00000000-0000-0000-0000-0000000000e1';
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
update public.incidents set trigger = 'ssl', cause_trigger = null where id = '00000000-0000-0000-0000-0000000000e1';

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
select is((select cause_trigger::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e2'),
  'key_page', 'the PROBLEM AGAIN stored its drop''s cause');
set local role service_role;
select ok(
  not public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e2', null, 'keyword', now(), '{}', false),
  'a key-page drop takes no new cause'
);
reset role;
-- Its drop is SSL instead (a PROBLEM AGAIN into the expiry).
update public.incidents set cause_trigger = 'ssl' where id = '00000000-0000-0000-0000-0000000000e2';
set local role service_role;
select ok(
  public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e2', null, 'keyword', now(), '{}', false),
  'a DOWN incident back up on SSL takes the keyword as its new cause'
);
reset role;
select ok(
  (select trigger = 'manual' and cause_trigger = 'keyword' and expiry_left from public.incidents
     where id = '00000000-0000-0000-0000-0000000000e2'),
  'its trigger stays manual, the drop''s cause is the keyword, and it may go back to SSL'
);
select is(private.site_busy('00000000-0000-0000-0000-0000000000a2'), 'INC-' || lpad(
  (select number::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e2'), 4, '0'),
  'its keyword blocks a window');
update public.incidents set cause_trigger = 'ssl' where id = '00000000-0000-0000-0000-0000000000e2';
select is(private.site_busy('00000000-0000-0000-0000-0000000000a2'), null,
  'back on SSL alone it doesn''t (Tao, 17 Nov)');
set local role service_role;
select ok(
  not public.engine_cause_back_incident('00000000-0000-0000-0000-0000000000e1', null, 'ssl', now(), '{}'),
  'an SSL incident has nothing to go back to on SSL'
);
reset role;

-- D-067 item 3: an incident open only for an expiry doesn't stop a window or a mute.
select is(private.site_busy('00000000-0000-0000-0000-0000000000a1'), null, 'an SSL incident leaves the site free');
update public.incidents set trigger = 'keyword', cause_trigger = null where id = '00000000-0000-0000-0000-0000000000e1';
select is(private.site_busy('00000000-0000-0000-0000-0000000000a1'), 'INC-' || lpad(
  (select number::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e1'), 4, '0'),
  'a keyword incident still blocks it');

-- D-067 item 2: a D-023 drop of a DOWN takes no new cause.
update public.incidents set trigger = 'ssl', cause_trigger = 'key_page', severity = 'down', episode_severity = 'problem'
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

-- Tao, 17 Nov: a Tier 1 new cause at night names the person on call on its reply and email only.
insert into ids values ('nok', tests.create_user('nok@pgtap.test', 'responder'));
update public.profiles set google_chat_user_id = '100000000000000000002' where id = (select id from ids where name = 'nok');
insert into public.oncall_shifts (user_id, starts_at, ends_at, slot)
values ((select id from ids where name = 'nok'), now() - interval '1 day', now() + interval '6 days', 1);
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1', 'Night', 1,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a3', 'http', true, 'https://c.pgtap.test');
insert into public.incidents (id, site_id, monitor_id, trigger, severity, episode_severity, state, started_at, detected_at, escalation_plan)
  values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a3',
          '00000000-0000-0000-0000-0000000000d3', 'ssl', 'problem', 'problem', 'unacked',
          now() - interval '1 day', now() - interval '1 day', public.escalation_plan_for(1::smallint, 'problem'));
set local role service_role;
select ok(
  public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e3', null, 'keyword', now(), '{"summary": "x"}', true,
    p_outside_hours => true),
  'a Tier 1 new cause at night'
);
reset role;
select is(
  (select context -> 'mention' ->> 'id' from public.notifications
     where incident_id = '00000000-0000-0000-0000-0000000000e3' and channel = 'google_chat'),
  (select id::text from ids where name = 'nok'), 'the reply @mentions the person on call'
);
select is(
  (select array_agg(user_id::text) from public.notifications
     where incident_id = '00000000-0000-0000-0000-0000000000e3' and channel = 'email'),
  array[(select id::text from ids where name = 'nok')], 'only the person on call is emailed, not the owner'
);
select ok(
  (select l0_user_id is null from public.incidents where id = '00000000-0000-0000-0000-0000000000e3')
  and (select payload -> 'mention' ->> 'id' = (select id::text from ids where name = 'nok') from public.incident_events
         where incident_id = '00000000-0000-0000-0000-0000000000e3' and type = 'new_cause'),
  'L0 is kept; the event records whom it told'
);

-- Tao, 17 Nov: SSL renewed with the domain still due → Domain expiring, silently.
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c1', 'Renewed', 1,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a4', 'http', true, 'https://d.pgtap.test');
insert into public.incidents (id, site_id, monitor_id, trigger, severity, episode_severity, state, started_at, detected_at,
                              acked_at, acked_by, escalation_plan)
  values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a4',
          '00000000-0000-0000-0000-0000000000d4', 'ssl', 'problem', 'problem', 'acknowledged',
          now() - interval '9 days', now() - interval '9 days', now() - interval '9 days',
          (select id from ids where name = 'arm'), public.escalation_plan_for(1::smallint, 'problem'));
-- The ack's ACKNOWLEDGED reply went 9 days ago.
insert into public.notifications (incident_id, channel, template, thread_key, context, status, sent_at, created_at)
  values ('00000000-0000-0000-0000-0000000000e4', 'google_chat', 'acknowledged', '00000000-0000-0000-0000-0000000000e4',
          '{}', 'sent', now() - interval '9 days', now() - interval '9 days');
set local role service_role;
select ok(
  public.engine_cause_back_incident('00000000-0000-0000-0000-0000000000e4', null, 'domain', now(), '{}'),
  'SSL → Domain expiring'
);
reset role;
select is((select coalesce(cause_trigger, trigger)::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e4'),
  'domain', 'it reads Domain expiring');

-- Tao, 17 Nov: acknowledged for the expiry, then a real DOWN: the DOWN ladder starts from L0 again.
set local role service_role;
select ok(
  public.engine_escalate_incident('00000000-0000-0000-0000-0000000000e4', now(), now(), '{}', false),
  'the site goes DOWN'
);
reset role;
select ok(
  (select state = 'unacked' and acked_at is null and acked_by is null and escalation_level = 0
     from public.incidents where id = '00000000-0000-0000-0000-0000000000e4'),
  'the expiry''s ack doesn''t silence the outage: Unacked, the ladder from L0'
);
-- The owner acknowledges the DOWN: a fresh ACKNOWLEDGED goes (the first one, sent days ago, is kept).
insert into public.notifications (incident_id, channel, template, thread_key, context, status, sent_at)
  values ('00000000-0000-0000-0000-0000000000e4', 'google_chat', 'down', '00000000-0000-0000-0000-0000000000e4',
          '{}', 'sent', now());
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(
  $$select public.ack_incident('00000000-0000-0000-0000-0000000000e4')$$,
  'the owner can acknowledge the DOWN'
);
reset role;
select is(
  (select count(*)::int from public.notifications where incident_id = '00000000-0000-0000-0000-0000000000e4'
     and channel = 'google_chat' and template = 'acknowledged' and status = 'queued'),
  1, 'a fresh ACKNOWLEDGED is queued'
);
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(
  $$select public.undo_ack('00000000-0000-0000-0000-0000000000e4')$$,
  'and can undo it: the cleared ack''s old reply doesn''t close the window (message-checker)'
);
reset role;

-- Engine re-review: the ack is judged by what it was given for. An ack of the outage holds.
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000c1', 'Acked down', 1,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a5', 'http', true, 'https://e.pgtap.test');
insert into public.incidents (id, site_id, monitor_id, trigger, severity, episode_severity, state, started_at, detected_at,
                              acked_at, acked_by, escalation_plan)
  values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a5',
          '00000000-0000-0000-0000-0000000000d5', 'hard_fail', 'down', 'down', 'acknowledged',
          now() - interval '1 hour', now() - interval '1 hour', now() - interval '55 minutes',
          (select id from ids where name = 'arm'), public.escalation_plan_for(1::smallint, 'down'));
select is((select acked_cause::text from public.incidents where id = '00000000-0000-0000-0000-0000000000e5'),
  'hard_fail', 'the ack remembers it was given for the DOWN');
-- Back up with SSL due (a PROBLEM AGAIN into the expiry), then DOWN AGAIN.
update public.incidents set episode_severity = 'problem', cause_trigger = 'ssl'
  where id = '00000000-0000-0000-0000-0000000000e5';
set local role service_role;
select ok(
  public.engine_relapse_incident('00000000-0000-0000-0000-0000000000e5', 'down', 'hard_fail', now(), now(), now(), '{}', false, false),
  'DOWN AGAIN'
);
reset role;
select ok(
  (select state = 'acknowledged' and acked_at is not null from public.incidents where id = '00000000-0000-0000-0000-0000000000e5'),
  'the ack of the outage holds (D-004)'
);

-- Engine review: a DOWN AGAIN clears an ack given for the expiry — three times on one incident, each
-- with an ACKNOWLEDGED sent (the re-key never grows past the 64-character key).
create function pg_temp.ssl_ack_then_down(p_n int) returns boolean language plpgsql as $$
begin
  update public.incidents set episode_severity = 'problem', cause_trigger = 'ssl', state = 'acknowledged',
         acked_at = now() - make_interval(secs => 100 - p_n), acked_by = (select id from ids where name = 'arm')
    where id = '00000000-0000-0000-0000-0000000000e5';
  insert into public.notifications (incident_id, channel, template, thread_key, context, status, sent_at, created_at)
    values ('00000000-0000-0000-0000-0000000000e5', 'google_chat', 'acknowledged', '00000000-0000-0000-0000-0000000000e5',
            '{}', 'sent', now(), now() - make_interval(secs => 100 - p_n));
  return public.engine_relapse_incident('00000000-0000-0000-0000-0000000000e5', 'down', 'hard_fail',
    now() + make_interval(secs => p_n), now() + make_interval(secs => p_n), now() + make_interval(secs => p_n),
    '{}', false, false);
end;
$$;
select ok(pg_temp.ssl_ack_then_down(1) and pg_temp.ssl_ack_then_down(2) and pg_temp.ssl_ack_then_down(3),
  'three DOWN AGAINs, each clearing an ack of the SSL');
select ok(
  (select acked_at is null and acked_cause is null and state <> 'acknowledged' from public.incidents
     where id = '00000000-0000-0000-0000-0000000000e5'),
  'the expiry''s ack is cleared by the DOWN AGAIN'
);
select ok(
  (select bool_and((after is not null) and (before ->> 'expiry_ack_cleared')::boolean and before ->> 'acked_by' is not null)
     from public.audit_log where entity_id = '00000000-0000-0000-0000-0000000000e5' and action = 'incident.relapsed'
       and before ? 'expiry_ack_cleared'),
  'each audit row records the ack it cleared'
);

-- Tao, 17 Nov: an SSL incident acknowledged ("waiting for the renewal") takes a defacement: the ack is
-- cleared and the PROBLEM ladder starts again from the new cause.
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000c1', 'Acked SSL', 1,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d8', '00000000-0000-0000-0000-0000000000a8', 'http', true, 'https://h.pgtap.test');
insert into public.incidents (id, site_id, monitor_id, trigger, severity, episode_severity, state, started_at, detected_at,
                              acked_at, acked_by, escalation_level, escalation_plan)
  values ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000a8',
          '00000000-0000-0000-0000-0000000000d8', 'ssl', 'problem', 'problem', 'acknowledged',
          now() - interval '4 days', now() - interval '4 days', now() - interval '4 days',
          (select id from ids where name = 'arm'), 1, public.escalation_plan_for(1::smallint, 'problem'));
insert into public.notifications (incident_id, channel, template, thread_key, context, status, sent_at, created_at)
  values ('00000000-0000-0000-0000-0000000000e8', 'google_chat', 'acknowledged', '00000000-0000-0000-0000-0000000000e8',
          '{}', 'sent', now() - interval '4 days', now() - interval '4 days');
set local role service_role;
select ok(
  public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e8', null, 'keyword', now(), '{"summary": "y"}', true),
  'the acknowledged SSL incident takes the keyword'
);
reset role;
select ok(
  (select state = 'escalated' and acked_at is null and escalation_level = 1 and alerted_at is null
          and expiry_ack_by = (select id from ids where name = 'arm')
     from public.incidents where id = '00000000-0000-0000-0000-0000000000e8'),
  'the ack of the SSL is set aside; the ladder carries on from its level (Tao, 18 Nov)'
);
select ok(
  (select dedupe_key like '%:expiry-ack:%' from public.notifications
     where incident_id = '00000000-0000-0000-0000-0000000000e8' and template = 'acknowledged'),
  'its old ACKNOWLEDGED stays the record, under its own key (the next ack posts)'
);
-- The keyword clears with the certificate still due: back to SSL, and the ack comes back.
set local role service_role;
select ok(
  public.engine_cause_back_incident('00000000-0000-0000-0000-0000000000e8', null, 'ssl', now(), '{}'),
  'back to SSL expiring'
);
reset role;
select ok(
  (select state = 'acknowledged' and acked_by = (select id from ids where name = 'arm') and acked_cause = 'ssl'
          and expiry_ack_at is null
     from public.incidents where id = '00000000-0000-0000-0000-0000000000e8'),
  'the ack set aside is given back (no reminders all night for the certificate)'
);
select ok(
  (select payload -> 'ackBack' ->> 'by' is not null and (payload -> 'ackBack' ->> 'at') is not null
     from public.incident_events
     where incident_id = '00000000-0000-0000-0000-0000000000e8' and type = 'new_cause' and (payload ->> 'back')::boolean),
  'D-068: the back event records the ack given back (timeline "Acknowledgement given back")'
);
select ok(
  (select payload -> 'setAside' ->> 'by' is not null
     from public.incident_events
     where incident_id = '00000000-0000-0000-0000-0000000000e8' and type = 'new_cause' and (payload ->> 'ackCleared')::boolean),
  'D-068: the new cause event records the ack it set aside (timeline "Acknowledgement set aside")'
);

-- Engine review: an incident acknowledged before the migration (no acked_cause) keeps its ack on a DOWN.
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000c1', 'Before S13', 1,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000a7', 'http', true, 'https://g.pgtap.test');
insert into public.incidents (id, site_id, monitor_id, trigger, severity, episode_severity, state, started_at, detected_at,
                              acked_at, acked_by, escalation_plan)
  values ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000a7',
          '00000000-0000-0000-0000-0000000000d7', 'keyword', 'problem', 'problem', 'acknowledged',
          now() - interval '1 day', now() - interval '1 day', now() - interval '1 day',
          (select id from ids where name = 'arm'), public.escalation_plan_for(1::smallint, 'problem'));
update public.incidents set acked_cause = null where id = '00000000-0000-0000-0000-0000000000e7';
set local role service_role;
select ok(public.engine_escalate_incident('00000000-0000-0000-0000-0000000000e7', now(), now(), '{}', false),
  'an old acked keyword incident goes DOWN');
reset role;
select ok(
  (select state = 'acknowledged' and acked_at is not null from public.incidents where id = '00000000-0000-0000-0000-0000000000e7'),
  'its ack holds'
);

-- An ack of the keyword the SSL incident took as its new cause holds through a DOWN too (D-021).
update public.incidents set acked_at = now(), acked_by = (select id from ids where name = 'nok'), state = 'acknowledged'
  where id = '00000000-0000-0000-0000-0000000000e3';
set local role service_role;
select ok(public.engine_escalate_incident('00000000-0000-0000-0000-0000000000e3', now(), now(), '{}', false),
  'the defaced site goes DOWN');
reset role;
select ok(
  (select state = 'acknowledged' and acked_cause = 'keyword' from public.incidents where id = '00000000-0000-0000-0000-0000000000e3'),
  'the keyword''s ack holds'
);

-- message-checker: an expiry ack's ACKNOWLEDGED waiting for a retry is cancelled by the DOWN too.
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000c1', 'Retrying', 1,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000a6', 'http', true, 'https://f.pgtap.test');
insert into public.incidents (id, site_id, monitor_id, trigger, severity, episode_severity, state, started_at, detected_at,
                              acked_at, acked_by, escalation_plan)
  values ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000a6',
          '00000000-0000-0000-0000-0000000000d6', 'ssl', 'problem', 'problem', 'acknowledged',
          now() - interval '1 hour', now() - interval '1 hour', now() - interval '20 seconds',
          (select id from ids where name = 'arm'), public.escalation_plan_for(1::smallint, 'problem'));
insert into public.notifications (id, incident_id, channel, template, thread_key, context, status, attempts, next_retry_at)
  values ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000e6', 'google_chat', 'acknowledged',
          '00000000-0000-0000-0000-0000000000e6', '{}', 'queued', 1, now() + interval '20 seconds');
insert into public.notification_attempts (notification_id, attempt, ok, error)
  values ('00000000-0000-0000-0000-0000000000f6', 1, false, 'HTTP 503');
set local role service_role;
select ok(public.engine_escalate_incident('00000000-0000-0000-0000-0000000000e6', now(), now(), '{}', false),
  'the SSL-acked site goes DOWN');
reset role;
select is((select status::text from public.notifications where id = '00000000-0000-0000-0000-0000000000f6'),
  'cancelled', 'the retrying ACKNOWLEDGED never posts after the DOWN');

-- D-067 item 3 (db review): a window on a site open only for an expiry starts.
insert into public.maintenance_windows (site_id, kind, starts_at, ends_at, reason, approved_at)
  values ('00000000-0000-0000-0000-0000000000a2', 'maintenance', now() - interval '1 minute', now() + interval '1 hour',
          'Deploy', now() - interval '1 day');
update public.incidents set cause_trigger = 'ssl' where id = '00000000-0000-0000-0000-0000000000e2';
set local role service_role;
select public.engine_log_windows(now());
reset role;
select is(
  (select outcome from public.maintenance_windows where site_id = '00000000-0000-0000-0000-0000000000a2'),
  null, 'it starts (not "didn''t start")'
);

select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(
  $$select public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000e1', null, 'keyword', now(), '{}', true)$$,
  '42501', null, 'a signed-in session can''t call it'
);
select throws_ok(
  $$select public.engine_cause_back_incident('00000000-0000-0000-0000-0000000000e1', null, 'ssl', now(), '{}')$$,
  '42501', null, 'nor the way back (security review)'
);

-- S13 PR 4 (spec §40.3, D-068 item 3): the ack of the expiry set aside names its acker — the reply
-- @mentions them and only they get the email, whoever owns the site.
-- (Nok, made above, is on call this week: Tier 3, so that doesn't matter here.)
reset role;
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Nok acked', 3,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'http', true, 'https://n.pgtap.test');
insert into public.incidents (id, site_id, monitor_id, trigger, severity, episode_severity, state, started_at, detected_at,
                              acked_at, acked_by, escalation_plan)
  values ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-0000000000f1', 'ssl', 'problem', 'problem', 'acknowledged',
          now() - interval '1 day', now() - interval '1 day', now() - interval '20 hours',
          (select id from ids where name = 'nok'), public.escalation_plan_for(3::smallint, 'problem'));
set local role service_role;
select ok(
  public.engine_new_cause_incident('00000000-0000-0000-0000-0000000000b9', null, 'keyword', now(), '{"summary": "z"}', true),
  'Nok''s acknowledged SSL incident takes the keyword'
);
reset role;
select ok(
  (select context -> 'mention' ->> 'id' = (select id from ids where name = 'nok')::text
          and (context -> 'mention' ->> 'acked')::boolean and context -> 'mention' ? 'ackedAt'
     from public.notifications
     where incident_id = '00000000-0000-0000-0000-0000000000b9' and channel = 'google_chat' and template = 'problem_again'),
  'the reply @mentions Nok, marked as the ack set aside'
);
select results_eq(
  $$select user_id from public.notifications
      where incident_id = '00000000-0000-0000-0000-0000000000b9' and channel = 'email' and template = 'problem_again'$$,
  $$select id from ids where name = 'nok'$$,
  'only Nok is emailed (not the owner)'
);

-- S13 PR 4 (spec §40.2, D-068): a raise to DOWN remembers the drop came from the expiry; the way back
-- to it (back up, still SSL expiring) forgets it.
reset role;
select ok(
  (select down_from_expiry from public.incidents where id = '00000000-0000-0000-0000-0000000000e4'),
  'the domain incident raised to DOWN: down_from_expiry'
);
select ok(
  (select not down_from_expiry from public.incidents where id = '00000000-0000-0000-0000-0000000000b9'),
  'a new cause on a PROBLEM drop is no DOWN'
);
set local role service_role;
select ok(
  public.engine_escalate_incident('00000000-0000-0000-0000-0000000000b9', now(), now(), '{}', false),
  'the keyword incident (taken from SSL) goes DOWN'
);
reset role;
select ok(
  (select down_from_expiry from public.incidents where id = '00000000-0000-0000-0000-0000000000b9'),
  'a DOWN on a cause taken from the expiry came from it too'
);
update public.incidents set state = 'monitoring', recovered_at = now() where id = '00000000-0000-0000-0000-0000000000b9';
set local role service_role;
select ok(
  public.engine_relapse_incident('00000000-0000-0000-0000-0000000000b9', 'problem', 'ssl', now(), now(), now(),
    '{"stillExpiry": true}', false, false),
  'back up, still SSL expiring: the silent way back'
);
reset role;
select ok(
  (select not down_from_expiry and cause_trigger = 'ssl' from public.incidents where id = '00000000-0000-0000-0000-0000000000b9'),
  'on the expiry again: down_from_expiry cleared'
);
select is(
  (select count(*)::int from public.notifications
     where incident_id = '00000000-0000-0000-0000-0000000000b9' and template = 'problem_again'
       and context ? 'stillExpiry'),
  0,
  'nothing posted for it (the RECOVERED says it)'
);

select * from finish();
rollback;
