-- The 10 s Undo of a series action (S14 PR 2c-1, D-057 amended 10 Nov): approve, decline, cancel and
-- withdraw are held under their Undo key; only the actor undoes, inside 10 s, before anything is taken;
-- an approval's windows and skips go, a cancel's windows come back (not over a window made meanwhile);
-- approve → Undo → approve posts SKIPPED once; post-now ends the 10 s; the engine waits out an Undo.
begin;
\ir _helpers.psql
select plan(39);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao', tests.create_user('tao@pgtap.test', 'admin')),
  ('arm', tests.create_user('arm@pgtap.test', 'responder')),
  ('nok', tests.create_user('nok@pgtap.test', 'responder'));
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 2,
   (select id from ids where name = 'arm'), (select id from ids where name = 'nok'), true);
create temp table s (name text primary key, id uuid) on commit drop;
grant select, insert on s to authenticated, service_role;
-- A one-off window that day+3 of a daily 05:00 series overlaps.
insert into public.maintenance_windows (site_id, kind, starts_at, ends_at, reason, approved_at)
values ('00000000-0000-0000-0000-0000000000a1', 'maintenance',
        ((current_date + 3) + time '04:30') at time zone 'Asia/Bangkok',
        ((current_date + 3) + time '06:00') at time zone 'Asia/Bangkok', 'Data-centre move', now());

create function pg_temp.held(p_series text, p_kind text)
returns table (n int, held int, keyed int, undone int) language sql as $$
  select count(*)::int,
         count(*) filter (where n.hold_until > now())::int,
         count(*) filter (where n.dedupe_key = m.undo_key or n.dedupe_key like m.undo_key || ':%')::int,
         count(*) filter (where n.status = 'cancelled' and n.error = 'Undone')::int
  from public.notifications n join public.maintenance_series m on m.id = n.maintenance_series_id
  where m.id = (select id from s where name = p_series) and n.context ->> 'kind' = p_kind
$$;
create function pg_temp.live_skips(p_series text) returns int language sql as $$
  select count(*)::int from public.notifications n
  where n.maintenance_series_id = (select id from s where name = p_series) and n.template = 'ms_line'
    and n.context ->> 'kind' = 'skipped' and n.status <> 'cancelled'
$$;

-- ── Approve: held, and every row under the Undo key ──────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
insert into s values ('daily', public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '05:00', 30, current_date + 2, null, 'Backups'));
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.decide_maintenance_series((select id from s where name = 'daily'), true, null);
reset role;
select ok((select n > 0 and held = n and keyed = n from pg_temp.held('daily', 'approved')),
  'the APPROVED line, reply and emails are held 10 s under the Undo key');
select ok((select n > 0 and held = n and keyed = n from pg_temp.held('daily', 'skipped')),
  'so are the SKIPPED lines the approval posts');
select ok((select undo_action = 'approved' and undo_by = (select id from ids where name = 'tao')
           and undo_until = now() + interval '10 seconds'
           from public.maintenance_series where id = (select id from s where name = 'daily')),
  'the series records who may undo it, and until when');
select ok((select count(*) > 0 from public.maintenance_windows where series_id = (select id from s where name = 'daily')),
  'its windows exist');

-- ── Only the actor undoes ─────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok($$ select public.undo_series_action((select id from s where name = 'daily')) $$,
  '42501', 'Only the person who did it can undo it', 'nobody else can undo it');
select throws_ok($$ select public.post_series_action_now((select id from s where name = 'daily')) $$,
  '42501', null, 'nor post it now');
reset role;

-- ── Undo the approval ─────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'tao'));
select lives_ok($$ select public.undo_series_action((select id from s where name = 'daily')) $$, 'Tao undoes it');
reset role;
select ok((select approved_at is null and approved_by is null and undo_key is null
           from public.maintenance_series where id = (select id from s where name = 'daily')),
  'the series is waiting again');
select is((select count(*)::int from public.maintenance_windows where series_id = (select id from s where name = 'daily')),
  0, 'the windows it made are gone');
select ok((select n = undone from pg_temp.held('daily', 'approved')) and (select n = undone from pg_temp.held('daily', 'skipped')),
  'every held row is cancelled as Undone');
