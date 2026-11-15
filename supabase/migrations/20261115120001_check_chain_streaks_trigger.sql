-- The trigger that keeps check_chain_streaks (20261115120000) on every check_results insert. Its own
-- file: creating a trigger on the partitioned table takes a lock that waits for (and holds back) the
-- probes' inserts, so this transaction does nothing else and commits at once. Partitions made later by
-- the partition job get it too (a trigger on a partitioned table is cloned to each partition).
set local lock_timeout = '5s';

create trigger check_results_chain_streak
  after insert on public.check_results
  for each row execute function private.track_chain_streak();
