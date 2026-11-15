-- Keep check_results' visibility map current, so the covering indexes (previous migration) answer from
-- the index alone. Postgres vacuums an insert-only table only after 20% new rows: a monthly partition
-- then waits days late in the month, every page written since needs a heap read, and the cold-load
-- timeouts come back. Each partition is vacuumed after every 10 k inserts instead (~100 min at today's
-- 142 k checks a day). Set on each partition — storage options aren't inherited — here for those that
-- exist and by the nightly partition job for each new one. `alter table … set` takes a
-- ShareUpdateExclusive lock: the probes keep inserting.
set local lock_timeout = '5s';

-- As in 20261031150845_brin_autosummarize.sql, plus the last loop. Same signature: its grants and the
-- nightly pg_cron job stay as they are.
create or replace function private.manage_check_results_partitions(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
-- Creating a partition locks the parent and an option change locks its index: never wait long behind
-- the probes' inserts (two months of partitions ahead, so a night that gives up costs nothing).
set lock_timeout = '5s'
as $$
declare
  v_month date;
  v_name text;
  v_part record;
  v_index regclass;
  v_table regclass;
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
    -- Oldest month first, the order the planner locks partitions in (db-reviewer: no deadlock).
    order by h.inhrelid::regclass::text
  loop
    execute format('alter index %s set (autosummarize = on)', v_index);
  end loop;

  -- Each partition is vacuumed after every 10 k inserts, so index-only scans skip the table (only those
  -- not set exactly so: a new one, or one changed by hand; same order).
  for v_table in
    select i.inhrelid::regclass
    from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.check_results'::regclass
      and not (coalesce(c.reloptions, '{}') @> array['autovacuum_vacuum_insert_threshold=10000',
                                                      'autovacuum_vacuum_insert_scale_factor=0'])
    order by i.inhrelid::regclass::text
  loop
    execute format(
      'alter table %s set (autovacuum_vacuum_insert_threshold = 10000, autovacuum_vacuum_insert_scale_factor = 0)',
      v_table);
  end loop;
end;
$$;

select private.manage_check_results_partitions();