select ok(not exists (select 1 from public.maintenance_series m, jsonb_array_elements(m.log) e
                      where m.id = (select id from s where name = 'daily') and e ->> 'action' = 'skipped'),
  'its skips are out of the log');
select ok((select log -> -1 ->> 'action' = 'undone' and log -> -1 ->> 'undid' = 'approved'
           from public.maintenance_series where id = (select id from s where name = 'daily')),
  'and the log gains an undone line');
select is((select count(*)::int from public.audit_log
           where entity_id = (select id from s where name = 'daily') and action = 'maintenance.series_undo'),
  1, 'with its audit row');

-- ── Approve again: SKIPPED once more, once ───────────────────────────────
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.decide_maintenance_series((select id from s where name = 'daily'), true, null);
reset role;
select is(pg_temp.live_skips('daily'), 1, 'the new approval posts the overlapping window''s SKIPPED, once');
select ok((select count(*) > 0 from public.maintenance_windows where series_id = (select id from s where name = 'daily')),
  'and makes its windows again');

-- ── Post now: the 10 s end, a later Undo is refused ──────────────────────
select tests.authenticate_as((select id from ids where name = 'tao'));
select lives_ok($$ select public.post_series_action_now((select id from s where name = 'daily')) $$, 'post it now');
reset role;
select ok((select bool_and(hold_until <= now()) from public.notifications
           where maintenance_series_id = (select id from s where name = 'daily') and status = 'queued'),
  'its rows are due at once');
select ok((select (e ->> 'posts_at')::timestamptz = now()
           from public.maintenance_series m, jsonb_array_elements(m.log) with ordinality x(e, ord)
           where m.id = (select id from s where name = 'daily') and e ->> 'action' = 'approved'
           order by ord desc limit 1),
  'and its log line says it posted now');
select is((select jsonb_array_length(after -> 'windows_removed') > 0 from public.audit_log
           where entity_id = (select id from s where name = 'daily') and action = 'maintenance.series_undo'),
  true, 'the approval''s Undo listed the windows it removed in its audit row');
select tests.authenticate_as((select id from ids where name = 'tao'));
select throws_ok($$ select public.undo_series_action((select id from s where name = 'daily')) $$,
  '22023', 'Too late to undo — it has been posted', 'Undo is too late after post-now');
reset role;

-- ── Cancel → Undo: its windows come back ─────────────────────────────────
update public.maintenance_series set undo_until = null where id = (select id from s where name = 'daily');
select tests.authenticate_as((select id from ids where name = 'arm'));
select ok(public.cancel_maintenance_series((select id from s where name = 'daily'), 'Not needed') > 0, 'the owner cancels it');
reset role;
select ok((select n > 0 and held = n and keyed = n from pg_temp.held('daily', 'cancelled')), 'CANCELLED is held under its key');
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok($$ select public.undo_series_action((select id from s where name = 'daily')) $$, 'and undoes it');
reset role;
select ok((select cancelled_at is null from public.maintenance_series where id = (select id from s where name = 'daily'))
      and not exists (select 1 from public.maintenance_windows
                      where series_id = (select id from s where name = 'daily') and cancelled_at is not null),
  'the series and its windows are back');

-- ── Cancel → a window made meanwhile overlaps → Undo refused ─────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.cancel_maintenance_series((select id from s where name = 'daily'), 'Not needed');
reset role;
insert into public.maintenance_windows (site_id, kind, starts_at, ends_at, reason, approved_at)
select site_id, 'maintenance', starts_at, ends_at, 'Hotfix', now() from public.maintenance_windows
where series_id = (select id from s where name = 'daily') order by starts_at desc limit 1;
select tests.authenticate_as((select id from ids where name = 'arm'));
select throws_ok($$ select public.undo_series_action((select id from s where name = 'daily')) $$,
  '22023', 'Another window now overlaps one of its windows — it can''t be undone', 'an overlap made meanwhile blocks the Undo');
reset role;

