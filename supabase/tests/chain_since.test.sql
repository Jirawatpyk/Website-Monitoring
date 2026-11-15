-- The TLS chain streak's start per location (spec §21.4, D-029): monitor_status.chain_since written by
-- engine_write_monitors, kept when an entry has no key (a runner deployed before this column), and
-- readable by staff for the Overview's "Since".
begin;
\ir _helpers.psql
select plan(7);

-- ── Fixtures (as postgres) ────────────────────────────────────────────────
select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Cando', 2,
   (select id from ids where name = 'arm'));
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true,
   'https://cando.pgtap.test/');

select col_not_null('public', 'monitor_status', 'chain_since', 'chain_since is never null');
select lives_ok(
  $$select public.engine_write_monitors('00000000-0000-0000-0000-0000000000a1', '2026-11-13 02:15Z',
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "problem", "trigger": "tls_chain",
       "slowRounds": 0, "failingSince": {}, "blips": [],
       "chainSince": {"BKK": "2026-11-13T02:15:01.000Z", "SIN": "2026-11-13T02:15:46.000Z"}}]'::jsonb, 'problem')$$,
  'engine_write_monitors takes chainSince'
);
select is(
  (select chain_since from public.monitor_status where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  '{"BKK": "2026-11-13T02:15:01.000Z", "SIN": "2026-11-13T02:15:46.000Z"}'::jsonb,
  'the start per location is stored as the engine wrote it'
);

-- A runner a deploy behind (no chainSince key) never wipes it.
select lives_ok(
  $$select public.engine_write_monitors('00000000-0000-0000-0000-0000000000a1', '2026-11-13 02:18Z',
    '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "problem", "trigger": "tls_chain",
       "slowRounds": 0, "failingSince": {}, "blips": []}]'::jsonb, null)$$,
  'an entry without chainSince is accepted'
);
select is(
  (select chain_since ->> 'BKK' from public.monitor_status where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  '2026-11-13T02:15:01.000Z',
  '… and keeps the stored start'
);

-- An empty object clears it (the streak ended).
select public.engine_write_monitors('00000000-0000-0000-0000-0000000000a1', '2026-11-13 02:21Z',
  '[{"monitorId": "00000000-0000-0000-0000-0000000000d1", "status": "ok", "slowRounds": 0,
     "failingSince": {}, "blips": [], "chainSince": {}}]'::jsonb, 'ok');
select is(
  (select chain_since from public.monitor_status where monitor_id = '00000000-0000-0000-0000-0000000000d1'),
  '{}'::jsonb,
  'an empty object clears it'
);

-- Staff read it (the Overview runs as the signed-in person).
select tests.authenticate_as((select id from ids where name = 'mint'));
select is(
  (select count(*) from public.monitor_status where monitor_id = '00000000-0000-0000-0000-0000000000d1' and chain_since = '{}'),
  1::bigint,
  'a Viewer reads chain_since'
);
reset role;

select * from finish();
rollback;
