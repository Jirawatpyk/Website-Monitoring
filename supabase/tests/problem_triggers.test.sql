-- S04a PROBLEM triggers & status rules (D-022): the probe's keyword / redirect facts, the engine's
-- per-monitor carry state written in the same transaction as the incident change (never backwards,
-- only the site's own monitors), the site status worked out from the verdicts, the PROBLEM alert
-- rows, the "fewer than 2 locations" Admin alert kind, and read-only RLS.
begin;
\ir _helpers.psql
select plan(31);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 2,
   (select id from ids where name = 'arm')),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Site B', 2,
   (select id from ids where name = 'arm'));
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true,
   'https://a.pgtap.test/'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'http', false,
   'https://a.pgtap.test/booking'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a2', 'http', true,
   'https://b.pgtap.test/');

-- ── check_results: keyword and redirect facts ────────────────────────────
select has_column('public', 'check_results', 'final_url', 'check_results stores the final URL');
select has_column('public', 'check_results', 'keyword_missing', 'check_results stores missing keywords');
select has_column('public', 'check_results', 'keyword_forbidden', 'check_results stores forbidden text found');
insert into public.check_results (monitor_id, location, checked_at, outcome, status_code, response_ms,
  final_url, keyword_missing, keyword_forbidden)
values ('00000000-0000-0000-0000-0000000000d1', 'SIN', '2026-10-07 09:00:05Z', 'pass', 200, 5800,
  'https://a.pgtap.test/', '{Welcome}', '{}');
select is(
  (select keyword_missing from public.check_results where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  '{Welcome}'::text[], 'a pass can carry a missing keyword (it never fails the check)'
);

-- ── engine_record_round writes the monitors and the site status ──────────
select lives_ok(
  $$select public.engine_record_round('00000000-0000-0000-0000-0000000000a1', '2026-10-07 09:00Z',
    '2026-10-07 09:01Z', 0::smallint,
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "problem", "trigger": "slow",
       "cause": "Slow · p50 5.8 s > 5 s", "slowRounds": 3, "failingSince": {}},
      {"monitorId": "00000000-0000-0000-0000-0000000000d2", "status": "ok", "slowRounds": 0,
       "failingSince": {"SIN": "2026-10-07T08:57:00Z"}},
      {"monitorId": "00000000-0000-0000-0000-0000000000d3", "status": "down"}]'::jsonb,
    'problem')$$,
  'engine_record_round takes the round''s monitor verdicts and site status'
);
select results_eq(
  $$select status::text, trigger::text, cause, slow_rounds::int from public.monitor_status
    where monitor_id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values ('problem', 'slow', 'Slow · p50 5.8 s > 5 s', 3)$$,
  'the primary monitor''s verdict and slow streak are stored'
);
select is(
  (select failing_since ->> 'SIN' from public.monitor_status where monitor_id = '00000000-0000-0000-0000-0000000000d2'),
  '2026-10-07T08:57:00Z', 'a key page''s per-location failing-since is stored'
);
select is(
  (select count(*)::int from public.monitor_status where monitor_id = '00000000-0000-0000-0000-0000000000d3'),
  0, 'another site''s monitor in the list is ignored'
);
select results_eq(
  $$select status::text, since, last_round_at from public.site_status
    where site_id = '00000000-0000-0000-0000-0000000000a1'$$,
  $$values ('problem', '2026-10-07 09:00Z'::timestamptz, '2026-10-07 09:00Z'::timestamptz)$$,
  'the site status is the one worked out from the verdicts'
);

-- Overlapping engine runs: an older or the same round never overwrites.
select public.engine_record_round('00000000-0000-0000-0000-0000000000a1', '2026-10-07 08:57Z',
  '2026-10-07 09:02Z', 2::smallint,
  '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "ok", "slowRounds": 0}]'::jsonb, 'ok');
select public.engine_record_round('00000000-0000-0000-0000-0000000000a1', '2026-10-07 09:00Z',
  '2026-10-07 09:02Z', 0::smallint,
  '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "problem", "trigger": "slow",
     "cause": "x", "slowRounds": 4}]'::jsonb, 'problem');
select results_eq(
  $$select slow_rounds::int, last_round_at from public.monitor_status
    where monitor_id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values (4, '2026-10-07 09:00Z'::timestamptz)$$,
  'a monitor row never moves back; the same round again is rewritten (values are set, never added)'
);
select is(
  (select status::text from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a1'),
  'problem', 'an older round doesn''t move the site status back'
);

-- No verdicts: only the round bookkeeping, as before.
select public.engine_record_round('00000000-0000-0000-0000-0000000000a1', '2026-10-07 09:03Z',
  '2026-10-07 09:04Z', 0::smallint);
select results_eq(
  $$select status::text, last_round_at from public.site_status where site_id = '00000000-0000-0000-0000-0000000000a1'$$,
  $$values ('problem', '2026-10-07 09:03Z'::timestamptz)$$,
  'without p_status the site status is left as it is'
);

select throws_ok(
  $$insert into public.monitor_status (monitor_id, site_id, last_round_at, status)
    values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a2', now(), 'problem')$$,
  '23514', null, 'a problem verdict names its trigger'
);

-- ── engine_open_incident: a PROBLEM incident and its alert rows ──────────
select isnt(
  public.engine_open_incident('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d3',
    'keyword', 'problem', '2026-10-07 09:06:05Z', '2026-10-07 09:07Z', '2026-10-07 09:06Z',
    '{"cause": "Keyword missing: \"Welcome\""}', true,
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d3", "status": "problem", "trigger": "keyword",
       "cause": "Keyword missing: \"Welcome\""}]'::jsonb, 'problem'),
  null, 'a PROBLEM opens with its monitor verdicts'
);
select results_eq(
  $$select channel::text, template from public.notifications n
    join public.incidents i on i.id = n.incident_id
    where i.site_id = '00000000-0000-0000-0000-0000000000a2' order by channel$$,
  $$values ('email', 'problem'), ('google_chat', 'problem')$$,
  'a PROBLEM queues its Chat card and the owner''s email'
);
select results_eq(
  $$select ms.trigger::text, s.status::text from public.monitor_status ms
    join public.site_status s on s.site_id = ms.site_id
    where ms.monitor_id = '00000000-0000-0000-0000-0000000000d3'$$,
  $$values ('keyword', 'problem')$$,
  'the monitor verdict and the site status commit with the incident'
);

