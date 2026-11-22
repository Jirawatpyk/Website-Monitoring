-- S20 (db review, 22 Nov 2026): the Reports page and a printed PDF read a month of each primary
-- monitor's all-location day rollups as `authenticated`. Under RLS `bucket = 'day'` can't be an index
-- condition (enum equality isn't leakproof), so the read scanned every rollup bucket and location —
-- 3,352 buffers for 440 rows on a 2-year synthetic table. This partial index serves exactly that read
-- (43 + 26 buffers, ~1 ms). check_rollups isn't partitioned; the table is small enough to index in one go.
set local lock_timeout = '5s';

create index if not exists check_rollups_day_all_idx
  on public.check_rollups (monitor_id, bucket_start)
  where bucket = 'day' and location is null;
