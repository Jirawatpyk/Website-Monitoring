-- The Overview's TLS chain "Since" (spec §21.4, D-029) without walking the streak (follow-up to the
-- cold-load fix, 15 Nov 2026). `fillChainSince` walked back through a location's checks to the last one
-- that wasn't a chain error on every page load — ~1.7 k buffers per location for each 45 k-row streak,
-- growing as long as the warning lasts.
--
-- Kept where the checks are written (engine-reviewer): a row per monitor and location while its newest
-- checks are chain errors, `since` = the first of them. Every writer of check_results (SIN / TYO probes,
-- the BKK ingest, scripts) goes through the trigger in 20261115120001, so no check is missed — the
-- engine judges rounds, and a round it skips or a check it drops would have left the start wrong.
--
-- One row per (monitor, location), written only by that location's inserts: no row shared with the
-- engine's monitor_status writes, so no lock order to cross. A natural key, no id / updated_at (like
-- engine_sweep_minutes): it is derived state, rebuilt from check_results at will.
set local lock_timeout = '5s';

create table public.check_chain_streaks (
  monitor_id uuid not null references public.monitors (id) on delete cascade,
  location text not null references public.probe_locations (code) on delete cascade,
  -- The first check of the current run of TLS chain errors at this location.
  since timestamptz not null,
  primary key (monitor_id, location)
);

comment on table public.check_chain_streaks is
  'D-029, §21.4: per monitor and location, when its current run of TLS chain errors began (kept by a trigger on check_results)';

alter table public.check_chain_streaks enable row level security;
create policy check_chain_streaks_select_staff on public.check_chain_streaks
  for select to authenticated using ((select public.is_staff()));
revoke all on public.check_chain_streaks from public, anon, authenticated;
grant select on public.check_chain_streaks to authenticated;
grant select on public.check_chain_streaks to service_role;

-- The walk's own answer, kept up per inserted check (by `checked_at`, never arrival order): with L the
-- newest check that isn't a chain error, the streak is the chain checks after L, and `since` is the
-- first of them; no chain check after L, no row. So, for a check at T:
--   · a chain error: unless a non-chain check at or after T exists, the streak runs through T, so
--     `since` = the earlier of the kept one and T;
--   · anything else, behind a kept start (since <= T): L moves to the newest non-chain check (T or a
--     newer one that arrived first) and the start to the first chain check after it — or no row.
-- Both look only at checks newer than T: normally none (T is the newest), read from
-- check_results_monitor_location_cover_idx alone. Out-of-order arrivals (a late BKK batch, a recheck
-- before its check) land on the same answer as the walk; the equivalence test checks it.
-- One (monitor, location) at a time (engine-reviewer): an advisory lock per pair, so a second insert
-- for the same pair in another transaction (a late BKK batch overlapping a live one) waits and then reads
-- the first one's rows — under READ COMMITTED each statement after the lock takes a fresh snapshot.
-- Best effort: the probes' insert must never fail for this bookkeeping (a lost round is worse than a
-- wrong "Since"), so any error — a deadlock between two multi-row batches included — is caught and
-- logged as a warning; the hourly reconcile (20261115120002) puts any row left wrong back. Only inserts
-- are tracked: nothing updates or deletes check_results rows except retention, which drops whole months.
create function private.track_chain_streak()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chain constant text[] :=
    array['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'];
  v_last_good timestamptz;
  v_since timestamptz;
begin
  begin
    perform pg_advisory_xact_lock(hashtextextended('chain_streak:' || new.monitor_id::text || ':' || new.location, 0));
    if new.outcome = 'fail' and coalesce(new.error, '') = any (v_chain) then
      if not exists (
        select 1 from public.check_results cr
        where cr.monitor_id = new.monitor_id and cr.location = new.location and cr.checked_at >= new.checked_at
          and not (cr.outcome = 'fail' and coalesce(cr.error, '') = any (v_chain))
      ) then
        insert into public.check_chain_streaks as s (monitor_id, location, since)
        values (new.monitor_id, new.location, new.checked_at)
        on conflict (monitor_id, location) do update set since = least(s.since, excluded.since);
      end if;
    elsif exists (
      select 1 from public.check_chain_streaks s
      where s.monitor_id = new.monitor_id and s.location = new.location and s.since <= new.checked_at
    ) then
      select max(cr.checked_at) into v_last_good
      from public.check_results cr
      where cr.monitor_id = new.monitor_id and cr.location = new.location and cr.checked_at >= new.checked_at
        and not (cr.outcome = 'fail' and coalesce(cr.error, '') = any (v_chain));
      select min(cr.checked_at) into v_since
      from public.check_results cr
      where cr.monitor_id = new.monitor_id and cr.location = new.location and cr.checked_at > v_last_good
        and cr.outcome = 'fail' and coalesce(cr.error, '') = any (v_chain);
      if v_since is null then
        delete from public.check_chain_streaks
        where monitor_id = new.monitor_id and location = new.location;
      else
        update public.check_chain_streaks set since = v_since
        where monitor_id = new.monitor_id and location = new.location;
      end if;
    end if;
  exception when others then
    raise warning 'track_chain_streak: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke execute on function private.track_chain_streak() from public, anon, authenticated;