-- Recover keeps the PROBLEM status until the second OK round; settle clears the monitors and the site.
select ok(
  public.engine_recover_incident(
    (select id from public.incidents where site_id = '00000000-0000-0000-0000-0000000000a2'),
    'unacked', 'monitoring', '2026-10-07 09:09:05Z', '2026-10-07 09:09Z', '{}', true,
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d3", "status": "ok"}]'::jsonb, 'problem'),
  'recover takes the monitor verdicts'
);
select is(
  (select template from public.notifications n join public.incidents i on i.id = n.incident_id
   where i.site_id = '00000000-0000-0000-0000-0000000000a2' and n.channel = 'google_chat'
     and n.template = 'recovered'),
  'recovered', 'a PROBLEM that recovers posts RECOVERED'
);
select ok(
  public.engine_settle_incident(
    (select id from public.incidents where site_id = '00000000-0000-0000-0000-0000000000a2'),
    'monitoring', 'needs_root_cause', '2026-10-07 09:12:05Z', '2026-10-07 09:12Z',
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d3", "status": "ok"}]'::jsonb, 'ok'),
  'settle takes the monitor verdicts'
);
select results_eq(
  $$select ms.status::text, ms.trigger, s.status::text from public.monitor_status ms
    join public.site_status s on s.site_id = ms.site_id
    where ms.monitor_id = '00000000-0000-0000-0000-0000000000d3'$$,
  $$values ('ok', null::public.incident_trigger, 'ok')$$,
  'after the second OK round the monitor and the site are OK'
);

-- ── Escalate, a list naming a monitor twice, bounded keyword lists ───────
select public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1',
  'blocked_unverified', 'problem', '2026-10-07 09:15:05Z', '2026-10-07 09:16Z', '2026-10-07 09:15Z', '{}', false);
select ok(
  public.engine_escalate_incident(
    (select id from public.incidents where site_id = '00000000-0000-0000-0000-0000000000a1'
       and state not in ('resolved', 'in_review', 'closed')),
    '2026-10-07 09:18:32Z', '2026-10-07 09:18Z', '{}', false,
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "ok"},
      {"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "down"}]'::jsonb, 'down'),
  'escalate takes the monitor verdicts'
);
select results_eq(
  $$select ms.status::text, s.status::text from public.monitor_status ms
    join public.site_status s on s.site_id = ms.site_id
    where ms.monitor_id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values ('down', 'down')$$,
  'a monitor named twice is written once, the last entry winning'
);
select lives_ok(
  $$select public.engine_record_round('00000000-0000-0000-0000-0000000000a1', '2026-10-07 09:18Z',
    '2026-10-07 09:19Z', 0::smallint,
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "down"}]'::jsonb, 'down')$$,
  'the same round again (an overlapping run) is a harmless rewrite'
);
select throws_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome, keyword_missing)
    values ('00000000-0000-0000-0000-0000000000d1', 'SIN', '2026-10-07 09:20Z', 'pass',
            (select array_agg('k' || g) from generate_series(1, 21) g))$$,
  '23514', null, 'at most 20 missing keywords per check'
);
select is(
  (select char_length(cause) from public.monitor_status where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  null, 'a down verdict has no cause'
);

-- ── Admin alert: fewer than 2 locations ──────────────────────────────────
select isnt(public.open_system_alert('probe_locations_low', '{"active": ["SIN"]}'), null,
  'the fewer-than-2-locations alert opens');
select throws_ok(
  $$insert into public.system_alerts (kind) values ('something_else')$$,
  '23514', null, 'only known alert kinds'
);

-- ── RLS and grants ───────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.monitor_status), 3, 'staff read monitor_status');
select throws_ok(
  $$update public.monitor_status set slow_rounds = 0$$,
  '42501', null, 'people can''t write monitor_status'
);
select throws_ok(
  $$select public.engine_write_monitors('00000000-0000-0000-0000-0000000000a1', now(), '[]', 'ok')$$,
  '42501', null, 'people can''t call engine_write_monitors'
);
reset role;
select tests.as_anon();
select throws_ok($$select count(*) from public.monitor_status$$, '42501', null, 'anon can''t read monitor_status');
reset role;

select * from finish();
rollback;
