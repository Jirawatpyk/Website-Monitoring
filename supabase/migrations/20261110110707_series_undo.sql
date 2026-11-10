-- S14 PR 2c-1 (D-057 amended 10 Nov, spec §32.6–7): the 10 s Undo of a series action, as one window's
-- (S09b, §24.8). Tao chose it for all four: approve, decline, cancel and withdraw.
--   · `maintenance_series.undo_*` as on maintenance_windows; `private.series_undo_begin` saves the series
--     as it is. The decide and cancel RPCs hold their messages 10 s under the Undo key (SKIPPED lines an
--     approval posts too, keyed `<undo key>:<start>`).
--   · `undo_series_action` (the actor, inside 10 s, nothing claimed): an approval's windows are deleted
--     (none has started or posted: the first is ≥ 5 min away) and its skips taken out of the log, so a new
--     approval notes and posts them again; a cancel's windows come back, against today's rules (an overlap
--     made meanwhile, a site no longer live). The held rows are cancelled ('Undone').
--   · `post_series_action_now` posts a held action at once (the actor moved on), as for windows.
--   · The engine leaves a series inside its Undo alone (reminders, NOT APPROVED).
--   · `maintenance_series` joins the Realtime publication, so /maintenance refreshes.
set local lock_timeout = '5s';

alter table public.maintenance_series
  add column undo_until timestamptz,
  add column undo_by uuid references public.profiles (id) on delete set null,
  add column undo_action text,
  add column undo_key text,
  add column undo_before jsonb;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'maintenance_series'
  ) then
    alter publication supabase_realtime add table public.maintenance_series;
  end if;
end;
$$;

