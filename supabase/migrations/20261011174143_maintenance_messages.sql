-- S09b (spec §24, D-037): maintenance messages. Every maintenance action and the engine's start / end
-- / didn't start / not approved queue their messages here — one text line in the window's own Alerts
-- Space thread, a reply @mentioning each person a direct message would go to (no Chat app yet, D-037),
-- and one email per owner / backup (and Admin, for a window that began as a request) in one mail
-- thread per window. Approve, decline, end now, change end, cancel and withdraw are held 10 s with Undo
-- (§24.8). Reminders 12 h / 1 h before a waiting request's start.

-- ── Columns ──────────────────────────────────────────────────────────────
-- A third subject: a message is about an incident, a system alert or a maintenance window / mute.
alter table public.notifications
  add column maintenance_window_id uuid references public.maintenance_windows (id) on delete restrict;
-- Delivery records are kept (as for incidents and system alerts): a window with messages isn't deleted.
-- The FK lookup needs every row, cancelled ones too (db review M2).
create index notifications_window_idx on public.notifications (maintenance_window_id)
  where maintenance_window_id is not null;
alter table public.notifications drop constraint notifications_one_subject;
alter table public.notifications
  add constraint notifications_one_subject
  check (num_nonnulls(incident_id, system_alert_id, maintenance_window_id) = 1);
-- One live message per window / channel / template / person / action (an action's key is a fresh id
-- for the undoable ones, the action word for the rest).
create unique index notifications_once_per_window
  on public.notifications (maintenance_window_id, channel, template, user_id, dedupe_key) nulls not distinct
  where status <> 'cancelled' and maintenance_window_id is not null;

-- Reminders (§24.2): stamped once each. Undo (§24.8): the last held action, who did it, until when, and
-- the window as it was before it (restored by undo_window_action).
alter table public.maintenance_windows
  add column reminded_12h_at timestamptz,
  add column reminded_1h_at timestamptz,
  add column undo_until timestamptz,
  add column undo_by uuid references public.profiles (id) on delete set null,
  add column undo_action text,
  add column undo_key text,
  add column undo_before jsonb;

-- ── Realtime (deferred from D-036's spec-check round 3) ─────────────────
-- /maintenance refreshes on other people's changes at once. Staff-only select policy, INSERT and
-- UPDATE only (a DELETE carries the key only), as overview_realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'maintenance_windows'
  ) then
    alter publication supabase_realtime add table public.maintenance_windows;
  end if;
end;
$$;

