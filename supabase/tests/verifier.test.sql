-- Browser verifier (S03, D-019): the job queue's leases, results refused after the lease, one job
-- per round / per incident, the evidence job of a hard-fail DOWN, Admin alerts (one open per kind,
-- one email per active Admin), the site note, read-only RLS and the private screenshot bucket.
begin;
\ir _helpers.psql
select plan(43);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
-- Only this test's Admins (the dev seed has its own).
update public.profiles set is_active = false where role = 'admin';
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('admin',  tests.create_user('admin@pgtap.test', 'admin')),
  ('admin2', tests.create_user('admin2@pgtap.test', 'admin')),
  ('arm',    tests.create_user('arm@pgtap.test', 'responder')),
  ('mint',   tests.create_user('mint@pgtap.test', 'viewer'));
update public.profiles set is_active = false where id = (select id from ids where name = 'admin2');
insert into ids values ('admin3', tests.create_user('admin3@pgtap.test', 'admin'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm')),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Site B', 1,
   (select id from ids where name = 'arm'));
insert into public.monitors (id, site_id, type, is_primary, url, must_contain) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true,
   'https://a.pgtap.test', '{Welcome}'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'http', true,
   'https://b.pgtap.test', '{}');

-- ── Queue: one verify job per round, leases ──────────────────────────────
insert into public.verification_jobs (id, kind, monitor_id, site_id, round_at, url, must_contain)
values ('00000000-0000-0000-0000-0000000000f1', 'verify', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000a1', '2026-10-07 03:00Z', 'https://a.pgtap.test', '{Welcome}');
select throws_ok(
  $$insert into public.verification_jobs (kind, monitor_id, site_id, round_at, url)
    values ('verify', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
            '2026-10-07 03:00Z', 'https://a.pgtap.test')$$,
  '23505', null, 'one verify job per monitor and round'
);
select throws_ok(
  $$insert into public.verification_jobs (kind, monitor_id, site_id, url)
    values ('verify', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
            'https://a.pgtap.test')$$,
  '23514', null, 'a verify job names its round'
);
select throws_ok(
  $$insert into public.verification_jobs (kind, monitor_id, site_id, url)
    values ('evidence', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
            'https://a.pgtap.test')$$,
  '23514', null, 'an evidence job names its incident'
);

select is((select count(*)::int from public.claim_verification_jobs(3)), 1, 'claim leases the queued job');
select results_eq(
  $$select status, attempts::int, lease_until > now() + interval '55 seconds' from public.verification_jobs
    where id = '00000000-0000-0000-0000-0000000000f1'$$,
  $$values ('leased'::text, 1, true)$$,
  'the lease runs 60 s and counts the attempt'
);
select is((select count(*)::int from public.claim_verification_jobs(3)), 0, 'a leased job is not handed out twice');

-- Completing after the lease ran out is refused (Done-when 4).
update public.verification_jobs set lease_until = now() - interval '1 second'
  where id = '00000000-0000-0000-0000-0000000000f1';
select is(
  (select count(*)::int from public.complete_verification_job(
     '00000000-0000-0000-0000-0000000000f1', 'loaded', null, 200::smallint, '2026-10/f1.jpg')),
  0, 'a result after the lease ran out is refused'
);
select is(public.expire_verification_jobs(), 1, 'the run-out lease expires');
select is((select status from public.verification_jobs where id = '00000000-0000-0000-0000-0000000000f1'),
  'expired', 'and the job is expired');

-- A fresh job, completed in time.
insert into public.verification_jobs (id, kind, monitor_id, site_id, round_at, url)
values ('00000000-0000-0000-0000-0000000000f2', 'verify', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000a1', '2026-10-07 03:01Z', 'https://a.pgtap.test');
select is((select count(*)::int from public.claim_verification_jobs(1)), 1, 'the next job is leased');
select results_eq(
  $$select status, result, http_status::int, screenshot_path from public.complete_verification_job(
      '00000000-0000-0000-0000-0000000000f2', 'loaded', 'Page loaded', 200::smallint, '2026-10/f2.jpg')$$,
  $$values ('done'::text, 'loaded'::text, 200, '2026-10/f2.jpg'::text)$$,
  'a result inside the lease is recorded'
);
select is(
  (select count(*)::int from public.complete_verification_job(
     '00000000-0000-0000-0000-0000000000f2', 'failed', null, null, null)),
  0, 'a job already done can''t be completed again'
);

-- A verify job still queued after 2 min expires.
insert into public.verification_jobs (kind, monitor_id, site_id, round_at, url, created_at)
values ('verify', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2',
        '2026-10-07 03:00Z', 'https://b.pgtap.test', now() - interval '3 minutes');
select is(public.expire_verification_jobs(), 1, 'a verify job left queued past 2 min expires');

-- ── Evidence after a hard-fail DOWN ──────────────────────────────────────
select isnt(
  public.engine_open_incident('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2',
    'hard_fail', 'down', now() - interval '2 minutes', now(), date_trunc('minute', now()),
    '{"cause":"HTTP 500"}', false),
  null, 'a hard-fail DOWN opens'
);
select results_eq(
  $$select kind, url, status from public.verification_jobs j
    join public.incidents i on i.id = j.incident_id where i.site_id = '00000000-0000-0000-0000-0000000000a2'$$,
  $$values ('evidence'::text, 'https://b.pgtap.test'::text, 'queued'::text)$$,
  'and queues one evidence job for the screenshot'
);
select is((select count(*)::int from public.claim_verification_jobs(5)), 1, 'the evidence job is leased');
select is(
  (select count(*)::int from public.complete_verification_job(
     (select id from public.verification_jobs where kind = 'evidence'), 'failed', 'HTTP 500', 500::smallint,
     '2026-10/ev.jpg')),
  1, 'its screenshot is recorded'
);
select results_eq(
  $$select e.payload ->> 'screenshotPath' from public.incident_events e
    join public.incidents i on i.id = e.incident_id
    where i.site_id = '00000000-0000-0000-0000-0000000000a2' and e.type = 'evidence'$$,
  $$values ('2026-10/ev.jpg'::text)$$,
  'and joins the incident timeline'
);

-- Blocked → the browser failed → DOWN: the verify job's screenshot is the evidence, no second job.
insert into public.verification_jobs (id, kind, monitor_id, site_id, round_at, url, status, result,
                                      screenshot_path, completed_at)
values ('00000000-0000-0000-0000-0000000000f3', 'verify', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000a1', '2026-10-07 03:02Z', 'https://a.pgtap.test', 'done',
        'failed', '2026-10/f3.jpg', now());
select isnt(
  public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1',
    'hard_fail', 'down', now() - interval '1 minute', now(), date_trunc('minute', now()),
    '{"cause":"Browser: page didn''t load","verifyJobId":"00000000-0000-0000-0000-0000000000f3"}', false),
  null, 'a DOWN the browser decided opens'
);
select results_eq(
  $$select count(*) filter (where j.kind = 'evidence')::int,
           count(*) filter (where j.id = '00000000-0000-0000-0000-0000000000f3' and j.incident_id = i.id)::int
    from public.verification_jobs j, public.incidents i
    where i.site_id = '00000000-0000-0000-0000-0000000000a1' and j.site_id = i.site_id$$,
  $$values (0, 1)$$,
  'with no evidence job, linked to the verify job'
);
select results_eq(
  $$select e.payload ->> 'screenshotPath' from public.incident_events e
    join public.incidents i on i.id = e.incident_id
    where i.site_id = '00000000-0000-0000-0000-0000000000a1' and e.type = 'evidence'$$,
  $$values ('2026-10/f3.jpg'::text)$$,
  'whose screenshot joins the timeline'
);

-- The browser decided but its screenshot didn't upload: an evidence job takes one instead.
insert into public.sites (id, client_id, name, tier) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1', 'Site C', 1);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a3', 'http', true, 'https://c.pgtap.test');
insert into public.verification_jobs (id, kind, monitor_id, site_id, round_at, url, status, result, completed_at)
values ('00000000-0000-0000-0000-0000000000f4', 'verify', '00000000-0000-0000-0000-0000000000d3',
        '00000000-0000-0000-0000-0000000000a3', '2026-10-07 03:03Z', 'https://c.pgtap.test', 'done', 'failed', now());
