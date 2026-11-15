-- check_chain_streaks from the rows themselves: once now, for the streaks already running, and then hourly
-- as a backstop (engine-reviewer, db-reviewer). The trigger keeps the table right on its own; this puts a
-- row back if something left it wrong — an error the trigger caught (a deadlock between two batches), a
-- backfill that raced an insert. Per monitor and location, under the trigger's own advisory lock, the walk:
-- the first chain check after the newest check that isn't one, or no row. Its own file, apart from the
-- trigger's lock.
set local lock_timeout = '5s';

create function private.reconcile_chain_streaks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chain constant text[] :=
    array['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'];
  v_pair record;
  v_newest_chained boolean;
  v_last_good timestamptz;
  v_since timestamptz;
  v_changed integer := 0;
  v_n integer;
begin
  for v_pair in
    select m.id as monitor_id, l.code as location
    from public.monitors m cross join public.probe_locations l
    order by 1, 2
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('chain_streak:' || v_pair.monitor_id::text || ':' || v_pair.location, 0));
    -- Only a pair whose newest check is a chain error can have a streak (one index probe each).
    select cr.outcome = 'fail' and coalesce(cr.error, '') = any (v_chain) into v_newest_chained
    from public.check_results cr
    where cr.monitor_id = v_pair.monitor_id and cr.location = v_pair.location
    order by cr.checked_at desc, cr.attempt desc
    limit 1;
    v_since := null;
    if coalesce(v_newest_chained, false) then
      select max(cr.checked_at) into v_last_good
      from public.check_results cr
      where cr.monitor_id = v_pair.monitor_id and cr.location = v_pair.location
        and not (cr.outcome = 'fail' and coalesce(cr.error, '') = any (v_chain));
      select min(cr.checked_at) into v_since
      from public.check_results cr
      where cr.monitor_id = v_pair.monitor_id and cr.location = v_pair.location
        and cr.checked_at > coalesce(v_last_good, '-infinity')
        and cr.outcome = 'fail' and coalesce(cr.error, '') = any (v_chain);
    end if;
    if v_since is null then
      delete from public.check_chain_streaks
      where monitor_id = v_pair.monitor_id and location = v_pair.location;
    else
      insert into public.check_chain_streaks as s (monitor_id, location, since)
      values (v_pair.monitor_id, v_pair.location, v_since)
      on conflict (monitor_id, location) do update set since = excluded.since
        where s.since is distinct from excluded.since;
    end if;
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
  end loop;
  return v_changed;
end;
$$;
revoke execute on function private.reconcile_chain_streaks() from public, anon, authenticated;

-- The backfill: the streaks running now (Cando Asia on 15 Nov).
select private.reconcile_chain_streaks();

-- The backstop, hourly at :17 (clear of the :00 / :30 crawler and the top-of-hour jobs). A pair whose
-- newest check isn't a chain error costs one index probe; 62 monitors × 3 locations today.
select cron.schedule(
  'check-chain-streaks-reconcile',
  '17 * * * *',
  $$select private.reconcile_chain_streaks()$$
);
