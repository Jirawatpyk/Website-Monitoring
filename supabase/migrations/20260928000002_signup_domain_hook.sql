-- DxT Monitor · 0002 — only company Google Workspace accounts may sign up (PRD §3).
-- First line of defence; the web proxy re-checks the session email (isAllowedEmail in @dxt/shared).
-- Deny by default: with no row in private.allowed_email_domains nobody can sign up.
-- Add the company domain per environment, e.g.:
--   insert into private.allowed_email_domains (domain) values ('<company-domain>');

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.allowed_email_domains (
  domain text primary key check (domain = lower(domain) and domain <> ''),
  created_at timestamptz not null default now()
);
revoke all on private.allowed_email_domains from public, anon, authenticated;

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  email text := lower(coalesce(event -> 'user' ->> 'email', ''));
  email_domain text := split_part(email, '@', 2);
begin
  if email_domain <> '' and exists (
    select 1 from private.allowed_email_domains d where d.domain = email_domain
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign in with your company Google account.'
    )
  );
end;
$$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
