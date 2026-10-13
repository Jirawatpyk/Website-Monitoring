-- S09c (D-041, D-042): crawler_checks — every 30 min the sin1 crawler fetches each live site's home
-- page as Googlebot and as a mobile browser arriving from Google search, reads the whole body (up to
-- 3 MB) and stores one row per view. Not a location and not part of a round: the engine reads each
-- monitor's latest usable row beside its round. ~2 rows × live sites × 48 a day, kept 30 days, so no
-- partitions.

create table public.crawler_checks (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors (id) on delete cascade,
  -- mirrors CRAWLER_VIEWS (@dxt/shared); S09d adds 'plain'
  view text not null check (view in ('googlebot', 'google_referer')),
  checked_at timestamptz not null,
  outcome public.check_outcome not null,
  -- a 2xx / 3xx answer that passed: anything else (a WAF 403, a challenge, a timeout) is no data,
  -- never a PROBLEM (D-041)
  usable boolean not null,
  status_code smallint check (status_code between 100 and 599),
  response_ms integer check (response_ms >= 0),
  final_url text check (char_length(final_url) <= 2048),
  -- the site's own must_not_contain words and the shared list's entries found anywhere in the body
  forbidden text[] check (cardinality(forbidden) <= 20),
  -- the whole body was read (not cut at 3 MB or broken off)
  scan_complete boolean,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- the engine's read: the latest usable row per monitor and view
create index crawler_checks_latest_idx on public.crawler_checks (monitor_id, view, checked_at desc)
  where usable;
-- retention
create index crawler_checks_checked_at_idx on public.crawler_checks (checked_at);

create trigger crawler_checks_set_updated_at before update on public.crawler_checks
  for each row execute function private.set_updated_at();

alter table public.crawler_checks enable row level security;

-- Like check_results: people read (staff), only the crawler writes.
create policy crawler_checks_select_staff on public.crawler_checks
  for select to authenticated
  using ((select public.is_staff()));

revoke all on public.crawler_checks from public, anon, authenticated;
grant select on public.crawler_checks to authenticated;
grant all on public.crawler_checks to service_role;

-- The engine's read: per primary monitor of an active site, the newest usable row of each view since
-- `p_since` (the freshness window, D-042). A row that isn't usable never hides an older usable one, so a
-- WAF 403 after a hit keeps the PROBLEM. At most one row per monitor and view.
create function public.engine_crawler_checks(p_since timestamptz)
returns setof public.crawler_checks
language sql
stable
set search_path = ''
as $$
  select distinct on (c.monitor_id, c.view) c.*
  from public.crawler_checks c
  join public.monitors m on m.id = c.monitor_id and m.is_primary and m.enabled and m.removed_at is null
  join public.sites s on s.id = m.site_id and s.is_active
  where c.usable and c.checked_at >= p_since
  order by c.monitor_id, c.view, c.checked_at desc;
$$;

revoke execute on function public.engine_crawler_checks(timestamptz) from public, anon, authenticated;
grant execute on function public.engine_crawler_checks(timestamptz) to service_role;

select cron.schedule(
  'crawler-checks-retention',
  '40 17 * * *', -- 00:40 Bangkok
  $$delete from public.crawler_checks where checked_at < now() - interval '30 days'$$
);
