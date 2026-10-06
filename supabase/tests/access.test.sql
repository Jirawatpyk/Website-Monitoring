-- D-007 sign-up filters: domain + exact allowlist address, lower-case, profile from the allowlist.
begin;
\ir _helpers.psql
select plan(14);

-- Allowlist rows
select lives_ok(
  $$ insert into private.allowed_emails (email, role) values ('arm@example.test', 'responder') $$,
  'an allowed-domain address can be allowlisted');
select throws_ok(
  $$ insert into private.allowed_emails (email, role) values ('Ploy@example.test', 'responder') $$,
  '23514', null, 'allowlist addresses must be stored lower-case');
select throws_ok(
  $$ insert into private.allowed_emails (email, role) values ('arm@alias.test', 'responder') $$,
  '23503', null, 'an address on a domain that is not allowed (e.g. an alias) is refused');

-- Hook
select is(public.hook_before_user_created('{"user":{"email":"arm@example.test"}}'),
  '{}'::jsonb, 'allowlisted address may sign up');
select is(public.hook_before_user_created('{"user":{"email":"Arm@Example.TEST"}}'),
  '{}'::jsonb, 'different capitals still match the allowlist');
select is(public.hook_before_user_created('{"user":{"email":"nok@example.test"}}') -> 'error' ->> 'http_code',
  '403', 'company account not on the allowlist is refused');
select matches(public.hook_before_user_created('{"user":{"email":"nok@example.test"}}') -> 'error' ->> 'message',
  'access list.*Ask an Admin', 'refusal tells them to ask an Admin');
select matches(public.hook_before_user_created('{"user":{"email":"someone@gmail.com"}}') -> 'error' ->> 'message',
  'Only DxT Google accounts.*Ask an Admin', 'non-company account is refused with a message to ask an Admin');
select is(public.hook_before_user_created('{"user":{}}') -> 'error' ->> 'http_code',
  '403', 'missing email is refused');

-- Profile created on first sign-in with the allowlisted role
select tests.create_user('Arm@Example.test');
select is((select role::text from public.profiles where email = 'arm@example.test'),
  'responder', 'first sign-in creates the profile with the allowlisted role');
select is((select display_name from public.profiles where email = 'arm@example.test'),
  'Arm', 'display name comes from the Google profile');
select tests.create_user('stranger@example.test');
select is((select count(*)::int from public.profiles where email = 'stranger@example.test'),
  0, 'an auth user without an allowlist row gets no profile');

-- Profile status as the app sees it
select tests.authenticate_as((select id from public.profiles where email = 'arm@example.test'));
select is(public.my_profile_status(), 'active', 'active profile reports active');
reset role;
update public.profiles set is_active = false where email = 'arm@example.test';
select tests.authenticate_as((select id from public.profiles where email = 'arm@example.test'));
select is(public.my_profile_status(), 'inactive', 'deactivated profile reports inactive');
reset role;

select * from finish();
rollback;
