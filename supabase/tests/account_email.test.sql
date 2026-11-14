-- S16 PR 4 (spec §34, D-062 item 13): a role change or a deactivation writes one account event and
-- queues one email to the person only — after every check has passed. The event freezes the actor,
-- the places that moved and their new holders (read after the reassignment, a live shift's split rest
-- included), and for a promotion the other Admins. Staff never read the events; only a notifier that
-- asks for account rows claims them, and one person's account emails leave in order.
begin;
\ir _helpers.psql
select plan(26);

-- ── Fixtures (as postgres), as users.test.sql ────────────────────────────
select tests.clear_sites();
delete from public.oncall_events;
delete from public.oncall_swaps;
delete from public.oncall_shifts;
delete from public.oncall_rotation;
update public.profiles set is_active = false where true;
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated, service_role;
insert into ids values
  ('tao',  tests.create_user('tao@pgtap.test', 'admin')),
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('ploy', tests.create_user('ploy@pgtap.test', 'responder')),
  ('nok',  tests.create_user('nok@pgtap.test', 'responder')),
  ('thee', tests.create_user('thee@pgtap.test', 'stakeholder')),
  ('ceo',  tests.create_user('ceo@pgtap.test', 'stakeholder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
grant execute on function pg_temp.uid(text) to anon, authenticated, service_role;
update public.profiles p set google_chat_user_id = v.chat
  from (values ('tao', '100001'), ('arm', '100002'), ('ploy', '100003'), ('nok', '100004')) v (name, chat)
  where p.id = pg_temp.uid(v.name);

insert into public.clients (id, name, am_user_id, is_internal) values
  ('00000000-0000-0000-0000-0000000000c1', 'Fuji', pg_temp.uid('thee'), false);
insert into public.sites (id, client_id, name, tier, primary_owner_id, backup_owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Fuji Links', 1,
   pg_temp.uid('nok'), pg_temp.uid('arm')),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Fuji Shop', 2,
   pg_temp.uid('arm'), pg_temp.uid('nok'));
-- Nok is on call now (a live shift: the hand-over splits it) and the week after next.
insert into public.oncall_rotation (user_id, position) values (pg_temp.uid('nok'), 1), (pg_temp.uid('ploy'), 2);
insert into public.oncall_shifts (id, user_id, starts_at, ends_at, slot) values
  ('00000000-0000-0000-0000-0000000000f1', pg_temp.uid('nok'), now() - interval '1 day', now() + interval '6 days', 1),
  ('00000000-0000-0000-0000-0000000000f2', pg_temp.uid('ploy'), now() + interval '6 days', now() + interval '13 days', 2),
  ('00000000-0000-0000-0000-0000000000f3', pg_temp.uid('nok'), now() + interval '13 days', now() + interval '20 days', 1);

create function pg_temp.event_of(p text) returns public.account_events language sql as $$
  select * from public.account_events where user_id = pg_temp.uid(p) order by created_at desc limit 1
$$;

-- ── A refused change leaves no event and no email ────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok(format('select public.change_user_role(%L, ''stakeholder'')', pg_temp.uid('nok')), '55000',
  'Pick who takes over each place first', 'Nok can''t change until each place has someone');
reset role;
select is((select count(*)::int from public.account_events), 0, 'a refused change writes no event');
select is((select count(*)::int from public.notifications where account_event_id is not null), 0, '… and no email');

-- ── Nok Responder → Stakeholder (the board's Role changed) ───────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select lives_ok(format('select public.change_user_role(%L, ''stakeholder'', %L)', pg_temp.uid('nok'),
  jsonb_build_object(
    'owners', jsonb_build_object('00000000-0000-0000-0000-0000000000a1', pg_temp.uid('ploy')),
    'backups', jsonb_build_object('00000000-0000-0000-0000-0000000000a2', pg_temp.uid('ploy')),
    'shifts', pg_temp.uid('arm'))),
  'Nok becomes a Stakeholder');
reset role;
select is((select count(*)::int from public.account_events where user_id = pg_temp.uid('nok')), 1, 'one event');
select is((select (kind, actor_id, from_role, to_role)::text from pg_temp.event_of('nok')),
  format('(role_changed,%s,responder,stakeholder)', pg_temp.uid('tao')), 'role_changed by Tao, responder → stakeholder');
