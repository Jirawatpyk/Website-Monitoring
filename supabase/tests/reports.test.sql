-- S14 (FR-12, D-056): queue_report writes the report and its messages once per kind and period; report
-- rows are claimed only by a notifier that asks for them; the engine-sweep beat records its minute.
begin;
\ir _helpers.psql
select plan(14);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated, service_role;
insert into ids values
  ('tao', tests.create_user('tao@pgtap.test', 'admin')),
  ('ceo', tests.create_user('ceo@pgtap.test', 'stakeholder')),
  ('gone', tests.create_user('gone@pgtap.test', 'stakeholder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));
update public.profiles set is_active = false where id = (select id from ids where name = 'gone');

set local role service_role;
select isnt(
  public.queue_report('weekly', '2026-09-21', '{"text":"Website week"}', '{"subject":"s"}',
    array[(select id from ids where name = 'ceo'), (select id from ids where name = 'gone')]),
  null, 'the weekly summary is queued');
select is(
  public.queue_report('weekly', '2026-09-21', '{"text":"again"}', '{"subject":"s"}',
    array[(select id from ids where name = 'ceo')]),
  null, 'a second run for the same week queues nothing');
select is((select count(*)::int from public.reports), 1, 'one report row');
select is((select chat->>'text' from public.reports), 'Website week', 'the first card is kept');
select is(
  (select count(*)::int from public.notifications where report_id is not null and channel = 'google_chat'),
  1, 'one Chat row for the Reports Space');
select is(
  (select array_agg(user_id) from public.notifications where report_id is not null and channel = 'email'),
  array[(select id from ids where name = 'ceo')], 'an email to each active recipient only');
select is(
  (select distinct template || ' ' || thread_key from public.notifications where report_id is not null),
  'weekly_summary report-weekly-2026-09-21', 'its template and thread');
select isnt(public.queue_report('daily', '2026-09-25', '{"text":"Website status"}', null, null), null,
  'the daily digest is queued');
select is(
  (select count(*)::int from public.notifications n join public.reports r on r.id = n.report_id
   where r.kind = 'daily'),
  1, 'a digest is Chat only');

select is((select count(*)::int from public.claim_notifications('google_chat', 20)), 0,
  'a notifier that doesn''t ask for reports claims none');
select is((select count(*)::int from public.claim_notifications('google_chat', 20, null, false, true)), 2,
  'one that does claims both');

insert into public.agent_heartbeats (name, last_seen_at) values ('engine-sweep', '2026-09-25 02:17:31+00')
  on conflict (name) do update set last_seen_at = excluded.last_seen_at;
update public.agent_heartbeats set last_seen_at = '2026-09-25 02:18:02+00' where name = 'engine-sweep';
update public.agent_heartbeats set last_seen_at = '2026-09-25 02:18:40+00' where name = 'engine-sweep';
select is(
  (select array_agg(minute order by minute) from public.engine_sweep_minutes
   where minute between '2026-09-25 02:00+00' and '2026-09-25 03:00+00'),
  array['2026-09-25 02:17+00', '2026-09-25 02:18+00']::timestamptz[],
  'each engine-sweep beat records its minute, once');
reset role;

select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.reports), 0, 'a Viewer reads no reports');
select throws_ok($$select public.queue_report('daily', '2026-09-26', '{}', null, null)$$, '42501', null,
  'and can''t queue one');
reset role;

select * from finish();
rollback;
