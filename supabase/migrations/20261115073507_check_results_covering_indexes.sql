-- The Overview and Probes cold-load timeouts (production, 15 Nov 2026): on the micro compute a cold read
-- of a day of checks takes longer than the `authenticated` statement_timeout (8 s). Measured locally at
-- production volume (2.06 M rows, 142 k a day, after VACUUM; buffers are 8 KB pages):
--   · overview_response_24h  31,073 buffers → 1,280 (Index Only Scan, 0 heap fetches)
--   · probe_activity_24h     12,011 buffers →   556
--   · probe_gaps_24h         12,011 buffers →   562
-- Both pages read the same rows through these indexes without touching the table, so a cold load reads
-- a few MB instead of ~250 MB. The functions don't change; the planner picks the indexes.
--
-- The per-monitor index keeps the key of `check_results_monitor_idx` (monitor, newest first), so every
-- query that used it uses this one, and it is replaced rather than kept beside it (one index to write
-- per check). Index-only scans need the visibility map to be current: the next migration has autovacuum
-- visit each partition after every 10 k inserts.
--
-- Building an index on the partitioned table holds a SHARE lock on each partition while it builds: the
-- probes' inserts wait for it (seconds per partition; ~1.7 s for 2 M rows locally). Merge at a quiet time.
set local lock_timeout = '5s';

create index check_results_monitor_cover_idx on public.check_results (monitor_id, checked_at desc)
  include (outcome, error, response_ms);
drop index public.check_results_monitor_idx;

create index check_results_checked_at_location_idx on public.check_results (checked_at)
  include (location);