-- Starts an action's 10 s Undo: saves the series as it is now and the moment of the action (its log
-- lines and skips carry it), marks who may undo it until when, and returns the key its messages carry.
create function private.series_undo_begin(s public.maintenance_series, p_action text, p_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := gen_random_uuid()::text;
begin
  update public.maintenance_series
    set undo_until = p_at + interval '10 seconds', undo_by = auth.uid(), undo_action = p_action, undo_key = v_key,
        undo_before = jsonb_build_object(
          'at', p_at, 'approved_at', s.approved_at, 'approved_by', s.approved_by,
          'declined_at', s.declined_at, 'cancelled_at', s.cancelled_at, 'cancelled_by', s.cancelled_by,
          'log_length', jsonb_array_length(s.log))
    where id = s.id;
  return v_key;
end;
$$;

revoke execute on function private.series_undo_begin(public.maintenance_series, text, timestamptz)
  from public, anon, authenticated;

-- ── SKIPPED, held with an action ────────────────────────────────────────────────────────────────────
-- 20261110072404 bodies, plus a hold and a key: an approval's skips wait out its Undo under
-- `<undo key>:<start>` (one row each — the once-per-series index includes the key). The nightly top-up
-- passes neither: keyed by the start alone, posted at once.
drop function private.queue_series_skips_at(uuid, timestamptz);
drop function private.queue_series_skip(uuid, timestamptz);

create function private.queue_series_skip(
  p_series_id uuid,
  p_start timestamptz,
  p_hold timestamptz default null,
  p_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms public.maintenance_series%rowtype;
  v_end timestamptz;
  v_other_id uuid;
  v_other_start timestamptz;
  v_other_end timestamptz;
  v_other_reason text;
  v_next timestamptz;
  v_start_key text := to_char(p_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"');
begin
  select * into ms from public.maintenance_series where id = p_series_id;
  if not found then
    return;
  end if;
  v_end := p_start + make_interval(mins => ms.duration_min);
  select w.id, w.starts_at, coalesce(w.ended_at, w.ends_at), w.reason
    into v_other_id, v_other_start, v_other_end, v_other_reason
  from public.maintenance_windows w
  where w.site_id = ms.site_id and w.kind = 'maintenance' and w.cancelled_at is null
    and w.series_id is distinct from ms.id
    and tstzrange(w.starts_at, coalesce(w.ended_at, w.ends_at)) && tstzrange(p_start, v_end)
  order by w.starts_at limit 1;
  select (d::date + ms.start_time) at time zone 'Asia/Bangkok' into v_next
  from generate_series((p_start at time zone 'Asia/Bangkok')::date + 1,
                       least(coalesce(ms.until_on, 'infinity'::date), (p_start at time zone 'Asia/Bangkok')::date + 400),
                       interval '1 day') d
  where private.series_matches(ms.rule, d::date)
  order by d limit 1;
  perform public.engine_queue_series_messages(ms.id, 'skipped', null, p_hold,
    case when p_key is null then v_start_key else p_key || ':' || v_start_key end,
    jsonb_build_object('startsAt', p_start, 'endsAt', v_end, 'next', v_next,
                       'overlap', case when v_other_id is null then null
                                  else jsonb_build_object('id', v_other_id, 'startsAt', v_other_start,
                                                          'endsAt', v_other_end, 'reason', v_other_reason) end));
end;
$$;

create function private.queue_series_skips_at(
  p_series_id uuid,
  p_at timestamptz,
  p_hold timestamptz default null,
  p_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
begin
  for v_start in
    select (e ->> 'starts_at')::timestamptz
    from public.maintenance_series m, jsonb_array_elements(m.log) e
    where m.id = p_series_id and e ->> 'action' = 'skipped' and e ->> 'reason' = 'overlaps another window'
      and (e ->> 'at')::timestamptz = p_at
    order by 1
  loop
    perform private.queue_series_skip(p_series_id, v_start, p_hold, p_key);
  end loop;
end;
$$;

revoke execute on function private.queue_series_skip(uuid, timestamptz, timestamptz, text),
  private.queue_series_skips_at(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;


-- ── decide_maintenance_series: 20261110072404 body, held 10 s for its Undo ──────────────────────
create or replace function public.decide_maintenance_series(p_series_id uuid, p_approve boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.maintenance_series%rowtype;
  v_now timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_windows jsonb;
  v_soon jsonb;
  v_key text;
  v_hold timestamptz := v_now + interval '10 seconds';
begin
  if not coalesce(public.current_app_role() = 'admin', false) then
    raise exception 'Only an Admin approves a series' using errcode = '42501';
  end if;
  select * into s from public.maintenance_series where id = p_series_id for update;
  if not found then
    raise exception 'series not found' using errcode = 'P0002';
  end if;
  -- Not approved by its first window: nothing was scheduled, and it can't be approved — nor declined —
  -- now (§32.7; the engine's NOT APPROVED wins, engine review L1).
  if s.outcome = 'not_approved'
     or (s.approved_at is null and s.cancelled_at is null and s.declined_at is null
         and coalesce(s.first_starts_at, s.created_at) <= v_now) then
    raise exception 'Nobody approved it before its first window — ask again'
      using errcode = '22023', hint = 'not_approved';
  end if;
  if s.approved_at is not null or s.declined_at is not null or s.cancelled_at is not null then
    raise exception 'This series was decided already' using errcode = '22023', hint = 'already_decided';
  end if;
  -- A reason is required to decline; an approval's optional note has the same 500-character cap
  -- (security review S14 PR 2b, L2).
  if not p_approve or v_reason is not null then
    v_reason := private.require_reason(p_reason);
  end if;
  -- The 10 s Undo (D-057 amended 10 Nov): the series as it was, and the key its held rows carry.
  v_key := private.series_undo_begin(s, case when p_approve then 'approved' else 'declined' end, v_now);
  update public.maintenance_series
    set approved_at = case when p_approve then v_now end,
        approved_by = case when p_approve then auth.uid() end,
        declined_at = case when p_approve then null else v_now end
    where id = s.id;
  perform private.series_log(s.id, case when p_approve then 'approved' else 'declined' end, v_reason);
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case when p_approve then 'maintenance.series_approve' else 'maintenance.series_decline' end,
          'maintenance_series', s.id, jsonb_build_object('state', 'waiting'),
          jsonb_build_object('state', case when p_approve then 'approved' else 'declined' end,
                             'site_id', s.site_id, 'reason', v_reason));
  if p_approve then
    perform private.expand_series(s.id, v_now, false);
    -- "2 windows scheduled (Tue 15 Sep, Tue 22 Sep)"; one too close to start is named on the line too.
    select coalesce(jsonb_agg(w.starts_at order by w.starts_at), '[]'::jsonb) into v_windows
    from public.maintenance_windows w where w.series_id = s.id and w.cancelled_at is null;
    select coalesce(jsonb_agg(e ->> 'starts_at' order by e ->> 'starts_at'), '[]'::jsonb) into v_soon
    from public.maintenance_series m, jsonb_array_elements(m.log) e
    where m.id = s.id and e ->> 'action' = 'skipped' and e ->> 'reason' = 'starts in less than 5 min'
      and (e ->> 'at')::timestamptz = v_now;
    perform public.engine_queue_series_messages(s.id, 'approved', auth.uid(), v_hold, v_key,
      jsonb_build_object('windows', v_windows, 'tooSoon', v_soon));
    perform private.queue_series_skips_at(s.id, v_now, v_hold, v_key);
  else
    perform public.engine_queue_series_messages(s.id, 'declined', auth.uid(), v_hold, v_key,
      jsonb_build_object('reason', v_reason));
  end if;
end;
$$;

-- ── cancel_maintenance_series: 20261110072404 body, held 10 s for its Undo ──────────────────────
create or replace function public.cancel_maintenance_series(p_series_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.maintenance_series%rowtype;
  v_reason text;
  v_n integer;
  v_gone jsonb;
  v_withdraw boolean;
  v_key text;
begin
  select * into s from public.maintenance_series where id = p_series_id for update;
  if not found then
    raise exception 'series not found' using errcode = 'P0002';
  end if;
  -- The site's owner / backup or an Admin; the asker only while still an active Responder (as
  -- withdraw_request, S09b; security review S14, M1).
  if not (private.can_pause(s.site_id)
          or (coalesce(public.current_app_role() = 'responder', false) and s.created_by = auth.uid())) then
    raise exception 'This role can''t cancel this series' using errcode = '42501';
  end if;
  if s.cancelled_at is not null or s.declined_at is not null then
    raise exception 'This series is over already' using errcode = '22023', hint = 'already_over';
  end if;
  -- Once a waiting series' first window has come, NOT APPROVED wins (checked first, so nobody is told to
  -- decline what can't be declined either). A series with no first window known can still be withdrawn —
  -- the engine marks it NOT APPROVED on its next run anyway (engine review L-a).
  if s.approved_at is null and s.first_starts_at <= now() then
    raise exception 'Nobody approved it before its first window — ask again'
      using errcode = '22023', hint = 'not_approved';
  end if;
  -- A waiting series is the asker's to withdraw or an Admin's to decline (§32.7: others see "Waiting for an
  -- Admin"; code, message and engine review S14 PR 2b).
  if s.approved_at is null and s.created_by is distinct from auth.uid() then
    raise exception 'A waiting series is withdrawn by whoever asked for it, or declined by an Admin'
      using errcode = '42501', hint = 'use_decline';
  end if;
  v_reason := private.require_reason(p_reason);
  v_withdraw := s.approved_at is null;
  v_key := private.series_undo_begin(s, case when v_withdraw then 'withdrawn' else 'cancelled' end, now());
  update public.maintenance_series set cancelled_at = now(), cancelled_by = auth.uid() where id = s.id;
  perform private.series_log(s.id, 'cancelled', v_reason);
  with gone as (
    update public.maintenance_windows w
      -- Only cancelled: every engine loop skips a cancelled row, and start_logged keeps meaning "it ran"
      -- (engine review S14, L1). "Not started" is the engine's start_logged, not the clock: one whose start
      -- has come but isn't logged yet is cancelled too (M1); the engine locks a row it is starting.
      set cancelled_at = now(),
          log = w.log || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'cancelled',
            'by', (select display_name from public.profiles where id = auth.uid()),
            'reason', v_reason, 'series', s.id))
    where w.series_id = s.id and w.cancelled_at is null and not w.start_logged
    returning w.id, w.starts_at
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object('id', id, 'starts_at', starts_at) order by starts_at),
                            '[]'::jsonb)
    into v_n, v_gone from gone;
  update public.maintenance_series
    set undo_before = undo_before || jsonb_build_object('windows',
      (select coalesce(jsonb_agg(g -> 'id'), '[]'::jsonb) from jsonb_array_elements(v_gone) g))
    where id = s.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  -- §32.7 / §32.13: the asker taking back a series still waiting withdraws it; anything else cancels.
  values (auth.uid(),
          case when v_withdraw then 'maintenance.series_withdraw' else 'maintenance.series_cancel' end,
          'maintenance_series', s.id,
          jsonb_build_object('state', case when s.approved_at is null then 'waiting' else 'approved' end),
          jsonb_build_object('state', 'cancelled', 'site_id', s.site_id, 'reason', v_reason,
                             'occurrences_cancelled', v_gone));
  -- One line for the series, none per window (§32.6); a running window finishes and says nothing here.
  perform public.engine_queue_series_messages(s.id, case when v_withdraw then 'withdrawn' else 'cancelled' end,
    auth.uid(), now() + interval '10 seconds', v_key,
    jsonb_build_object('reason', v_reason,
                       'cancelled', (select coalesce(jsonb_agg(g -> 'starts_at'), '[]'::jsonb)
                                     from jsonb_array_elements(v_gone) g),
                       'running', exists (select 1 from public.maintenance_windows w
                                          where w.series_id = s.id and w.start_logged and not w.end_logged
                                            and w.cancelled_at is null
                                            and coalesce(w.ended_at, w.ends_at) > now())));
  return v_n;
end;
$$;

-- ── engine_window_reminders: 20261110072404 body, waiting out a series' Undo ─────────────────────
create or replace function public.engine_window_reminders(p_now timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  w public.maintenance_windows%rowtype;
  ms public.maintenance_series%rowtype;
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

  -- A waiting series nobody approved by its first window: over, nothing scheduled (ask again).
  for ms in
    update public.maintenance_series m
      set cancelled_at = coalesce(m.first_starts_at, p_now), outcome = 'not_approved',
          log = m.log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'not_approved'))
    where m.approved_at is null and m.declined_at is null and m.cancelled_at is null
      and coalesce(m.first_starts_at, m.created_at) <= p_now
      and (m.undo_until is null or m.undo_until <= p_now)
    returning m.*
  loop
    insert into public.audit_log (action, entity, entity_id, before, after)
    values ('maintenance.series_not_approved', 'maintenance_series', ms.id, jsonb_build_object('state', 'waiting'),
            jsonb_build_object('state', 'not_approved', 'site_id', ms.site_id, 'deadline', ms.first_starts_at));
    perform public.engine_queue_series_messages(ms.id, 'not_approved', null, null, 'not_approved');
    v_n := v_n + 1;
  end loop;

  for ms in
    select * from public.maintenance_series m
    where m.approved_at is null and m.declined_at is null and m.cancelled_at is null
      and m.first_starts_at > p_now and m.first_starts_at <= p_now + interval '12 hours'
      and (m.reminded_12h_at is null or m.reminded_1h_at is null)
      and (m.undo_until is null or m.undo_until <= p_now)
    for update skip locked
  loop
    if ms.reminded_12h_at is null and ms.reminded_1h_at is null
       and ms.created_at <= ms.first_starts_at - interval '12 hours' and ms.first_starts_at > p_now + interval '1 hour' then
      update public.maintenance_series set reminded_12h_at = p_now where id = ms.id;
      perform public.engine_queue_series_messages(ms.id, 'reminder_12h', null, null, 'reminder_12h');
      v_n := v_n + 1;
    elsif ms.reminded_1h_at is null and ms.first_starts_at <= p_now + interval '1 hour'
          and ms.created_at <= ms.first_starts_at - interval '1 hour' then
      update public.maintenance_series set reminded_1h_at = p_now where id = ms.id;
      perform public.engine_queue_series_messages(ms.id, 'reminder_1h', null, null, 'reminder_1h');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ── Undo ────────────────────────────────────────────────────────────────────────────────────────────
-- Undo the last held action on a series: only the person who did it, inside its 10 s, before the
-- notifier took any of its messages. The series goes back as it was; its log and the audit trail gain a
-- line (the action's own line stays, as on a window).
create function public.undo_series_action(p_series_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.maintenance_series%rowtype;
  b jsonb;
  v_key text;
  v_action text;
  v_at timestamptz;
begin
  select * into s from public.maintenance_series where id = p_series_id for update;
  if not found then
    raise exception 'series not found' using errcode = 'P0002';
  end if;
  if s.undo_by is null or s.undo_by is distinct from auth.uid() then
    raise exception 'Only the person who did it can undo it' using errcode = '42501';
  end if;
  -- Its messages are locked first, so the notifier (skip locked) can't take one meanwhile.
  perform 1 from public.notifications n
  where n.maintenance_series_id = s.id and (n.dedupe_key = s.undo_key or n.dedupe_key like s.undo_key || ':%')
  for update;
  if s.undo_until is null or now() >= s.undo_until
     or exists (select 1 from public.notifications n
                where n.maintenance_series_id = s.id
                  and (n.dedupe_key = s.undo_key or n.dedupe_key like s.undo_key || ':%')
                  and (n.status <> 'queued' or n.attempts > 0) and n.status <> 'cancelled') then
    raise exception 'Too late to undo — it has been posted' using errcode = '22023', hint = 'undo_expired';
  end if;
  b := s.undo_before;
  v_key := s.undo_key;
  v_action := s.undo_action;
  v_at := (b ->> 'at')::timestamptz;

  if v_action = 'approved' then
    -- The windows it made: none has started (the first is ≥ 5 min away) nor posted (a series' window says
    -- nothing before it starts). Every window of the series goes — it had none while waiting — so a
    -- nightly top-up inside the 10 s goes too.
    if exists (select 1 from public.maintenance_windows w
               where w.series_id = s.id and (w.start_logged or exists (
                 select 1 from public.notifications n where n.maintenance_window_id = w.id))) then
      raise exception 'Too late to undo — a window has started' using errcode = '22023', hint = 'undo_expired';
    end if;
    delete from public.maintenance_windows where series_id = s.id;
  elsif v_action in ('cancelled', 'withdrawn') then
    if not exists (select 1 from public.sites where id = s.site_id and is_active) then
      raise exception 'The site stopped monitoring — it can''t be undone'
        using errcode = '22023', hint = 'site_not_live';
    end if;
    begin
      update public.maintenance_windows w
        set cancelled_at = null,
            log = w.log || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'undone', 'series', s.id))
        where w.series_id = s.id
          and w.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(b -> 'windows', '[]'::jsonb)) x);
    exception when exclusion_violation then
      raise exception 'Another window now overlaps one of its windows — it can''t be undone'
        using errcode = '22023', hint = 'undo_overlap';
    end;
  end if;

  update public.maintenance_series
    set approved_at = (b ->> 'approved_at')::timestamptz,
        approved_by = (b ->> 'approved_by')::uuid,
        declined_at = (b ->> 'declined_at')::timestamptz,
        cancelled_at = (b ->> 'cancelled_at')::timestamptz,
        cancelled_by = (b ->> 'cancelled_by')::uuid,
        -- An approval's skips come out, so the next approval notes (and posts) them again.
        log = (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
               from jsonb_array_elements(s.log) with ordinality as x(e, ord)
               where not (v_action = 'approved' and e ->> 'action' = 'skipped'
                          and (e ->> 'at')::timestamptz = v_at))
              || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'undone', 'undid', v_action,
                   'by', (select display_name from public.profiles where id = auth.uid()))),
        undo_until = null, undo_by = null, undo_action = null, undo_key = null, undo_before = null
    where id = s.id;
  update public.notifications
    set status = 'cancelled', error = 'Undone'
    where maintenance_series_id = s.id and (dedupe_key = v_key or dedupe_key like v_key || ':%')
      and status = 'queued';
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'maintenance.series_undo', 'maintenance_series', s.id,
          jsonb_build_object('action', v_action), b || jsonb_build_object('undid', v_action));