select public.engine_open_incident('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000d3',
  'hard_fail', 'down', now() - interval '1 minute', now(), date_trunc('minute', now()),
  '{"cause":"Browser: page didn''t load","verifyJobId":"00000000-0000-0000-0000-0000000000f4"}', false);
select is(
  (select count(*)::int from public.verification_jobs where site_id = '00000000-0000-0000-0000-0000000000a3' and kind = 'evidence'),
  1, 'a browser DOWN without a screenshot queues an evidence job'
);

-- PROBLEM (unverified) then a confirmed DOWN: raised to DOWN with its alert, once (D-021).
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c1', 'Site D', 1,
   (select id from ids where name = 'arm'));
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a4', 'http', true, 'https://d.pgtap.test');
create temp table d_inc on commit drop as
select public.engine_open_incident('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000d4',
  'blocked_unverified', 'problem', now() - interval '3 minutes', now() - interval '2 minutes',
  date_trunc('minute', now()) - interval '2 minutes', '{"cause":"Blocked, not verified"}', false) as id;
select ok(
  public.engine_escalate_incident((select id from d_inc), now(), date_trunc('minute', now()),
    '{"cause":"HTTP 500 (SIN, TYO)","confirmingLocations":2}', true),
  'a confirmed DOWN raises the open PROBLEM'
);
select results_eq(
  $$select i.severity::text, i.state::text, s.status::text,
           (select count(*)::int from public.notifications n where n.incident_id = i.id and n.template = 'down')
    from public.incidents i join public.site_status s on s.site_id = i.site_id
    where i.site_id = '00000000-0000-0000-0000-0000000000a4'$$,
  $$values ('down', 'unacked', 'down', 2)$$,
  'to DOWN, the site DOWN, with the DOWN Chat post and the owner email'
);
select ok(
  not public.engine_escalate_incident((select id from d_inc), now(), date_trunc('minute', now()), '{}', true),
  'a second engine run raises nothing'
);
select results_eq(
  $$select action, before ->> 'severity', after ->> 'severity' from public.audit_log
    where entity = 'incident' and entity_id = (select id from d_inc) and action = 'incident.severity'$$,
  $$values ('incident.severity'::text, 'problem'::text, 'down'::text)$$,
  'raising it writes one audit row, problem → down'
);

