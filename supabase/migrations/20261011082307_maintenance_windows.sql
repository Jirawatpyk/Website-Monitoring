-- S09 (FR-10a, FR-14, D-036): maintenance windows and mute.
--
-- One table holds both kinds. A mute also keeps `sites.muted_until` / `mute_reason` / `muted_at` in
-- step (the engine and every page read the site row). People change windows only through the RPCs
-- below — each writes its audit row in the same transaction (the S01 deferral) — and a signed-in
-- session can no longer write the mute fields directly (D-012 amended).

-- btree_gist: the per-site "no overlap" exclusion constraint compares a uuid with `=`.
create extension if not exists btree_gist with schema extensions;

-- ── Table ────────────────────────────────────────────────────────────────
create table public.maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  kind text not null check (kind in ('maintenance', 'mute')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (btrim(reason) <> '' and length(reason) <= 500),
  -- Recurring windows are S14 (FR-10b); one-off only until then.
  rrule text check (rrule is null),
  created_by uuid references public.profiles (id) on delete set null,
  -- Null while a window over 24 h waits for an Admin; an Admin's own and every mute are approved on create.
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  -- Ended early (End now) — the window's real end. A cancel that ends a running window sets both.
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  end_reason text check (end_reason is null or length(end_reason) <= 500),
  cancelled_at timestamptz,
  -- The engine logs a window's start and end once each (System rows in the audit log).
  start_logged boolean not null default false,
  end_logged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ended_at is null or ended_at >= starts_at),
  -- Spec §11 / FR-14: a mute lasts at most 24 h.
  check (kind = 'maintenance' or ends_at - starts_at <= interval '24 hours'),
  -- Two windows of one kind never overlap on a site (a cancelled one no longer counts).
  constraint maintenance_windows_no_overlap exclude using gist (
    site_id with =, kind with =, tstzrange(starts_at, coalesce(ended_at, ends_at)) with &&
  ) where (cancelled_at is null)
);

comment on table public.maintenance_windows is
  'Maintenance windows and mutes (D-036). State is derived: waiting for approval, scheduled, active, ended, cancelled, not approved.';

-- The engine's "active now" read and the pages' per-site lists.
create index maintenance_windows_site_idx on public.maintenance_windows (site_id, starts_at desc);
create index maintenance_windows_open_idx on public.maintenance_windows (ends_at)
  where cancelled_at is null and ended_at is null;

create trigger maintenance_windows_set_updated_at before update on public.maintenance_windows
  for each row execute function private.set_updated_at();

alter table public.maintenance_windows enable row level security;
create policy maintenance_windows_select_staff on public.maintenance_windows
  for select to authenticated using ((select public.is_staff()));
-- No insert / update / delete policies: writes go through the RPCs (security definer).
revoke all on public.maintenance_windows from public, anon, authenticated;
grant select on public.maintenance_windows to authenticated;
grant select, insert, update on public.maintenance_windows to service_role;

-- ── Columns ──────────────────────────────────────────────────────────────
-- When the current mute started (Overview Since, D-032 lifted).
alter table public.sites add column muted_at timestamptz;
-- When the incident's first alert went out, if that was later than detection (a mute that ended
-- while the incident it silenced was still open, D-036). The ladder counts from it.
alter table public.incidents add column alerted_at timestamptz;

-- ── D-012 amended: the mute fields only through the RPCs ─────────────────
-- A signed-in session's own statement runs as `authenticated`; inside a security-definer RPC the
-- current user is the function's owner. So a direct write of the mute fields is refused for everyone
-- (Admins too), while the RPCs — which write the window row and the audit row with it — may.
create or replace function private.sites_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' then
    if current_user = 'authenticated'
       and (new.muted_until, new.mute_reason, new.muted_at)
           is distinct from (old.muted_until, old.mute_reason, old.muted_at)
    then
      raise exception 'Mute and unmute from the Mute dialog'
        using errcode = '42501', hint = 'mute_via_dialog';
    end if;
    if public.current_app_role() is distinct from 'admin'
       and (to_jsonb(new) - 'muted_until' - 'mute_reason' - 'muted_at' - 'updated_at')
           is distinct from (to_jsonb(old) - 'muted_until' - 'mute_reason' - 'muted_at' - 'updated_at')
    then
      raise exception 'Only an Admin can change this site''s settings'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- …and a new site can't arrive muted (a window row and its audit row would be missing).
