-- D-049 follow-ups (D-050, D-051).
--
--   check_results.confirm — D-051: true on a Tier 2–3 confirm check (and its recheck), the extra check
--                           every location runs about a minute after a round whose scheduled checks
--                           timed out. The engine judges it with that round, never as a round of its
--                           own. null = an ordinary scheduled check or recheck (every row before this).
--                           `engine_checks` returns `setof check_results` with `c.*`, so the column
--                           reaches the engine without changing the function.
--   monitor_status.blips  — D-050: when the monitor's recent timeout blips happened (D-049 first
--                           timeout rounds that no second round confirmed), kept by the engine for
--                           30 min; the 3rd in that window is a PROBLEM · Intermittent.
--
-- check_results is the big partitioned table: the new column is nullable without a default
-- (catalog-only) and has no constraint to validate.

set local lock_timeout = '5s';

alter table public.check_results add column confirm boolean;

comment on column public.check_results.confirm is
  'D-051: true on a Tier 2–3 confirm check (and its recheck) after a timeout round; null otherwise';

alter table public.monitor_status
  add column blips timestamptz[] not null default '{}' check (cardinality(blips) <= 20);

comment on column public.monitor_status.blips is
  'D-050: round times of the monitor''s timeout blips in the last 30 min (the engine prunes it)';

-- ── engine_write_monitors: + blips ────────────────────────────────────────
-- As before (S04a), plus `blips` ([ISO times]). A monitor entry without the key keeps the stored
-- value, so a runner deployed before this migration's code never wipes it (and a new monitor gets
-- none). Inline SQL: functions the service role calls can't reach `private` (supabase/CLAUDE.md).
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
      (monitor_id, site_id, last_round_at, status, trigger, cause, slow_rounds, failing_since, blips)
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
          blips = excluded.blips
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
