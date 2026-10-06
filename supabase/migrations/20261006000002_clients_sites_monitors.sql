-- DxT Monitor · 0004 — clients, sites and monitors (PRD §11) with RLS per role (PRD §3, D-012).
-- Staff read everything; Admins write; a Responder may change only the mute fields of a site
-- they own (primary or backup). Server jobs use the service role and bypass RLS.

-- ── Tables ────────────────────────────────────────────────────────────────
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  am_user_id uuid references public.profiles (id) on delete restrict,
  contact_email text check (contact_email is null or contact_email = lower(contact_email)),
  language text not null default 'en' check (language in ('en', 'th')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Owners may be empty while a site is being registered; alerts need both (S05 / S08).
-- Deleting a profile that still owns a site is refused: reassign first (PRD §3 "Used in").
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  name text not null unique check (btrim(name) <> ''),
  tier smallint not null check (tier between 1 and 3),
  primary_owner_id uuid references public.profiles (id) on delete restrict,
  backup_owner_id uuid references public.profiles (id) on delete restrict,
  hosting text,
  notes text,
  is_active boolean not null default true,
  muted_until timestamptz,
  mute_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (primary_owner_id is distinct from backup_owner_id or primary_owner_id is null)
);

create table public.monitors (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  type public.monitor_type not null,
  is_primary boolean not null default false,
  url text not null check (url ~ '^https?://'),
  method text not null default 'GET' check (method in ('GET', 'HEAD')),
  expected_status smallint not null default 200 check (expected_status between 100 and 599),
  timeout_ms integer not null default 10000 check (timeout_ms between 1000 and 60000),
  must_contain text[] not null default '{}',
  must_not_contain text[] not null default '{}',
  allowed_redirect_domains text[] not null default '{}',
  thresholds jsonb not null default '{}' check (jsonb_typeof(thresholds) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────
create index clients_am_user_id_idx on public.clients (am_user_id);
create index sites_client_id_idx on public.sites (client_id);
create index sites_primary_owner_id_idx on public.sites (primary_owner_id);
create index sites_backup_owner_id_idx on public.sites (backup_owner_id);
create index monitors_site_id_idx on public.monitors (site_id);
-- Only the primary monitor can make a site DOWN (spec §6): at most one per site.
create unique index monitors_one_primary_per_site on public.monitors (site_id) where is_primary;

-- ── updated_at ────────────────────────────────────────────────────────────
create trigger clients_set_updated_at before update on public.clients
  for each row execute function private.set_updated_at();
create trigger sites_set_updated_at before update on public.sites
  for each row execute function private.set_updated_at();
create trigger monitors_set_updated_at before update on public.monitors
  for each row execute function private.set_updated_at();

-- ── Helpers ───────────────────────────────────────────────────────────────
-- True when the signed-in user is the site's primary or backup owner.
-- On-call Tier 1 access is added with on-call shifts (S10).
create function public.owns_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sites s
    where s.id = p_site_id
      and auth.uid() is not null
      and (s.primary_owner_id = auth.uid() or s.backup_owner_id = auth.uid())
  );
$$;

revoke execute on function public.owns_site(uuid) from public, anon;
grant execute on function public.owns_site(uuid) to authenticated, service_role;

-- D-012: signed-in non-Admins may change only muted_until / mute_reason.
-- Applies to API sessions only; the service role and direct database sessions are not limited.
create function private.sites_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated'
     and public.current_app_role() is distinct from 'admin'
     and (to_jsonb(new) - 'muted_until' - 'mute_reason' - 'updated_at')
         is distinct from (to_jsonb(old) - 'muted_until' - 'mute_reason' - 'updated_at')
  then
    raise exception 'Only an Admin can change this site''s settings'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger sites_guard_update before update on public.sites
  for each row execute function private.sites_guard_update();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.clients enable row level security;
alter table public.sites enable row level security;
alter table public.monitors enable row level security;

create policy clients_select_staff on public.clients
  for select to authenticated using (public.is_staff());
create policy clients_insert_admin on public.clients
  for insert to authenticated with check (public.current_app_role() = 'admin');
create policy clients_update_admin on public.clients
  for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');
create policy clients_delete_admin on public.clients
  for delete to authenticated using (public.current_app_role() = 'admin');

create policy sites_select_staff on public.sites
  for select to authenticated using (public.is_staff());
create policy sites_insert_admin on public.sites
  for insert to authenticated with check (public.current_app_role() = 'admin');
create policy sites_update_admin_or_owner on public.sites
  for update to authenticated
  using (
    public.current_app_role() = 'admin'
    or (public.current_app_role() = 'responder' and public.owns_site(id))
  )
  with check (
    public.current_app_role() = 'admin'
    or (public.current_app_role() = 'responder' and public.owns_site(id))
  );
create policy sites_delete_admin on public.sites
  for delete to authenticated using (public.current_app_role() = 'admin');

create policy monitors_select_staff on public.monitors
  for select to authenticated using (public.is_staff());
create policy monitors_insert_admin on public.monitors
  for insert to authenticated with check (public.current_app_role() = 'admin');
create policy monitors_update_admin on public.monitors
  for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');
create policy monitors_delete_admin on public.monitors
  for delete to authenticated using (public.current_app_role() = 'admin');

-- ── Grants (auto_expose_new_tables = false) ───────────────────────────────
revoke all on public.clients, public.sites, public.monitors from public, anon, authenticated;
grant select, insert, update, delete on public.clients, public.sites, public.monitors to authenticated;
grant all on public.clients, public.sites, public.monitors to service_role;