create function private.sites_guard_insert_mute()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and (new.muted_until is not null or new.mute_reason is not null or new.muted_at is not null) then
    raise exception 'Mute and unmute from the Mute dialog'
      using errcode = '42501', hint = 'mute_via_dialog';
  end if;
  return new;
end;
$$;

create trigger sites_guard_insert_mute before insert on public.sites
  for each row execute function private.sites_guard_insert_mute();

-- A mute-only change on a live site needs no readiness check (now with muted_at).
create or replace function private.sites_check_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'authenticated' or not new.is_active then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.is_active
     and (to_jsonb(new) - 'muted_until' - 'mute_reason' - 'muted_at' - 'updated_at')
         = (to_jsonb(old) - 'muted_until' - 'mute_reason' - 'muted_at' - 'updated_at') then
    return null;
  end if;
  perform private.site_assert_ready(new.id);
  return null;
end;
$$;

-- One audit row per changed row (S05) — except a mute-only site change made by the window RPCs or the
-- engine's expiry (they set `dxt.window_write` for their transaction and write their own row with
-- the reason, so it logs once). A script that writes the mute fields still gets its `site.update`.
-- People can't set the flag: `set_config` isn't reachable through the API.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    v_action := v_entity || '.create';
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    if (v_before - 'updated_at') = (v_after - 'updated_at') then
      return null;
    end if;
    if v_entity = 'site' and current_setting('dxt.window_write', true) = 'on'
       and (v_before - 'muted_until' - 'mute_reason' - 'muted_at' - 'updated_at')
           = (v_after - 'muted_until' - 'mute_reason' - 'muted_at' - 'updated_at') then
      return null;
    end if;
    v_action := v_entity || '.update';
  else
    v_before := to_jsonb(old);
    v_action := v_entity || '.delete';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (
    (select p.id from public.profiles p where p.id = auth.uid()),
    v_action, v_entity, coalesce(v_after ->> 'id', v_before ->> 'id')::uuid, v_before, v_after
  );
  return null;
end;
$$;

