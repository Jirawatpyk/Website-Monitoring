-- pg_safeupdate (S10 B2c): Supabase preloads it for PostgREST's `authenticator` role, so a DELETE or
-- UPDATE with no WHERE inside any function the app or the service role calls is refused through the
-- API ("DELETE requires a WHERE clause") — but pgTAP runs as postgres and never loads it (supautils
-- won't let it). This scans every function body instead: write `where true` when a whole table is meant.
begin;
\ir _helpers.psql
select plan(1);

select is(
  array(
    select distinct n.nspname || '.' || p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
    regexp_split_to_table(p.prosrc, ';') as stmt
    where n.nspname in ('public', 'private')
      and stmt ~* '(^|\s)(delete\s+from|update\s+[a-z_."]+(\s+(as\s+)?[a-z_]+)?\s+set)\s'
      and stmt !~* '\mwhere\M'
    order by 1
  ),
  array[]::text[],
  'no function deletes or updates a whole table without a WHERE (pg_safeupdate refuses it through the API)'
);

select * from finish();
rollback;