-- ── Queueing ─────────────────────────────────────────────────────────────
-- Queues the messages of one window action (§24.2–§24.6, D-037). p_kind: requested · scheduled ·
-- approved · declined · withdrawn · request_changed · changed · cancelled · started · ended ·
-- ended_early · didnt_start · not_approved · muted · mute_changed · mute_ended · mute_ended_early ·
-- reminder_12h · reminder_1h. p_actor is skipped as a recipient (null = the engine). p_hold holds the
-- rows (Undo); p_key tells one action's rows from another's. Called by the RPCs below and the engine.
create function public.engine_queue_window_messages(
  p_window_id uuid,
  p_kind text,
  p_actor uuid default null,
  p_hold timestamptz default null,
  p_key text default '',
  p_extra jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.maintenance_windows%rowtype;
  s public.sites%rowtype;
  v_ctx jsonb;
  v_request boolean;
  v_thread text;
  v_inc record;
  v_n integer := 0;
  v_k integer;
begin
  select * into w from public.maintenance_windows where id = p_window_id;
  if not found then
    return 0;
  end if;
  select * into s from public.sites where id = w.site_id;
  v_thread := 'mw-' || w.id;
  -- A window that began as a request keeps its request mail thread, with the Admins in it (§24.5).
  v_request := w.log @> '[{"action": "requested"}]'::jsonb;
  v_ctx := jsonb_build_object('kind', p_kind, 'at', now(), 'request', v_request,
                              'by', (select display_name from public.profiles where id = p_actor))
           || p_extra;

  -- A mute that ends with an incident it silenced: that incident posts now (§24.7, D-036).
  if p_kind in ('mute_ended', 'mute_ended_early') then
    select i.id, i.number, i.detected_at, coalesce(i.episode_severity, i.severity)::text as severity into v_inc
    from public.incidents i
    where i.site_id = w.site_id and i.state in ('unacked', 'escalated') and i.escalation_plan is not null
      and not exists (
        select 1 from public.notifications n
        where n.incident_id = i.id and n.channel = 'google_chat'
          and n.template in (i.severity::text, i.severity::text || '_again', coalesce(i.episode_severity, i.severity)::text, coalesce(i.episode_severity, i.severity)::text || '_again')
          and (n.status <> 'cancelled' or n.attempts > 0))
    order by i.detected_at desc limit 1;
    if found then
      v_ctx := v_ctx || jsonb_build_object('incidentId', v_inc.id, 'incident', v_inc.number,
                                           'since', v_inc.detected_at, 'severity', v_inc.severity);
    end if;
  end if;
  -- A window that didn't start: the incident it couldn't start over, for "Open INC-…" (§24.6).
  if p_kind = 'didnt_start' then
    select i.id, i.number, i.detected_at, coalesce(i.episode_severity, i.severity)::text as severity,
           i.state = 'acknowledged' as acked into v_inc
    from public.incidents i
    where i.site_id = w.site_id and i.state in ('unacked', 'escalated', 'acknowledged')
    order by i.detected_at desc limit 1;
    v_ctx := v_ctx || case when found
      then jsonb_build_object('incidentId', v_inc.id, 'incident', v_inc.number,
                              'since', v_inc.detected_at, 'severity', v_inc.severity, 'acked', v_inc.acked)
      else jsonb_build_object('incident', null) end;
  end if;

  -- Rows are stamped with the clock, not the transaction time, so the line opens the thread before the
  -- replies that follow it (claim_notifications keeps a window's rows in created_at order).
  -- 1. The action's line in the window's Space thread: no mention, no card (§24.4).
  if p_kind not in ('reminder_12h', 'reminder_1h') then
    insert into public.notifications
      (maintenance_window_id, channel, template, thread_key, context, hold_until, dedupe_key, created_at)
    values (w.id, 'google_chat', 'mw_line', v_thread, v_ctx, p_hold, p_key, clock_timestamp());
    v_n := v_n + 1;
  end if;

  -- 2. "Direct messages" as replies in that thread, @mentioning the person (D-037).
  insert into public.notifications
    (maintenance_window_id, user_id, channel, template, thread_key, context, hold_until, dedupe_key, created_at)
  select distinct on (r.id) w.id, r.id, 'google_chat', 'mw_dm', v_thread, v_ctx || jsonb_build_object('dm', r.dm),
         p_hold, p_key, clock_timestamp()
  from (
    -- The request and its reminders to every active Admin.
    select p.id, p_kind as dm from public.profiles p
    where p_kind in ('requested', 'reminder_12h', 'reminder_1h') and p.role = 'admin' and p.is_active
    union all
    -- The asker: the answer, STILL WAITING at 12 h, NOT APPROVED at the deadline.
    select p.id, case p_kind when 'reminder_12h' then 'still_waiting' else p_kind end
    from public.profiles p
    where p.id = w.created_by and p.is_active and p.role <> 'admin'
      and p_kind in ('approved', 'declined', 'not_approved', 'reminder_12h')
    union all
    -- Someone else muted their site: the owner and the backup get the MUTED line (§24.4).
    select p.id, 'muted' from public.profiles p
    where p_kind = 'muted' and p.is_active and p.id in (s.primary_owner_id, s.backup_owner_id)
      and p_actor is distinct from s.primary_owner_id and p_actor is distinct from s.backup_owner_id
  ) r
  where r.id is distinct from p_actor
  order by r.id;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;

  -- 3. Email (§24.5): mutes and the 1 h reminder are Chat only; the 12 h reminder goes to the Admins;
  -- everything else to the owner and the backup — and the Admins in a request thread — minus whoever
  -- did it. Each person once, by the closest tie (owner, backup, Admin) for the "why" line.
  if p_kind not in ('muted', 'mute_changed', 'mute_ended', 'mute_ended_early', 'reminder_1h') then
    insert into public.notifications
      (maintenance_window_id, user_id, channel, template, thread_key, context, hold_until, dedupe_key, created_at)
    select distinct on (r.id) w.id, r.id, 'email', 'mw_email', v_thread, v_ctx || jsonb_build_object('role', r.role),
           p_hold, p_key, clock_timestamp()
    from (
      select s.primary_owner_id as id, 'owner' as role, 1 as rank where p_kind <> 'reminder_12h'
      union all
      select s.backup_owner_id, 'backup', 2 where p_kind <> 'reminder_12h'
      union all
      select p.id, 'admin', 3 from public.profiles p
      where p.role = 'admin' and (v_request or p_kind = 'reminder_12h')
    ) r
    join public.profiles p on p.id = r.id and p.is_active
    where r.id is distinct from p_actor
    order by r.id, r.rank;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end if;

  -- 4. A mute on a site with an open incident: one line in that incident's thread too (§24.4), if the
  -- thread exists (an incident a mute silenced from the start has none yet).
  if p_kind = 'muted' then
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key, created_at)
    select i.id, 'google_chat', 'muted', i.id::text,
           jsonb_build_object('until', w.ends_at, 'by', v_ctx ->> 'by', 'reason', w.reason,
                              'acked', i.state = 'acknowledged'),
           w.id::text, clock_timestamp()
    from public.incidents i
    where i.site_id = w.site_id and i.state in ('unacked', 'escalated', 'acknowledged')
      and exists (
        select 1 from public.notifications n
        where n.incident_id = i.id and n.channel = 'google_chat'
          and n.template in ('down', 'problem', 'down_again', 'problem_again')
          and (n.status = 'sent' or n.attempts > 0));
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end if;
  return v_n;
end;
$$;

-- Starts an action's 10 s Undo (§24.8): saves the window (and a mute's site row) as it is now, marks
-- who may undo it until when, and returns the key its messages carry. The caller holds them until
-- `undo_until`.
create function private.window_undo_begin(w public.maintenance_windows, p_action text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := gen_random_uuid()::text;
begin
  update public.maintenance_windows
    set undo_until = now() + interval '10 seconds', undo_by = auth.uid(), undo_action = p_action, undo_key = v_key,
        undo_before = jsonb_build_object(
          'ends_at', w.ends_at, 'ended_at', w.ended_at, 'ended_by', w.ended_by, 'end_reason', w.end_reason,
          'cancelled_at', w.cancelled_at, 'outcome', w.outcome, 'approved_by', w.approved_by,
          'approved_at', w.approved_at, 'start_logged', w.start_logged, 'end_logged', w.end_logged)
        || coalesce((select jsonb_build_object('muted_until', s.muted_until, 'mute_reason', s.mute_reason,
                                               'muted_at', s.muted_at)
                     from public.sites s where s.id = w.site_id and w.kind = 'mute'), '{}'::jsonb)
    where id = w.id;
  return v_key;
end;
$$;

-- Undo the last held action on a window (§24.8): only the person who did it, inside its 10 s, before
-- the notifier took any of its messages. The window goes back as it was; the log and the audit trail
-- gain a line (never rewritten).
create function public.undo_window_action(p_window_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.maintenance_windows%rowtype;
  b jsonb;
  v_key text;
  v_action text;
begin
  select * into w from public.maintenance_windows where id = p_window_id for update;
  if not found then
    raise exception 'window not found' using errcode = 'P0002';
  end if;
  if w.undo_by is null or w.undo_by is distinct from auth.uid() then
    raise exception 'Only the person who did it can undo it' using errcode = '42501';
  end if;
  -- Its messages are locked first, so the notifier (skip locked) can't take one between this check and
  -- the cancel below (security review L2).
  perform 1 from public.notifications n
  where n.maintenance_window_id = w.id and n.dedupe_key = w.undo_key
  for update;
  if w.undo_until is null or now() >= w.undo_until
     or exists (select 1 from public.notifications n
                where n.maintenance_window_id = w.id and n.dedupe_key = w.undo_key
                  and (n.status <> 'queued' or n.attempts > 0) and n.status <> 'cancelled') then
    raise exception 'Too late to undo — it has been posted' using errcode = '22023', hint = 'undo_expired';
  end if;
  b := w.undo_before;
  v_key := w.undo_key;
  v_action := w.undo_action;
  begin
    update public.maintenance_windows
      set ends_at = (b ->> 'ends_at')::timestamptz,
          ended_at = (b ->> 'ended_at')::timestamptz,
          ended_by = (b ->> 'ended_by')::uuid,
          end_reason = b ->> 'end_reason',
          cancelled_at = (b ->> 'cancelled_at')::timestamptz,
          outcome = b ->> 'outcome',
          approved_by = (b ->> 'approved_by')::uuid,
          approved_at = (b ->> 'approved_at')::timestamptz,
          start_logged = (b ->> 'start_logged')::boolean,
          end_logged = (b ->> 'end_logged')::boolean,
          undo_until = null, undo_by = null, undo_action = null, undo_key = null, undo_before = null
      where id = w.id;
  exception when exclusion_violation then
    raise exception 'Another window now overlaps that time — it can''t be undone'
      using errcode = '22023', hint = 'undo_overlap';
  end;
  -- The window as restored must pass today's rules, not just the ones it passed then (security review
  -- M1, L1): a Responder's live maintenance stays within 24 h back to back with its neighbours, a
  -- maintenance running again needs a site that isn't DOWN, and a mute running again can't sit inside
  -- maintenance. Anything else would let Undo do what the RPCs refuse.
  select * into w from public.maintenance_windows where id = p_window_id;
  if w.kind = 'maintenance' and w.cancelled_at is null and w.outcome is null and w.approved_at is not null
     and not coalesce(public.current_app_role() = 'admin', false)
     and private.chained_minutes(w.site_id, w.starts_at, coalesce(w.ended_at, w.ends_at), w.id) > 24 * 60 then
    raise exception 'Over 24 h with the windows next to it — it can''t be undone; ask an Admin'
      using errcode = '22023', hint = 'undo_needs_admin';
  end if;
  if w.kind = 'maintenance' and public.window_state(w, now()) = 'active' and private.site_busy(w.site_id) is not null then
    raise exception 'The site is DOWN or has an open incident now — it can''t be undone'
      using errcode = '22023', hint = 'maintenance_open_incident';
  end if;
  if w.kind = 'mute' and public.window_state(w, now()) = 'active'
     and exists (select 1 from public.maintenance_windows m
                 where m.site_id = w.site_id and m.kind = 'maintenance' and public.window_state(m, now()) = 'active') then
    raise exception 'The site is in maintenance now — it can''t be undone'
      using errcode = '22023', hint = 'in_maintenance';
  end if;
  if w.kind = 'mute' and b ? 'muted_until' then
    perform set_config('dxt.window_write', 'on', true);
    update public.sites
      set muted_until = (b ->> 'muted_until')::timestamptz, mute_reason = b ->> 'mute_reason',
          muted_at = (b ->> 'muted_at')::timestamptz
      where id = w.site_id;
  end if;
  update public.notifications
    set status = 'cancelled', error = 'Undone'
    where maintenance_window_id = w.id and dedupe_key = v_key and status = 'queued';
  perform private.window_log(w.id, 'undone', null, jsonb_build_object('undid', v_action));
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.undo', 'maintenance_window', w.id,
          jsonb_build_object('action', v_action),
          b || jsonb_build_object('undid', v_action));
