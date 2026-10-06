-- D-007 sign-up filters: domain + exact allowlist address, lower-case, profile from the allowlist.
begin;
\ir _helpers.psql
select plan(17);

-- Allowlist rows
select lives_ok(
  $$ insert into private.allowed_emails (email, role) values ('arm@pgtap.test', 'responder') $$,
  'an allowed-domain address can be allowlisted');
select throws_ok(
  $$ insert into private.allowed_emails (email, role) values ('Ploy@pgtap.test', 'responder') $$,
  '23514', null, 'allowlist addresses must be stored lower-case');
select throws_ok(
  $$ insert into private.allowed_emails (email, role) values ('arm@alias.invalid', 'responder') $$,
  '23503', null, 'an address on a domain that is not allowed (e.g. an alias) is refused');

-- Hook
select is(public.hook_before_user_created('{"user":{"email":"arm@pgtap.test"}}'),
  '{}'::jsonb, 'allowlisted address may sign up');
select is(public.hook_before_user_created('{"user":{"email":"Arm@Pgtap.TEST"}}'),
  '{}'::jsonb, 'different capitals still match the allowlist');
select is(public.hook_before_user_created('{"user":{"email":"nok@pgtap.test"}}') -> 'error' ->> 'http_code',
  '403', 'company account not on the allowlist is refused');
select matches(public.hook_before_user_created('{"user":{"email":"nok@pgtap.test"}}') -> 'error' ->> 'message',
  'access list.*Ask an Admin', 'refusal tells them to ask an Admin');
select matches(public.hook_before_user_created('{"user":{"email":"someone@gmail.com"}}') -> 'error' ->> 'message',
  'Only DxT Google accounts.*Ask an Admin', 'non-company account is refused with a message to ask an Admin');
select is(public.hook_before_user_created('{"user":{}}') -> 'error' ->> 'http_code',
  '403', 'missing email is refused');

-- Profile created on first sign-in with the allowlisted role
select tests.create_user('Arm@Pgtap.test');
select is((select role::text from public.profiles where email = 'arm@pgtap.test'),
  'responder', 'first sign-in creates the profile with the allowlisted role');
select is((select display_name from public.profiles where email = 'arm@pgtap.test'),
  'Arm', 'display name comes from the Google profile');
select tests.create_user('stranger@pgtap.test');
select is((select count(*)::int from public.profiles where email = 'stranger@pgtap.test'),
  0, 'an auth user without an allowlist row gets no profile');

-- Profile status as the app sees it
select tests.authenticate_as((select id from public.profiles where email = 'arm@pgtap.test'));
select is((select status from public.my_access()), 'active', 'active profile reports active');
select is((select role::text from public.my_access()), 'responder', 'my_access returns the role of an active profile');
reset role;
update public.profiles set is_active = false where email = 'arm@pgtap.test';
select tests.authenticate_as((select id from public.profiles where email = 'arm@pgtap.test'));
select is((select status from public.my_access()), 'inactive', 'deactivated profile reports inactive');
select is((select email from public.my_access()), null, 'my_access hides the profile of a deactivated user');
reset role;
select tests.authenticate_as(gen_random_uuid());
select is((select status from public.my_access()), 'missing', 'a session without a profile reports missing');
reset role;

select * from finish();
rollback;
