-- Page-change detection (S09d, D-041, D-046): the content_change trigger, plain fetches with a
-- fingerprint, the automatic first baseline and its reset on a URL change, the engine's read (the
-- previous baseline while an accept's Undo is open), Accept / Undo (Admin only, audited, on the
-- timeline) and resolve with "Also accept the current page as the new baseline".
begin;
\ir _helpers.psql
select plan(46);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('admin',  tests.create_user('admin@pgtap.test', 'admin')),
  ('admin2', tests.create_user('admin2@pgtap.test', 'admin')),
  ('arm',    tests.create_user('arm@pgtap.test', 'responder')),
  ('mint',   tests.create_user('mint@pgtap.test', 'viewer'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), true),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Site B', 2,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true,
   'https://a.pgtap.test/'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'http', true,
   'https://b.pgtap.test/');

-- Three plain fetches of Site A (the first becomes the baseline) and a Googlebot one.
insert into public.crawler_checks (id, monitor_id, view, checked_at, outcome, usable, status_code, fingerprint) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'plain',
   now() - interval '90 minutes', 'pass', true, 200,
   '{"title":"Site A","h1":"Welcome","scripts":["cdn.example"],"links":["a.pgtap.test"]}'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'plain',
   now() - interval '30 minutes', 'pass', true, 200,
   '{"title":"Site A | สล็อตออนไลน์","h1":"Welcome","scripts":["cdn.example","evil-cdn.example"],"links":["a.pgtap.test"]}'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'plain',
   now() - interval '1 minute', 'blocked', false, 403, null),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', 'googlebot',
   now() - interval '1 minute', 'pass', true, 200, null);

-- ── Schema ───────────────────────────────────────────────────────────────
select is('content_change'::public.incident_trigger::text, 'content_change', 'content_change is an incident trigger');
select lives_ok(
  $$insert into public.monitor_status (monitor_id, site_id, last_round_at, status, trigger, cause)
    values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', now(), 'problem',
            'content_change', '/ · new script domain evil-cdn.example')$$,
  'a monitor shows PROBLEM with the content_change trigger'
);
select throws_ok(
  $$insert into public.crawler_checks (monitor_id, view, checked_at, outcome, usable, status_code, fingerprint)
    values ('00000000-0000-0000-0000-0000000000d1', 'googlebot', now(), 'pass', true, 200, '{"title":"x"}')$$,
  '23514', null, 'only a plain fetch carries a fingerprint'
);
select throws_ok(
  $$insert into public.crawler_checks (monitor_id, view, checked_at, outcome, usable, status_code, fingerprint)
    values ('00000000-0000-0000-0000-0000000000d1', 'plain', now(), 'pass', true, 200, '["x"]')$$,
  '23514', null, 'a fingerprint is an object'
);

