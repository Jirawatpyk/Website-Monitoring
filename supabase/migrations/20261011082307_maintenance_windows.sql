-- S09 (FR-10a, FR-14, D-036): maintenance windows and mute.
--
-- One table holds both kinds. A mute also keeps `sites.muted_until` / `mute_reason` / `muted_at` in
-- step (the engine and every page read the site row). People change windows only through the RPCs
-- below — each writes its audit row in the same transaction (the S01 deferral) — and a signed-in
-- session can no longer write the mute fields directly (D-012 amended).

set local lock_timeout = '5s';

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
  -- Why a window that never ran or was set aside ended (§23.2 Recent): withdrawn, declined, not approved
  -- in time, or didn't start because the site was DOWN (`outcome_detail` = the incident).
  outcome text check (outcome in ('withdrawn', 'declined', 'not_approved', 'didnt_start')),
  outcome_detail text,
  -- One line per action (who, when, old → new, reason); lines are never replaced (§23.5).
  log jsonb not null default '[]'::jsonb,
  -- The engine logs a window's start and end once each (System rows in the audit log); a window ended
  -- or cancelled by a person is logged by its RPC and marked logged there.
  start_logged boolean not null default false,
  end_logged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ended_at is null or (ended_at >= starts_at and ended_at <= ends_at)),
  check (ends_at - starts_at <= interval '31 days'),
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
create index maintenance_windows_open_idx on public.maintenance_windows (starts_at)
  where not end_logged and cancelled_at is null;

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

create function public.window_state(w public.maintenance_windows, p_at timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when w.outcome is not null then w.outcome
    when w.cancelled_at is not null then 'cancelled'
    when w.approved_at is null and p_at >= w.starts_at then 'not_approved'
    when w.approved_at is null then 'waiting'
    when p_at < w.starts_at then 'scheduled'
    when p_at < coalesce(w.ended_at, w.ends_at) then 'active'
    else 'ended'
  end;
$$;

-- §14.5 / §23.10 (D-036 as amended): the site is DOWN now, or has an incident that hasn't recovered
-- (Unacked, Escalated, Acknowledged). An incident waiting only for its root cause doesn't count.
create function private.site_busy(p_site_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 'INC-' || lpad(i.number::text, 4, '0') from public.incidents i
      where i.site_id = p_site_id and i.state in ('unacked', 'escalated', 'acknowledged') limit 1),
    (select 'down' from public.site_status st where st.site_id = p_site_id and st.status = 'down'));
$$;

