-- DxT Monitor · generated check data for load tests (S06, D-031). LOCAL OR STAGING ONLY — never production.
--
-- Writes passing-with-noise checks for every live site's primary monitor from 3 locations at the
-- site's tier interval (1 / 3 / 5 min), creates the monthly partitions it needs, then rolls them up.
-- Every generated row carries `resolved_ip = 192.0.2.1` (TEST-NET-1, never a real answer), so
-- `delete-generated-checks.sql` removes exactly those rows.
--
-- Settings (session, before running):
--   set dxt.generate = 'local';    -- or 'staging'; anything else refuses
--   set dxt.raw_days = '90';       -- days of raw checks (staging: 2 — its free tier holds no more)
--   set dxt.rollup_days = '90';    -- days of rollups; days beyond raw_days get synthetic day / hour rows
--
-- Local: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/dev/generate-checks.sql
-- Staging: the staging SQL editor, with the settings above set to 'staging', 2, 90.

do $$
declare
  v_mode text := current_setting('dxt.generate', true);
  v_raw int := coalesce(nullif(current_setting('dxt.raw_days', true), ''), '90')::int;
  v_roll int := coalesce(nullif(current_setting('dxt.rollup_days', true), ''), '90')::int;
  v_from timestamptz;
  v_month date;
  v_name text;
begin
  if v_mode is null or v_mode not in ('local', 'staging') then
    raise exception 'Refusing: set dxt.generate to local or staging first';
  end if;
  -- Refuse any database that watches a real site: every live site's primary monitor must point at
  -- the local seed (*.example.test) or the staging test target. Production fails this whatever the
  -- session says, so a script pasted into the wrong SQL editor stops here (security review H1).
  if not exists (select 1 from public.sites where is_active) or exists (
    select 1 from public.monitors m join public.sites s on s.id = m.site_id and s.is_active
    where m.is_primary
      and m.url !~* '^https?://([a-z0-9-]+\.)*example\.test(:[0-9]+)?(/|\?|$)'
      and m.url !~* '^https?://dxt-test-target\.vercel\.app(/|\?|$)'
  ) then
    raise exception 'Refusing: this database watches real sites (or none) — local seed or staging only';
  end if;

  v_from := date_trunc('hour', now()) - make_interval(days => v_raw);

  -- partitions for every month the raw range touches
  v_month := date_trunc('month', v_from at time zone 'UTC')::date;
  while v_month <= (now() at time zone 'UTC')::date loop
    v_name := 'check_results_' || to_char(v_month, 'YYYY_MM');
    if to_regclass('private.' || v_name) is null then
      execute format(
        'create table private.%I partition of public.check_results for values from (%L) to (%L)',
        v_name, v_month::timestamp at time zone 'UTC', (v_month + interval '1 month')::timestamp at time zone 'UTC');
      execute format('revoke all on private.%I from public, anon, authenticated', v_name);
    end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;

  -- raw checks: a site's base latency per location, ±40 % noise, 0.2 % failures, 0.5 % blocked
  insert into public.check_results (monitor_id, location, checked_at, attempt, outcome, status_code, response_ms, ttfb_ms, resolved_ip, error)
  select m.id, l.code, t.at, 1,
    case when r.x < 0.002 then 'fail' when r.x < 0.007 then 'blocked' else 'pass' end::public.check_outcome,
    case when r.x < 0.002 then 503 when r.x < 0.007 then 403 else 200 end,
    greatest(40, round(b.base * (0.6 + 0.8 * r.y)))::int,
    greatest(20, round(b.base * 0.45 * (0.6 + 0.8 * r.y)))::int,
    '192.0.2.1'::inet,
    null
  from public.monitors m
  join public.sites s on s.id = m.site_id and s.is_active
  cross join public.probe_locations l
  cross join lateral (select (200 + (abs(hashtext(m.id::text || l.code)) % 900))::numeric as base) b
  cross join lateral generate_series(
    -- stops 15 min short of now: the engine judges recent rounds from raw checks, and a generated
    -- pass in the round in progress would mix into a live site's verdict (staging Test target)
    v_from, now() - interval '15 minutes',
    make_interval(mins => case s.tier when 1 then 1 when 2 then 3 else 5 end)
  ) as t(at)
  cross join lateral (select random() as x, random() as y) r
  where m.is_primary;

  perform private.rollup_check_results('hour', v_from, now());
  perform private.rollup_check_results('day', v_from, now());

  -- older than the raw range: synthetic rollup rows so 30 / 90 d charts have data (staging)
  if v_roll > v_raw then
    insert into public.check_rollups (monitor_id, location, bucket, bucket_start, checks, hard_fails, blocked, p50_ms, p95_ms)
    select m.id, l.code, 'day', d.day, n.checks, 0, 0,
      round(b.base * (0.9 + 0.2 * random()))::int, round(b.base * (1.5 + 0.3 * random()))::int
    from public.monitors m
    join public.sites s on s.id = m.site_id and s.is_active
    cross join (select code from public.probe_locations union all select null) l
    cross join lateral (select (200 + (abs(hashtext(m.id::text || coalesce(l.code, 'BKK'))) % 900))::numeric as base) b
    cross join lateral (select (1440 / case s.tier when 1 then 1 when 2 then 3 else 5 end)
      * case when l.code is null then 3 else 1 end as checks) n
    cross join lateral generate_series(
      date_trunc('day', (now() - make_interval(days => v_roll)) at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok',
      private.rollup_bucket_start('day', v_from) - interval '1 day',
      interval '1 day'
    ) as d(day)
    where m.is_primary
    on conflict on constraint check_rollups_key do nothing;
  end if;
end;
$$;

select count(*) as raw_checks from public.check_results;
select bucket, count(*) as rollup_rows from public.check_rollups group by bucket;