-- ── Helpers ──────────────────────────────────────────────────────────────
-- Who may mute or set maintenance on a site: the Acknowledge rule (PRD §3, D-012) — an Admin on any
-- site, a Responder on sites they own or back up.
create function private.can_pause(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_ack(p_site_id);
$$;

-- The reason every change needs (spec §15.1: required before submit), trimmed; 22023 with a hint.
create function private.require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v is null then
    raise exception 'Type a reason — it goes in the audit log with the change'
      using errcode = '22023', hint = 'reason_required';
  end if;
  if length(v) > 500 then
    raise exception 'The reason is too long (500 characters at most)'
      using errcode = '22023', hint = 'reason_too_long';
  end if;
  return v;
end;
$$;

-- A window's state at a moment (D-036): the same words as `windowState` in @dxt/engine.
create function public.window_state(w public.maintenance_windows, p_at timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when w.cancelled_at is not null then 'cancelled'
    when w.approved_at is null and p_at < w.starts_at then 'waiting'
    when w.approved_at is null then 'not_approved'
    when p_at < w.starts_at then 'scheduled'
    when p_at < coalesce(w.ended_at, w.ends_at) then 'active'
    else 'ended'
  end;
$$;

-- §14.5: the site is DOWN now or has an open incident (any state before Resolved).
create function private.site_busy(p_site_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 'INC-' || lpad(i.number::text, 4, '0') from public.incidents i
      where i.site_id = p_site_id and i.state not in ('resolved', 'in_review', 'closed') limit 1),
    (select 'down' from public.site_status st where st.site_id = p_site_id and st.status = 'down'));
$$;

-- How long maintenance runs back to back on a site if [p_start, p_end) is added (or an existing window
-- is changed to it): its own length plus every live window that overlaps or sits within an hour of it,
-- so chaining 24 h windows end to end still needs an Admin (security review M1).
create function private.chained_minutes(p_site_id uuid, p_start timestamptz, p_end timestamptz, p_except uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select extract(epoch from (greatest(p_end, max(coalesce(w.ended_at, w.ends_at)))
                             - least(p_start, min(w.starts_at)))) / 60
  from (select p_start as starts_at, p_end as ends_at, null::timestamptz as ended_at
        union all
        select w.starts_at, w.ends_at, w.ended_at from public.maintenance_windows w
        where w.site_id = p_site_id and w.kind = 'maintenance' and w.cancelled_at is null
          and w.id is distinct from p_except
          and tstzrange(w.starts_at, coalesce(w.ended_at, w.ends_at))
              && tstzrange(p_start - interval '1 hour', p_end + interval '1 hour')) w;
$$;

-- ── RPCs (signed-in people) ──────────────────────────────────────────────
-- Schedule a maintenance window, or start one now. Refusals: 42501 (role), 22023 + hint.
create function public.create_maintenance(
  p_site_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_reason text;
  v_start timestamptz;
  v_admin boolean := coalesce(public.current_app_role() = 'admin', false);
  v_busy text;
  v_id uuid;
  v_auto boolean;
begin
  if not exists (select 1 from public.sites where id = p_site_id) then
    raise exception 'site not found' using errcode = 'P0002';
  end if;
  if not private.can_pause(p_site_id) then
    raise exception 'This role can''t set maintenance on this site' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  -- "Now" from the dialog is a moment ago by the time it lands: up to 5 min late counts as now.
  if p_starts_at is null or p_starts_at < v_now - interval '5 minutes' then
    raise exception 'The start is in the past — pick Now or a later time'
      using errcode = '22023', hint = 'starts_in_past';
  end if;
  v_start := greatest(p_starts_at, v_now);
  if p_ends_at is null or p_ends_at <= v_start then
    raise exception 'The end must be after the start' using errcode = '22023', hint = 'ends_before_start';
  end if;
  if p_ends_at - v_start > interval '31 days' then
    raise exception 'A window lasts at most 31 days' using errcode = '22023', hint = 'too_long';
  end if;
  -- §14.5: never start now (or overlap now) on a site that is DOWN or has an open incident.
  if v_start <= v_now then
    v_busy := private.site_busy(p_site_id);
    if v_busy is not null then
      raise exception 'A window started now won''t hide this incident — mute instead, or schedule it for later'
        using errcode = '22023', hint = 'maintenance_open_incident', detail = v_busy;
    end if;
  end if;

  -- Over 24 h (back to back with its neighbours) waits for an Admin; an Admin approves their own (§14.5).
  v_auto := v_admin or private.chained_minutes(p_site_id, v_start, p_ends_at, null) <= 24 * 60;
  begin
    insert into public.maintenance_windows
      (site_id, kind, starts_at, ends_at, reason, created_by, approved_by, approved_at)
    values (p_site_id, 'maintenance', v_start, p_ends_at, v_reason, auth.uid(),
            case when v_auto then auth.uid() end, case when v_auto then v_now end)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Another maintenance window on this site overlaps that time'
      using errcode = '22023', hint = 'overlap';
  end;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  select auth.uid(), 'maintenance.create', 'maintenance_window', v_id,
         jsonb_build_object('site_id', w.site_id, 'starts_at', w.starts_at, 'ends_at', w.ends_at,
                            'reason', w.reason, 'approved', w.approved_at is not null)
  from public.maintenance_windows w where w.id = v_id;
  return v_id;
end;
$$;

-- Mute a site now until p_ends_at (at most 24 h, spec §11). One mute at a time: change it with
-- edit_window_end. A mute stops new alerts only (§15.1) — the engine reads `sites.muted_until`.
create function public.mute_site(p_site_id uuid, p_ends_at timestamptz, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_reason text;
  v_site public.sites%rowtype;
  v_id uuid;
begin
  select * into v_site from public.sites where id = p_site_id for update;
  if not found then
    raise exception 'site not found' using errcode = 'P0002';
  end if;
  if not private.can_pause(p_site_id) then
    raise exception 'This role can''t mute this site' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  if p_ends_at is null or p_ends_at <= v_now then
    raise exception 'The end must be after now' using errcode = '22023', hint = 'ends_before_start';
  end if;
  -- A minute of slack for the time the request took.
  if p_ends_at - v_now > interval '24 hours 1 minute' then
    raise exception 'A mute lasts at most 24 h — schedule maintenance for longer'
      using errcode = '22023', hint = 'mute_too_long';
  end if;
  if exists (select 1 from public.maintenance_windows w
             where w.site_id = p_site_id and w.kind = 'mute' and public.window_state(w, v_now) = 'active') then
    raise exception 'This site is already muted — end or edit that mute'
      using errcode = '22023', hint = 'already_muted';
  end if;

  insert into public.maintenance_windows
    (site_id, kind, starts_at, ends_at, reason, created_by, approved_by, approved_at, start_logged)
  values (p_site_id, 'mute', v_now, least(p_ends_at, v_now + interval '24 hours'), v_reason,
          auth.uid(), auth.uid(), v_now, true)
  returning id into v_id;

  perform set_config('dxt.window_write', 'on', true);
  update public.sites
    set muted_until = least(p_ends_at, v_now + interval '24 hours'), mute_reason = v_reason, muted_at = v_now
    where id = p_site_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'site.mute', 'site', p_site_id,
          jsonb_build_object('muted_until', case when v_site.muted_until > v_now then v_site.muted_until end),
          jsonb_build_object('muted_until', least(p_ends_at, v_now + interval '24 hours'),
                             'reason', v_reason, 'window_id', v_id));
  return v_id;
end;
$$;

-- Clears the site row's mute when the mute it mirrors ends (the RPCs below, and the engine on expiry).
create function private.clear_site_mute(p_site_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select set_config('dxt.window_write', 'on', true);
  update public.sites set muted_until = null, mute_reason = null, muted_at = null
  where id = p_site_id and muted_until is not null;
$$;

-- End a running window or mute now (Overview "End now"): a reason, a confirm in the UI, one audit row.
create function public.end_window_early(p_window_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_reason text;
  w public.maintenance_windows%rowtype;
begin
  select * into w from public.maintenance_windows where id = p_window_id for update;
  if not found then
    raise exception 'window not found' using errcode = 'P0002';
  end if;
  if not private.can_pause(w.site_id) then
    raise exception 'This role can''t change this site''s windows' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  if public.window_state(w, v_now) <> 'active' then
    raise exception 'It isn''t running — cancel it instead' using errcode = '22023', hint = 'not_active';
  end if;

  update public.maintenance_windows
    set ended_at = v_now, ended_by = auth.uid(), end_reason = v_reason
    where id = p_window_id;
  if w.kind = 'mute' then
    perform private.clear_site_mute(w.site_id);
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case w.kind when 'mute' then 'site.unmute' else 'maintenance.end' end,
          case w.kind when 'mute' then 'site' else 'maintenance_window' end,
          case w.kind when 'mute' then w.site_id else w.id end,
          jsonb_build_object('ends_at', w.ends_at),
          jsonb_build_object('ended_at', v_now, 'reason', v_reason, 'window_id', w.id));
end;
$$;

-- Move a window's or mute's end (Overview "Edit / cancel" → Save end time).
create function public.edit_window_end(p_window_id uuid, p_ends_at timestamptz, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_reason text;
  v_state text;
  v_admin boolean := coalesce(public.current_app_role() = 'admin', false);
  v_long boolean;
  v_approved boolean;
  w public.maintenance_windows%rowtype;
begin
  select * into w from public.maintenance_windows where id = p_window_id for update;
  if not found then
    raise exception 'window not found' using errcode = 'P0002';
  end if;
  if not private.can_pause(w.site_id) then
    raise exception 'This role can''t change this site''s windows' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  v_state := public.window_state(w, v_now);
  if v_state not in ('active', 'scheduled', 'waiting') then
    raise exception 'It has already ended' using errcode = '22023', hint = 'not_open';
  end if;
  if p_ends_at is null or p_ends_at <= greatest(v_now, w.starts_at) then
    raise exception 'The end must be after now and after the start'
      using errcode = '22023', hint = 'ends_before_start';
  end if;
  if p_ends_at = w.ends_at then
    raise exception 'Pick a different end time' using errcode = '22023', hint = 'unchanged';
  end if;
  if w.kind = 'mute' and p_ends_at - w.starts_at > interval '24 hours' then
    raise exception 'A mute lasts at most 24 h — schedule maintenance for longer'
      using errcode = '22023', hint = 'mute_too_long';
  end if;
  if w.kind = 'maintenance' and p_ends_at - w.starts_at > interval '31 days' then
    raise exception 'A window lasts at most 31 days' using errcode = '22023', hint = 'too_long';
  end if;
  v_long := w.kind = 'maintenance'
            and private.chained_minutes(w.site_id, w.starts_at, p_ends_at, w.id) > 24 * 60;
  -- Making a window longer than 24 h needs an Admin: before it starts it waits again; a running one
  -- can't be stretched past 24 h by a Responder.
  if v_long and not v_admin and v_state = 'active' then
    raise exception 'Over 24 h needs an Admin — ask one to extend it'
      using errcode = '22023', hint = 'needs_admin';
  end if;

  begin
    update public.maintenance_windows
      set ends_at = p_ends_at,
          approved_by = case when v_long and not v_admin then null
                             when approved_at is null and v_admin then auth.uid()
                             when approved_at is null and not v_long then auth.uid()
                             else approved_by end,
          approved_at = case when v_long and not v_admin then null
                             when approved_at is null and (v_admin or not v_long) then v_now
                             else approved_at end
      where id = p_window_id
      returning approved_at is not null into v_approved;
  exception when exclusion_violation then
    raise exception 'Another window on this site overlaps that time'
      using errcode = '22023', hint = 'overlap';
  end;
  if w.kind = 'mute' and v_state = 'active' then
    perform set_config('dxt.window_write', 'on', true);
    update public.sites set muted_until = p_ends_at where id = w.site_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case w.kind when 'mute' then 'site.mute.edit' else 'maintenance.edit' end,
          case w.kind when 'mute' then 'site' else 'maintenance_window' end,
          case w.kind when 'mute' then w.site_id else w.id end,
          jsonb_build_object('ends_at', w.ends_at, 'approved', w.approved_at is not null),
          jsonb_build_object('ends_at', p_ends_at, 'approved', v_approved, 'reason', v_reason,
                             'window_id', w.id));
end;
$$;

-- Cancel a window or mute (Overview "Edit / cancel" → Cancel …). A running one ends now and is marked
-- Cancelled — the time it already ran stays excluded from uptime (Main board); a scheduled or waiting
-- one never happens. An Admin declining a request uses this too.
create function public.cancel_window(p_window_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_reason text;
  v_state text;
  w public.maintenance_windows%rowtype;
begin
  select * into w from public.maintenance_windows where id = p_window_id for update;
  if not found then
    raise exception 'window not found' using errcode = 'P0002';
  end if;
  if not private.can_pause(w.site_id) then
    raise exception 'This role can''t change this site''s windows' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  v_state := public.window_state(w, v_now);
  if v_state not in ('active', 'scheduled', 'waiting') then
    raise exception 'It has already ended' using errcode = '22023', hint = 'not_open';
  end if;

  update public.maintenance_windows
    set cancelled_at = v_now, end_reason = v_reason, ended_by = auth.uid(),
        ended_at = case when v_state = 'active' then v_now end
    where id = p_window_id;
  if w.kind = 'mute' and v_state = 'active' then
    perform private.clear_site_mute(w.site_id);
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case w.kind when 'mute' then 'site.mute.cancel' else 'maintenance.cancel' end,
          case w.kind when 'mute' then 'site' else 'maintenance_window' end,
          case w.kind when 'mute' then w.site_id else w.id end,
          jsonb_build_object('state', v_state, 'ends_at', w.ends_at),
          jsonb_build_object('state', 'cancelled', 'reason', v_reason, 'window_id', w.id));
end;
$$;

-- Approve a window over 24 h that a Responder asked for (Admin only, before it starts, §14.5).
create function public.approve_maintenance(p_window_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  w public.maintenance_windows%rowtype;
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception 'Only an Admin can approve maintenance' using errcode = '42501';
  end if;
  select * into w from public.maintenance_windows where id = p_window_id for update;
  if not found then
    raise exception 'window not found' using errcode = 'P0002';
  end if;
  if public.window_state(w, v_now) <> 'waiting' then
    raise exception 'It isn''t waiting for approval' using errcode = '22023', hint = 'not_waiting';
  end if;
  update public.maintenance_windows set approved_by = auth.uid(), approved_at = v_now
    where id = p_window_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.approve', 'maintenance_window', w.id,
          jsonb_build_object('approved', false),
          jsonb_build_object('approved', true, 'starts_at', w.starts_at, 'ends_at', w.ends_at));
end;
$$;

revoke execute on function
  public.create_maintenance(uuid, timestamptz, timestamptz, text),
  public.mute_site(uuid, timestamptz, text),
  public.end_window_early(uuid, text),
  public.edit_window_end(uuid, timestamptz, text),
  public.cancel_window(uuid, text),
  public.approve_maintenance(uuid)
  from public, anon;
grant execute on function
  public.create_maintenance(uuid, timestamptz, timestamptz, text),
  public.mute_site(uuid, timestamptz, text),
  public.end_window_early(uuid, text),
  public.edit_window_end(uuid, timestamptz, text),
  public.cancel_window(uuid, text),
  public.approve_maintenance(uuid)
  to authenticated;
revoke execute on function public.window_state(public.maintenance_windows, timestamptz) from public, anon;
grant execute on function public.window_state(public.maintenance_windows, timestamptz)
  to authenticated, service_role;
revoke execute on function private.can_pause(uuid), private.require_reason(text),
  private.site_busy(uuid), private.clear_site_mute(uuid),
  private.chained_minutes(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

-- ── Engine (service role) ────────────────────────────────────────────────
-- Logs each window's start and end once (System rows, AuditLog board) and clears the site row of a
-- mute that ran out. Returns nothing; called once per engine run.
create function public.engine_log_windows(p_now timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
begin
  with started as (
    update public.maintenance_windows w set start_logged = true
    where w.kind = 'maintenance' and not w.start_logged and w.cancelled_at is null
      and w.approved_at is not null and w.starts_at <= p_now
    returning w.*
  )
  insert into public.audit_log (action, entity, entity_id, before, after)
  select 'maintenance.start', 'maintenance_window', s.id, jsonb_build_object('state', 'scheduled'),
         jsonb_build_object('state', 'active', 'site_id', s.site_id, 'ends_at', s.ends_at)
  from started s;

  with ended as (
    update public.maintenance_windows w set end_logged = true
    where not w.end_logged and w.start_logged and w.cancelled_at is null and w.ended_at is null
      and w.ends_at <= p_now
    returning w.*
  )
  insert into public.audit_log (action, entity, entity_id, before, after)
  select case e.kind when 'mute' then 'site.mute.expire' else 'maintenance.finish' end,
         case e.kind when 'mute' then 'site' else 'maintenance_window' end,
         case e.kind when 'mute' then e.site_id else e.id end,
         jsonb_build_object('state', 'active'),
         jsonb_build_object('state', 'ended', 'ended_at', e.ends_at, 'window_id', e.id)
  from ended e;

  -- A mute that ran out leaves the site row (readers already compare with now()).
  perform set_config('dxt.window_write', 'on', true);
  update public.sites s set muted_until = null, mute_reason = null, muted_at = null
  where s.muted_until is not null and s.muted_until <= p_now;
end;
$$;

-- Open incidents whose first alert never went out (opened while muted) on sites no longer muted.
-- The runner posts them with engine_post_late_alert (D-036).
create function public.engine_silent_incidents(p_now timestamptz)
returns table (incident_id uuid, site_id uuid, tier smallint, severity public.severity, detected_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select i.id, i.site_id, s.tier, i.severity, i.detected_at
  from public.incidents i
  join public.sites s on s.id = i.site_id
  where i.state in ('unacked', 'escalated')
    and s.is_active
    and (s.muted_until is null or s.muted_until <= p_now)
    and not exists (
      select 1 from public.notifications n
      where n.incident_id = i.id and n.channel = 'google_chat'
        and n.template in ('down', 'problem', 'down_again', 'problem_again')
        and (n.status <> 'cancelled' or n.attempts > 0));
$$;

-- Posts the first alert of an incident a mute silenced: the card for its current severity and the
-- owner email (as engine_open_incident does), and stamps `alerted_at` — the ladder counts from it.
-- A PROBLEM outside Tier 2–3 response hours waits for p_hold_until, like any PROBLEM card.
create function public.engine_post_late_alert(p_incident_id uuid, p_at timestamptz, p_hold_until timestamptz default null)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_context jsonb;
  v_hold timestamptz;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.state not in ('unacked', 'escalated') then
    return false;
  end if;
  if exists (select 1 from public.sites s where s.id = v_inc.site_id and s.muted_until > p_at) then
    return false;
  end if;
  if exists (select 1 from public.notifications n
             where n.incident_id = p_incident_id and n.channel = 'google_chat'
               and n.template in ('down', 'problem', 'down_again', 'problem_again')
               and (n.status <> 'cancelled' or n.attempts > 0)) then
    return false;
  end if;

  -- The facts of the drop it alerts about: its latest detection event's payload.
  select e.payload into v_context from public.incident_events e
  where e.incident_id = p_incident_id and e.type in ('detected', 'relapsed', 'escalated_to_down')
  order by e.at desc limit 1;
  v_context := coalesce(v_context, '{}'::jsonb) || jsonb_build_object('afterMute', true);
  v_hold := case when v_inc.severity = 'problem' and p_hold_until > p_at then p_hold_until end;

  insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
  values (p_incident_id, 'google_chat', v_inc.severity::text, p_incident_id::text, v_context, v_hold);
  insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, hold_until)
  select p_incident_id, s.primary_owner_id, 'email', v_inc.severity::text, p_incident_id::text, v_context, v_hold
  from public.sites s
  join public.profiles p on p.id = s.primary_owner_id and p.is_active
  where s.id = v_inc.site_id;

  update public.incidents set alerted_at = p_at where id = p_incident_id;
  return true;
end;
$$;

revoke execute on function
  public.engine_log_windows(timestamptz),
  public.engine_silent_incidents(timestamptz),
  public.engine_post_late_alert(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.engine_log_windows(timestamptz),
  public.engine_silent_incidents(timestamptz),
  public.engine_post_late_alert(uuid, timestamptz, timestamptz)
  to service_role;
