-- S16 Users & access (D-062, spec §14.9). Everything that changes who may do what goes through one
-- audited function, so the Access category of /audit records it and nothing writes `profiles` behind
-- the log (signed-in UPDATE on `profiles` stays revoked, S15 / D-061 item 6).
--   · invite_user / revoke_invite        — the allowlist row is the invite (D-007, D-011); inviting a
--                                          deactivated address gives their access back.
--   · change_user_role / deactivate_user — reassign every place the person is used first; never
--                                          the last active Admin; deactivate also deletes the
--                                          allowlist row, bans the auth user and ends their sessions.
--   · set_chat_user_id                   — the person or an Admin (D-015).
--   · list_sessions / sign_out_*         — devices and "Sign out everywhere": sessions are deleted
--                                          (their refresh tokens go with them).
--   · my_access()                        — a token whose session is gone reads 'ended', so the app
--                                          refuses it at once (a direct API call: until it expires).
--   · hook_before_user_created           — a refused sign-in writes `signin.refused`.
-- What the log keeps about people (D-062 item 7): company addresses and roles, never Chat id digits;
-- a refused address off the company domains keeps its domain only.

set local lock_timeout = '5s';

-- ── Shared guards ─────────────────────────────────────────────────────────
create function private.require_admin(p_message text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception '%', p_message using errcode = '42501';
  end if;
end;
$$;
revoke execute on function private.require_admin(text) from public, anon, authenticated;

-- The roles a person can be invited as or changed to (client is Phase 3).
create function private.staff_role(p_role public.app_role)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_role is null or p_role not in ('admin', 'responder', 'stakeholder', 'viewer') then
    raise exception 'Pick Admin, Responder, Stakeholder or Viewer' using errcode = '22023', hint = 'bad_role';
  end if;
end;
$$;
revoke execute on function private.staff_role(public.app_role) from public, anon, authenticated;

-- ── Invite (= an allowlist row) ───────────────────────────────────────────
create function public.invite_user(p_email text, p_role public.app_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_profile public.profiles%rowtype;
begin
  perform private.require_admin('Only an Admin can invite people');
  perform private.staff_role(p_role);
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'Enter their primary Google address, e.g. name@company' using errcode = '22023', hint = 'bad_email';
  end if;
  if not exists (select 1 from private.allowed_email_domains d where d.domain = split_part(v_email, '@', 2)) then
    raise exception 'Only addresses on the company''s Google Workspace domain can sign in'
      using errcode = '22023', hint = 'bad_domain';
  end if;

  select * into v_profile from public.profiles where email = v_email for update;
  if found and v_profile.is_active then
    raise exception '% already has access', v_profile.display_name using errcode = '23505', hint = 'already_member';
  end if;

  if found then
    -- Deactivated before: the same account comes back with the role picked now.
    insert into private.allowed_emails (email, role) values (v_email, p_role)
      on conflict (email) do update set role = excluded.role;
    update public.profiles set role = p_role, is_active = true where id = v_profile.id;
    update auth.users set banned_until = null where id = v_profile.id;
    insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
    values (auth.uid(), 'user.reactivate', 'user', v_profile.id,
            jsonb_build_object('role', v_profile.role, 'active', false),
            jsonb_build_object('email', v_email, 'role', p_role, 'active', true));
    return 'reactivated';
  end if;

  if exists (select 1 from private.allowed_emails a where a.email = v_email) then
    raise exception 'That address is already invited — revoke it first to pick another role'
      using errcode = '23505', hint = 'already_invited';
  end if;
  insert into private.allowed_emails (email, role) values (v_email, p_role);
  insert into public.audit_log (actor_id, action, entity, after)
  values (auth.uid(), 'user.invite', 'user', jsonb_build_object('email', v_email, 'role', p_role));
  return 'invited';
end;
$$;

-- An invite nobody has signed in with yet. After a first sign-in it's a person: deactivate instead.
create function public.revoke_invite(p_email text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_reason text := private.oncall_note(p_reason);
  v_role public.app_role;
begin
  perform private.require_admin('Only an Admin can revoke an invite');
  if v_reason is null then
    raise exception 'Add a short reason — it goes in the audit log' using errcode = '22023', hint = 'reason_required';
  end if;
  if exists (select 1 from public.profiles p where p.email = v_email) then
    raise exception 'They have signed in already — deactivate them instead' using errcode = '55000', hint = 'not_pending';
  end if;
  delete from private.allowed_emails where email = v_email returning role into v_role;
  if not found then
    raise exception 'That invite doesn''t exist any more' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor_id, action, entity, before, after)
  values (auth.uid(), 'user.invite_revoke', 'user', jsonb_build_object('email', v_email, 'role', v_role),
          jsonb_build_object('reason', v_reason));
end;
$$;

-- ── Where a person is used (§14.9 "Used in") ──────────────────────────────
-- What still needs a new person before `p_user` can become `p_role` (null = deactivated): one text
-- per place, '<kind>:<id>' — owner / backup of a site, AM of a client, a shift not over. The rotation
-- and open swaps need no pick (the person leaves the rotation, the swap closes). The Users dialog
-- reads the same places (features/settings `usageOf`).
create function private.user_usage_problems(p_user uuid, p_role public.app_role)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x.k order by x.k), '{}')
  from (
    select 'owner:' || s.id as k from public.sites s
      where s.primary_owner_id = p_user and (p_role is null or p_role not in ('admin', 'responder'))
    union all
    select 'backup:' || s.id from public.sites s
      where s.backup_owner_id = p_user and (p_role is null or p_role not in ('admin', 'responder'))
    union all
    select 'am:' || c.id from public.clients c
      where c.am_user_id = p_user and (p_role is null or p_role not in ('admin', 'responder', 'stakeholder'))
    union all
    select 'shift:' || sh.id from public.oncall_shifts sh
      where sh.user_id = p_user and sh.ends_at > now() and (p_role is null or p_role not in ('admin', 'responder'))
  ) x;
