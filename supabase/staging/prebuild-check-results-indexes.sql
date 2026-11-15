-- Pre-build the cold-load fix's indexes on the CURRENT month's check_results partition, before PR #202
-- merges (migrations 20261115073507–073509 then skip them). CREATE INDEX CONCURRENTLY takes no lock that
-- blocks the probes' inserts. Run in the SQL editor of the project being migrated.
--
-- Run ONE statement at a time: CONCURRENTLY can't run inside a transaction block, and the editor wraps
-- several statements in one. Change 2026_11 to the current UTC month if it isn't November any more.
-- Each takes a while (it reads the partition twice); the probes keep writing meanwhile.

-- 1
create index concurrently if not exists check_results_2026_11_monitor_cover_idx
  on private.check_results_2026_11 (monitor_id, checked_at desc) include (outcome, error, response_ms);

-- 2
create index concurrently if not exists check_results_2026_11_day_location_idx
  on private.check_results_2026_11 (checked_at) include (location);

-- 3
create index concurrently if not exists check_results_2026_11_monitor_location_cover_idx
  on private.check_results_2026_11 (monitor_id, location, checked_at desc)
  include (attempt, outcome, error, response_ms);

-- 4: all three must say valid = true. A false one: drop index concurrently private.<name>; then run it again.
select c.relname, x.indisvalid as valid, pg_size_pretty(pg_relation_size(c.oid)) as size
from pg_index x join pg_class c on c.oid = x.indexrelid
where x.indrelid = 'private.check_results_2026_11'::regclass
  and (c.relname like '%cover_idx' or c.relname like '%day_location_idx')
order by 1;
