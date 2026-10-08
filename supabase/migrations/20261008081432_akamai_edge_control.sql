-- S05b (D-027 rule 2b, Tao 8 Oct 2026): the VPS also checks a public site served by Akamai. On a
-- site behind Akamai, a Bangkok failure while that Akamai control also failed says the route from
-- the VPS to Akamai is broken, not the client's origin: no vote (PROBLEM, unverified). The Akamai
-- control passing while the site fails is the origin → DOWN as usual.
--   akamai_ok — BKK only: whether the Akamai control answered in that batch; null = not reported.
-- Same pattern as 20261008065647: nullable column (catalog-only), constraint NOT VALID then
-- VALIDATE so probes keep inserting.

set lock_timeout = '5s';

alter table public.check_results add column akamai_ok boolean;

alter table public.check_results
  add constraint check_results_akamai_bkk check (akamai_ok is null or location = 'BKK') not valid;
alter table public.check_results validate constraint check_results_akamai_bkk;

comment on column public.check_results.akamai_ok is
  'D-027: BKK only — false when the VPS''s Akamai control failed in this batch; null = not reported';