-- Adds one line to a window's log (§23.5: every action adds a line; lines are never replaced).
create function private.window_log(p_window_id uuid, p_action text, p_reason text, p_extra jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.maintenance_windows
    set log = log || jsonb_build_array(
      jsonb_build_object('at', now(), 'action', p_action,
                         'by', (select display_name from public.profiles where id = auth.uid()))
      || case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end
      || p_extra)
    where id = p_window_id;
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

-- One maintenance window per site at a time (§23.10): refused with the window it overlaps, as
-- detail "<site>|<starts_at>|<ends_at>" for the dialog's "Overlaps WeCare Studio 09:30 → 14:00".
create function private.assert_no_overlap(p_site_id uuid, p_kind text, p_start timestamptz, p_end timestamptz, p_except uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_detail text;
begin
  select s.name || '|' || w.starts_at || '|' || coalesce(w.ended_at, w.ends_at) into v_detail
  from public.maintenance_windows w join public.sites s on s.id = w.site_id
  where w.site_id = p_site_id and w.kind = p_kind and w.cancelled_at is null and w.outcome is null
    and w.id is distinct from p_except
    and tstzrange(w.starts_at, coalesce(w.ended_at, w.ends_at)) && tstzrange(p_start, p_end)
  order by w.starts_at limit 1;
  if v_detail is not null then
    raise exception 'Another window on this site overlaps that time'
      using errcode = '22023', hint = 'overlap', detail = v_detail;
  end if;
end;
$$;

-- A new end is at least 5 min away (§23.10), checked by the API as well as the dialog.
create function private.assert_end(p_ends_at timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_ends_at is null or p_ends_at < now() + interval '5 minutes' then
    raise exception 'The end must be at least 5 min from now' using errcode = '22023', hint = 'ends_too_soon';
  end if;
end;
$$;

-- Clears the site row's mute when the mute it mirrors ends (the RPCs below, and the engine).
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

-- Ends the site's running mute because maintenance started (§23.10: the window ends the mute).
create function private.end_mute_for_maintenance(p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.maintenance_windows%rowtype;
begin
  select * into m from public.maintenance_windows w
  where w.site_id = p_site_id and w.kind = 'mute' and public.window_state(w, now()) = 'active'
  for update;
  if not found then
    return;
  end if;
  update public.maintenance_windows
    set ended_at = now(), end_reason = 'Maintenance started', start_logged = true, end_logged = true
    where id = m.id;
  perform private.window_log(m.id, 'ended_by_maintenance', null);
  perform private.clear_site_mute(p_site_id);
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values ((select id from public.profiles where id = auth.uid()), 'site.mute_end', 'site', p_site_id,
          jsonb_build_object('muted_until', m.ends_at),
          jsonb_build_object('ended_at', now(), 'reason', 'Maintenance started', 'window_id', m.id));
end;
$$;

-- ── RPCs (signed-in people) ──────────────────────────────────────────────
-- Schedule a maintenance window, start one now, or ask for one over 24 h (a Responder's waits for an
-- Admin). Refusals: 42501 (role), 22023 + hint.
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
  perform private.assert_end(p_ends_at);
  if p_ends_at <= v_start then
    raise exception 'The end must be after the start' using errcode = '22023', hint = 'ends_before_start';
  end if;
  if p_ends_at - v_start > interval '31 days' then
    raise exception 'A window lasts at most 31 days' using errcode = '22023', hint = 'too_long';
  end if;
  -- §14.5: never start now on a site that is DOWN or has an incident that hasn't recovered.
  if v_start <= v_now then
    v_busy := private.site_busy(p_site_id);
    if v_busy is not null then
      raise exception 'A window started now won''t hide this incident — mute instead, or schedule it for later'
        using errcode = '22023', hint = 'maintenance_open_incident', detail = v_busy;
    end if;
  end if;
  perform private.assert_no_overlap(p_site_id, 'maintenance', v_start, p_ends_at, null);

  -- Over 24 h (back to back with its neighbours) waits for an Admin; an Admin approves their own (§14.5).
  v_auto := v_admin or private.chained_minutes(p_site_id, v_start, p_ends_at, null) <= 24 * 60;
  begin
    insert into public.maintenance_windows
      (site_id, kind, starts_at, ends_at, reason, created_by, approved_by, approved_at)
    values (p_site_id, 'maintenance', v_start, p_ends_at, v_reason, auth.uid(),
            case when v_auto then auth.uid() end, case when v_auto then v_now end)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Another window on this site overlaps that time'
      using errcode = '22023', hint = 'overlap';
  end;
  perform private.window_log(v_id, case when v_auto then 'created' else 'requested' end, v_reason);

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  select auth.uid(), case when v_auto then 'maintenance.create' else 'maintenance.request' end,
         'maintenance_window', v_id,
         jsonb_build_object('site_id', w.site_id, 'starts_at', w.starts_at, 'ends_at', w.ends_at,
                            'reason', w.reason, 'approved', w.approved_at is not null)
  from public.maintenance_windows w where w.id = v_id;

  -- Started now: a running mute on the site ends (§23.10).
  if v_start <= v_now then
    perform private.end_mute_for_maintenance(p_site_id);
  end if;
  return v_id;
end;
$$;

-- Mute a site now until p_ends_at (at most 24 h, spec §11). One mute at a time: change it with
-- edit_window_end. Not during the site's maintenance (alerts are already off, §23.10).
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
  v_end timestamptz;
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
  perform private.assert_end(p_ends_at);
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
  if exists (select 1 from public.maintenance_windows w
             where w.site_id = p_site_id and w.kind = 'maintenance' and public.window_state(w, v_now) = 'active') then
    raise exception 'The site is in maintenance — its alerts are already off'
      using errcode = '22023', hint = 'in_maintenance';
  end if;
  v_end := least(p_ends_at, v_now + interval '24 hours');

  insert into public.maintenance_windows
    (site_id, kind, starts_at, ends_at, reason, created_by, approved_by, approved_at, start_logged)
  values (p_site_id, 'mute', v_now, v_end, v_reason, auth.uid(), auth.uid(), v_now, true)
  returning id into v_id;
  perform private.window_log(v_id, 'muted', v_reason);

  perform set_config('dxt.window_write', 'on', true);
  update public.sites set muted_until = v_end, mute_reason = v_reason, muted_at = v_now where id = p_site_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'site.mute', 'site', p_site_id,
          jsonb_build_object('muted_until', case when v_site.muted_until > v_now then v_site.muted_until end),
          jsonb_build_object('muted_until', v_end, 'reason', v_reason, 'window_id', v_id));
  return v_id;
end;
$$;

-- End a running window or mute now (End now): a reason, a confirm in the UI, one audit row.
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
    set ended_at = v_now, ended_by = auth.uid(), end_reason = v_reason, start_logged = true, end_logged = true
    where id = p_window_id;
  perform private.window_log(p_window_id, 'ended_early', v_reason);
  if w.kind = 'mute' then
    perform private.clear_site_mute(w.site_id);
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case w.kind when 'mute' then 'site.mute_end' else 'maintenance.end_early' end,
          case w.kind when 'mute' then 'site' else 'maintenance_window' end,
          case w.kind when 'mute' then w.site_id else w.id end,
          jsonb_build_object('ends_at', w.ends_at),
          jsonb_build_object('ended_at', v_now, 'reason', v_reason, 'window_id', w.id));
end;
$$;

-- Move a window's, mute's or request's end (Edit end · Edit / cancel · Edit / withdraw, §23.5).
-- Editing never undoes an approval and a request stays a request; Admins don't edit a request (they
-- decline it with a reason); a Responder can't stretch an approved window past 24 h.
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
  if v_state = 'waiting' and v_admin then
    raise exception 'Admins answer a request — decline it with a reason to ask for changes'
      using errcode = '22023', hint = 'decline_instead';
  end if;
  perform private.assert_end(p_ends_at);
  if p_ends_at <= w.starts_at then
    raise exception 'The end must be after the start' using errcode = '22023', hint = 'ends_before_start';
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
  if w.kind = 'maintenance' and v_state in ('active', 'scheduled') and not v_admin
     and private.chained_minutes(w.site_id, w.starts_at, p_ends_at, w.id) > 24 * 60 then
    raise exception 'Over 24 h needs an Admin — ask one to extend it'
      using errcode = '22023', hint = 'needs_admin';
  end if;
  perform private.assert_no_overlap(w.site_id, w.kind, w.starts_at, p_ends_at, w.id);

  begin
    update public.maintenance_windows set ends_at = p_ends_at where id = p_window_id;
  exception when exclusion_violation then
    raise exception 'Another window on this site overlaps that time'
      using errcode = '22023', hint = 'overlap';
  end;
  perform private.window_log(p_window_id, 'edited', v_reason, jsonb_build_object('from', w.ends_at, 'to', p_ends_at));
  if w.kind = 'mute' and v_state = 'active' then
    perform set_config('dxt.window_write', 'on', true);
    update public.sites set muted_until = p_ends_at where id = w.site_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case w.kind when 'mute' then 'site.mute' else 'maintenance.edit' end,
          case w.kind when 'mute' then 'site' else 'maintenance_window' end,
          case w.kind when 'mute' then w.site_id else w.id end,
          jsonb_build_object('ends_at', w.ends_at, 'approved', w.approved_at is not null),
          jsonb_build_object('ends_at', p_ends_at, 'approved', w.approved_at is not null,
                             'reason', v_reason, 'window_id', w.id));
