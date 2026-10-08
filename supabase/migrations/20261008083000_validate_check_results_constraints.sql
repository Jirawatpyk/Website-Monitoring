-- S05b: validate the check_results constraints added NOT VALID by 20261008065647 and 20261008081432.
-- A migration runs in one transaction, so validating here — not in the file that added them — means
-- the scan holds only SHARE UPDATE EXCLUSIVE: probe inserts carry on (db-reviewer, S05b).

set local lock_timeout = '5s';

alter table public.check_results validate constraint check_results_waf_vendor;
alter table public.check_results validate constraint check_results_waf_blocked;
alter table public.check_results validate constraint check_results_control_bkk;
alter table public.check_results validate constraint check_results_akamai_bkk;
