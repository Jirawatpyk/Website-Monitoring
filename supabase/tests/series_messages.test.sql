-- A series' own messages (S14 PR 2b, D-057, spec §32.10–11): SCHEDULED / REQUESTED → APPROVED, the
-- waiting series' reminders and NOT APPROVED, SKIPPED for an overlap (once, after the action's line),
-- CANCELLED / REQUEST WITHDRAWN with no line per window, who each reaches, no STARTED email for a
-- series' window, and claim_notifications holding series rows for a notifier that renders them.
begin;
\ir _helpers.psql
select plan(43);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao', tests.create_user('tao@pgtap.test', 'admin')),
  ('arm', tests.create_user('arm@pgtap.test', 'responder')),
  ('nok', tests.create_user('nok@pgtap.test', 'responder'));
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), (select id from ids where name = 'nok'), true);
create temp table s (name text primary key, id uuid) on commit drop;
grant select, insert on s to authenticated, service_role;

-- The rows a series has, by template and kind: '-' for a row to nobody in particular, else the person
-- (people outside this test — a used local stack's Admins — left out).
create function pg_temp.rows(p_series text, p_template text, p_kind text)
returns text[] language sql as $$
  select coalesce(array_agg(x.who order by x.who), '{}')
  from (
    select case when n.user_id is null then '-' else i.name end as who
    from public.notifications n
    left join ids i on i.id = n.user_id
    where n.maintenance_series_id = (select id from s where name = p_series)
      and n.template = p_template and n.context ->> 'kind' = p_kind
      and (n.user_id is null or i.name is not null)
  ) x
$$;

-- ── An Admin's series: SCHEDULED, owner + backup emailed ─────────────────
select tests.authenticate_as((select id from ids where name = 'tao'));
insert into s values ('daily', public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '01:00', 60, current_date + 2, null, 'Plugin updates'));
reset role;
select is(pg_temp.rows('daily', 'ms_line', 'scheduled'), array['-'], 'one SCHEDULED line in the series thread');
select is((select thread_key from public.notifications where template = 'ms_line'
           and maintenance_series_id = (select id from s where name = 'daily')),
  'ms-' || (select id from s where name = 'daily'), 'its own thread, ms-<series>');
select is(pg_temp.rows('daily', 'ms_email', 'scheduled'), array['arm', 'nok'], 'owner and backup get one email; Tao did it');
select is(pg_temp.rows('daily', 'ms_dm', 'scheduled'), '{}'::text[], 'nobody is @mentioned');
select ok((select first_starts_at = ((current_date + 2) + time '01:00') at time zone 'Asia/Bangkok'
           from public.maintenance_series where id = (select id from s where name = 'daily')),
  'first_starts_at is the first window by the rule');
select is((select count(*)::int from public.notifications n join public.maintenance_windows w on w.id = n.maintenance_window_id
           where w.series_id = (select id from s where name = 'daily')), 0, 'its windows say nothing yet');

-- ── A Responder's series: REQUESTED to the Admins ────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into s values ('req', public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"weekly","days":[2,4]}', '03:00', 60, current_date + 2, null, 'Cache purge'));
reset role;
select is(pg_temp.rows('req', 'ms_line', 'requested'), array['-'], 'a REQUESTED line');
select is(pg_temp.rows('req', 'ms_dm', 'requested'), array['tao'], 'a reply @mentioning every active Admin');
select is(pg_temp.rows('req', 'ms_email', 'requested'), array['tao'], 'and an email to them; the asker isn''t emailed');
select ok((select (context ->> 'request')::boolean from public.notifications
           where template = 'ms_line' and maintenance_series_id = (select id from s where name = 'req')),
  'the line knows it is a request');

-- ── Its reminders, 12 h and 1 h before the first window ──────────────────
set local role service_role;
select is(public.engine_window_reminders((select first_starts_at - interval '11 hours' from public.maintenance_series
                                          where id = (select id from s where name = 'req'))), 1, '12 h before: a reminder');