end;
$$;

-- Cancel a scheduled window before it starts (§23.5: a running one is ended with End now; a request
-- is withdrawn or declined).
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
  if v_state = 'active' then
    raise exception 'It is running — end it now instead' using errcode = '22023', hint = 'end_instead';
  end if;
  if v_state = 'waiting' then
    raise exception 'It is a request — withdraw it instead' using errcode = '22023', hint = 'withdraw_instead';
  end if;
  if v_state <> 'scheduled' then
    raise exception 'It has already ended' using errcode = '22023', hint = 'not_open';
  end if;

  update public.maintenance_windows
    set cancelled_at = v_now, end_reason = v_reason, ended_by = auth.uid(), end_logged = true
    where id = p_window_id;
  perform private.window_log(p_window_id, 'cancelled', v_reason);
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.cancel', 'maintenance_window', w.id,
          jsonb_build_object('state', v_state, 'starts_at', w.starts_at, 'ends_at', w.ends_at),
          jsonb_build_object('state', 'cancelled', 'reason', v_reason));
end;
$$;

-- Withdraw a request (the asker, or the site's owner / backup; §23.5).
create function public.withdraw_request(p_window_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  w public.maintenance_windows%rowtype;
begin
  select * into w from public.maintenance_windows where id = p_window_id for update;
  if not found then
    raise exception 'window not found' using errcode = 'P0002';
  end if;
  if coalesce(public.current_app_role() = 'admin', false)
     or not (private.can_pause(w.site_id) or w.created_by = auth.uid()) then
    raise exception 'Only the asker or the site''s owner or backup can withdraw it' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  if public.window_state(w, now()) <> 'waiting' then
    raise exception 'It isn''t waiting for approval' using errcode = '22023', hint = 'not_waiting';
  end if;
  update public.maintenance_windows
    set cancelled_at = now(), outcome = 'withdrawn', end_reason = v_reason, ended_by = auth.uid(), end_logged = true
    where id = p_window_id;
  perform private.window_log(p_window_id, 'withdrawn', v_reason);
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.withdraw', 'maintenance_window', w.id,
          jsonb_build_object('state', 'waiting'), jsonb_build_object('state', 'withdrawn', 'reason', v_reason));
end;
$$;

-- Approve a request (Admin only, before it starts, §14.5).
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
  update public.maintenance_windows set approved_by = auth.uid(), approved_at = v_now where id = p_window_id;
  perform private.window_log(p_window_id, 'approved', null);
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.approve', 'maintenance_window', w.id,
          jsonb_build_object('approved', false),
          jsonb_build_object('approved', true, 'starts_at', w.starts_at, 'ends_at', w.ends_at));
