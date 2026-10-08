-- S05b (D-027, D-028): sites behind a WAF are judged on the locations it doesn't block.
--
-- Two facts per check the engine needs:
--   waf        — the header-level WAF signature of a blocked check (akamai / cloudflare / sucuri), or
--                null. Only these let a location abstain on a site flagged `behind_waf`. Text + check,
--                like `location` (D-014): the list is short and mirrors `WAF_VENDORS` in
--                packages/shared/src/domain.ts — add a vendor in both.
--   control_ok — for a Bangkok check: whether the VPS's control check (two public URLs from different
--                providers) answered in that batch. false = both failed, so the VPS's own network is
--                suspect and its result can't decide a WAF site. null = not reported (Singapore /
--                Tokyo, or an agent not redeployed) = unknown, treated as ok.
-- `engine_checks` returns `setof check_results` with `c.*`, so the new columns reach the engine
-- without changing the function.
--
-- check_results is the big partitioned table: the constraints go in NOT VALID (no scan under the
-- ACCESS EXCLUSIVE lock) and are validated in the next migration — its own transaction, so the
-- scan takes only SHARE UPDATE EXCLUSIVE and probes keep inserting (db-reviewer, S05b).

set local lock_timeout = '5s';

alter table public.check_results
  add column waf text,
  add column control_ok boolean;

alter table public.check_results
  add constraint check_results_waf_vendor check (waf in ('akamai', 'cloudflare', 'sucuri')) not valid,
  -- A WAF signature only ever comes with a blocked result.
  add constraint check_results_waf_blocked check (waf is null or outcome = 'blocked') not valid,
  -- Only the Bangkok probe runs the control check.
  add constraint check_results_control_bkk check (control_ok is null or location = 'BKK') not valid;

comment on column public.check_results.waf is
  'D-027: header-level WAF signature of a blocked check (akamai / cloudflare / sucuri), null otherwise';
comment on column public.check_results.control_ok is
  'D-027: BKK only — false when both VPS control URLs failed in this batch; null = not reported';

-- D-028: the BKK probe's control check failing for 3 rounds in a row is an Admin alert — the VPS's
-- network is the Admin's to fix, not the site owner's.
alter table public.system_alerts drop constraint system_alerts_kind_check;
alter table public.system_alerts add constraint system_alerts_kind_check
  check (kind in ('verifier_unavailable', 'verifier_backlog', 'probe_locations_low', 'bkk_control_failing'));
