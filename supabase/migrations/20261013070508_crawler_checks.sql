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
  -- a 2xx / 3xx answer that passed and was read to its end (or with a hit), or a redirect off the
  -- site: anything else (a WAF 403, a challenge, a timeout) is no data, never a PROBLEM (D-041, D-042)
  usable boolean not null,
  status_code smallint check (status_code between 100 and 599),
  response_ms integer check (response_ms >= 0),
  final_url text check (char_length(final_url) <= 2048),
  -- the site's own must_not_contain words and the shared list's entries found anywhere in the body
  forbidden text[] check (cardinality(forbidden) <= 20),
  -- the body was read to its end or to the 3 MB cap, not broken off
  scan_complete boolean,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a usable fetch had an answer
  constraint crawler_checks_usable_answered check (not usable or status_code is not null)
);

-- retention and the engine's read (a time range across every monitor)
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

-- The engine's read: per primary monitor of an active site, the two newest usable fetches of each view
-- since `p_since` (D-042). A row that isn't usable never hides an older usable one, so a WAF 403 after a
-- hit keeps the PROBLEM; two per view, so a round judged after a newer fetch landed still sees the one
-- before it. One row per monitor (`facts`: a jsonb array), under PostgREST's 1,000-row cap.
create function public.engine_crawler_checks(p_since timestamptz)
returns table (monitor_id uuid, facts jsonb)
language sql
stable
set search_path = ''
as $$
  select r.monitor_id,
    jsonb_agg(
      jsonb_build_object(
        'view', r.view,
        'checked_at', r.checked_at,
        'final_url', r.final_url,
        'forbidden', coalesce(r.forbidden, '{}')
      )
      order by r.view, r.checked_at desc
    )
  from (
    select c.monitor_id, c.view, c.checked_at, c.final_url, c.forbidden,
      row_number() over (partition by c.monitor_id, c.view order by c.checked_at desc) as rn
    from public.crawler_checks c
    join public.monitors m on m.id = c.monitor_id and m.is_primary and m.enabled and m.removed_at is null
    join public.sites s on s.id = m.site_id and s.is_active
    where c.usable and c.checked_at >= p_since
  ) r
  where r.rn <= 2
  group by r.monitor_id;
$$;

revoke execute on function public.engine_crawler_checks(timestamptz) from public, anon, authenticated;
grant execute on function public.engine_crawler_checks(timestamptz) to service_role;

select cron.schedule(
  'crawler-checks-retention',
  '40 17 * * *', -- 00:40 Bangkok
  $$delete from public.crawler_checks where checked_at < now() - interval '30 days'$$
);