end;
$$;

-- Decline a request with a reason (Admin only; §23.5).
create function public.decline_maintenance(p_window_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  w public.maintenance_windows%rowtype;
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception 'Only an Admin can decline maintenance' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  select * into w from public.maintenance_windows where id = p_window_id for update;
  if not found then
    raise exception 'window not found' using errcode = 'P0002';
  end if;
  if public.window_state(w, now()) <> 'waiting' then
    raise exception 'It isn''t waiting for approval' using errcode = '22023', hint = 'not_waiting';
  end if;
  update public.maintenance_windows
    set cancelled_at = now(), outcome = 'declined', end_reason = v_reason, ended_by = auth.uid(), end_logged = true
    where id = p_window_id;
  perform private.window_log(p_window_id, 'declined', v_reason);
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.decline', 'maintenance_window', w.id,
          jsonb_build_object('state', 'waiting'), jsonb_build_object('state', 'declined', 'reason', v_reason));
end;
$$;

revoke execute on function
  public.create_maintenance(uuid, timestamptz, timestamptz, text),
  public.mute_site(uuid, timestamptz, text),
  public.end_window_early(uuid, text),
  public.edit_window_end(uuid, timestamptz, text),
  public.cancel_window(uuid, text),
  public.withdraw_request(uuid, text),
  public.approve_maintenance(uuid),
  public.decline_maintenance(uuid, text)
  from public, anon;
grant execute on function
  public.create_maintenance(uuid, timestamptz, timestamptz, text),
  public.mute_site(uuid, timestamptz, text),
  public.end_window_early(uuid, text),
  public.edit_window_end(uuid, timestamptz, text),
  public.cancel_window(uuid, text),
  public.withdraw_request(uuid, text),
  public.approve_maintenance(uuid),
  public.decline_maintenance(uuid, text)
  to authenticated;
revoke execute on function public.window_state(public.maintenance_windows, timestamptz) from public, anon;
grant execute on function public.window_state(public.maintenance_windows, timestamptz)
  to authenticated, service_role;
revoke execute on function private.can_pause(uuid), private.require_reason(text),
  private.site_busy(uuid), private.clear_site_mute(uuid), private.window_log(uuid, text, text, jsonb),
  private.chained_minutes(uuid, timestamptz, timestamptz, uuid),
  private.assert_no_overlap(uuid, text, timestamptz, timestamptz, uuid), private.assert_end(timestamptz),
  private.end_mute_for_maintenance(uuid)
  from public, anon, authenticated;

