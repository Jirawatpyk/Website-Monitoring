-- D-078 (spec §43) PR 2: Management is a tag on an active Admin with a Chat id. set_management (an
-- Admin, a note, one audit row, one account email to the person); a role change away from Admin or a
-- deactivation takes the tag with its own audit row; a Management person's Chat id can't be cleared.
begin;
\ir _helpers.psql
select plan(17);

-- ── Fixtures (as postgres) ───────────────────────────────────────────────
select tests.clear_sites();
delete from public.oncall_events;
delete from public.oncall_swaps;
delete from public.oncall_shifts;
delete from public.oncall_rotation;
update public.profiles set is_active = false where true;
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao', tests.create_user('tao@pgtap.test', 'admin')),
  ('vee', tests.create_user('vee@pgtap.test', 'admin')),
  ('pim', tests.create_user('pim@pgtap.test', 'admin')),
  ('new', tests.create_user('new@pgtap.test', 'admin')),
  ('arm', tests.create_user('arm@pgtap.test', 'responder'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
grant execute on function pg_temp.uid(text) to anon, authenticated, service_role;
update public.profiles p set google_chat_user_id = v.chat
  from (values ('tao', '200001'), ('vee', '200002'), ('pim', '200003'), ('arm', '200005')) v (name, chat)
  where p.id = pg_temp.uid(v.name);

-- ── Who may set it, and on whom ──────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('arm'));
select throws_ok(format($$select public.set_management(%L, true, 'L2')$$, pg_temp.uid('vee')),
  '42501', 'Only an Admin can set who is Management', 'a Responder can''t set it');

select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format($$select public.set_management(%L, true, '  ')$$, pg_temp.uid('vee')),
  '22023', 'Add a short note — it goes in the audit log', 'a note is required');
select throws_ok(format($$select public.set_management(%L, true, 'L2')$$, pg_temp.uid('arm')),
  '55000', 'Only Admins can be Management', 'only Admins carry it');
select throws_ok(format($$select public.set_management(%L, true, 'L2')$$, pg_temp.uid('new')),
  '55000', 'Add a Google Chat id first — Management is @mentioned', 'an Admin with no Chat id can''t');

select lives_ok(format($$select public.set_management(%L, true, 'Bua review, item 3')$$, pg_temp.uid('vee')),
  'an Admin sets Vee as Management');
select lives_ok(format($$select public.set_management(%L, true, 'Bua review, item 3')$$, pg_temp.uid('vee')),
  'setting it again is a no-op');

reset role;
select is((select is_management from public.profiles where id = pg_temp.uid('vee')), true, 'Vee is Management');
select results_eq(
  $$select before ->> 'management', after ->> 'management', after ->> 'note' from public.audit_log
    where action = 'user.management' and entity_id = pg_temp.uid('vee')$$,
  $$values ('false', 'true', 'Bua review, item 3')$$,
  'one audit row with the note (the no-op wrote none)');
select results_eq(
  $$select e.kind, n.template, n.channel::text, n.user_id from public.account_events e
    join public.notifications n on n.account_event_id = e.id where e.user_id = pg_temp.uid('vee')$$,
  $$values ('management_set', 'account_email', 'email', pg_temp.uid('vee'))$$,
  'one account email to Vee only');

-- ── Can't hold it without being an active Admin ──────────────────────────
select throws_ok(format($$update public.profiles set is_management = true where id = %L$$, pg_temp.uid('arm')),
  '23514', null, 'the check refuses it on a non-Admin');

-- ── Chat id stays while Management ───────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format($$select public.set_chat_user_id(%L, null)$$, pg_temp.uid('vee')),
  '55000', 'Management is @mentioned — remove them from Management first', 'a Management Chat id can''t be cleared');

-- ── A role change away from Admin takes the tag ──────────────────────────
select lives_ok(format($$select public.set_management(%L, true, 'L2 too')$$, pg_temp.uid('pim')), 'Pim set too');
select lives_ok(format($$select public.change_user_role(%L, 'responder')$$, pg_temp.uid('pim')),
  'Pim is changed to Responder');
reset role;
select is((select is_management from public.profiles where id = pg_temp.uid('pim')), false,
  'the role change took the tag');
select is(
  (select after ->> 'reason' from public.audit_log where action = 'user.management' and entity_id = pg_temp.uid('pim')
     and (after ->> 'management') = 'false'),
  'role changed', 'with its own audit row saying why');

-- ── Remove ───────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select lives_ok(format($$select public.set_management(%L, false, 'Back to L1')$$, pg_temp.uid('vee')), 'Vee removed');
reset role;
select is(
  (select count(*)::int from public.account_events where user_id = pg_temp.uid('vee') and kind = 'management_removed'),
  1, 'the removal emails Vee too');

select * from finish();
rollback;
