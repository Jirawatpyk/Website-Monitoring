-- Cold-load fix (db-reviewer): `error` is now in covering indexes, and Postgres refuses an index row over
-- ~2.7 kB — one long network message would fail the whole round's insert. The probes store at most 500
-- characters (`insertCheckResults` caps every location; Bangkok's ingest schema too); the database holds
-- that for new rows. NOT VALID: every row already stored fitted the index builds above, which is the
-- limit that matters; the cap itself is only for rows from now on.
set local lock_timeout = '5s';

alter table public.check_results
  add constraint check_results_error_length check (char_length(error) <= 500) not valid;
