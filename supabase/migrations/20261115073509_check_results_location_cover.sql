-- Cold-load fix, third index (see 20261115073507 for how it's built; code review): the Overview's TLS
-- chain "Since" (fillChainSince) walks back through a monitor's chain streak at one location until a
-- check that isn't a chain error — the read that timed out on 15 Nov. Through
-- `check_results_monitor_location_idx` every row of the streak was a heap fetch. Covering outcome and
-- error lets it walk the index alone; attempt and response_ms also cover site_list_locations (newest
-- check per monitor and location). Same key as the index it replaces (dropped in 20261115073511).
set local lock_timeout = '5s';

do $$
declare
  v_part record;
begin
  for v_part in
    select c.oid::regclass as part, c.relname
    from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.check_results'::regclass
    order by c.relname = 'check_results_' || to_char(now() at time zone 'UTC', 'YYYY_MM'), c.relname
  loop
    execute format(
      'create index if not exists %I on %s (monitor_id, location, checked_at desc) include (attempt, outcome, error, response_ms)',
      v_part.relname || '_monitor_location_cover_idx', v_part.part);
  end loop;
end;
$$;
