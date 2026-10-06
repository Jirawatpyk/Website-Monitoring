-- DxT Monitor · access list (D-007). TEMPLATE — placeholders only; never commit real addresses.
--
-- Run per environment in that Supabase project's SQL editor (staging first, production after the
-- S01 merge). Until the Users screen (S16) this is how an Admin invites, changes or removes people.
--
-- Before adding someone, they confirm on their Google Account → Security → 2-Step Verification page
-- that it is required and can't be turned off (D-007). Use the person's PRIMARY Google address —
-- never a DxT alias (an alias domain is refused). Addresses are stored lower-case.
-- Roles: admin | responder | stakeholder | viewer   (client is Phase 3)

-- 1. Company domain (once per environment)
insert into private.allowed_email_domains (domain)
values ('<company-domain>')
on conflict do nothing;

-- 2. Invite: the row is the invite; the profile is created at first sign-in with this role
insert into private.allowed_emails (email, role) values
  (lower('<first.last>@<company-domain>'), 'admin'),
  (lower('<first.last>@<company-domain>'), 'responder')
on conflict (email) do update set role = excluded.role;

-- 3. Change the role of someone who has already signed in (the allowlist row only matters at sign-up)
-- update public.profiles set role = 'viewer' where email = lower('<first.last>@<company-domain>');

-- 4. Remove someone: deactivate (keeps their history), drop the invite, sign them out everywhere
-- update public.profiles set is_active = false where email = lower('<first.last>@<company-domain>');
-- delete from private.allowed_emails where email = lower('<first.last>@<company-domain>');
-- update auth.users set banned_until = 'infinity' where email = lower('<first.last>@<company-domain>');
-- delete from auth.sessions where user_id = (select id from auth.users where email = lower('<first.last>@<company-domain>'));

-- Check
-- select email, role from private.allowed_emails order by email;
-- select email, role, is_active from public.profiles order by email;