select is(pg_temp.rows('req', 'ms_dm', 'reminder_12h'), array['arm', 'tao'], 'to the Admins, and STILL WAITING to the asker');
select is((select context ->> 'dm' from public.notifications where template = 'ms_dm' and context ->> 'kind' = 'reminder_12h'
           and user_id = (select id from ids where name = 'arm')), 'still_waiting', 'the asker''s reply is STILL WAITING');
select is(pg_temp.rows('req', 'ms_email', 'reminder_12h'), array['tao'], 'the 12 h one emails the Admins');
select is(pg_temp.rows('req', 'ms_line', 'reminder_12h'), '{}'::text[], 'no line in the thread for a reminder');
select is(public.engine_window_reminders((select first_starts_at - interval '11 hours' from public.maintenance_series
                                          where id = (select id from s where name = 'req'))), 0, 'once');
select is(public.engine_window_reminders((select first_starts_at - interval '30 minutes' from public.maintenance_series
                                          where id = (select id from s where name = 'req'))), 1, '1 h before: the last one');
select is(pg_temp.rows('req', 'ms_dm', 'reminder_1h'), array['tao'], 'Admins only, Chat only');
select is(pg_temp.rows('req', 'ms_email', 'reminder_1h'), '{}'::text[], 'no email for the 1 h one');
reset role;

-- ── Approve: APPROVED to the asker, owner + backup emailed ───────────────
select tests.authenticate_as((select id from ids where name = 'tao'));
select lives_ok($$ select public.decide_maintenance_series((select id from s where name = 'req'), true, null) $$, 'Tao approves');
reset role;
select is(pg_temp.rows('req', 'ms_dm', 'approved'), array['arm'], 'APPROVED replies to the asker (ChatAlert)');
select is(pg_temp.rows('req', 'ms_email', 'approved'), array['arm', 'nok'], 'owner and backup get the approval email');
select is((select jsonb_array_length(context -> 'windows') from public.notifications
           where template = 'ms_line' and context ->> 'kind' = 'approved'),
  (select count(*)::int from public.maintenance_windows where series_id = (select id from s where name = 'req')),
  'the line lists the windows it scheduled');

-- ── An overlap: SKIPPED once per window, after the APPROVED line ─────────
select tests.authenticate_as((select id from ids where name = 'nok'));
insert into s values ('clash', public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '01:30', 30, current_date + 2, null, 'Backups'));
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.decide_maintenance_series((select id from s where name = 'clash'), true, null);
reset role;
select is((select count(*)::int from public.maintenance_windows where series_id = (select id from s where name = 'clash')),
  0, 'every window of the clashing series is skipped');
select is((select count(*)::int from public.notifications where template = 'ms_line' and context ->> 'kind' = 'skipped'
           and maintenance_series_id = (select id from s where name = 'clash')),
  (select count(*)::int from public.maintenance_series m, jsonb_array_elements(m.log) e
   where m.id = (select id from s where name = 'clash') and e ->> 'reason' = 'overlaps another window'),
  'one SKIPPED line per skipped window');
select ok((select bool_and(n.created_at > a.created_at and n.context -> 'overlap' ->> 'reason' = 'Plugin updates'
                           and n.context ->> 'next' is not null)
           from public.notifications n,
                (select created_at from public.notifications where template = 'ms_line' and context ->> 'kind' = 'approved'
                   and maintenance_series_id = (select id from s where name = 'clash')) a
           where n.template = 'ms_line' and n.context ->> 'kind' = 'skipped'
             and n.maintenance_series_id = (select id from s where name = 'clash')),
  'each after the APPROVED line, naming the window it overlaps and the next one');
select is(pg_temp.rows('clash', 'ms_email', 'skipped'), '{}'::text[], 'SKIPPED is Chat only');
select is(pg_temp.rows('clash', 'ms_dm', 'approved'), array['nok'], 'a non-owner asker gets the APPROVED reply');

set local role service_role;
create temp table before_top_up on commit drop as
  select count(*)::int as n from public.notifications where template = 'ms_line' and context ->> 'kind' = 'skipped';