-- ── Engine (service role) ────────────────────────────────────────────────
-- Logs each window's start and end once (System rows, AuditLog board) and clears the site row of a
-- mute that ran out. Returns nothing; called once per engine run.
create function public.engine_log_windows(p_now timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  w public.maintenance_windows%rowtype;
  v_busy text;
  m public.maintenance_windows%rowtype;
begin
  -- Nobody approved it before its start: it never starts, and stops holding its time (D-036, §23.10).
  update public.maintenance_windows mw
    set cancelled_at = mw.starts_at, outcome = 'not_approved', end_logged = true,
        log = mw.log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'not_approved'))
  where mw.approved_at is null and mw.cancelled_at is null and mw.outcome is null and mw.starts_at <= p_now;

  -- A window's start: it doesn't start on a site that is DOWN or has an incident that hasn't recovered
  -- (§23.10); otherwise it starts, and a running mute on the site ends (alerts are off anyway).
  for w in
    select * from public.maintenance_windows mw
    where mw.kind = 'maintenance' and not mw.start_logged and mw.cancelled_at is null and mw.outcome is null
      and mw.approved_at is not null and mw.starts_at <= p_now
    for update skip locked
  loop
    select coalesce(
      (select 'INC-' || lpad(i.number::text, 4, '0') from public.incidents i
        where i.site_id = w.site_id and i.state in ('unacked', 'escalated', 'acknowledged') limit 1),
      (select 'down' from public.site_status st where st.site_id = w.site_id and st.status = 'down'))
    into v_busy;
    if v_busy is not null then
      update public.maintenance_windows
        set cancelled_at = w.starts_at, outcome = 'didnt_start', outcome_detail = v_busy,
            start_logged = true, end_logged = true,
            log = log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'didnt_start', 'incident', v_busy))
        where id = w.id;
      insert into public.audit_log (action, entity, entity_id, before, after)
      values ('maintenance.start', 'maintenance_window', w.id, jsonb_build_object('state', 'scheduled'),
              jsonb_build_object('state', 'didnt_start', 'site_id', w.site_id, 'incident', v_busy));
      continue;
    end if;
    update public.maintenance_windows
      set start_logged = true,
          log = log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'started'))
      where id = w.id;
    insert into public.audit_log (action, entity, entity_id, before, after)
    values ('maintenance.start', 'maintenance_window', w.id, jsonb_build_object('state', 'scheduled'),
            jsonb_build_object('state', 'active', 'site_id', w.site_id, 'ends_at', w.ends_at));
    for m in
      select * from public.maintenance_windows mm
      where mm.site_id = w.site_id and mm.kind = 'mute' and mm.cancelled_at is null and mm.ended_at is null
        and mm.starts_at <= p_now and mm.ends_at > p_now
    loop
      update public.maintenance_windows
        set ended_at = p_now, end_reason = 'Maintenance started', end_logged = true,
            log = log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'ended_by_maintenance'))
        where id = m.id;
      insert into public.audit_log (action, entity, entity_id, before, after)
      values ('site.mute_end', 'site', m.site_id, jsonb_build_object('muted_until', m.ends_at),
              jsonb_build_object('ended_at', p_now, 'reason', 'Maintenance started', 'window_id', m.id));
    end loop;
  end loop;

  -- Windows and mutes that ran their course: logged once (System).
  with ended as (
    update public.maintenance_windows mw
      set end_logged = true,
          log = mw.log || jsonb_build_array(jsonb_build_object('at', mw.ends_at, 'action', 'ended'))
    where not mw.end_logged and mw.start_logged and mw.cancelled_at is null and mw.ended_at is null
      and mw.outcome is null and mw.ends_at <= p_now
    returning mw.*
  )
  insert into public.audit_log (action, entity, entity_id, before, after)
  select case e.kind when 'mute' then 'site.mute_end' else 'maintenance.end' end,
         case e.kind when 'mute' then 'site' else 'maintenance_window' end,
         case e.kind when 'mute' then e.site_id else e.id end,
         jsonb_build_object('state', 'active'),
         jsonb_build_object('state', 'ended', 'ended_at', e.ends_at, 'window_id', e.id)
  from ended e;

  -- A mute that ran out, or that maintenance ended, leaves the site row.
  perform set_config('dxt.window_write', 'on', true);
  update public.sites s set muted_until = null, mute_reason = null, muted_at = null
  where s.muted_until is not null
    and (s.muted_until <= p_now
         or not exists (select 1 from public.maintenance_windows mm
                        where mm.site_id = s.id and mm.kind = 'mute' and mm.cancelled_at is null
                          and mm.ended_at is null and mm.starts_at <= p_now and mm.ends_at > p_now));
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
  select i.id, i.site_id, s.tier, coalesce(i.episode_severity, i.severity), i.detected_at
  from public.incidents i
  join public.sites s on s.id = i.site_id
  where i.state in ('unacked', 'escalated')
    and s.is_active
    and (s.muted_until is null or s.muted_until <= p_now)
    and not exists (
      select 1 from public.notifications n
      where n.incident_id = i.id and n.channel = 'google_chat'
        and n.template in (coalesce(i.episode_severity, i.severity)::text,
                           coalesce(i.episode_severity, i.severity)::text || '_again')
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
  v_sev text;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.state not in ('unacked', 'escalated') then
    return false;
  end if;
  if exists (select 1 from public.sites s where s.id = v_inc.site_id and s.muted_until > p_at) then
    return false;
  end if;
  -- The drop in progress (D-023: a DOWN whose home page is back is a PROBLEM now).
  v_sev := coalesce(v_inc.episode_severity, v_inc.severity)::text;
  if exists (select 1 from public.notifications n
             where n.incident_id = p_incident_id and n.channel = 'google_chat'
               and n.template in (v_sev, v_sev || '_again')
               and (n.status <> 'cancelled' or n.attempts > 0)) then
    return false;
  end if;

  -- The facts of the drop it alerts about: its latest detection event's payload.
  select e.payload into v_context from public.incident_events e
  where e.incident_id = p_incident_id and e.type in ('detected', 'relapsed', 'escalated_to_down')
  order by e.at desc limit 1;
  v_context := coalesce(v_context, '{}'::jsonb) || jsonb_build_object('afterMute', true);
  v_hold := case when v_sev = 'problem' and p_hold_until > p_at then p_hold_until end;

  insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
  values (p_incident_id, 'google_chat', v_sev, p_incident_id::text, v_context, v_hold);
  insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, hold_until)
  select p_incident_id, s.primary_owner_id, 'email', v_sev, p_incident_id::text, v_context, v_hold
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

