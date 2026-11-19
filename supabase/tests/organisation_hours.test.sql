-- S17 PR 1 (D-069, spec §14.14): save_response_hours — an Admin, a required note, From < To on the
-- 30-min grid between 06:00 and 22:00, the board's day sets, one audit row only when the hours changed;
-- organisation_storage for Admins only.
begin;
\ir _helpers.psql
select plan(18);

update public.profiles set is_active = false where true;
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated;
insert into ids values
  ('tao', tests.create_user('tao@pgtap.test', 'admin')),
  ('arm', tests.create_user('arm@pgtap.test', 'responder'));
update public.organisation_settings
  set response_start = '09:00', response_end = '18:00', response_days = '{1,2,3,4,5}' where singleton;

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
select tests.authenticate_as((select id from ids where name = 'arm'));
select is(pg_temp.hint_of($$select public.save_response_hours('08:00', '17:00', '{1,2,3,4,5}', 'earlier')$$),
          '42501', 'a Responder cannot change the hours');
select is(pg_temp.hint_of($$select public.organisation_storage()$$), '42501', 'a Responder cannot read the storage');

select tests.authenticate_as((select id from ids where name = 'tao'));
select is(pg_temp.hint_of($$select public.save_response_hours('08:00', '17:00', '{1,2,3,4,5}', '  ')$$),
          'note_required', 'a note is required');
select is(pg_temp.hint_of(format('select public.save_response_hours(%L, %L, %L, %L)', '08:00', '17:00', '{1,2,3,4,5}',
                                 repeat('x', 501))),
          'note_too_long', 'a note over 500 characters is refused');
select is(pg_temp.hint_of($$select public.save_response_hours('18:00', '09:00', '{1,2,3,4,5}', 'n')$$),
          'hours_order', 'To must be after From');
select is(pg_temp.hint_of($$select public.save_response_hours('09:00', '09:00', '{1,2,3,4,5}', 'n')$$),
          'hours_order', 'From = To is refused');
select is(pg_temp.hint_of($$select public.save_response_hours('09:15', '18:00', '{1,2,3,4,5}', 'n')$$),
          'hours_grid', 'times stay on the half hour');
select is(pg_temp.hint_of($$select public.save_response_hours('05:30', '18:00', '{1,2,3,4,5}', 'n')$$),
          'hours_grid', 'no earlier than 06:00');
select is(pg_temp.hint_of($$select public.save_response_hours('09:00', '22:30', '{1,2,3,4,5}', 'n')$$),
          'hours_grid', 'no later than 22:00');
select is(pg_temp.hint_of($$select public.save_response_hours('09:00', '18:00', '{1,3,5}', 'n')$$),
          'days_invalid', 'only Mon–Fri, Mon–Sat or every day');
select is(pg_temp.hint_of($$select public.save_response_hours('09:00', '18:00', '{}', 'n')$$),
          'days_invalid', 'no days is refused');

-- ── Saved ────────────────────────────────────────────────────────────────
select lives_ok($$select public.save_response_hours('08:30', '17:30', '{6,1,2,3,4,5}', ' Office opens earlier ')$$,
                'an Admin saves new hours');
reset role;
select is((select array[to_char(response_start, 'HH24:MI'), to_char(response_end, 'HH24:MI')]
           from public.organisation_settings where singleton),
          array['08:30', '17:30'], 'the hours are stored');
select is((select response_days from public.organisation_settings where singleton), '{1,2,3,4,5,6}'::smallint[],
          'the days are stored in order');
select is((select count(*)::int from public.audit_log where action = 'organisation.response_hours'), 1,
          'one audit row');
select is((select jsonb_build_object('before', before, 'after', after) from public.audit_log
           where action = 'organisation.response_hours'),
          jsonb_build_object(
            'before', jsonb_build_object('start', '09:00', 'end', '18:00', 'days', '[1,2,3,4,5]'::jsonb),
            'after', jsonb_build_object('start', '08:30', 'end', '17:30', 'days', '[1,2,3,4,5,6]'::jsonb,
                                        'note', 'Office opens earlier')),
          'the row holds before, after and the trimmed note');

select tests.authenticate_as((select id from ids where name = 'tao'));
select public.save_response_hours('08:30', '17:30', '{1,2,3,4,5,6}', 'same again');
reset role;
select is((select count(*)::int from public.audit_log where action = 'organisation.response_hours'), 1,
          'saving the same hours writes no row');

select tests.authenticate_as((select id from ids where name = 'tao'));
select ok(public.organisation_storage() > 0, 'an Admin reads the database size');

select * from finish();
rollback;