-- ── Decline and withdraw undo too; too late after a claim or the 10 s ────
select tests.authenticate_as((select id from ids where name = 'nok'));
insert into s values ('ask', public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"monthly","day":20}', '03:00', 30, current_date + 2, null, 'Asked'));
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.decide_maintenance_series((select id from s where name = 'ask'), false, 'Too often');
select lives_ok($$ select public.undo_series_action((select id from s where name = 'ask')) $$, 'a decline is undone');
reset role;
select ok((select declined_at is null and undo_key is null from public.maintenance_series where id = (select id from s where name = 'ask')),
  'the series is waiting again');
select tests.authenticate_as((select id from ids where name = 'nok'));
select public.cancel_maintenance_series((select id from s where name = 'ask'), 'Host does it');
reset role;
update public.notifications set attempts = 1
where maintenance_series_id = (select id from s where name = 'ask') and context ->> 'kind' = 'withdrawn' and channel = 'google_chat';
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok($$ select public.undo_series_action((select id from s where name = 'ask')) $$,
  '22023', 'Too late to undo — it has been posted', 'a withdraw whose line was taken can''t be undone');
reset role;
update public.notifications set attempts = 0
where maintenance_series_id = (select id from s where name = 'ask') and context ->> 'kind' = 'withdrawn';
update public.maintenance_series set undo_until = now() - interval '1 second' where id = (select id from s where name = 'ask');
select tests.authenticate_as((select id from ids where name = 'nok'));
select throws_ok($$ select public.undo_series_action((select id from s where name = 'ask')) $$,
  '22023', 'Too late to undo — it has been posted', 'nor after its 10 s');
reset role;

-- ── A decline undone past the deadline: the engine then marks it Not approved ──
select tests.authenticate_as((select id from ids where name = 'nok'));
insert into s values ('late', public.create_maintenance_series('00000000-0000-0000-0000-0000000000a1',
  '{"freq":"monthly","day":21}', '03:00', 30, current_date + 2, null, 'Late'));
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.decide_maintenance_series((select id from s where name = 'late'), false, 'No');
select public.undo_series_action((select id from s where name = 'late'));
reset role;
update public.maintenance_series set first_starts_at = now() - interval '1 minute' where id = (select id from s where name = 'late');
set local role service_role;
select public.engine_window_reminders(now());
reset role;
select ok((select outcome = 'not_approved' from public.maintenance_series where id = (select id from s where name = 'late'))
      and (select n = undone from pg_temp.held('late', 'declined')),
  'an undone decline past the deadline lapses to Not approved; its DECLINED rows stay Undone');

-- More sites for the review cases (security M1, engine M1, M2, L4, L5; db L1).
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Site B', 2,
   (select id from ids where name = 'arm'), (select id from ids where name = 'nok'), true),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1', 'Site C', 2,
   (select id from ids where name = 'arm'), (select id from ids where name = 'nok'), true),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1', 'Site D', 2,
   (select id from ids where name = 'arm'), (select id from ids where name = 'nok'), true);

-- Security M1: a Responder cancels, puts a window next to one, and can't undo into a chain over 24 h.
select tests.authenticate_as((select id from ids where name = 'tao'));
insert into s values ('chain', public.create_maintenance_series('00000000-0000-0000-0000-0000000000b1',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '08:00', 720, current_date + 2, null, 'Long days'));
reset role;
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.cancel_maintenance_series((select id from s where name = 'chain'), 'Pause');
select public.create_maintenance('00000000-0000-0000-0000-0000000000b1',
  ((current_date + 2) + time '20:00') at time zone 'Asia/Bangkok',
  ((current_date + 3) + time '08:00') at time zone 'Asia/Bangkok', 'Night work');
select throws_ok($$ select public.undo_series_action((select id from s where name = 'chain')) $$,
  '22023', 'Over 24 h with the windows next to it — it can''t be undone; ask an Admin',
  'a Responder''s Undo can''t chain windows past 24 h');
reset role;

-- Engine M1: a window's own Undo can't bring a window back under a cancelled series.
select tests.authenticate_as((select id from ids where name = 'tao'));
insert into s values ('m1', public.create_maintenance_series('00000000-0000-0000-0000-0000000000b2',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '03:00', 30, current_date + 2, null, 'Patches'));
reset role;
create temp table w1 on commit drop as
  select id from public.maintenance_windows where series_id = (select id from s where name = 'm1') order by starts_at limit 1;
