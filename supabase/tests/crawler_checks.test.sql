-- S09c (D-041, D-042): crawler_checks — RLS, the engine's latest-usable read, retention job.
begin;
\ir _helpers.psql
select plan(14);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer')),
  ('cli',  tests.create_user('cli@pgtap.test', 'client'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Live', 1,
   (select id from ids where name = 'arm'), true),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Draft', 1,
   (select id from ids where name = 'arm'), false);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true, 'https://a.pgtap.test'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'http', false, 'https://a.pgtap.test/key'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'http', true, 'https://b.pgtap.test');

insert into public.crawler_checks (monitor_id, view, checked_at, outcome, usable, status_code, forbidden) values
  -- googlebot: a hit 40 min ago, then a WAF 403 (no data) 10 min ago
  ('00000000-0000-0000-0000-0000000000d1', 'googlebot', now() - interval '40 min', 'pass', true, 200, '{บาคาร่า}'),
  ('00000000-0000-0000-0000-0000000000d1', 'googlebot', now() - interval '10 min', 'pass', false, 403, null),
  -- google_referer: an old usable row, outside the window, and a newer clean one
  ('00000000-0000-0000-0000-0000000000d1', 'google_referer', now() - interval '3 hours', 'pass', true, 200, '{x}'),
  ('00000000-0000-0000-0000-0000000000d1', 'google_referer', now() - interval '20 min', 'pass', true, 200, '{}'),
  -- a key page and a draft site: never read
  ('00000000-0000-0000-0000-0000000000d3', 'googlebot', now() - interval '5 min', 'pass', true, 200, '{x}'),
  ('00000000-0000-0000-0000-0000000000d2', 'googlebot', now() - interval '5 min', 'pass', true, 200, '{x}'),
  -- 31 days old: the retention job's
  ('00000000-0000-0000-0000-0000000000d1', 'googlebot', now() - interval '31 days', 'pass', true, 200, '{}');

select throws_ok(
  $$insert into public.crawler_checks (monitor_id, view, checked_at, outcome, usable, status_code)
    values ('00000000-0000-0000-0000-0000000000d1', 'plain', now(), 'pass', true, 200)$$,
  '23514', null, 'a view outside CRAWLER_VIEWS is refused'
);
select throws_ok(
  $$insert into public.crawler_checks (monitor_id, view, checked_at, outcome, usable)
    values ('00000000-0000-0000-0000-0000000000d1', 'googlebot', now(), 'fail', true)$$,
  '23514', null, 'a fetch without an answer is never usable'
);

-- ── The engine's read ─────────────────────────────────────────────────────
select results_eq(
  $$select f->>'view', f->'forbidden'
    from public.engine_crawler_checks(now() - interval '65 min'), jsonb_array_elements(facts) f$$,
  $$values ('google_referer'::text, '[]'::jsonb), ('googlebot'::text, '["บาคาร่า"]'::jsonb)$$,
  'usable rows per view of live primary monitors, newest first; a later 403 never hides the hit'
);
select results_eq(
  $$select monitor_id, jsonb_array_length(facts) from public.engine_crawler_checks(now() - interval '1 day')$$,
  $$values ('00000000-0000-0000-0000-0000000000d1'::uuid, 3)$$,
  'one row per monitor: two google_referer fetches (the 3-hour-old one within a day), the one usable googlebot fetch'
);
select is(
  (select count(*)::int from public.engine_crawler_checks(now() - interval '5 min')),
  0,
  'nothing older than p_since'
);

-- ── Retention ─────────────────────────────────────────────────────────────
select is(
  (select schedule::text from cron.job where jobname = 'crawler-checks-retention'),
  '40 17 * * *',
  'pg_cron deletes old crawler rows nightly'
);
select lives_ok(
  (select command from cron.job where jobname = 'crawler-checks-retention'),
  'the retention command runs'
);
select is(
  (select count(*)::int from public.crawler_checks where checked_at < now() - interval '30 days'),
  0,
  'and keeps 30 days'
);

-- ── RLS ───────────────────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.crawler_checks), 6, 'a viewer reads crawler_checks');
select throws_ok(
  $$select * from public.engine_crawler_checks(now())$$, '42501', null, 'but not the engine''s read'
);

select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok(
  $$delete from public.crawler_checks$$, '42501', null, 'staff can''t change crawler rows (only the crawler writes)'
);
select throws_ok(
  $$insert into public.crawler_checks (monitor_id, view, checked_at, outcome, usable)
    values ('00000000-0000-0000-0000-0000000000d1', 'googlebot', now(), 'pass', true)$$,
  '42501', null, 'nor add one'
);

select tests.authenticate_as((select id from ids where name = 'cli'));
select is((select count(*)::int from public.crawler_checks), 0, 'a client account sees no crawler rows (RLS)');

select tests.as_anon();
select throws_ok($$select * from public.crawler_checks$$, '42501', null, 'anon can''t read crawler_checks');

select * from finish();
rollback;
