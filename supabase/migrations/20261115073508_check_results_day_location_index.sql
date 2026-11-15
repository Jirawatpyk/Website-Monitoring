-- Cold-load fix, second index (see 20261115073507 for the numbers and how it's built): a day of checks
-- per location, for the Probes page (probe_activity_24h, probe_gaps_24h): 12,011 → ~560 buffers each.
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
    execute format('create index if not exists %I on %s (checked_at) include (location)',
      v_part.relname || '_day_location_idx', v_part.part);
  end loop;
end;
$$;
