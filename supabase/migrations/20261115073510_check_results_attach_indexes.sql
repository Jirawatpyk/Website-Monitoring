-- Cold-load fix: the parent indexes over the per-partition ones built in 20261115073507–073509. Each
-- partition already has a matching index, so these only attach them (milliseconds, no build). Their own
-- file (db-reviewer): here the parent is locked first and then each partition, the same order a probe
-- insert takes, so they can't deadlock. A partition the job makes later gets all three on creation.
set local lock_timeout = '5s';

create index check_results_monitor_cover_idx on public.check_results (monitor_id, checked_at desc)
  include (outcome, error, response_ms);

create index check_results_checked_at_location_idx on public.check_results (checked_at)
  include (location);

create index check_results_monitor_location_cover_idx
  on public.check_results (monitor_id, location, checked_at desc)
  include (attempt, outcome, error, response_ms);