select public.engine_expand_series(now() + interval '1 day');
select is((select count(*)::int from public.notifications where template = 'ms_line' and context ->> 'kind' = 'skipped'),
  (select n + 1 from before_top_up), 'the nightly top-up posts the new day''s skip');
select public.engine_expand_series(now() + interval '1 day');
select is((select count(*)::int from public.notifications where template = 'ms_line' and context ->> 'kind' = 'skipped'),
  (select n + 1 from before_top_up), 'and only once');
reset role;

-- ── A series' window: STARTED, but no STARTED email ──────────────────────
update public.maintenance_windows set starts_at = now() - interval '1 minute', ends_at = now() + interval '1 hour'
where id = (select id from public.maintenance_windows where series_id = (select id from s where name = 'req')
            order by starts_at limit 1);
set local role service_role;
select public.engine_log_windows(now());
reset role;
select is((select count(*)::int from public.notifications n join public.maintenance_windows w on w.id = n.maintenance_window_id
           where w.series_id = (select id from s where name = 'req') and n.template = 'mw_line' and n.context ->> 'kind' = 'started'),
  1, 'the window posts STARTED in its own thread');
select is((select count(*)::int from public.notifications n join public.maintenance_windows w on w.id = n.maintenance_window_id
           where w.series_id = (select id from s where name = 'req') and n.channel = 'email'),
  0, 'and emails nobody (§32.11)');

-- ── Cancel: one CANCELLED line, owner + backup emailed, nothing per window ──
select tests.authenticate_as((select id from ids where name = 'arm'));
select ok(public.cancel_maintenance_series((select id from s where name = 'daily'), 'Updates are automatic now') > 0,
  'the owner cancels the series');
reset role;
select is(pg_temp.rows('daily', 'ms_line', 'cancelled'), array['-'], 'one CANCELLED line');
select is(pg_temp.rows('daily', 'ms_email', 'cancelled'), array['nok'], 'the backup is emailed; Arm did it');
select is((select jsonb_array_length(context -> 'cancelled') from public.notifications
           where template = 'ms_line' and context ->> 'kind' = 'cancelled'),
  (select count(*)::int from public.maintenance_windows where series_id = (select id from s where name = 'daily')),
  'the line lists the windows it cancelled');

-- ── A waiting series withdrawn; another nobody approved in time ──────────
select tests.authenticate_as((select id from ids where name = 'nok'));
insert into s values ('late', public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"monthly","day":28}', '05:00', 60, current_date + 2, null, 'Log rotation'));
insert into s values ('took', public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"monthly","day":27}', '05:00', 60, current_date + 2, null, 'Host does it'));
select public.cancel_maintenance_series((select id from s where name = 'took'), 'Host does it now');
reset role;
select is(pg_temp.rows('took', 'ms_email', 'withdrawn'), array['tao'], 'REQUEST WITHDRAWN emails the Admins');

update public.maintenance_series set first_starts_at = now() - interval '1 minute'
where id = (select id from s where name = 'late');
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.decide_maintenance_series((select id from s where name = 'late'), true, null) $$,
  '22023', 'Nobody approved it before its first window — ask again', 'an approval after the first window is refused');
reset role;
set local role service_role;
select public.engine_window_reminders(now());
reset role;
select is((select outcome from public.maintenance_series where id = (select id from s where name = 'late')),
  'not_approved', 'the engine marks it Not approved');
select is(pg_temp.rows('late', 'ms_dm', 'not_approved'), array['nok'], 'NOT APPROVED to the asker');
select is(pg_temp.rows('late', 'ms_email', 'not_approved'), array['tao'], 'and emailed to the Admins');

-- ── A notifier that can't render series rows never claims them ───────────
set local role service_role;
select is((select count(*)::int from public.claim_notifications('google_chat', 200, null, true, true)
           where maintenance_series_id is not null), 0, 'without p_series, no series row is claimed');
select ok((select count(*)::int from public.claim_notifications('google_chat', 200, null, true, true, true)
           where maintenance_series_id is not null) > 0, 'with it, they are');
reset role;

select * from finish();
rollback;
