-- DxT Monitor · staging test monitor (S02a). STAGING ONLY — never run on production.
-- TEMPLATE: replace the placeholders, then run it in the staging project's SQL editor after
-- `pnpm db:push:staging`. It adds one client, one Tier 1 site and its primary monitor pointing at
-- the test target (apps/test-target, Vercel project dxt-test-target). Flip the target's Edge Config
-- item `mode` (ok / error / timeout / challenge… / keyword-missing / slow) to trigger DOWN, RECOVERED,
-- blocked rounds and the S04a PROBLEMs in the staging Chat space. The monitor looks for the page's
-- title "Test target" (must_contain), so `keyword-missing` gives PROBLEM · Keyword.
-- Safe to run again: it updates the existing rows.

with client as (
  insert into public.clients (name)
  values ('DxT test')
  on conflict (name) do update set name = excluded.name
  returning id
), site as (
  insert into public.sites (client_id, name, tier, primary_owner_id)
  select client.id, 'Test target', 1,
         (select id from public.profiles where email = lower('<owner-email>'))  -- the owner who gets the mention
  from client
  on conflict (name) do update set primary_owner_id = excluded.primary_owner_id, is_active = true
  returning id
)
insert into public.monitors (site_id, type, is_primary, url, must_contain)
select site.id, 'http', true, '<https://test-target-url>/', '{Test target}'
from site
on conflict (site_id) where is_primary do update set url = excluded.url, must_contain = excluded.must_contain;

-- Check: the site, its monitor and (after the first engine run) its status.
select s.name, s.tier, m.url, m.must_contain, st.status, st.last_round_at
from public.sites s
join public.monitors m on m.site_id = s.id and m.is_primary
left join public.site_status st on st.site_id = s.id
where s.name = 'Test target';