$$;
revoke execute on function private.user_usage_problems(uuid, public.app_role) from public, anon, authenticated;

-- Apply the dialog's picks: `{"owners": {site: person}, "backups": {site: person}, "am": person,
-- "shifts": person}`. Owners and backups are checked by `sites_require_linked_owners` (active Admin /
-- Responder with a Chat id) and a live site by the deferred ready check; shifts by the hand-over.
-- Only the places that need it (`p_role` as in user_usage_problems) are touched.
create function private.user_reassign(p_user uuid, p_role public.app_role, p_reassign jsonb, p_why text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pick jsonb := coalesce(p_reassign, '{}'::jsonb);
  v_needs_owner boolean := p_role is null or p_role not in ('admin', 'responder');
  v_needs_am boolean := p_role is null or p_role not in ('admin', 'responder', 'stakeholder');
  v_site record;
  v_to uuid;
  v_shift record;
  v_swap record;
  v_before jsonb;
begin
  if v_needs_owner then
    for v_site in select s.id from public.sites s where s.primary_owner_id = p_user order by s.id loop
      v_to := nullif(v_pick -> 'owners' ->> v_site.id::text, '')::uuid;
      if v_to is not null then
        update public.sites set primary_owner_id = v_to where id = v_site.id;
      end if;
    end loop;
    for v_site in select s.id from public.sites s where s.backup_owner_id = p_user order by s.id loop
      v_to := nullif(v_pick -> 'backups' ->> v_site.id::text, '')::uuid;
      if v_to is not null then
        update public.sites set backup_owner_id = v_to where id = v_site.id;
      end if;
    end loop;
  end if;

  if v_needs_am then
    v_to := nullif(v_pick ->> 'am', '')::uuid;
    if v_to is not null then
      if not exists (select 1 from public.profiles p where p.id = v_to and p.is_active and p.id <> p_user
                       and p.role in ('admin', 'responder', 'stakeholder')) then
        raise exception 'A Site AM must be an active Admin, Responder or Stakeholder'
          using errcode = '22023', hint = 'am_not_eligible';
      end if;
      update public.clients set am_user_id = v_to where am_user_id = p_user;
    end if;
  end if;

  if v_needs_owner then
    -- Open swaps can't go through any more: closed, logged and told as an Admin's decline.
    for v_swap in
      update public.oncall_swaps set status = 'admin_declined', decided_by = auth.uid(), decided_at = now(),
             decision_note = p_why
        where status in ('waiting', 'accepted') and p_user in (requester_id, counterpart_id)
        returning id, requester_shift_id
    loop
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (auth.uid(), 'oncall.swap_admin_decline', 'oncall_swap', v_swap.id,
              jsonb_build_object('status', 'admin_declined', 'note', p_why));
      perform private.oncall_event('swap_admin_declined', null, v_swap.id, v_swap.requester_shift_id);
    end loop;

    -- The live shift and the weeks ahead go to the person picked, through the S10 hand-over.
    v_to := nullif(v_pick ->> 'shifts', '')::uuid;
    if v_to is not null then
      for v_shift in
        select sh.id from public.oncall_shifts sh where sh.user_id = p_user and sh.ends_at > now()
        order by sh.starts_at
      loop
        perform public.hand_over_oncall_shift(v_shift.id, v_to, now(), p_why);
      end loop;
    end if;

    -- Out of the rotation; the others keep their order.
    if exists (select 1 from public.oncall_rotation r where r.user_id = p_user) then
      perform pg_advisory_xact_lock(hashtext('oncall_extend_shifts'));
      select coalesce(jsonb_agg(user_id order by position), '[]'::jsonb) into v_before from public.oncall_rotation;
      delete from public.oncall_rotation where user_id = p_user;
      -- Two steps: `position` is unique and checked row by row.
      update public.oncall_rotation set position = position + 1000 where true;
      update public.oncall_rotation r set position = o.n
        from (select id, row_number() over (order by position) as n from public.oncall_rotation) o
        where r.id = o.id;
      insert into public.audit_log (actor_id, action, entity, before, after)
      values (auth.uid(), 'oncall.rotation', 'oncall_rotation', jsonb_build_object('order', v_before),
              jsonb_build_object('order', (select coalesce(jsonb_agg(user_id order by position), '[]'::jsonb)
                                           from public.oncall_rotation), 'note', p_why));
      perform private.oncall_event('rotation_changed', null, null, null, jsonb_build_object(
        'order', (select coalesce(jsonb_agg(user_id order by position), '[]'::jsonb) from public.oncall_rotation),
        'removed', jsonb_build_array(p_user)));
    end if;
  end if;
end;
$$;
revoke execute on function private.user_reassign(uuid, public.app_role, jsonb, text) from public, anon, authenticated;

-- The person, locked, for a role change or deactivation; refuses yourself and a missing person.
create function private.user_for_change(p_user uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  if p_user = auth.uid() then
    raise exception 'You can''t change your own access — ask another Admin' using errcode = '22023', hint = 'self';
  end if;
  select * into v from public.profiles where id = p_user for update;
  if not found or not v.is_active then
    raise exception 'That person doesn''t have access any more' using errcode = 'P0002';
  end if;
  return v;
end;
$$;
revoke execute on function private.user_for_change(uuid) from public, anon, authenticated;

-- Refuses while a place still needs a new person (detail = the places), and the last active Admin.
create function private.assert_user_free(p_user public.profiles, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left text[] := private.user_usage_problems(p_user.id, p_role);
begin
  if p_user.role = 'admin' and p_role is distinct from 'admin'
     and not exists (select 1 from public.profiles a
                     where a.role = 'admin' and a.is_active and a.id <> p_user.id) then
    raise exception 'They are the only active Admin — invite another Admin first'
      using errcode = '55000', hint = 'last_admin';
  end if;
  if cardinality(v_left) > 0 then
    raise exception 'Pick who takes over each place first' using errcode = '55000', hint = 'needs_reassign',
      detail = array_to_string(v_left, ',');
  end if;
end;
$$;
revoke execute on function private.assert_user_free(public.profiles, public.app_role) from public, anon, authenticated;

create function public.change_user_role(p_user_id uuid, p_role public.app_role, p_reassign jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  perform private.require_admin('Only an Admin can change roles');
  perform private.staff_role(p_role);
  v := private.user_for_change(p_user_id);
  if v.role = p_role then
    raise exception 'They are % already', p_role using errcode = '22023', hint = 'same_role';
  end if;
  perform private.user_reassign(v.id, p_role, p_reassign,
                                format('%s is now %s', v.display_name, initcap(p_role::text)));
  perform private.assert_user_free(v, p_role);
  update public.profiles set role = p_role where id = v.id;
  update private.allowed_emails set role = p_role where email = v.email;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'user.role_change', 'user', v.id, jsonb_build_object('role', v.role),
          jsonb_build_object('role', p_role));
end;
$$;

create function public.deactivate_user(p_user_id uuid, p_reassign jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
  v_sessions integer;
begin
  perform private.require_admin('Only an Admin can deactivate people');
  v := private.user_for_change(p_user_id);
  perform private.user_reassign(v.id, null, p_reassign, format('%s was deactivated', v.display_name));
  perform private.assert_user_free(v, null);
  update public.profiles set is_active = false where id = v.id;
  delete from private.allowed_emails where email = v.email;
  -- A date, not 'infinity': Auth reads the column into a Go time, which can't hold infinity.
  update auth.users set banned_until = now() + interval '100 years' where id = v.id;
  delete from auth.sessions where user_id = v.id;
  get diagnostics v_sessions = row_count;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'user.deactivate', 'user', v.id, jsonb_build_object('role', v.role, 'active', true),
          jsonb_build_object('active', false, 'devices_signed_out', v_sessions));
end;
$$;

-- ── Google Chat user id (D-015) ───────────────────────────────────────────
create function public.set_chat_user_id(p_user_id uuid, p_chat_id text)
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
  if not public.is_staff() then
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
  end if;
  update public.profiles set google_chat_user_id = v_id where id = p_user_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'profile.chat_id', 'user', p_user_id, jsonb_build_object(
    'change', case when v_old is null then 'set' when v_id is null then 'cleared' else 'changed' end));
end;
$$;

-- ── Sessions ──────────────────────────────────────────────────────────────
-- Signed-in devices: an Admin reads anyone's (null = everyone), anyone else their own. No IP.
create function public.list_sessions(p_user_id uuid default null)
returns table (id uuid, user_id uuid, user_agent text, created_at timestamptz, last_used timestamptz,
               is_current boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.current_app_role() <> 'admin' and p_user_id is distinct from auth.uid() then
    raise exception 'Only an Admin can see someone else''s devices' using errcode = '42501';
  end if;
  return query
    select s.id, s.user_id, s.user_agent, s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
           s.id::text = (auth.jwt() ->> 'session_id')
    from auth.sessions s
    where (p_user_id is null or s.user_id = p_user_id)
      and (s.not_after is null or s.not_after > now())
    order by s.user_id, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc;
end;
$$;

-- An Admin signs another person out everywhere (Security). Role and alerts don't change.
create function public.sign_out_user_everywhere(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform private.require_admin('Only an Admin can sign someone else out');
  if p_user_id = auth.uid() then
    raise exception 'Use "Sign out other devices" for yourself' using errcode = '22023', hint = 'self';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'That person doesn''t exist' using errcode = 'P0002';
  end if;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_n = row_count;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'session.sign_out_all', 'user', p_user_id, jsonb_build_object('devices', v_n));
  return v_n;
end;
$$;

-- Every device but this one (Security own row, Profile).
create function public.sign_out_my_other_devices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_current text := auth.jwt() ->> 'session_id';
begin
  if not public.is_staff() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  delete from auth.sessions where user_id = auth.uid() and id::text is distinct from v_current;
  get diagnostics v_n = row_count;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'session.sign_out_others', 'user', auth.uid(), jsonb_build_object('devices', v_n));
  return v_n;
end;
$$;

-- One of your own other devices (Profile "Signed-in devices"). This device: the Sign out button.
create function public.sign_out_my_device(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_session_id::text = (auth.jwt() ->> 'session_id') then
    raise exception 'That''s this device — use Sign out' using errcode = '22023', hint = 'this_device';
  end if;
  delete from auth.sessions where id = p_session_id and user_id = auth.uid();
  if not found then
    raise exception 'That device is signed out already' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'session.sign_out_device', 'user', auth.uid(), jsonb_build_object('devices', 1));
end;
$$;

-- ── my_access: a signed-out session reads 'ended' (D-062 item 5) ─────────
-- The token outlives its session by up to jwt_expiry; the app refuses it at once. A token without a
-- session_id claim (tests, scripts) isn't checked.
create or replace function public.my_access()
returns table (status text, id uuid, email text, display_name text, role public.app_role)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when (select auth.jwt() ->> 'session_id') is not null
           and not exists (select 1 from auth.sessions s where s.id::text = (select auth.jwt() ->> 'session_id'))
        then 'ended'
      else coalesce(case when p.is_active then 'active' when p.id is not null then 'inactive' end, 'missing')
    end,
    case when p.is_active then p.id end,
    case when p.is_active then p.email end,
    case when p.is_active then p.display_name end,
    case when p.is_active then p.role end
  from (select 1) as one
  left join public.profiles p on p.id = auth.uid();
$$;

-- ── Refused sign-ins write `signin.refused` (D-061 item 3, D-062 item 7) ─
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
  v_domain text := split_part(v_email, '@', 2);
  v_provider text := event -> 'user' -> 'app_metadata' ->> 'provider';
begin
  if v_domain = '' or not exists (
    select 1 from private.allowed_email_domains d where d.domain = v_domain
  ) then
    insert into public.audit_log (actor_id, action, entity, after)
    values (null, 'signin.refused', 'signin', jsonb_build_object('reason', 'domain', 'domain', nullif(v_domain, '')));
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Only DxT Google accounts can sign in. Ask an Admin if you need access.'
    ));
  end if;

  if not private.is_trusted_sign_up(v_provider, v_email) then
    insert into public.audit_log (actor_id, action, entity, after)
    values (null, 'signin.refused', 'signin', jsonb_build_object('reason', 'provider', 'email', v_email));
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign in with your DxT Google account.'
    ));
  end if;

  if not exists (select 1 from private.allowed_emails a where a.email = v_email) then
    insert into public.audit_log (actor_id, action, entity, after)
    values (null, 'signin.refused', 'signin', jsonb_build_object('reason', 'not_invited', 'email', v_email));
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'You''re not on the DxT Monitor access list yet. Ask an Admin to add you.'
    ));
  end if;

  return '{}'::jsonb;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────
revoke execute on function public.invite_user(text, public.app_role) from public, anon;
revoke execute on function public.revoke_invite(text, text) from public, anon;
revoke execute on function public.change_user_role(uuid, public.app_role, jsonb) from public, anon;
revoke execute on function public.deactivate_user(uuid, jsonb) from public, anon;
revoke execute on function public.set_chat_user_id(uuid, text) from public, anon;
revoke execute on function public.list_sessions(uuid) from public, anon;
revoke execute on function public.sign_out_user_everywhere(uuid) from public, anon;
revoke execute on function public.sign_out_my_other_devices() from public, anon;
revoke execute on function public.sign_out_my_device(uuid) from public, anon;
grant execute on function public.invite_user(text, public.app_role) to authenticated;
grant execute on function public.revoke_invite(text, text) to authenticated;
grant execute on function public.change_user_role(uuid, public.app_role, jsonb) to authenticated;
grant execute on function public.deactivate_user(uuid, jsonb) to authenticated;
grant execute on function public.set_chat_user_id(uuid, text) to authenticated;
grant execute on function public.list_sessions(uuid) to authenticated;
grant execute on function public.sign_out_user_everywhere(uuid) to authenticated;
grant execute on function public.sign_out_my_other_devices() to authenticated;
grant execute on function public.sign_out_my_device(uuid) to authenticated;
-- The allowlist list for the Users page (pending invites): Admins only, through a function.
create function public.pending_invites()
returns table (email text, role public.app_role, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('Only an Admin can see the access list');
  return query
    select a.email, a.role, a.created_at from private.allowed_emails a
    where not exists (select 1 from public.profiles p where p.email = a.email)
    order by a.created_at desc;
end;
$$;
revoke execute on function public.pending_invites() from public, anon;
grant execute on function public.pending_invites() to authenticated;
