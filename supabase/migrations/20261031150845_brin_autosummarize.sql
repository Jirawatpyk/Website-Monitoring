-- BRIN autosummarize on every check_results partition (db-reviewer, D-051 review, 31 Oct 2026).
--
-- `check_results_checked_at_brin` (20261009033334_check_rollups.sql) is summarized only by autovacuum,
-- whose insert threshold (20% of a monthly partition) leaves days of rows unsummarized late in the
-- month — and every time-range read (the rollup job, the response series, D-051's due-ness) then
-- scans those ranges in full: 16 ms summarized vs 135–362 ms on db-reviewer's 12.4 M-row set.
-- `autosummarize` asks for each page range to be summarized as it fills. Postgres refuses it on the
-- partitioned parent index, so it is set on each partition's own index — here for the partitions that
-- exist, and by the nightly partition job for each new one. Catalog-only: no scan, no rebuild.

set local lock_timeout = '5s';

-- As in 20261006103440_probes_and_incidents.sql, plus the last loop. Same signature: its grants and
-- the nightly pg_cron job stay as they are.
create or replace function private.manage_check_results_partitions(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_name text;
  v_part record;
  v_index regclass;
begin
  for i in 0..2 loop
    v_month := (date_trunc('month', p_now at time zone 'UTC') + make_interval(months => i))::date;
    v_name := 'check_results_' || to_char(v_month, 'YYYY_MM');
    if to_regclass('private.' || v_name) is null then
      execute format(
        'create table private.%I partition of public.check_results for values from (%L) to (%L)',
        v_name,
        v_month::timestamp at time zone 'UTC',
        (v_month + interval '1 month')::timestamp at time zone 'UTC'
      );
      execute format('revoke all on private.%I from public, anon, authenticated', v_name);
    end if;
  end loop;

  for v_part in
    select c.relname
    from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where i.inhparent = 'public.check_results'::regclass
      and n.nspname = 'private'
      and c.relname ~ '^check_results_\d{4}_\d{2}$'
  loop
    if (to_date(right(v_part.relname, 7), 'YYYY_MM') + interval '1 month')
       <= (p_now at time zone 'UTC') - interval '90 days' then
      execute format('drop table private.%I', v_part.relname);
    end if;
  end loop;

  -- Each partition's own BRIN index summarizes its page ranges as they fill (only those not set yet,
  -- so a nightly run takes no lock it doesn't need).
  for v_index in
    select h.inhrelid::regclass
    from pg_catalog.pg_inherits h
    join pg_catalog.pg_class c on c.oid = h.inhrelid
    where h.inhparent = 'public.check_results_checked_at_brin'::regclass
      and not ('autosummarize=on' = any (coalesce(c.reloptions, '{}')))
  loop
    execute format('alter index %s set (autosummarize = on)', v_index);
  end loop;
end;
$$;

select private.manage_check_results_partitions();
