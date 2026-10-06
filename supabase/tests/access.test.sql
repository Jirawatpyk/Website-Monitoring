-- D-007 sign-up filters: domain + exact allowlist address, lower-case, profile from the allowlist.
begin;
\ir _helpers.psql
select plan(23);

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

-- Google only (D-007): a password account is refused even for an allowlisted company address
insert into private.allowed_email_domains (domain) values ('corp.example');
insert into private.allowed_emails (email, role) values ('boss@corp.example', 'admin');
select is(
  public.hook_before_user_created('{"user":{"email":"boss@corp.example","app_metadata":{"provider":"google"}}}'),
  '{}'::jsonb, 'an allowlisted address signing in with Google may sign up');
select matches(
  public.hook_before_user_created('{"user":{"email":"boss@corp.example","app_metadata":{"provider":"email"}}}') -> 'error' ->> 'message',
  'Google account', 'an email/password sign-up is refused even when allowlisted');
select is(
  public.hook_before_user_created('{"user":{"email":"boss@corp.example"}}') -> 'error' ->> 'http_code',
  '403', 'a sign-up with no provider is refused');
insert into auth.users (id, email, aud, role, raw_app_meta_data)
values (gen_random_uuid(), 'boss@corp.example', 'authenticated', 'authenticated', '{"provider":"email"}');
select is((select count(*)::int from public.profiles where email = 'boss@corp.example'), 0,
  'a non-Google auth user gets no profile, even when allowlisted');

-- The hook and the allowlist are out of reach of API roles
select tests.as_anon();
select throws_ok($$ select public.hook_before_user_created('{}') $$, '42501', null,
  'anon cannot call the sign-up hook');
reset role;
select tests.authenticate_as((select id from public.profiles where email = 'arm@pgtap.test'));
select throws_ok($$ select * from private.allowed_emails $$, '42501', null,
  'a signed-in user cannot read the allowlist');
reset role;

select * from finish();
rollback;