-- ── The ladder after a late alert, and the live thread per severity (engine review M3, M5) ───────────
-- A thread is live for the ladder only once an alert of the incident's current drop went: a PROBLEM
-- card doesn't make a DOWN raised from it (D-021) live while a mute held its DOWN card back — the owner
-- gets that card when the mute is over, and the DOWN ladder counts from then.
create or replace function public.engine_thread_live(p_incident_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.notifications n
    join public.incidents i on i.id = n.incident_id
    where n.incident_id = p_incident_id and n.channel = 'google_chat'
      and n.template in (coalesce(i.episode_severity, i.severity)::text,
                         coalesce(i.episode_severity, i.severity)::text || '_again')
      and (n.status <> 'cancelled' or n.attempts > 0)
      and (n.hold_until is null or n.hold_until <= now()));
$$;

create or replace function public.engine_fire_step(
  p_incident_id uuid,
  p_level smallint,
  p_due_at timestamptz,
  p_context jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_step jsonb;
  v_told uuid[];
  v_new uuid[];
  v_mention uuid[];
  v_fyi uuid[];
  v_others boolean;
  v_payload jsonb;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.state not in ('unacked', 'escalated') or v_inc.escalation_level >= p_level
     or p_level < 1 then
    return false;
  end if;
  -- A level due before the incident's first alert went (a run that read it before a late alert after a
  -- mute was stamped, D-036): the ladder counts from that alert, so this one isn't due yet.
  if v_inc.alerted_at is not null and p_due_at < v_inc.alerted_at then
    return false;
  end if;

  -- The thread needs its first alert: none for an incident opened while muted (mute stops new
  -- alerts, §15.1), and none yet while a PROBLEM card waits for response hours (§19.2).
  if not public.engine_thread_live(p_incident_id) then
    return false;
  end if;

  select s into v_step
  from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s
  where (s ->> 'level')::smallint = p_level;
  if v_step is null then
    return false;
  end if;

  -- Told already: everyone the earlier steps name (L0 = the owner) and every person a fired step told.
  select coalesce(array_agg(distinct u), '{}') into v_told
  from (
    select pe.user_id as u
    from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s,
         public.escalation_people(p_incident_id, s -> 'targets') pe
    where (s ->> 'level')::smallint = 0
    union
    select (jsonb_array_elements_text(e.payload -> 'notified'))::uuid
    from public.incident_events e
    where e.incident_id = p_incident_id and e.type = 'step_fired'
      and e.payload ->> 'severity' = v_inc.severity::text
  ) t;

  select coalesce(array_agg(pe.user_id), '{}'),
         coalesce(bool_or(pe.token <> 'admins'), false)
    into v_new, v_others
  from public.escalation_people(p_incident_id, v_step -> 'targets') pe
  where pe.user_id <> all (v_told);

  select coalesce(array_agg(pe.user_id) filter (where not (v_others and pe.token = 'admins')), '{}'),
         coalesce(array_agg(pe.user_id) filter (where v_others and pe.token = 'admins'), '{}')
    into v_mention, v_fyi
  from public.escalation_people(p_incident_id, v_step -> 'targets') pe
  where pe.user_id = any (v_new);

  -- Nobody new to tell (all told already, or not active): the level is passed, but nothing is posted
  -- and the incident doesn't read "Escalated" (spec §14.3) for a step that paged no one.
  update public.incidents
    set state = case when cardinality(v_new) > 0 then 'escalated'::public.incident_state else state end,
        escalation_level = p_level
    where id = p_incident_id;

  v_payload := jsonb_build_object(
    'level', p_level, 'severity', v_inc.severity, 'dueAt', p_due_at,
    'notified', to_jsonb(v_new), 'mentioned', to_jsonb(v_mention), 'fyi', to_jsonb(v_fyi),
    'channels', v_step -> 'channels');

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'step_fired', v_payload, now());

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.escalated', 'incident', p_incident_id,
          jsonb_build_object('state', v_inc.state, 'escalation_level', v_inc.escalation_level),
          jsonb_build_object('state', case when cardinality(v_new) > 0 then 'escalated' else v_inc.state::text end,
                             'escalation_level', p_level));

  if cardinality(v_new) > 0 and v_step -> 'channels' ?| array['chat', 'space'] then
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
    values (p_incident_id, 'google_chat', 'step_fired', p_incident_id::text,
            p_context || v_payload, v_inc.severity || ':L' || p_level)
    on conflict do nothing;
  end if;

  if v_step -> 'channels' ? 'email' then
    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
    select p_incident_id, u, 'email', 'step_fired', p_incident_id::text,
           p_context || v_payload || jsonb_build_object('asFyi', u = any (v_fyi)), v_inc.severity || ':L' || p_level
    from unnest(v_new) u
    on conflict do nothing;
  end if;

  return true;