-- ── The first baseline ───────────────────────────────────────────────────
select ok(public.crawler_set_baseline('00000000-0000-0000-0000-0000000000e1'), 'the first usable plain fetch becomes the baseline');
select ok(not public.crawler_set_baseline('00000000-0000-0000-0000-0000000000e2'), 'a later fetch doesn''t replace it');
select ok(not public.crawler_set_baseline('00000000-0000-0000-0000-0000000000e3'), 'an unusable fetch never becomes one');
select is(
  (select fingerprint->>'title' || ' · ' || (accepted_by is null)::text || ' · ' || (first_set_at = now() - interval '90 minutes')::text
   from public.page_baselines where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  'Site A · true · true', 'set from that fetch, by nobody, recording from its time'
);
select is((select count(*)::int from public.audit_log where action = 'page_baseline.auto'
           and entity_id = '00000000-0000-0000-0000-0000000000d1'), 1, 'audited once');

-- ── The engine's read ────────────────────────────────────────────────────
select is(
  (select baseline->>'title' || ' · ' || coalesce(pending_until::text, 'none') || ' · ' || jsonb_array_length(facts)::text
          || ' · ' || (accepted_at = now() - interval '90 minutes')::text
   from public.engine_page_fingerprints(now(), now() - interval '1 day')
   where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  'Site A · none · 2 · true', 'baseline, no accept waiting, the two usable plain fetches (a blocked one hides none), accepted when first set'
);
select is(
  (select facts->0->>'id' from public.engine_page_fingerprints(now(), now() - interval '1 day')
   where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  '00000000-0000-0000-0000-0000000000e2', 'newest usable first'
);
select is(
  (select (facts->1->'fingerprint' = 'null'::jsonb)::text || ' · ' || (facts->0->'fingerprint'->>'title')
   from public.engine_page_fingerprints(now(), now() - interval '1 day')
   where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  'true · Site A | สล็อตออนไลน์', 'only a fingerprint that differs from the baseline is sent'
);
select is((select count(*)::int from public.engine_page_fingerprints(now(), now() - interval '1 day')), 1,
  'a monitor with no baseline has no row');

-- ── Who may read and accept ──────────────────────────────────────────────
select tests.as_anon();
select throws_ok('select * from public.page_baselines', '42501', null, 'anon can''t read baselines');
select throws_ok($$select public.accept_page_baseline('00000000-0000-0000-0000-0000000000e2', 'x')$$,
  '42501', null, 'anon can''t accept');
reset role;
select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.page_baselines), 1, 'a Viewer reads baselines');
select throws_ok($$select public.accept_page_baseline('00000000-0000-0000-0000-0000000000e2', 'x')$$,
  '42501', null, 'a Viewer can''t accept');
select throws_ok($$select * from public.engine_page_fingerprints(now(), now())$$,
  '42501', null, 'the engine read is the service role''s');
reset role;
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok($$select public.accept_page_baseline('00000000-0000-0000-0000-0000000000e2', 'x')$$,
  '42501', null, 'a Responder, even the owner, can''t accept');
select throws_ok($$update public.page_baselines set reason = 'x'$$, '42501', null, 'nobody writes a baseline directly');
reset role;

-- ── Accept, Undo ─────────────────────────────────────────────────────────
insert into public.incidents (id, site_id, monitor_id, state, severity, episode_severity, trigger, started_at, detected_at)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000d1', 'unacked', 'problem', 'problem', 'content_change',
        now() - interval '30 minutes', now() - interval '30 minutes');

select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok($$select public.accept_page_baseline('00000000-0000-0000-0000-0000000000e2', '  ')$$,
  '22023', null, 'a reason is required');
select throws_ok($$select public.accept_page_baseline('00000000-0000-0000-0000-0000000000e3', 'x')$$,
  '22023', null, 'a blocked fetch can''t become the baseline');
select throws_ok($$select public.accept_page_baseline('00000000-0000-0000-0000-0000000000e4', 'x')$$,
  '22023', null, 'a Googlebot fetch can''t become the baseline');
select is(public.accept_page_baseline('00000000-0000-0000-0000-0000000000e2', 'Client added the partner script'),
  now() + interval '10 seconds', 'an Admin accepts; it applies in 10 s');
select throws_ok($$select public.accept_page_baseline('00000000-0000-0000-0000-0000000000e2', 'again')$$,
  '55000', null, 'one accept at a time');
reset role;

select is(
  (select fingerprint->>'title' || ' · ' || (undo_before->'fingerprint'->>'title') || ' · ' || reason
   from public.page_baselines where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  'Site A | สล็อตออนไลน์ · Site A · Client added the partner script', 'stored with the previous one kept'
);
select is(
  (select baseline->>'title' || ' · ' || (pending_until = now() + interval '10 seconds')::text
   from public.engine_page_fingerprints(now(), now() - interval '1 day')
   where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  'Site A · true', 'until the window closes the engine still compares with the previous baseline'
);
select is(
  (select payload->>'reason' || ' · ' || (payload->>'with_resolve') from public.incident_events
   where incident_id = '00000000-0000-0000-0000-0000000000f1' and type = 'baseline_accepted'),
  'Client added the partner script · false', 'the open Page change incident''s timeline has it'
);
select is((select count(*)::int from public.audit_log where action = 'page_baseline.accept'
           and actor_id = (select id from ids where name = 'admin')), 1, 'audited as the Admin');

select tests.authenticate_as((select id from ids where name = 'admin2'));
select throws_ok($$select public.undo_page_baseline('00000000-0000-0000-0000-0000000000d1')$$,
  '42501', null, 'another Admin can''t undo it');
reset role;
select tests.authenticate_as((select id from ids where name = 'admin'));
select lives_ok($$select public.undo_page_baseline('00000000-0000-0000-0000-0000000000d1')$$, 'the Admin undoes it');
reset role;
select is(
  (select fingerprint->>'title' || ' · ' || (accepted_by is null)::text || ' · ' || (undo_until is null)::text
   from public.page_baselines where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  'Site A · true · true', 'the previous baseline is back'
);
select is(
  (select count(*)::int from public.incident_events where incident_id = '00000000-0000-0000-0000-0000000000f1'
     and type = 'baseline_undone')
  + (select count(*)::int from public.audit_log where action = 'page_baseline.undo'),
  2, 'Undo is on the timeline and in the audit log'
);

-- After the window: the engine compares with the new one, and Undo is too late.
select tests.authenticate_as((select id from ids where name = 'admin'));
select lives_ok($$select public.accept_page_baseline('00000000-0000-0000-0000-0000000000e2', 'Client redesign')$$, 'accepted again');
reset role;
update public.page_baselines set undo_until = now() - interval '1 second'
  where monitor_id = '00000000-0000-0000-0000-0000000000d1';
select is(
  (select baseline->>'title' || ' · ' || coalesce(pending_until::text, 'none')
   from public.engine_page_fingerprints(now(), now() - interval '1 day')
   where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  'Site A | สล็อตออนไลน์ · none', 'once the window closed the engine compares with the new baseline'
);
select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok($$select public.undo_page_baseline('00000000-0000-0000-0000-0000000000d1')$$,
  '55000', null, 'too late to undo');
reset role;

-- ── A new home page URL resets the baseline ──────────────────────────────
update public.monitors set url = 'https://a2.pgtap.test/' where id = '00000000-0000-0000-0000-0000000000d1';
select is((select count(*)::int from public.engine_page_fingerprints(now(), now() - interval '1 day')), 0,
  'a baseline of the old URL isn''t compared');
insert into public.crawler_checks (id, monitor_id, view, checked_at, outcome, usable, status_code, fingerprint) values
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d1', 'plain', now(), 'pass', true, 200,
   '{"title":"Site A2","scripts":[],"links":[]}');
select ok(public.crawler_set_baseline('00000000-0000-0000-0000-0000000000e5'), 'the next fetch sets a new baseline');
select is(
  (select fingerprint->>'title' || ' · ' || (first_set_at = now())::text || ' · ' || (accepted_by is null)::text
   from public.page_baselines where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  'Site A2 · true · true', 'and the recording starts again'
);

-- ── Resolve with "Also accept the current page" ──────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(
  $$select public.resolve_incident('00000000-0000-0000-0000-0000000000f1', 'client_change', 'Redesign', null,
                                   '00000000-0000-0000-0000-0000000000e5')$$,
  '42501', null, 'only an Admin resolves with a new baseline');
select throws_ok(
  $$select public.resolve_incident('00000000-0000-0000-0000-0000000000f1', 'client_change', 'Redesign', null)$$,
  '55000', null, 'without it a Page change still waits for the page to match');
reset role;
select tests.authenticate_as((select id from ids where name = 'admin'));
select throws_ok(
  $$select public.resolve_incident('00000000-0000-0000-0000-0000000000f1', 'deploy', 'Redesign', null,
                                   '00000000-0000-0000-0000-0000000000e5')$$,
  '22023', null, 'only with Client-side change');
select is(
  public.resolve_incident('00000000-0000-0000-0000-0000000000f1', 'client_change', 'Client launched a new home page', null,
                          '00000000-0000-0000-0000-0000000000e5'),
  now() + interval '10 seconds', 'an Admin accepts and resolves at once'
);
select throws_ok($$select public.undo_page_baseline('00000000-0000-0000-0000-0000000000d1')$$,
  '55000', null, 'a baseline accepted with a resolve is undone only with the resolve');
select lives_ok($$select public.undo_resolve('00000000-0000-0000-0000-0000000000f1')$$, 'Undo takes the resolve back');
reset role;
select is(
  (select i.state::text || ' · ' || (b.undo_until is null)::text
   from public.incidents i, public.page_baselines b
   where i.id = '00000000-0000-0000-0000-0000000000f1' and b.monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  'unacked · true', 'and the baseline it accepted'
);

select * from finish();
rollback;
