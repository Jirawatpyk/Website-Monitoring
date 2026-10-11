-- A Google Chat id is digits only: a `users/` prefix or any other text is refused (S08 staging run).
begin;
\ir _helpers.psql
select plan(4);

create temp table ids (name text primary key, id uuid) on commit drop;
insert into ids values ('arm', tests.create_user('arm-chat@pgtap.test', 'responder'));

select lives_ok(
  $$ update public.profiles set google_chat_user_id = '117857922524484393598' where id = (select id from ids where name = 'arm') $$,
  'digits are accepted');
select lives_ok(
  $$ update public.profiles set google_chat_user_id = null where id = (select id from ids where name = 'arm') $$,
  'no id (null) is accepted');
select throws_ok(
  $$ update public.profiles set google_chat_user_id = 'users/117857922524484393598' where id = (select id from ids where name = 'arm') $$,
  '23514', null, 'the users/ prefix is refused');
select throws_ok(
  $$ update public.profiles set google_chat_user_id = 'ARM' where id = (select id from ids where name = 'arm') $$,
  '23514', null, 'text is refused');

select * from finish();
rollback;
