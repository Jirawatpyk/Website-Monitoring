-- At most 5 notes a minute per person and incident (S07 security review L1): each NOTE posts to Chat
-- at once, so a burst can't crowd the webhook quota DOWN alerts share.
begin;
\ir _helpers.psql
select plan(6);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('arm',   tests.create_user('arm@pgtap.test', 'responder')),
  ('admin', tests.create_user('admin@pgtap.test', 'admin'));
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'));
create temp table inc (id uuid) on commit drop;
grant select on inc to anon, authenticated;
insert into inc values (public.engine_open_incident('00000000-0000-0000-0000-0000000000a1', null,
  'hard_fail', 'down', now() - interval '2 minutes', now() - interval '1 minute', now(), '{}', true));

select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok(
  $$select public.add_incident_note((select id from inc), 'note ' || n) from generate_series(1, 5) n$$,
  'five notes in a minute go through');
select throws_like($$select public.add_incident_note((select id from inc), 'one more')$$,
  '%5 notes in a minute%', 'the sixth inside the minute is refused');
reset role;

select tests.authenticate_as((select id from ids where name = 'admin'));
select lives_ok($$select public.add_incident_note((select id from inc), 'from someone else')$$,
  'the limit is per person: someone else can still write');
reset role;

-- A minute later the earlier notes no longer count.
update public.incident_events set at = now() - interval '61 seconds'
  where type = 'note' and actor_id = (select id from ids where name = 'arm');
select tests.authenticate_as((select id from ids where name = 'arm'));
select lives_ok($$select public.add_incident_note((select id from inc), 'later')$$,
  'once the minute has passed, notes go through again');
reset role;

select is((select count(*)::int from public.incident_events where type = 'note'), 7,
  'every accepted note is on the timeline');
select is((select count(*)::int from public.notifications where template = 'note'), 7,
  'and a NOTE reply each; the refused one left nothing');

select * from finish();
rollback;