end;
$$;

revoke execute on function
  public.engine_queue_window_messages(uuid, text, uuid, timestamptz, text, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.engine_queue_window_messages(uuid, text, uuid, timestamptz, text, jsonb)
  to service_role;
revoke execute on function private.window_undo_begin(public.maintenance_windows, text)
  from public, anon, authenticated;
revoke execute on function public.undo_window_action(uuid) from public, anon;
grant execute on function public.undo_window_action(uuid) to authenticated;

-- ── The people's actions now queue their messages ───────────────────────
-- S09 bodies (20261011082307), plus: create / mute post at once; the six undoable actions save the
-- window first, hold their messages 10 s and note the posting time in the log line.

create or replace function public.create_maintenance(
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
  if not exists (select 1 from public.sites where id = p_site_id and is_active) then
    raise exception 'Maintenance and mutes are for live sites — start monitoring first'
      using errcode = '22023', hint = 'site_not_live';
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
  if not v_auto and v_start <= v_now then
    raise exception 'Over 24 h needs an Admin''s approval first — pick a later start'
      using errcode = '22023', hint = 'needs_approval_now';
  end if;
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

  perform public.engine_queue_window_messages(v_id, case when v_auto then 'scheduled' else 'requested' end,
    auth.uid(), null, case when v_auto then 'scheduled' else 'requested' end);

  -- Started now: a running mute on the site ends (§23.10).
  if v_start <= v_now then
    perform private.end_mute_for_maintenance(p_site_id);
  end if;
  return v_id;
end;
$$;

create or replace function public.mute_site(p_site_id uuid, p_ends_at timestamptz, p_reason text)
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
  if not v_site.is_active then
    raise exception 'Maintenance and mutes are for live sites — start monitoring first'
      using errcode = '22023', hint = 'site_not_live';
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
  perform public.engine_queue_window_messages(v_id, 'muted', auth.uid(), null, 'muted');
  return v_id;
end;
$$;

create or replace function public.end_window_early(p_window_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_reason text;
  w public.maintenance_windows%rowtype;
  v_key text;
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

  v_key := private.window_undo_begin(w, case w.kind when 'mute' then 'mute_ended_early' else 'ended_early' end);
  update public.maintenance_windows
    set ended_at = v_now, ended_by = auth.uid(), end_reason = v_reason, start_logged = true, end_logged = true
    where id = p_window_id;
  perform private.window_log(p_window_id, 'ended_early', v_reason, jsonb_build_object('posts_at', now() + interval '10 seconds'));
  if w.kind = 'mute' then
    perform private.clear_site_mute(w.site_id);
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case w.kind when 'mute' then 'site.mute_end' else 'maintenance.end_early' end,
          case w.kind when 'mute' then 'site' else 'maintenance_window' end,
          case w.kind when 'mute' then w.site_id else w.id end,
          jsonb_build_object('ends_at', w.ends_at),
          jsonb_build_object('ended_at', v_now, 'reason', v_reason, 'window_id', w.id));
  perform public.engine_queue_window_messages(w.id,
    case w.kind when 'mute' then 'mute_ended_early' else 'ended_early' end,
    auth.uid(), v_now + interval '10 seconds', v_key, jsonb_build_object('reason', v_reason));
end;
$$;

create or replace function public.edit_window_end(p_window_id uuid, p_ends_at timestamptz, p_reason text)
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
  v_key text;
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
  -- The same minute of slack as mute_site: "24 h" picked in the dialog counts from the moment it opened.
  if w.kind = 'mute' and p_ends_at - w.starts_at > interval '24 hours 1 minute' then
    raise exception 'A mute lasts at most 24 h — schedule maintenance for longer'
      using errcode = '22023', hint = 'mute_too_long';
  end if;
  if w.kind = 'maintenance' and p_ends_at - w.starts_at > interval '31 days' then
    raise exception 'A window lasts at most 31 days' using errcode = '22023', hint = 'too_long';
  end if;
  if w.kind = 'maintenance' and v_state in ('active', 'scheduled') and not v_admin and p_ends_at > w.ends_at
     and private.chained_minutes(w.site_id, w.starts_at, p_ends_at, w.id) > 24 * 60 then
    raise exception 'Over 24 h needs an Admin — ask one to extend it'
      using errcode = '22023', hint = 'needs_admin';
  end if;
  perform private.assert_no_overlap(w.site_id, w.kind, w.starts_at, p_ends_at, w.id);

  v_key := private.window_undo_begin(w, 'edited');
  begin
    update public.maintenance_windows set ends_at = p_ends_at where id = p_window_id;
  exception when exclusion_violation then
    raise exception 'Another window on this site overlaps that time'
      using errcode = '22023', hint = 'overlap';
  end;
  perform private.window_log(p_window_id, 'edited', v_reason, jsonb_build_object('from', w.ends_at, 'to', p_ends_at,
    'posts_at', v_now + interval '10 seconds'));
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
  perform public.engine_queue_window_messages(w.id,
    case when w.kind = 'mute' then 'mute_changed' when v_state = 'waiting' then 'request_changed' else 'changed' end,
    auth.uid(), v_now + interval '10 seconds', v_key,
    jsonb_build_object('from', w.ends_at, 'to', p_ends_at, 'reason', v_reason));
end;
$$;

create or replace function public.cancel_window(p_window_id uuid, p_reason text)
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
  v_key text;
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

  v_key := private.window_undo_begin(w, 'cancelled');
  update public.maintenance_windows
    set cancelled_at = v_now, end_reason = v_reason, ended_by = auth.uid(), end_logged = true
    where id = p_window_id;
  perform private.window_log(p_window_id, 'cancelled', v_reason, jsonb_build_object('posts_at', now() + interval '10 seconds'));
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.cancel', 'maintenance_window', w.id,
          jsonb_build_object('state', v_state, 'starts_at', w.starts_at, 'ends_at', w.ends_at),
          jsonb_build_object('state', 'cancelled', 'reason', v_reason));
  perform public.engine_queue_window_messages(w.id, 'cancelled', auth.uid(), v_now + interval '10 seconds', v_key,
    jsonb_build_object('reason', v_reason));
end;
$$;

create or replace function public.withdraw_request(p_window_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  w public.maintenance_windows%rowtype;
  v_key text;
begin
  select * into w from public.maintenance_windows where id = p_window_id for update;
  if not found then
    raise exception 'window not found' using errcode = 'P0002';
  end if;
  if public.current_app_role() is distinct from 'responder'
     or not (private.can_pause(w.site_id) or coalesce(w.created_by = auth.uid(), false)) then
    raise exception 'Only the asker or the site''s owner or backup can withdraw it' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  if public.window_state(w, now()) <> 'waiting' then
    raise exception 'It isn''t waiting for approval' using errcode = '22023', hint = 'not_waiting';
  end if;
  v_key := private.window_undo_begin(w, 'withdrawn');
  update public.maintenance_windows
    set cancelled_at = now(), outcome = 'withdrawn', end_reason = v_reason, ended_by = auth.uid(), end_logged = true
    where id = p_window_id;
  perform private.window_log(p_window_id, 'withdrawn', v_reason, jsonb_build_object('posts_at', now() + interval '10 seconds'));
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.withdraw', 'maintenance_window', w.id,
          jsonb_build_object('state', 'waiting'), jsonb_build_object('state', 'withdrawn', 'reason', v_reason));
  perform public.engine_queue_window_messages(w.id, 'withdrawn', auth.uid(), now() + interval '10 seconds', v_key,
    jsonb_build_object('reason', v_reason));
end;
$$;

create or replace function public.approve_maintenance(p_window_id uuid, p_ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  w public.maintenance_windows%rowtype;
  v_key text;
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
  if p_ends_at is distinct from w.ends_at then
    raise exception 'The request changed — reload and check it again' using errcode = '22023', hint = 'changed';
  end if;
  v_key := private.window_undo_begin(w, 'approved');
  update public.maintenance_windows set approved_by = auth.uid(), approved_at = v_now where id = p_window_id;
  perform private.window_log(p_window_id, 'approved', null, jsonb_build_object('posts_at', now() + interval '10 seconds'));
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.approve', 'maintenance_window', w.id,
          jsonb_build_object('approved', false),
          jsonb_build_object('approved', true, 'starts_at', w.starts_at, 'ends_at', w.ends_at));
  perform public.engine_queue_window_messages(w.id, 'approved', auth.uid(), v_now + interval '10 seconds', v_key);
end;
$$;

create or replace function public.decline_maintenance(p_window_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  w public.maintenance_windows%rowtype;
  v_key text;
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
  v_key := private.window_undo_begin(w, 'declined');
  update public.maintenance_windows
    set cancelled_at = now(), outcome = 'declined', end_reason = v_reason, ended_by = auth.uid(), end_logged = true
    where id = p_window_id;
  perform private.window_log(p_window_id, 'declined', v_reason, jsonb_build_object('posts_at', now() + interval '10 seconds'));
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.decline', 'maintenance_window', w.id,
          jsonb_build_object('state', 'waiting'), jsonb_build_object('state', 'declined', 'reason', v_reason));
  perform public.engine_queue_window_messages(w.id, 'declined', auth.uid(), now() + interval '10 seconds', v_key,
    jsonb_build_object('reason', v_reason));
end;
$$;

-- ── Engine (service role) ────────────────────────────────────────────────
-- S09 body, plus the messages of each start, end, didn't start and not approved (§24.2, §24.4, §24.6),
-- and a window inside an action's 10 s Undo waits for it (db review M1, security review L1): an Undo
-- never has to take back a start or an end the engine logged meanwhile.
-- A mute that maintenance ended gets no line of its own: MAINTENANCE STARTED says it.
create or replace function public.engine_log_windows(p_now timestamptz)
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
  for w in
    update public.maintenance_windows mw
      set cancelled_at = mw.starts_at, outcome = 'not_approved', end_logged = true,
          log = mw.log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'not_approved'))
    where mw.approved_at is null and mw.cancelled_at is null and mw.outcome is null and mw.starts_at <= p_now
      and (mw.undo_until is null or mw.undo_until <= p_now)
    returning mw.*
  loop
    insert into public.audit_log (action, entity, entity_id, before, after)
    values ('maintenance.start', 'maintenance_window', w.id, jsonb_build_object('state', 'waiting'),
            jsonb_build_object('state', 'not_approved', 'site_id', w.site_id));
    perform public.engine_queue_window_messages(w.id, 'not_approved', null, null, 'not_approved');
  end loop;

  -- A window's start: it doesn't start on a site that is DOWN or has an incident that hasn't recovered
  -- (§23.10); otherwise it starts, and a running mute on the site ends (alerts are off anyway).
  for w in
    select * from public.maintenance_windows mw
    where mw.kind = 'maintenance' and not mw.start_logged and mw.cancelled_at is null and mw.outcome is null
      and mw.approved_at is not null and mw.starts_at <= p_now
      and (mw.undo_until is null or mw.undo_until <= p_now)
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
      perform public.engine_queue_window_messages(w.id, 'didnt_start', null, null, 'didnt_start',
        jsonb_build_object('incident', v_busy));
      continue;
    end if;
    update public.maintenance_windows
      set start_logged = true,
          log = log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'started'))
      where id = w.id;
    insert into public.audit_log (action, entity, entity_id, before, after)
    values ('maintenance.start', 'maintenance_window', w.id, jsonb_build_object('state', 'scheduled'),
            jsonb_build_object('state', 'active', 'site_id', w.site_id, 'ends_at', w.ends_at));
    perform public.engine_queue_window_messages(w.id, 'started', null, null, 'started');
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
  for w in
    update public.maintenance_windows mw
      set end_logged = true,
          log = mw.log || jsonb_build_array(jsonb_build_object('at', mw.ends_at, 'action', 'ended'))
    where not mw.end_logged and mw.start_logged and mw.cancelled_at is null and mw.ended_at is null
      and mw.outcome is null and mw.ends_at <= p_now
      and (mw.undo_until is null or mw.undo_until <= p_now)
    returning mw.*
  loop
    insert into public.audit_log (action, entity, entity_id, before, after)
    values (case w.kind when 'mute' then 'site.mute_end' else 'maintenance.end' end,
            case w.kind when 'mute' then 'site' else 'maintenance_window' end,
            case w.kind when 'mute' then w.site_id else w.id end,
            jsonb_build_object('state', 'active'),
            jsonb_build_object('state', 'ended', 'ended_at', w.ends_at, 'window_id', w.id));
    perform public.engine_queue_window_messages(w.id,
      case w.kind when 'mute' then 'mute_ended' else 'ended' end, null, null, 'ended');
  end loop;

  -- A mute that ran out, or that maintenance ended, leaves the site row; one with no window behind it
  -- (never written by the RPCs) is logged as it goes.
  perform set_config('dxt.window_write', 'on', true);
  with cleared as (
    update public.sites s set muted_until = null, mute_reason = null, muted_at = null
    where s.muted_until is not null
      and (s.muted_until <= p_now
           or not exists (select 1 from public.maintenance_windows mm
                          where mm.site_id = s.id and mm.kind = 'mute' and mm.cancelled_at is null
                            and mm.ended_at is null and mm.starts_at <= p_now and mm.ends_at > p_now))
    returning s.id
  )
  insert into public.audit_log (action, entity, entity_id, after)
  select 'site.mute_end', 'site', c.id, jsonb_build_object('reason', 'No mute window behind it')
  from cleared c
  where not exists (select 1 from public.maintenance_windows mm where mm.site_id = c.id and mm.kind = 'mute'
                    and coalesce(mm.ended_at, mm.ends_at) between p_now - interval '2 minutes' and p_now + interval '1 minute');
