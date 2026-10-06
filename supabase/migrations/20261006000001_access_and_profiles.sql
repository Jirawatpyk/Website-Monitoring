-- DxT Monitor · 0003 — access list and profiles (D-007).
-- Sign-up needs the company domain (0002) AND the exact address on private.allowed_emails.
-- The allowlist row is the invite: on first sign-in the profile is created with its role.
-- Rows are added per environment from supabase/access/allowlist.template.sql — real addresses
-- are never committed.

-- ── Shared trigger: updated_at ────────────────────────────────────────────
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Allowlist ─────────────────────────────────────────────────────────────
-- Stored lower-case. The generated domain must be an allowed domain, so a DxT alias
-- (never in allowed_email_domains) can't be invited by mistake.
create table private.allowed_emails (
  email text primary key
    check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  domain text generated always as (split_part(email, '@', 2)) stored not null
    references private.allowed_email_domains (domain) on delete restrict,
  role public.app_role not null,
  created_at timestamptz not null default now()
);
revoke all on private.allowed_emails from public, anon, authenticated;

-- ── Sign-up hook: domain AND allowlist ────────────────────────────────────
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
  v_domain text := split_part(v_email, '@', 2);
begin
  if v_domain = '' or not exists (
    select 1 from private.allowed_email_domains d where d.domain = v_domain
  ) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Only DxT Google accounts can sign in. Ask an Admin if you need access.'
    ));
  end if;

  if not exists (select 1 from private.allowed_emails a where a.email = v_email) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'You''re not on the DxT Monitor access list yet. Ask an Admin to add you.'
    ));
  end if;

  return '{}'::jsonb;
end;
$$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- ── Profiles ──────────────────────────────────────────────────────────────
-- PRD §11 plus display_name and is_active (deactivated users read nothing).
-- Email is the default notification channel (PRD §3).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique check (email = lower(email)),
  display_name text not null check (btrim(display_name) <> ''),
  role public.app_role not null,
  is_active boolean not null default true,
  google_chat_user_id text,
  phone text,
  timezone text not null default 'Asia/Bangkok',
  notify_email boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- First sign-in: create the profile with the allowlisted role. An auth user created
-- without an allowlist row (only possible outside the hook) gets no profile and reads nothing.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(new.email);
  v_role public.app_role;
begin
  select a.role into v_role from private.allowed_emails a where a.email = v_email;
  if v_role is null then
    return new;
  end if;

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    v_email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(v_email, '@', 1)
    ),
    v_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── Role helpers (used by RLS policies) ───────────────────────────────────
-- The signed-in user's role, or null when they have no active profile.
create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

-- Internal staff who may read the dashboard (clients come in Phase 3 with their own rules).
create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('admin', 'responder', 'stakeholder', 'viewer'), false);
$$;

-- The signed-in user's access in one call (the app layout runs it on every page): status
-- 'active' | 'inactive' | 'missing', plus the profile fields when active. RLS hides an inactive
-- profile, so the app can't read this itself.
create function public.my_access()
returns table (status text, id uuid, email text, display_name text, role public.app_role)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(case when p.is_active then 'active' when p.id is not null then 'inactive' end, 'missing'),
    case when p.is_active then p.id end,
    case when p.is_active then p.email end,
    case when p.is_active then p.display_name end,
    case when p.is_active then p.role end
  from (select 1) as one
  left join public.profiles p on p.id = auth.uid();
$$;

revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.current_app_role() to authenticated, service_role;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.my_access() to authenticated, service_role;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

-- Staff see each other (owner names on sites and incidents); inactive or missing profiles see nothing.
create policy profiles_select_staff on public.profiles
  for select to authenticated
  using ((select public.is_staff()));

-- Role and activation changes are Admin-only (Users screen, S16). Profiles are inserted
-- only by the sign-up trigger and never deleted by the app (deactivate instead).
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

revoke all on public.profiles from public, anon, authenticated;
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
