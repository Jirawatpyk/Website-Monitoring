-- S17 PR 3a (D-069, spec §41): add / rename / remove a company holiday — Admins only, today (Bangkok)
-- to 31 Dec next year, one per day, a name of 1–100 characters, past days untouched; each change is one
-- audit row naming the Admin (the row trigger, inside a security definer function).
begin;
\ir _helpers.psql
select plan(25);

-- ── Who may call them (security review: a later `create or replace` mustn't widen them) ────────────
select ok(not has_function_privilege('anon', 'public.add_company_holiday(date,text,text)', 'execute'), 'anon can’t add');
select ok(not has_function_privilege('anon', 'public.rename_company_holiday(uuid,text)', 'execute'), 'anon can’t rename');
select ok(not has_function_privilege('anon', 'public.remove_company_holiday(uuid)', 'execute'), 'anon can’t remove');
select ok(not has_function_privilege('authenticated', 'private.holiday_window_check(date)', 'execute'),
          'the date helper is private');
select ok(not has_function_privilege('authenticated', 'private.holiday_name(text)', 'execute'),
          'the name helper is private');

update public.profiles set is_active = false where true;
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated;
insert into ids values
  ('tao', tests.create_user('tao-hol@pgtap.test', 'admin')),
  ('arm', tests.create_user('arm-hol@pgtap.test', 'responder'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
grant execute on function pg_temp.uid(text) to authenticated;

create temp table d (name text primary key, day date) on commit drop;
grant select on d to authenticated;
insert into d values
  ('today', (now() at time zone 'Asia/Bangkok')::date),
  ('yesterday', (now() at time zone 'Asia/Bangkok')::date - 1),
  ('free', (now() at time zone 'Asia/Bangkok')::date + 400),
  ('last', make_date(extract(year from (now() at time zone 'Asia/Bangkok'))::int + 1, 12, 31)),
  ('too_far', make_date(extract(year from (now() at time zone 'Asia/Bangkok'))::int + 2, 1, 1));
create function pg_temp.day(p text) returns date language sql as $$ select day from d where name = p $$;
grant execute on function pg_temp.day(text) to authenticated;
-- The chosen days start empty (a seeded holiday may fall on one).
delete from public.company_holidays where day in (select day from d);
insert into public.company_holidays (day, name) values (pg_temp.day('yesterday'), 'Past day');

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_hint;
  return coalesce(nullif(v, ''), sqlstate);
end;
$$;
grant execute on function pg_temp.hint_of(text) to authenticated;

-- ── Refused ──────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('arm'));
select is(pg_temp.hint_of($$select public.add_company_holiday(pg_temp.day('today'), 'Outing', 'company')$$),
          '42501', 'a Responder can’t add one');
select tests.authenticate_as(pg_temp.uid('tao'));
select is(pg_temp.hint_of($$select public.add_company_holiday(pg_temp.day('yesterday') - 1, 'Outing', 'company')$$),
          'holiday_past', 'a past day is refused');
select is(pg_temp.hint_of($$select public.add_company_holiday(pg_temp.day('too_far'), 'Outing', 'company')$$),
          'holiday_too_far', 'later than 31 Dec next year is refused');
select is(pg_temp.hint_of($$select public.add_company_holiday(pg_temp.day('today'), '   ', 'company')$$),
          'name_required', 'a name is required');
select is(pg_temp.hint_of(format($$select public.add_company_holiday(pg_temp.day('today'), %L, 'company')$$, repeat('x', 101))),
          'name_too_long', 'up to 100 characters');
select is(pg_temp.hint_of($$select public.add_company_holiday(pg_temp.day('today'), 'Outing', 'other')$$),
          'kind_invalid', 'public or company only');

-- ── Add ──────────────────────────────────────────────────────────────────
select lives_ok($$select public.add_company_holiday(pg_temp.day('today'), '  Company outing  ', 'company')$$,
                'today can be added');
select lives_ok($$select public.add_company_holiday(pg_temp.day('last'), 'New Year’s Eve', 'public')$$,
                '31 Dec next year can be added');
select is(pg_temp.hint_of($$select public.add_company_holiday(pg_temp.day('today'), 'Again', 'company')$$),
          'holiday_taken', 'one holiday per day');
reset role;
select is((select name || ' · ' || kind from public.company_holidays where day = pg_temp.day('today')),
          'Company outing · company', 'stored trimmed, with its kind');
select is((select count(*)::int from public.audit_log
           where action = 'holiday.create' and actor_id = pg_temp.uid('tao') and after ->> 'day' = pg_temp.day('today')::text),
          1, 'one holiday.create row naming the Admin');

-- ── Rename ───────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select lives_ok(format($$select public.rename_company_holiday(%L, 'Company outing — Hua Hin')$$,
                       (select id from public.company_holidays where day = pg_temp.day('today'))), 'rename');
select lives_ok(format($$select public.rename_company_holiday(%L, 'Company outing — Hua Hin')$$,
                       (select id from public.company_holidays where day = pg_temp.day('today'))), 'the same name again');
select is(pg_temp.hint_of(format($$select public.rename_company_holiday(%L, 'Renamed')$$,
                                 (select id from public.company_holidays where day = pg_temp.day('yesterday')))),
          'holiday_past', 'a past day can’t be renamed');
reset role;
select is((select count(*)::int from public.audit_log
           where action = 'holiday.update' and actor_id = pg_temp.uid('tao')
             and before ->> 'name' = 'Company outing' and after ->> 'name' = 'Company outing — Hua Hin'),
          1, 'one holiday.update row; the same name again writes none');

-- ── Remove ───────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('arm'));
select is(pg_temp.hint_of(format($$select public.remove_company_holiday(%L)$$,
                                 (select id from public.company_holidays where day = pg_temp.day('today')))),
          '42501', 'a Responder can’t remove one');
select tests.authenticate_as(pg_temp.uid('tao'));
select is(pg_temp.hint_of(format($$select public.remove_company_holiday(%L)$$,
                                 (select id from public.company_holidays where day = pg_temp.day('yesterday')))),
          'holiday_past', 'a past day can’t be removed');
select lives_ok(format($$select public.remove_company_holiday(%L)$$,
                       (select id from public.company_holidays where day = pg_temp.day('today'))), 'remove');
select is(pg_temp.hint_of(format($$select public.remove_company_holiday(%L)$$, gen_random_uuid())),
          'holiday_missing', 'a holiday that is gone says so');
reset role;
select is((select count(*)::int from public.audit_log
           where action = 'holiday.delete' and actor_id = pg_temp.uid('tao')
             and before ->> 'name' = 'Company outing — Hua Hin'),
          1, 'one holiday.delete row, with the name it had');

select * from finish();
rollback;