end;
$$;

create or replace function public.engine_remind(
  p_incident_id uuid,
  p_due_at timestamptz,
  p_context jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_mention uuid[];
  v_id uuid;
  v_key text;
begin
  -- Most calls find the reminder already queued (every engine run asks): answer from the index
  -- before taking the incident's lock (db review).
  select i.severity || ':' || to_char(p_due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') into v_key
  from public.incidents i where i.id = p_incident_id;
  if v_key is null or exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat' and template = 'reminder'
      and dedupe_key = v_key and status <> 'cancelled'
  ) then
    return false;
  end if;

  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.state not in ('unacked', 'escalated') or v_inc.escalation_plan is null
     or not public.engine_thread_live(p_incident_id)
     or (v_inc.alerted_at is not null and p_due_at < v_inc.alerted_at) then
    return false;
  end if;

  select coalesce(array_agg(distinct u), '{}') into v_mention
  from (
    select pe.user_id as u
    from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s,
         public.escalation_people(p_incident_id, s -> 'targets') pe
    where (s ->> 'level')::smallint = 0 and pe.token <> 'admins'
    union
    select (jsonb_array_elements_text(e.payload -> 'mentioned'))::uuid
    from public.incident_events e
    where e.incident_id = p_incident_id and e.type = 'step_fired'
      and e.payload ->> 'severity' = v_inc.severity::text
  ) t;

  insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
  values (p_incident_id, 'google_chat', 'reminder', p_incident_id::text,
          p_context || jsonb_build_object('dueAt', p_due_at, 'severity', v_inc.severity,
                                          'mentioned', to_jsonb(v_mention)),
          v_inc.severity || ':' || to_char(p_due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'))
  on conflict do nothing
  returning id into v_id;

  return v_id is not null;
end;
$$;
