-- check_chain_streaks (spec §21.4, D-029): the trigger on check_results gives the old walk's answer —
-- per monitor and location, the first TLS chain check after the newest check that isn't one, or none —
-- whatever order the checks arrive in. Equivalence, not the rule against itself (advisor, 15 Nov 2026):
-- generated sequences of chain errors, passes, blocks, hard fails, rechecks, confirm checks and equal
-- timestamps, inserted shuffled one by one, compared with the walk computed from the rows. Also: a
-- partition the partition job makes later has the trigger, the insert never fails for it, staff read it.
begin;
\ir _helpers.psql
select plan(11);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values ('arm', tests.create_user('arm@pgtap.test', 'responder')),
                       ('mint', tests.create_user('mint@pgtap.test', 'viewer'));
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Cando', 2,
   (select id from ids where name = 'arm'));
-- Twelve monitors × three locations = 36 independent sequences.
insert into public.monitors (id, site_id, type, is_primary, url)
select ('00000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, '00000000-0000-0000-0000-0000000000a1',
       'http', i = 1, 'https://cando.pgtap.test/p' || i
from generate_series(1, 12) i;

-- The walk (the Overview's old fillChainSince), from the rows themselves.
create temp view walk as
  select m.id as monitor_id, l.code as location,
    (select min(cr.checked_at) from public.check_results cr
     where cr.monitor_id = m.id and cr.location = l.code
       and cr.outcome = 'fail' and coalesce(cr.error, '') in
             ('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT')
       and cr.checked_at > coalesce(
         (select max(g.checked_at) from public.check_results g
          where g.monitor_id = m.id and g.location = l.code
            and not (g.outcome = 'fail' and coalesce(g.error, '') in
                       ('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'))),
         '-infinity')) as since
  from public.monitors m cross join public.probe_locations l
  where m.site_id = '00000000-0000-0000-0000-0000000000a1';

-- Generated checks: 60 per sequence over ~3 h, a fifth of them sharing a second with another, every
-- kind of row; inserted in a shuffled order, one statement each (the trigger runs per row).
select setseed(0.29);
create temp table gen as
  select ('00000000-0000-0000-0000-0000000001' || lpad(m::text, 2, '0'))::uuid as monitor_id, l.code as location,
         now() - interval '4 hours' + make_interval(secs => (k * 180 + case when random() < 0.2 then 0 else (random() * 170)::int end)) as checked_at,
         case when random() < 0.3 then 2 else 1 end::smallint as attempt,
         (array['chain', 'chain', 'chain', 'pass', 'blocked', 'hardfail'])[1 + floor(random() * 6)::int] as kind,
         random() < 0.05 as confirm,
         random() as shuffle
  from generate_series(1, 12) m
  cross join (values ('BKK'), ('SIN'), ('TYO')) l (code)
  cross join generate_series(1, 60) k;
do $$
declare
  r record;
begin
  for r in select * from gen order by shuffle loop
    insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, status_code, error, confirm)
    values (r.monitor_id, r.location, r.checked_at, r.attempt,
            case r.kind when 'pass' then 'pass' when 'blocked' then 'blocked' else 'fail' end::public.check_outcome,
            case r.kind when 'pass' then 200 when 'blocked' then 403 when 'hardfail' then 503 end,
            case r.kind when 'chain' then 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' when 'hardfail' then 'HTTP 503' end,
            case when r.confirm then true end);
  end loop;
end;
$$;

select ok((select count(*) from public.check_chain_streaks) > 0, 'some sequences end in a running streak');
select ok((select count(*) from walk where since is null) > 0, '… and some don''t');
select is(
  (select count(*) from walk w
   full join public.check_chain_streaks s on s.monitor_id = w.monitor_id and s.location = w.location
   where w.since is distinct from s.since),
  0::bigint,
  'every sequence: the trigger''s start is the walk''s, shuffled arrivals and all'
);

-- Then each arrives in time order too (the usual case), on fresh monitors: same answer.
update gen set monitor_id = ('00000000-0000-0000-0000-0000000002' || right(monitor_id::text, 2))::uuid;
insert into public.monitors (id, site_id, type, is_primary, url)
select distinct monitor_id, '00000000-0000-0000-0000-0000000000a1'::uuid, 'http'::public.monitor_type, false, 'https://cando.pgtap.test/q' || right(monitor_id::text, 2)
from gen;
do $$
declare
  r record;
begin
  for r in select * from gen order by checked_at, attempt loop
    insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, status_code, error, confirm)
    values (r.monitor_id, r.location, r.checked_at, r.attempt,
            case r.kind when 'pass' then 'pass' when 'blocked' then 'blocked' else 'fail' end::public.check_outcome,
            case r.kind when 'pass' then 200 when 'blocked' then 403 when 'hardfail' then 503 end,
            case r.kind when 'chain' then 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' when 'hardfail' then 'HTTP 503' end,
            case when r.confirm then true end);
  end loop;
end;
$$;
select is(
  (select count(*) from walk w
   full join public.check_chain_streaks s on s.monitor_id = w.monitor_id and s.location = w.location
   where w.since is distinct from s.since),
  0::bigint,
  'in time order too'
);

-- The hourly reconcile puts a wrong row back (a row a caught error or a raced backfill left behind).
update public.check_chain_streaks set since = since - interval '1 day'
  where (monitor_id, location) in (select monitor_id, location from public.check_chain_streaks limit 1);
insert into public.check_chain_streaks (monitor_id, location, since)
select w.monitor_id, w.location, now() - interval '1 day' from walk w where w.since is null limit 1;
select ok(private.reconcile_chain_streaks() >= 2, 'the reconcile changes the rows left wrong');
select is(
  (select count(*) from walk w
   full join public.check_chain_streaks s on s.monitor_id = w.monitor_id and s.location = w.location
   where w.since is distinct from s.since),
  0::bigint,
  '… and the table equals the walk again'
);
select is((select count(*) from cron.job where jobname = 'check-chain-streaks-reconcile'), 1::bigint,
  'the reconcile runs hourly');

-- A partition the job makes later has the trigger (four months on; the job also drops old months —
-- the test rolls back).
select private.manage_check_results_partitions(now() + interval '4 months');
insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, error) values
  ('00000000-0000-0000-0000-000000000101', 'BKK', date_trunc('month', now() + interval '4 months') + interval '1 day', 1, 'fail', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
select is(
  (select since from public.check_chain_streaks where monitor_id = '00000000-0000-0000-0000-000000000101' and location = 'BKK')
    <= date_trunc('month', now() + interval '4 months') + interval '1 day',
  true,
  'a check in a partition the job made later reaches the trigger'
);

-- The bookkeeping never fails an insert: with the table gone the check is still stored (a warning).
alter table public.check_chain_streaks rename to check_chain_streaks_away;
select lives_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, error)
    values ('00000000-0000-0000-0000-000000000101', 'SIN', date_trunc('month', now() + interval '4 months') + interval '2 days',
            1, 'fail', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')$$,
  'an error in the trigger never fails the probes'' insert'
);
alter table public.check_chain_streaks_away rename to check_chain_streaks;

-- Staff read it (the Overview runs as the signed-in person); nobody else writes it.
select tests.authenticate_as((select id from ids where name = 'mint'));
select ok((select count(*) from public.check_chain_streaks) > 0, 'a Viewer reads the streaks');
select throws_ok($$delete from public.check_chain_streaks$$, '42501', null, 'a signed-in session can''t change them');
reset role;

select * from finish();
rollback;