-- ── Site note ────────────────────────────────────────────────────────────
select lives_ok(
  $$select public.engine_note_site('00000000-0000-0000-0000-0000000000a1', date_trunc('minute', now()),
      'Blocked, not verified')$$,
  'the engine notes the round'
);
select is((select note from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a1'),
  'Blocked, not verified', 'the note is on the site');
select public.engine_note_site('00000000-0000-0000-0000-0000000000a1',
  date_trunc('minute', now()) - interval '5 minutes', null);
select is((select note from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a1'),
  'Blocked, not verified', 'an older round never changes it');

-- ── Admin alerts ─────────────────────────────────────────────────────────
select isnt(public.open_system_alert('verifier_unavailable', '{"sites":["Site A"],"reason":"no_poll"}'),
  null, 'opening an alert returns its id');
select results_eq(
  $$select n.user_id, n.channel::text, n.template, n.incident_id from public.notifications n
    where n.system_alert_id is not null order by n.user_id$$,
  $$select id, 'email', 'verifier_unavailable', null::uuid from ids where name in ('admin', 'admin3') order by id$$,
  'one email per active Admin, tied to the alert and no incident'
);
select is(public.open_system_alert('verifier_unavailable', '{}'), null, 'a second open of the same kind does nothing');
select is((select count(*)::int from public.notifications where system_alert_id is not null), 2,
  'so nobody is emailed twice for one outage');
select ok(public.clear_system_alert('verifier_unavailable'), 'the alert clears');
select isnt(public.open_system_alert('verifier_unavailable', '{}'), null,
  'the next outage opens a new alert');
select is((select count(*)::int from public.notifications where system_alert_id is not null), 4,
  'and emails the Admins again, even with the first emails still on record');
select results_eq(
  $$select action, count(*)::int from public.audit_log where entity = 'system_alert'
      and entity_id in (select id from public.system_alerts) group by 1 order by 1$$,
  $$values ('system_alert.cleared'::text, 1), ('system_alert.opened'::text, 2)$$,
  'opening and clearing an alert are audited'
);

-- ── RLS: people read, never write ────────────────────────────────────────
insert into public.agent_heartbeats (name, last_seen_at) values ('verifier', now());
select tests.as_anon();
select throws_ok($$select count(*) from public.agent_heartbeats$$, '42501', null, 'anon can''t read heartbeats');
reset role;
select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.agent_heartbeats), 1, 'a Viewer reads the verifier heartbeat');
select throws_ok($$update public.agent_heartbeats set last_seen_at = now()$$, '42501', null,
  'people can''t stamp a heartbeat');
select results_eq(
  $$select (select count(*) from public.verification_jobs) > 0, (select count(*) from public.system_alerts)$$,
  $$values (true, 0::bigint)$$,
  'a Viewer reads verification jobs, not Admin alerts'
);
select throws_ok($$select public.claim_verification_jobs(1)$$, '42501', null,
  'people can''t lease jobs');
reset role;

-- ── Screenshot bucket ────────────────────────────────────────────────────
select results_eq(
  $$select public, file_size_limit::int, allowed_mime_types from storage.buckets where id = 'verifier-screenshots'$$,
  $$values (false, 1048576, array['image/jpeg'])$$,
  'screenshots live in a private bucket, JPEG up to 1 MB'
);

select * from finish();
rollback;
