set local lock_timeout = '5s';

-- D-078 (spec §43): Management is a tag on Admins, not a role. PR 2 of 3: the tag, who may carry it,
-- the audited function that sets it and the person's email. The ladder token `management` and the
-- Admins-minus-Management rule come in the next PR; until then the tag changes nobody's alerts.

-- ── The tag ──────────────────────────────────────────────────────────────────────────────────────
-- Catalog-only on Postgres 11+ (a non-volatile default), so no table rewrite.
alter table public.profiles add column is_management boolean not null default false;
-- Only an active Admin carries it (a role change away from Admin, or a deactivation, clears it first:
-- profiles_management_follows below).
alter table public.profiles add constraint profiles_management_admin
  check (not is_management or (role = 'admin' and is_active));

-- ── The account email for it (§34's mechanism) ────────────────────────────────────────────────────
alter table public.account_events drop constraint account_events_kind_check;
alter table public.account_events add constraint account_events_kind_check
  check (kind in ('role_changed', 'deactivated', 'management_set', 'management_removed'));

-- ── A role change away from Admin, or a deactivation, takes the tag with it ──────────────────────
-- A trigger, so every writer is covered (change_user_role, deactivate_user, a script). Its own audit
-- row says why; the role change's email already tells the person.
create function private.management_follows_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_management and (new.role <> 'admin' or not new.is_active) then
    new.is_management := false;
    insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
    values (auth.uid(), 'user.management', 'user', new.id, jsonb_build_object('management', true),
            jsonb_build_object('management', false,
              'reason', case when not new.is_active then 'deactivated' else 'role changed' end));
  end if;
  return new;
end;
$$;
revoke execute on function private.management_follows_role() from public, anon, authenticated;

create trigger profiles_management_follows
  before update of role, is_active on public.profiles
  for each row execute function private.management_follows_role();

-- ── set_management: the Users page's "Set as Management…" / "Remove from Management…" ─────────────
create function public.set_management(p_user_id uuid, p_on boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  -- one change to people at a time (S16 review M1); no on-call row is touched
  perform private.lock_people('Only an Admin can set who is Management', false);
  if p_on is null then
    raise exception 'Say whether to set or remove' using errcode = '22023';
  end if;
  if v_note is null then
    raise exception 'Add a short note — it goes in the audit log' using errcode = '22023', hint = 'note_required';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = '22023', hint = 'note_too_long';
  end if;
  select * into v from public.profiles where id = p_user_id for update;
  if not found or not v.is_active then
    raise exception 'That person doesn''t have access any more' using errcode = 'P0002';
  end if;
  if v.is_management = p_on then
    return;
  end if;
  if p_on and v.role <> 'admin' then
    raise exception 'Only Admins can be Management' using errcode = '55000', hint = 'not_admin';
  end if;
  if p_on and nullif(btrim(v.google_chat_user_id), '') is null then
    raise exception 'Add a Google Chat id first — Management is @mentioned'
      using errcode = '55000', hint = 'needs_chat';
  end if;

  update public.profiles set is_management = p_on where id = p_user_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'user.management', 'user', p_user_id, jsonb_build_object('management', not p_on),
          jsonb_build_object('management', p_on, 'note', v_note));

  -- One email, to the person only (§34, D-078 item 3c).
  insert into public.account_events (kind, user_id, actor_id, from_role, to_role, facts)
  values (case when p_on then 'management_set' else 'management_removed' end, v.id, auth.uid(), v.role, v.role,
          jsonb_build_object('actor', (select a.display_name from public.profiles a where a.id = auth.uid()),
            'others', (select coalesce(jsonb_agg(m.display_name order by m.display_name), '[]'::jsonb)
                       from public.profiles m
                       where m.is_management and m.is_active and m.id <> v.id)))
  returning id into v_id;
  insert into public.notifications (account_event_id, channel, template, user_id, thread_key)
  values (v_id, 'email', 'account_email', v.id, 'account-' || v_id);
end;
$$;
revoke execute on function public.set_management(uuid, boolean, text) from public, anon;
grant execute on function public.set_management(uuid, boolean, text) to authenticated;

-- ── A Management person's Chat id can't be cleared (they are @mentioned) ─────────────────────────
-- Body as 20261114041445_s16_users_access.sql, plus that refusal.
create or replace function public.set_chat_user_id(p_user_id uuid, p_chat_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
  v_id text := nullif(btrim(coalesce(p_chat_id, '')), '');
  v_old text;
  v_sites text;
begin
  if not public.is_staff() or not private.session_alive() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_user_id is distinct from auth.uid() and public.current_app_role() <> 'admin' then
    raise exception 'Only an Admin can change someone else''s Chat id' using errcode = '42501';
  end if;
  if v_id is not null and (v_id !~ '^[0-9]+$' or length(v_id) > 40) then
    raise exception 'A Chat user id is digits only' using errcode = '22023', hint = 'chat_id_digits';
  end if;
  select * into v from public.profiles where id = p_user_id for update;
  if not found or not v.is_active then
    raise exception 'That person doesn''t have access any more' using errcode = 'P0002';
  end if;
  v_old := nullif(btrim(v.google_chat_user_id), '');
  if v_old is not distinct from v_id then
    return;
  end if;
  if v_id is null then
    select string_agg(s.name, ', ' order by s.name) into v_sites from public.sites s
      where s.is_active and p_user_id in (s.primary_owner_id, s.backup_owner_id);
    if v_sites is not null then
      raise exception 'Owners of live sites need a Chat id: %', v_sites
        using errcode = '55000', hint = 'owner_needs_chat', detail = v_sites;
    end if;
    if v.is_management then
      raise exception 'Management is @mentioned — remove them from Management first'
        using errcode = '55000', hint = 'management_needs_chat';
    end if;
  end if;
  -- An @mention reaches one person (security review L2). Checked here, not by a unique index: the
  -- staging fixture people share Tao's Chat id on purpose (D-035), set by SQL.
  if v_id is not null then
    perform pg_advisory_xact_lock(hashtext('chat_id:' || v_id));
  end if;
  if v_id is not null and exists (select 1 from public.profiles p
                                  where p.google_chat_user_id = v_id and p.id <> p_user_id and p.is_active) then
    raise exception 'That Chat id belongs to someone else' using errcode = '23505', hint = 'chat_id_taken';
  end if;
  update public.profiles set google_chat_user_id = v_id where id = p_user_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'profile.chat_id', 'user', p_user_id, jsonb_build_object(
    'change', case when v_old is null then 'set' when v_id is null then 'cleared' else 'changed' end));
end;
$$;
