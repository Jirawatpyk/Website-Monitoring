-- The Overview and Probes cold-load timeouts (production, 15 Nov 2026): on the micro compute a cold read
-- of a day of checks takes longer than the `authenticated` statement_timeout (8 s). Measured locally at
-- production volume (2.06 M rows, 142 k a day, after VACUUM; buffers are 8 KB pages):
--   · overview_response_24h  31,073 buffers → 1,280 (Index Only Scan, 0 heap fetches)
--   · probe_activity_24h     12,011 buffers →   556
--   · probe_gaps_24h         12,011 buffers →   562
--   · the TLS chain Since     3,700 buffers → 1,669 per location (45 k-row streak)
-- The pages read the same rows through covering indexes without touching the table. The functions don't
-- change; the planner picks the indexes. Index-only scans need a current visibility map:
-- 20261115073512 has autovacuum visit each partition after every 10 k inserts.
--
-- How it's built (db-reviewer): each partition gets its index here — past months and the empty future
-- ones, then the current month last. A file is one transaction, so every partition stays SHARE-locked
-- until it commits: built this way, the partition the probes write to is locked only for its own build
-- (~1 s per 2 M rows locally; more on the micro compute). One index per file. The parent indexes come
-- in 20261115073510, which only attaches these: in the same file the parent's lock would come after the
-- partition's, the reverse of an insert's order, and a probe insert landing mid-build deadlocks it
-- (db-reviewer reproduced it). The old indexes are dropped in a file of their own (20261115073511).
-- Merge at a quiet time.
--
-- This file: the per-monitor day (overview_response_24h, the site's response series, the rollups, the
-- due-monitors confirm reads). Same key as `check_results_monitor_idx`, which it replaces.
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
      'create index if not exists %I on %s (monitor_id, checked_at desc) include (outcome, error, response_ms)',
      v_part.relname || '_monitor_cover_idx', v_part.part);
  end loop;
end;
$$;
