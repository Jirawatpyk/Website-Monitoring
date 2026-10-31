-- D-049 follow-ups: the confirm-check flag on check_results (D-051), the monitor's timeout blips in
-- monitor_status written and kept by engine_write_monitors (D-050), and the Intermittent trigger.
begin;
\ir _helpers.psql
select plan(12);

-- ── Fixtures (as postgres) ────────────────────────────────────────────────
select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 3,
   (select id from ids where name = 'arm'));
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true,
   'https://a.pgtap.test/');

-- ── check_results.confirm (D-051) ─────────────────────────────────────────
select col_is_null('public', 'check_results', 'confirm', 'confirm is nullable (catalog-only on the big table)');
select col_hasnt_default('public', 'check_results', 'confirm', 'confirm has no default');
insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, error, confirm) values
  ('00000000-0000-0000-0000-0000000000d1', 'SIN', '2026-10-31 02:00:00Z', 1, 'fail', 'Timeout', null),
  ('00000000-0000-0000-0000-0000000000d1', 'SIN', '2026-10-31 02:01:00Z', 1, 'fail', 'Timeout', true);
select is(
  (select array_agg(confirm order by checked_at) from public.check_results
    where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  array[null, true]::boolean[], 'a scheduled check and a confirm check are told apart'
);

-- ── monitor_status.blips (D-050) ──────────────────────────────────────────
select col_not_null('public', 'monitor_status', 'blips', 'blips is never null');
select lives_ok(
  $$select public.engine_write_monitors('00000000-0000-0000-0000-0000000000a1', '2026-10-31 02:00Z',
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "ok", "slowRounds": 0,
       "failingSince": {}, "blips": ["2026-10-31T01:50:00Z", "2026-10-31T01:40:00Z"]}]'::jsonb, null)$$,
  'engine_write_monitors takes the blips'
);
select is(
  (select blips from public.monitor_status where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  array['2026-10-31 01:40Z', '2026-10-31 01:50Z']::timestamptz[], 'the blips are stored oldest first'
);
select lives_ok(
  $$select public.engine_write_monitors('00000000-0000-0000-0000-0000000000a1', '2026-10-31 02:05Z',
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "ok", "slowRounds": 0,
       "failingSince": {}}]'::jsonb, null)$$,
  'an entry without blips (a runner deployed before D-050) is accepted'
);
select is(
  (select blips from public.monitor_status where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  array['2026-10-31 01:40Z', '2026-10-31 01:50Z']::timestamptz[], '… and keeps the stored blips'
);
select lives_ok(
  $$select public.engine_write_monitors('00000000-0000-0000-0000-0000000000a1', '2026-10-31 02:10Z',
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "problem", "trigger": "intermittent",
       "cause": "Timing out on and off", "slowRounds": 0, "failingSince": {}, "blips": []}]'::jsonb, 'problem')$$,
  'an empty list clears the blips, and the Intermittent trigger is stored'
);
select results_eq(
  $$select cardinality(blips), trigger::text from public.monitor_status
    where monitor_id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values (0, 'intermittent')$$,
  'blips cleared, PROBLEM · Intermittent kept'
);
select throws_ok(
  $$update public.monitor_status set blips = array(select now() from generate_series(1, 21))
    where monitor_id = '00000000-0000-0000-0000-0000000000d1'$$,
  '23514', null, 'blips is bounded'
);

-- ── RLS unchanged: staff read, nobody else writes ─────────────────────────
select tests.authenticate_as((select id from ids where name = 'mint'));
select throws_ok(
  $$update public.monitor_status set blips = '{}'$$,
  '42501', null, 'a signed-in person can''t write the carry state'
);

select * from finish();
rollback;
