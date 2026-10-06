-- Probes, check results, site status, incidents and notifications (S02a): partitions, the engine's
-- write functions, one open incident per site, one message per incident, and read-only RLS.
begin;
\ir _helpers.psql
select plan(35);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
delete from public.monitors;
delete from public.sites;
delete from public.clients;
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('admin', tests.create_user('admin@pgtap.test', 'admin')),
  ('arm',   tests.create_user('arm@pgtap.test', 'responder')),
  ('mint',  tests.create_user('mint@pgtap.test', 'viewer'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'));
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true,
   'https://a.pgtap.test');

-- ── Reference data and partitions ────────────────────────────────────────
select results_eq(
  'select code from public.probe_locations where is_active order by code',
  $$values ('SIN'), ('TYO')$$,
  'SIN and TYO are active; Bangkok waits for the VPS agent (S03)'
);
select is(
  (select count(*)::int from pg_inherits where inhparent = 'public.check_results'::regclass),
  3,
  'check_results has this month and the next two months as partitions'
);
select is(
  (select count(*)::int from pg_inherits i join pg_class c on c.oid = i.inhrelid
     join pg_namespace n on n.oid = c.relnamespace
   where i.inhparent = 'public.check_results'::regclass and n.nspname <> 'private'),
  0,
  'partitions live in the private schema, out of the API'
);
select isnt_empty(
  $$select 1 from cron.job where jobname = 'check-results-partitions'$$,
  'a nightly pg_cron job manages the partitions'
);

insert into public.check_results (monitor_id, location, checked_at, outcome, status_code)
values ('00000000-0000-0000-0000-0000000000d1', 'SIN', now(), 'pass', 200);
select is(
  (select tableoid::regclass::text from public.check_results limit 1),
  'private.check_results_' || to_char(now() at time zone 'UTC', 'YYYY_MM'),
  'a result lands in its month''s partition'
);
select throws_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome)
    values ('00000000-0000-0000-0000-0000000000d1', 'LAX', now(), 'pass')$$,
  '23503', null, 'an unknown location is refused'
);
select throws_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, attempt, outcome)
    values ('00000000-0000-0000-0000-0000000000d1', 'SIN', now(), 3, 'pass')$$,
  '23514', null, 'attempt is 1 (scheduled) or 2 (recheck)'
);

-- Retention: a month that ended more than 90 days ago is dropped, newer ones are kept.
select private.manage_check_results_partitions(now() - interval '6 months');
select private.manage_check_results_partitions(now());
select ok(
  to_regclass('private.check_results_' || to_char(now() - interval '6 months', 'YYYY_MM')) is null,
  'a partition older than 90 days is dropped'
);
select ok(
  to_regclass('private.check_results_' || to_char(now(), 'YYYY_MM')) is not null,
  'the current month is kept'
);

-- ── Engine writes ────────────────────────────────────────────────────────
create temp table inc (id uuid) on commit drop;
grant select on inc to authenticated;
insert into inc select public.engine_open_incident(
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1',
  'hard_fail', 'down', now() - interval '90 seconds', now(), now() - interval '60 seconds',
  '{"cause":"HTTP 500 (SIN, TYO)"}', true);
select isnt((select id from inc), null, 'engine_open_incident opens a DOWN incident');
select is(
  (select state::text || '/' || number::text from public.incidents),
  'unacked/' || (select number::text from public.incidents),
  'it starts Unacked with a number'
);
select is((select status::text from public.site_status), 'down', 'the site is DOWN');
select results_eq(
  'select type from public.incident_events',
  $$values ('detected')$$,
  'the timeline starts with "detected"'
);
select results_eq(
  'select template, thread_key, status::text from public.notifications',
  format($$values ('down', '%s', 'queued')$$, (select id from inc)),
  'the DOWN Chat message is queued, threaded by incident id'
);
select is(
  public.engine_open_incident(
    '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1',
    'hard_fail', 'down', now(), now(), now(), '{}', true),
  null,
  'a second open incident for the same site is not created'
);
select is((select count(*)::int from public.notifications), 1, 'and no second DOWN is queued');
select throws_ok(
  format($$insert into public.notifications (incident_id, channel, template) values ('%s', 'google_chat', 'down')$$,
    (select id from inc)),
  '23505', null, 'the same message can''t be queued twice for one incident'
);

select ok(
  public.engine_recover_incident((select id from inc), 'unacked', 'monitoring', now(), now(),
    '{"locations":2}', true),
  'engine_recover_incident moves Unacked → Monitoring'
);
select results_eq(
  'select template from public.notifications order by created_at, template',
  $$values ('down'), ('recovered')$$,
  'RECOVERED is queued in the same incident'
);
select ok(
  not public.engine_recover_incident((select id from inc), 'unacked', 'monitoring', now(), now(), '{}', true),
  'recovering twice does nothing'
);
select ok(
  public.engine_settle_incident((select id from inc), 'monitoring', 'needs_root_cause', now(), now()),
  'a second OK round settles the incident'
);
select is(
  (select state::text from public.incidents) || '/' || (select status::text from public.site_status),
  'needs_root_cause/ok',
  'Needs root cause, and the site is OK again'
);

select results_eq(
  format($$select action, before->>'state', after->>'state' from public.audit_log
           where entity = 'incident' and entity_id = '%s' order by at, action$$, (select id from inc)),
  $$values ('incident.opened', null, 'unacked'), ('incident.recovered', 'unacked', 'monitoring'),
           ('incident.state', 'monitoring', 'needs_root_cause')$$,
  'every incident state change is audited, with before / after'
);

-- claim_notifications leases due rows once.
select is((select count(*)::int from public.claim_notifications('google_chat', 10)), 2, 'claim takes both due messages');
select is((select count(*)::int from public.claim_notifications('google_chat', 10)), 0, 'a second run gets none while leased');

-- ── RLS and grants ───────────────────────────────────────────────────────
select tests.as_anon();
select throws_ok('select * from public.incidents', '42501', null, 'anon cannot read incidents');
reset role;

select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.incidents), 1, 'a viewer reads incidents');
select is_empty('select * from public.notifications', 'a viewer can''t read the delivery log');
select throws_ok(
  $$update public.incidents set state = 'resolved'$$,
  '42501', null, 'a viewer can''t change an incident'
);
reset role;

select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome)
    values ('00000000-0000-0000-0000-0000000000d1', 'SIN', now(), 'fail')$$,
  '42501', null, 'not even an Admin writes check results through the API'
);
select throws_ok(
  $$select public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null, 'hard_fail', 'down',
      now(), now(), now(), '{}', false)$$,
  '42501', null, 'not even an Admin can open an incident through the engine function'
);
select throws_ok(
  format($$select public.engine_recover_incident('%s', 'needs_root_cause', 'monitoring', now(), now(), '{}', false)$$,
    (select id from inc)),
  '42501', null, 'or recover one'
);
select throws_ok(
  format($$select public.engine_settle_incident('%s', 'monitoring', 'needs_root_cause', now(), now())$$,
    (select id from inc)),
  '42501', null, 'or settle one'
);
select is(
  (select count(*)::int from public.notifications where channel = 'email'),
  0,
  'claims are per channel (no email rows exist in S02a)'
);
select throws_ok(
  $$select public.claim_notifications('google_chat', 1)$$,
  '42501', null, 'only the service role can claim notifications'
);
reset role;

select * from finish();
rollback;