end;
$$;

-- A held action posts at once when its actor starts another (§24.12): its messages leave on the
-- notifier's next claim and it can no longer be undone; the actor and the key stay, so a late Undo is
-- told it was posted.
create function public.post_series_action_now(p_series_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.maintenance_series%rowtype;
  v_now timestamptz := now();
begin
  select * into s from public.maintenance_series where id = p_series_id for update;
  if not found then
    raise exception 'series not found' using errcode = 'P0002';
  end if;
  if s.undo_by is null or s.undo_by is distinct from auth.uid() then
    raise exception 'Only the person who did it can post it now' using errcode = '42501';
  end if;
  if s.undo_until is null or v_now >= s.undo_until then
    raise exception 'Already posted' using errcode = '22023', hint = 'undo_expired';
  end if;
  update public.notifications
    set hold_until = v_now
    where maintenance_series_id = s.id and (dedupe_key = s.undo_key or dedupe_key like s.undo_key || ':%')
      and status = 'queued';
  update public.maintenance_series set undo_until = v_now where id = s.id;
end;
$$;

revoke execute on function public.undo_series_action(uuid), public.post_series_action_now(uuid)
  from public, anon;
grant execute on function public.undo_series_action(uuid), public.post_series_action_now(uuid)
  to authenticated;