end;
$$;

-- Reminders to the Admins while a request waits (§24.2): 12 h before its start (Chat + email; the
-- asker gets STILL WAITING) and 1 h before (Chat), once each. A request made under 12 h before its
-- start gets only the 1 h one, under 1 h none. Late runs still send the 12 h one until the last hour.
-- Returns how many reminders it queued.
create function public.engine_window_reminders(p_now timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  w public.maintenance_windows%rowtype;
  v_n integer := 0;
begin
  for w in
    select * from public.maintenance_windows mw
    where mw.kind = 'maintenance' and mw.approved_at is null and mw.cancelled_at is null and mw.outcome is null
      and mw.starts_at > p_now and mw.starts_at <= p_now + interval '12 hours'
      and (mw.reminded_12h_at is null or mw.reminded_1h_at is null)
    for update skip locked
  loop
    if w.reminded_12h_at is null and w.reminded_1h_at is null
       and w.created_at <= w.starts_at - interval '12 hours' and w.starts_at > p_now + interval '1 hour' then
      update public.maintenance_windows set reminded_12h_at = p_now where id = w.id;
      perform public.engine_queue_window_messages(w.id, 'reminder_12h', null, null, 'reminder_12h');
      v_n := v_n + 1;
    elsif w.reminded_1h_at is null and w.starts_at <= p_now + interval '1 hour'
          and w.created_at <= w.starts_at - interval '1 hour' then
      update public.maintenance_windows set reminded_1h_at = p_now where id = w.id;
      perform public.engine_queue_window_messages(w.id, 'reminder_1h', null, null, 'reminder_1h');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- S09 body, plus: a mute a person ended waits out its 10 s Undo before its silenced incident posts
-- (§24.8, D-037) — an Undo can't take back an alert that already went.
create or replace function public.engine_silent_incidents(p_now timestamptz)
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
    and i.escalation_plan is not null
    and not exists (
      select 1 from public.notifications n
      where n.incident_id = i.id and n.channel = 'google_chat'
        and n.template in (i.severity::text, i.severity::text || '_again', coalesce(i.episode_severity, i.severity)::text, coalesce(i.episode_severity, i.severity)::text || '_again')
        and (n.status <> 'cancelled' or n.attempts > 0))
    and not exists (
      select 1 from public.maintenance_windows mw
      where mw.site_id = i.site_id and mw.kind = 'mute' and mw.undo_until > p_now);
$$;

-- ── The notifier keeps a window's thread in order ───────────────────────
-- S08 body, plus: a window's Chat rows go in order (one thread, whoever is mentioned), and its emails
-- in order per person — as an incident's.
create or replace function public.claim_notifications(
  p_channel public.notification_channel,
  p_limit integer default 20,
  p_incident_id uuid default null
)
returns setof public.notifications
language sql
set search_path = ''
as $$
  with due as (
    select id from public.notifications
    where status = 'queued'
      and channel = p_channel
      and (p_incident_id is null or incident_id = p_incident_id)
      and (hold_until is null or hold_until <= now())
      and (next_retry_at is null or next_retry_at <= now())
      and not exists (
        select 1 from public.notifications older
        where older.incident_id = notifications.incident_id and older.channel = notifications.channel
          and older.user_id is not distinct from notifications.user_id
          and older.status = 'queued' and older.created_at < notifications.created_at
          and not (older.template in ('flap_summary', 'problem', 'problem_again')
                   and coalesce(older.hold_until > now(), false))
      )
      and not exists (
        select 1 from public.notifications older
        where older.maintenance_window_id = notifications.maintenance_window_id
          and older.channel = notifications.channel
          -- Chat: behind the action's own line and anything of an earlier action; one action's mention
          -- replies go together (db review M4). Email: in order per person.
          and (case when older.channel = 'google_chat'
                    then older.template = 'mw_line' or older.dedupe_key <> notifications.dedupe_key
                    else older.user_id is not distinct from notifications.user_id end)
          and older.status = 'queued' and older.created_at < notifications.created_at
      )
    order by created_at
    limit p_limit
    for update skip locked
  )
  update public.notifications n
    set attempts = n.attempts + 1, next_retry_at = now() + interval '90 seconds'
    from due
    where n.id = due.id
  returning n.*;
$$;

revoke execute on function
  public.engine_log_windows(timestamptz),
  public.engine_window_reminders(timestamptz),
  public.engine_silent_incidents(timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.engine_log_windows(timestamptz),
  public.engine_window_reminders(timestamptz),
  public.engine_silent_incidents(timestamptz)
  to service_role;

-- S09 body, plus the mute's end in the card's context (§24.7: "Held by a mute until 15:00"), and an
-- alert of the drop in progress counts as sent (engine review H1).
create or replace function public.engine_post_late_alert(p_incident_id uuid, p_at timestamptz, p_hold_until timestamptz default null)
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
  -- Silent: no alert of its worst severity went (engine review M-A — a PROBLEM AGAIN held back by a
  -- mute on an incident that already alerted DOWN isn't one). The card is for the drop in progress
  -- (D-023: a DOWN whose home page is back is a PROBLEM now).
  if exists (select 1 from public.notifications n
             where n.incident_id = p_incident_id and n.channel = 'google_chat'
               and n.template in (v_inc.severity::text, v_inc.severity::text || '_again',
                                  coalesce(v_inc.episode_severity, v_inc.severity)::text,
                                  coalesce(v_inc.episode_severity, v_inc.severity)::text || '_again')
               and (n.status <> 'cancelled' or n.attempts > 0)) then
    return false;
  end if;
  v_sev := coalesce(v_inc.episode_severity, v_inc.severity)::text;

  -- The facts of the drop it alerts about: its latest detection event's payload.
  select e.payload into v_context from public.incident_events e
  where e.incident_id = p_incident_id and e.type in ('detected', 'relapsed', 'escalated_to_down')
  order by e.at desc limit 1;
  v_context := coalesce(v_context, '{}'::jsonb) || jsonb_build_object('afterMute', true,
    'heldUntil', (select max(coalesce(mw.ended_at, mw.ends_at)) from public.maintenance_windows mw
                  where mw.site_id = v_inc.site_id and mw.kind = 'mute' and mw.cancelled_at is null
                    and coalesce(mw.ended_at, mw.ends_at) <= p_at
                    and coalesce(mw.ended_at, mw.ends_at) >= v_inc.detected_at));
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

