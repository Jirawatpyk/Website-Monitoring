-- S05b (D-027): sites behind a WAF are judged on the locations it doesn't block.
--
-- Two facts per check the engine needs:
--   waf        — the header-level WAF signature of a blocked check (akamai / cloudflare / sucuri), or
--                null. Only these let a location abstain on a site flagged `behind_waf`.
--   control_ok — for a Bangkok check: whether the VPS's control check (two public URLs from different
--                providers) answered in that batch. false = both failed, so the VPS's own network is
--                suspect and its result can't decide a WAF site. null = not reported (Singapore /
--                Tokyo, or an agent not redeployed) = unknown, treated as ok.
-- `engine_checks` returns `setof check_results` with `c.*`, so the new columns reach the engine
-- without changing the function.

alter table public.check_results
  add column waf text check (waf in ('akamai', 'cloudflare', 'sucuri')),
  add column control_ok boolean;

-- A WAF signature only ever comes with a blocked result.
alter table public.check_results
  add constraint check_results_waf_blocked check (waf is null or outcome = 'blocked');

comment on column public.check_results.waf is
  'D-027: header-level WAF signature of a blocked check (akamai / cloudflare / sucuri), null otherwise';
comment on column public.check_results.control_ok is
  'D-027: BKK only — false when both VPS control URLs failed in this batch; null = not reported';
