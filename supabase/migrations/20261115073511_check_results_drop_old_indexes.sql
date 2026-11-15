-- Cold-load fix: the two indexes the covering ones replace (same keys), so each check writes one index
-- per key, not two. Their own file (db-reviewer): a drop takes an ACCESS EXCLUSIVE lock on the table and
-- every partition until commit, so it holds that lock only for the drop itself; if the lock wait passes
-- 5 s behind a read, only this small file fails and is retried.
set local lock_timeout = '5s';

drop index public.check_results_monitor_idx;
drop index public.check_results_monitor_location_idx;
