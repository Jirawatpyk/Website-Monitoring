-- S17 PR 2 (D-069, spec §10, D-062 item 12): send_channel_test — any active person; Chat needs a Chat
-- id; one a minute per person and channel; a Chat test is one card in its own "test-<event>" thread
-- naming only the tester, an email test is one email to them alone; the on-call checklist is untouched.
begin;
\ir _helpers.psql
select plan(14);

delete from public.oncall_events where kind = 'channel_test';
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated;
insert into ids values
  ('tao',  tests.create_user('tao-ct@pgtap.test', 'admin')),
  ('mint', tests.create_user('mint-ct@pgtap.test', 'viewer')),
  ('ceo',  tests.create_user('ceo-ct@pgtap.test', 'stakeholder')),
  ('off',  tests.create_user('off-ct@pgtap.test', 'responder'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
grant execute on function pg_temp.uid(text) to authenticated;
update public.profiles set google_chat_user_id = '200001' where id = pg_temp.uid('tao');
update public.profiles set google_chat_user_id = '200002' where id = pg_temp.uid('mint');
update public.profiles set is_active = false where id = pg_temp.uid('off');

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

-- ── A Viewer's Chat test ─────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('mint'));
select lives_ok($$select public.send_channel_test('chat')$$, 'a Viewer sends a Chat test');
reset role;
select is((select count(*)::int from public.notifications n join public.oncall_events e on e.id = n.oncall_event_id
           where e.kind = 'channel_test' and e.user_id = pg_temp.uid('mint')), 1, 'one message');
select is((select n.channel::text from public.notifications n join public.oncall_events e on e.id = n.oncall_event_id
           where e.kind = 'channel_test' and e.user_id = pg_temp.uid('mint')), 'google_chat', 'a Chat card');
select is((select n.thread_key = 'test-' || e.id from public.notifications n join public.oncall_events e on e.id = n.oncall_event_id
           where e.kind = 'channel_test' and e.user_id = pg_temp.uid('mint')), true, 'in its own thread');
select is((select n.context -> 'people' from public.notifications n join public.oncall_events e on e.id = n.oncall_event_id
           where e.kind = 'channel_test' and e.user_id = pg_temp.uid('mint')),
          jsonb_build_array(jsonb_build_object('id', pg_temp.uid('mint'), 'role', 'self')), 'naming only the tester');

-- ── The cooldown, per channel ────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('mint'));
select is(pg_temp.hint_of($$select public.send_channel_test('chat')$$), 'test_too_soon', 'a second Chat test inside a minute is refused');
select lives_ok($$select public.send_channel_test('email')$$, 'an email test is its own channel');
reset role;
select is((select string_agg(n.channel::text || ':' || (n.user_id = pg_temp.uid('mint'))::text, ',')
           from public.notifications n join public.oncall_events e on e.id = n.oncall_event_id
           where e.kind = 'channel_test' and e.payload ->> 'channel' = 'email'), 'email:true',
          'the email test is one email, to the tester');
update public.oncall_events set at = now() - interval '61 seconds' where kind = 'channel_test' and user_id = pg_temp.uid('mint');
select tests.authenticate_as(pg_temp.uid('mint'));
select lives_ok($$select public.send_channel_test('chat')$$, 'after a minute it goes again');

-- ── Refused ──────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('ceo'));
select is(pg_temp.hint_of($$select public.send_channel_test('chat')$$), 'no_chat_id', 'Chat needs a Chat id');
select lives_ok($$select public.send_channel_test('email')$$, 'a Stakeholder without a Chat id can test email');
select is(pg_temp.hint_of($$select public.send_channel_test('sms')$$), 'bad_channel', 'only chat or email');
select tests.authenticate_as(pg_temp.uid('off'));
select is(pg_temp.hint_of($$select public.send_channel_test('email')$$), '42501', 'an inactive person is refused');
reset role;
select is((select count(*)::int from public.oncall_checklist where user_id in (select id from ids)), 0,
          'the on-call checklist is untouched');

select * from finish();
rollback;
