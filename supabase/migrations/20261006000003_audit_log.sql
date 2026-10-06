-- DxT Monitor · 0005 — audit_log (PRD §11): append-only record of every config and incident
-- state change, with before / after. Written only through public.write_audit() (signed-in
-- users) or by the service role; never updated or deleted — not even by the service role.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  -- null = the system (engine, cron). Profiles with history can't be deleted: deactivate instead.
  actor_id uuid references public.profiles (id) on delete restrict,
  action text not null check (btrim(action) <> ''),
  entity text not null check (btrim(entity) <> ''),
  entity_id uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now(),
  -- Append-only: there is no updated_at because a row never changes.
  created_at timestamptz not null default now()
);

create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

-- ── Append-only, enforced for every role ─────────────────────────────────
create function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

-- ── Write helper ──────────────────────────────────────────────────────────
-- Records a change by the signed-in user. Refuses anyone without an active profile,
-- so the actor is always a real, current person.
create function public.write_audit(
  p_action text,
  p_entity text,
  p_entity_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if public.current_app_role() is null then
    raise exception 'No active profile' using errcode = '42501';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.write_audit(text, text, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.write_audit(text, text, uuid, jsonb, jsonb) to authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.audit_log enable row level security;

-- Who else may read it is decided with the Audit log screen (S15).
create policy audit_log_select_admin on public.audit_log
  for select to authenticated using ((select public.current_app_role()) = 'admin');

revoke all on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;
revoke update, delete, truncate on public.audit_log from service_role;
grant select, insert on public.audit_log to service_role;