select is((select facts ->> 'actor' from pg_temp.event_of('nok')), 'Tao', 'the actor''s name is frozen');
select is((select jsonb_agg(m - 'starts' - 'ends') from jsonb_array_elements((select facts -> 'moves' from pg_temp.event_of('nok'))) m),
  '[{"kind": "owner", "place": "Fuji Links", "with": "Ploy"},
    {"kind": "backup", "place": "Fuji Shop", "with": "Ploy"},
    {"kind": "shift", "with": "Arm"}, {"kind": "shift", "with": "Arm"}]'::jsonb,
  'what moved and who has it now — the live shift''s split rest included (db review H1)');
select is((select (facts -> 'moves' -> 2 ->> 'ends')::timestamptz from pg_temp.event_of('nok')),
  now() + interval '6 days',
  'the live shift keeps its own week in the email');
select ok((select (facts ->> 'left_rotation')::boolean from pg_temp.event_of('nok')), 'Nok left the rotation');
select ok((select not (facts ->> 'was_am')::boolean and not (facts ->> 'manages_clients')::boolean from pg_temp.event_of('nok')),
  'not an AM before or after: "(none yet)"');
select is((select facts -> 'admins' from pg_temp.event_of('nok')), '[]'::jsonb, 'no Admin names unless promoted');
select is((select jsonb_agg(jsonb_build_array(channel, template, user_id, status) order by channel)
           from public.notifications where account_event_id = (pg_temp.event_of('nok')).id),
  jsonb_build_array(jsonb_build_array('email', 'account_email', pg_temp.uid('nok'), 'queued')),
  'one email, to Nok only — no Chat row, nobody else');

-- ── Arm Responder → Admin: nothing moves, the other Admins are named ──────
select tests.authenticate_as(pg_temp.uid('tao'));
select lives_ok(format('select public.change_user_role(%L, ''admin'')', pg_temp.uid('arm')), 'Arm becomes an Admin');
reset role;
select is((select facts -> 'admins' from pg_temp.event_of('arm')), '["Tao"]'::jsonb, 'WHAT COMES WITH ADMIN names Tao');
select is((select facts -> 'moves' from pg_temp.event_of('arm')), '[]'::jsonb,
  'an Admin keeps their sites and shifts: nothing moved');

-- ── Deactivate Thee, the AM (the board's Access removed) ─────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select lives_ok(format('select public.deactivate_user(%L, %L)', pg_temp.uid('thee'),
  jsonb_build_object('am', pg_temp.uid('ceo'))), 'Thee is deactivated');
reset role;
select is((select (kind, from_role, to_role)::text from pg_temp.event_of('thee')), '(deactivated,stakeholder,)',
  'deactivated, was a stakeholder');
select ok((select (facts ->> 'was_am')::boolean from pg_temp.event_of('thee')), '"Was Stakeholder · Site AM"');
select is((select facts -> 'moves' from pg_temp.event_of('thee')),
  '[{"kind": "am", "place": "Fuji", "with": "Ceo"}]'::jsonb, 'WHAT MOVED: Site AM of Fuji, now with Ceo');
select is((select count(*)::int from public.notifications n where n.account_event_id = (pg_temp.event_of('thee')).id
           and n.channel = 'email' and n.user_id = pg_temp.uid('thee')), 1,
  'the Access removed email is queued for Thee although inactive');

-- ── Nobody but the notifier reads them ───────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select throws_ok('select * from public.account_events', '42501', null, 'an Admin can''t read account events');
select throws_ok($$select * from public.claim_notifications('email', 20, null, false, false, false, true)$$, '42501',
  null, 'a signed-in session can''t claim messages');
reset role;

-- ── Claiming: only with p_account, one person's emails in order ──────────
set local role service_role;
select is((select count(*)::int from public.claim_notifications('email', 50) c where c.account_event_id is not null), 0,
  'a notifier that doesn''t ask for account rows never claims them');
reset role;
-- A second change to Nok: its email waits behind the first.
update public.notifications set created_at = now() - interval '1 minute'
  where account_event_id = (pg_temp.event_of('nok')).id;
select tests.authenticate_as(pg_temp.uid('tao'));
select lives_ok(format('select public.change_user_role(%L, ''viewer'')', pg_temp.uid('nok')), 'Nok becomes a Viewer');
reset role;
set local role service_role;
select is((select array_agg(c.account_event_id order by c.created_at)
           from public.claim_notifications('email', 50, null, false, false, false, true) c
           where c.user_id = pg_temp.uid('nok')),
  array[(select e.id from public.account_events e where e.user_id = pg_temp.uid('nok') and e.to_role = 'stakeholder')],
  'only Nok''s first email is claimed; the second waits for it');
reset role;

select * from finish();
rollback;