grant select on w1 to authenticated;
select tests.authenticate_as((select id from ids where name = 'arm'));
select public.cancel_window((select id from w1), 'Skip this one');
select public.cancel_maintenance_series((select id from s where name = 'm1'), 'Stop');
select throws_ok($$ select public.undo_window_action((select id from w1)) $$,
  '22023', 'Too late to undo — it has been posted', 'the window''s own Undo is over once its series is cancelled');
reset role;
select ok((select cancelled_at is not null from public.maintenance_windows where id = (select id from w1)),
  'and the window stays cancelled');

-- Engine M2 and L4: a second action inside the first one's 10 s posts the first at once; the log line
-- carries when it posts.
select tests.authenticate_as((select id from ids where name = 'nok'));
insert into s values ('m2', public.create_maintenance_series('00000000-0000-0000-0000-0000000000b3',
  '{"freq":"weekly","days":[1,2,3,4,5,6,7]}', '03:00', 30, current_date + 2, null, 'Asked'));
reset role;
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.decide_maintenance_series((select id from s where name = 'm2'), true, null);
reset role;
select ok((select (e ->> 'posts_at')::timestamptz = now() + interval '10 seconds'
           from public.maintenance_series m, jsonb_array_elements(m.log) e
           where m.id = (select id from s where name = 'm2') and e ->> 'action' = 'approved'),
  'the approval''s log line says when it posts');
select tests.authenticate_as((select id from ids where name = 'nok'));
select public.cancel_maintenance_series((select id from s where name = 'm2'), 'Changed my mind');
reset role;
select ok((select bool_and(hold_until <= now()) from public.notifications
           where maintenance_series_id = (select id from s where name = 'm2') and context ->> 'kind' = 'approved'
             and status = 'queued'),
  'a cancel inside the approval''s 10 s posts the approval at once');
select ok((select (e ->> 'posts_at')::timestamptz = now()
           from public.maintenance_series m, jsonb_array_elements(m.log) e
           where m.id = (select id from s where name = 'm2') and e ->> 'action' = 'approved'),
  'and its log line says so');

-- Engine L5: an approval whose window was changed on its own since can't be undone (its own words).
update public.maintenance_series set cancelled_at = null, cancelled_by = null, undo_until = null
where id = (select id from s where name = 'm2');
update public.maintenance_series set approved_at = null, approved_by = null where id = (select id from s where name = 'm2');
delete from public.notifications where maintenance_window_id in
  (select id from public.maintenance_windows where series_id = (select id from s where name = 'm2'));
delete from public.maintenance_windows where series_id = (select id from s where name = 'm2');
select tests.authenticate_as((select id from ids where name = 'tao'));
select public.decide_maintenance_series((select id from s where name = 'm2'), true, null);
select public.cancel_window((select id from public.maintenance_windows where series_id = (select id from s where name = 'm2')
                             order by starts_at limit 1), 'Not this one');
select throws_ok($$ select public.undo_series_action((select id from s where name = 'm2')) $$,
  '22023', 'One of its windows was changed since — it can''t be undone; cancel the series instead',
  'an approval whose window was changed on its own can''t be undone');
reset role;

-- db L1 / engine L2: the nightly top-up waits out an Undo.
update public.maintenance_series set undo_until = now() + interval '2 days' where id = (select id from s where name = 'm2');
create temp table before_nightly on commit drop as
  select count(*)::int as n from public.maintenance_windows where series_id = (select id from s where name = 'm2');
set local role service_role;
select public.engine_expand_series(now() + interval '1 day');
reset role;
select is((select count(*)::int from public.maintenance_windows where series_id = (select id from s where name = 'm2')),
  (select n from before_nightly), 'the nightly top-up leaves a series inside its Undo alone');

select ok(has_function_privilege('authenticated', 'public.undo_series_action(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.undo_series_action(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.post_series_action_now(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.series_undo_begin(public.maintenance_series,text,timestamptz)', 'execute'),
  'signed-in people undo through the RPC only');

select * from finish();
rollback;
