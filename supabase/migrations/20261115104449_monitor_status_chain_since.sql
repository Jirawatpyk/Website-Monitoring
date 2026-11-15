-- The Overview's TLS chain "Since" (spec §21.4, D-029) without walking the streak (follow-up to the
-- cold-load fix, 15 Nov 2026). `fillChainSince` walked back through a location's checks to the last
-- one that wasn't a chain error on every page load — ~1.7 k buffers per location for each 45 k-row
-- streak, growing as long as the warning lasts. The engine now carries when each location's streak
-- began (`nextChainSince`, packages/engine/src/triggers.ts), the same way it carries `blips` (D-050);
-- the Overview reads one row.
--
-- monitor_status is one row per monitor: the new column with a constant default is catalog-only.
set local lock_timeout = '5s';

alter table public.monitor_status
  add column chain_since jsonb not null default '{}' check (jsonb_typeof(chain_since) = 'object');

comment on column public.monitor_status.chain_since is
  'D-029, §21.4: per location (BKK / SIN / TYO), when its current run of TLS chain errors began (ISO); kept by the engine';

-- ── engine_write_monitors: + chainSince ──────────────────────────────────────
-- As in 20261031013914_d049_followups.sql, plus `chainSince` ({location: ISO}). A monitor entry
-- without the key keeps the stored value (as `blips`), so a runner deployed before this migration's
-- code never wipes it. Same signature: grants unchanged.
create or replace function public.engine_write_monitors(
  p_site_id uuid,
  p_round_at timestamptz,
  p_monitors jsonb,
  p_status public.site_state
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_monitors is not null then
    insert into public.monitor_status as ms
      (monitor_id, site_id, last_round_at, status, trigger, cause, slow_rounds, failing_since, blips, chain_since)
    select (d.m ->> 'monitorId')::uuid, p_site_id, p_round_at,
           (d.m ->> 'status')::public.site_state,
           nullif(d.m ->> 'trigger', '')::public.incident_trigger,
           left(nullif(d.m ->> 'cause', ''), 500),
           coalesce((d.m ->> 'slowRounds')::smallint, 0),
           coalesce(d.m -> 'failingSince', '{}'),
           case
             when jsonb_typeof(d.m -> 'blips') = 'array' then
               array(select b::timestamptz from jsonb_array_elements_text(d.m -> 'blips') as x(b) where b is not null order by 1)
             else coalesce(
               (select cur.blips from public.monitor_status cur where cur.monitor_id = (d.m ->> 'monitorId')::uuid),
               '{}')
           end,
           case
             when jsonb_typeof(d.m -> 'chainSince') = 'object' then d.m -> 'chainSince'
             else coalesce(
               (select cur.chain_since from public.monitor_status cur where cur.monitor_id = (d.m ->> 'monitorId')::uuid),
               '{}')
           end
    -- One row per monitor even if the list names one twice (the last wins).
    from (
      select distinct on (e ->> 'monitorId') e as m
      from jsonb_array_elements(p_monitors) with ordinality as x(e, n)
      order by e ->> 'monitorId', n desc
    ) d
    -- Only this site's monitors.
    join public.monitors mon on mon.id = (d.m ->> 'monitorId')::uuid and mon.site_id = p_site_id
    on conflict (monitor_id) do update
      set last_round_at = excluded.last_round_at, status = excluded.status,
          trigger = excluded.trigger, cause = excluded.cause,
          slow_rounds = excluded.slow_rounds, failing_since = excluded.failing_since,
          blips = excluded.blips, chain_since = excluded.chain_since
      -- Same round again (overlapping runs judge it from the same prior state): the same values, so
      -- `<=` rewrites them harmlessly and keeps the monitor in step with site_status's `<=` guard.
      where ms.last_round_at <= excluded.last_round_at;
  end if;

  if p_status is not null then
    update public.site_status
      set status = p_status, since = p_round_at
      where site_id = p_site_id and status is distinct from p_status
        and (last_round_at is null or last_round_at <= p_round_at);
  end if;
end;
$$;

-- ── Backfill: streaks already running ───────────────────────────────────────
-- Once, the old walk: for each monitor and location whose newest check (90 days kept) is a chain
-- error, the first check after the last one that wasn't. A handful of rows (Cando Asia on 15 Nov),
-- through check_results_monitor_location_cover_idx. ISO with milliseconds and Z, as the engine writes.
with latest as (
  select ms.monitor_id, l.code as location,
    (select cr.outcome = 'fail' and coalesce(cr.error, '') in
              ('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT')
     from public.check_results cr
     where cr.monitor_id = ms.monitor_id and cr.location = l.code
       and cr.checked_at > now() - interval '90 days'
     order by cr.checked_at desc, cr.attempt desc
     limit 1) as chained
  from public.monitor_status ms
  cross join public.probe_locations l
),
starts as (
  select lt.monitor_id, lt.location,
    (select min(cr.checked_at)
     from public.check_results cr
     where cr.monitor_id = lt.monitor_id and cr.location = lt.location
       and cr.checked_at > coalesce(
         (select max(g.checked_at) from public.check_results g
          where g.monitor_id = lt.monitor_id and g.location = lt.location
            and g.checked_at > now() - interval '90 days'
            and not (g.outcome = 'fail' and coalesce(g.error, '') in
                       ('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'))),
         now() - interval '90 days')) as started
  from latest lt
  where lt.chained
)
update public.monitor_status ms
  set chain_since = ms.chain_since || s.obj
  from (
    select monitor_id,
      jsonb_object_agg(location, to_char(started at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as obj
    from starts
    where started is not null
    group by monitor_id
  ) s
  where ms.monitor_id = s.monitor_id;
