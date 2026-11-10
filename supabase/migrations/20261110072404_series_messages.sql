-- S14 PR 2b (FR-10b, D-057, spec §32.10–11, ChatAlert "Maintenance · repeating series"): a series' own
-- messages. PR 2a's series sent none ("wait for the board"); the board is drawn.
--   · `notifications` names a sixth subject, the series (`maintenance_series_id`, thread `ms-<id>`):
--     SCHEDULED, or REQUESTED → APPROVED / DECLINED / REQUEST WITHDRAWN / NOT APPROVED, CANCELLED, and
--     SKIPPED for a window that would overlap another one. `engine_queue_series_messages` queues an action's
--     rows as `engine_queue_window_messages` does a window's: the `ms_line`, `ms_dm` replies @mentioning the
--     Admins (a request and its reminders) or the asker (the answer), and `ms_email` — owner + backup once
--     per scheduled / approved / declined / cancelled (§32.11), the Admins while it is a request.
--   · A waiting series follows the request pattern (§32.7, Tao 10 Nov 2026, amending D-057's reading):
--     reminders 12 h / 1 h before its first window, and NOT APPROVED at that window's start — nothing is
--     scheduled and a later approval is refused. `first_starts_at` holds that start, from the rule.
--   · A series' windows send no STARTED / ENDED email (§32.11); DIDN'T START still does. Their Chat lines
--     carry "· series every Tue" — the notifier words that from the window's series.
--   · `claim_notifications` takes `p_series`, so a notifier that can't render series rows never claims them.
--   · The undo of a series action waits for its dialog (PR 2c): these rows aren't held.
set local lock_timeout = '5s';

-- ── maintenance_series: its first window, the reminders and the expiry ─────────────────────────────
alter table public.maintenance_series
  add column first_starts_at timestamptz,
  add column reminded_12h_at timestamptz,
  add column reminded_1h_at timestamptz,
  add column outcome text check (outcome is null or outcome = 'not_approved');

-- Series made before this file: the first window their rule gave at creation (the same rule as below).
update public.maintenance_series m
  set first_starts_at = (
    select (d::date + m.start_time) at time zone 'Asia/Bangkok'
    from generate_series(m.starts_on, coalesce(m.until_on, m.starts_on + 400), interval '1 day') d
    where private.series_matches(m.rule, d::date)
      and (d::date + m.start_time) at time zone 'Asia/Bangkok' >= m.created_at + interval '5 minutes'
    order by d limit 1);

-- The reminder loop's look-up: waiting series only.
create index maintenance_series_waiting_idx on public.maintenance_series (first_starts_at)
  where approved_at is null and declined_at is null and cancelled_at is null;

-- ── notifications: a series is a sixth subject ──────────────────────────────────────────────────────
-- Delivery records are kept, as for windows: a series with messages isn't deleted (site delete cascades
-- would stop at them; a live site is never deleted, D-025).
alter table public.notifications
  add column maintenance_series_id uuid references public.maintenance_series (id) on delete restrict;
create index notifications_series_idx on public.notifications (maintenance_series_id)
  where maintenance_series_id is not null;
alter table public.notifications drop constraint notifications_one_subject;
alter table public.notifications
  add constraint notifications_one_subject
  check (num_nonnulls(incident_id, system_alert_id, maintenance_window_id, oncall_event_id, report_id,
                      maintenance_series_id) = 1)
  not valid;
create unique index notifications_once_per_series
  on public.notifications (maintenance_series_id, channel, template, user_id, dedupe_key) nulls not distinct
  where status <> 'cancelled' and maintenance_series_id is not null;

-- One series action's messages (as engine_queue_window_messages, §24.4–5 / §32.10–11). Kinds: scheduled,
-- requested, approved, declined, withdrawn, cancelled, skipped, not_approved, reminder_12h, reminder_1h.
-- Each person once, minus whoever did it, active people only. Rows are stamped with the clock so the
-- line opens the thread before its replies. Returns how many rows it queued.
create function public.engine_queue_series_messages(
  p_series_id uuid,
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
  ms public.maintenance_series%rowtype;
  s public.sites%rowtype;
  v_ctx jsonb;
  v_thread text;
  v_n integer := 0;
  v_k integer;
begin
  select * into ms from public.maintenance_series where id = p_series_id;
  if not found then
    return 0;
  end if;
  select * into s from public.sites where id = ms.site_id;
  v_thread := 'ms-' || ms.id;
  v_ctx := jsonb_build_object('kind', p_kind, 'at', now(),
                              'request', ms.log @> '[{"action": "requested"}]'::jsonb,
                              'by', (select display_name from public.profiles where id = p_actor))
           || p_extra;

  -- 1. The action's line in the series' Space thread (no mention, no card).
  if p_kind not in ('reminder_12h', 'reminder_1h') then
    insert into public.notifications
      (maintenance_series_id, channel, template, thread_key, context, hold_until, dedupe_key, created_at)
    values (ms.id, 'google_chat', 'ms_line', v_thread, v_ctx, p_hold, p_key, clock_timestamp());
    v_n := v_n + 1;
  end if;

  -- 2. Replies @mentioning the person: the request and its reminders to every active Admin; the answer,
  -- STILL WAITING at 12 h and NOT APPROVED to the asker (§24.1–3 with "series every Mon, Thu").
  insert into public.notifications
    (maintenance_series_id, user_id, channel, template, thread_key, context, hold_until, dedupe_key, created_at)
  select distinct on (r.id) ms.id, r.id, 'google_chat', 'ms_dm', v_thread, v_ctx || jsonb_build_object('dm', r.dm),
         p_hold, p_key, clock_timestamp()
  from (
    select p.id, p_kind as dm from public.profiles p
    where p_kind in ('requested', 'reminder_12h', 'reminder_1h') and p.role = 'admin' and p.is_active
    union all
    select p.id, case p_kind when 'reminder_12h' then 'still_waiting' else p_kind end
    from public.profiles p
    where p.id = ms.created_by and p.is_active and p.role <> 'admin'
      and p_kind in ('approved', 'declined', 'not_approved', 'reminder_12h')
  ) r
  where r.id is distinct from p_actor
  order by r.id;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;

  -- 3. Email (§32.11): owner and backup once when the series is scheduled, approved, declined or
  -- cancelled; the Admins while it is a request (requested, withdrawn, not approved, the 12 h reminder).
  -- SKIPPED and the 1 h reminder are Chat only.
  insert into public.notifications
    (maintenance_series_id, user_id, channel, template, thread_key, context, hold_until, dedupe_key, created_at)
  select distinct on (r.id) ms.id, r.id, 'email', 'ms_email', v_thread, v_ctx || jsonb_build_object('role', r.role),
         p_hold, p_key, clock_timestamp()
  from (
    select s.primary_owner_id as id, 'owner' as role, 1 as rank
    where p_kind in ('scheduled', 'approved', 'declined', 'cancelled')
    union all
    select s.backup_owner_id, 'backup', 2
    where p_kind in ('scheduled', 'approved', 'declined', 'cancelled')
    union all
    select p.id, 'admin', 4 from public.profiles p
    where p.role = 'admin' and p_kind in ('requested', 'withdrawn', 'not_approved', 'reminder_12h')
  ) r
  join public.profiles p on p.id = r.id and p.is_active
  where r.id is distinct from p_actor
  order by r.id, r.rank;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;
  return v_n;
end;
$$;

revoke execute on function public.engine_queue_series_messages(uuid, text, uuid, timestamptz, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.engine_queue_series_messages(uuid, text, uuid, timestamptz, text, jsonb)
  to service_role;

-- MAINTENANCE SKIPPED for one window of a series (§32.8): the window it overlaps, and the series' next
-- window by the rule. Keyed by the skipped start, so a skip posts once.
create function private.queue_series_skip(p_series_id uuid, p_start timestamptz)
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
  perform public.engine_queue_series_messages(ms.id, 'skipped', null, null,
    to_char(p_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
    jsonb_build_object('startsAt', p_start, 'endsAt', v_end, 'next', v_next,
                       'overlap', case when v_other_id is null then null
                                  else jsonb_build_object('id', v_other_id, 'startsAt', v_other_start,
                                                          'endsAt', v_other_end, 'reason', v_other_reason) end));
end;
$$;

revoke execute on function private.queue_series_skip(uuid, timestamptz) from public, anon, authenticated;

-- The skips an action's own expansion just logged (at `p_at`), posted after that action's line so the
-- thread opens with SCHEDULED / APPROVED.
create function private.queue_series_skips_at(p_series_id uuid, p_at timestamptz)
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
    perform private.queue_series_skip(p_series_id, v_start);
  end loop;
end;
$$;

revoke execute on function private.queue_series_skips_at(uuid, timestamptz) from public, anon, authenticated;

-- ── engine_queue_window_messages: S09b follow-up body, minus a series window's STARTED / ENDED email ─
create or replace function public.engine_queue_window_messages(
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
  ) r
  where r.id is distinct from p_actor
  order by r.id;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;

  -- Someone else muted their site: one reply @mentioning the owner and the backup together (§24.4,
  -- the redrawn ChatAlert "No Chat app yet"); `context.mention` names them.
  if p_kind = 'muted' and p_actor is distinct from s.primary_owner_id and p_actor is distinct from s.backup_owner_id then
    insert into public.notifications
      (maintenance_window_id, channel, template, thread_key, context, hold_until, dedupe_key, created_at)
    select w.id, 'google_chat', 'mw_dm', v_thread,
           v_ctx || jsonb_build_object('dm', 'muted', 'mention', jsonb_agg(
             jsonb_build_object('name', p.display_name, 'chat', p.google_chat_user_id) order by p.id = s.primary_owner_id desc)),
           p_hold, p_key, clock_timestamp()
    from public.profiles p
    where p.is_active and p.id in (s.primary_owner_id, s.backup_owner_id)
    having count(*) > 0;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end if;

  -- 3. Email (§24.5): mutes and the 1 h reminder are Chat only; the 12 h reminder goes to the Admins;
  -- everything else to the owner and the backup — the Admins too while it is a request (requested,
  -- request changed, withdrawn, not approved), the approver when it didn't start — minus whoever did it. Each
  -- person once, by the closest tie (owner, backup, approver, Admin) for the "why" line.
  -- A series' window: no STARTED / ENDED email (§32.11) — DIDN'T START still goes.
  if p_kind not in ('muted', 'mute_changed', 'mute_ended', 'mute_ended_early', 'reminder_1h')
     and not (w.series_id is not null and p_kind in ('started', 'ended')) then
    insert into public.notifications
      (maintenance_window_id, user_id, channel, template, thread_key, context, hold_until, dedupe_key, created_at)
    select distinct on (r.id) w.id, r.id, 'email', 'mw_email', v_thread, v_ctx || jsonb_build_object('role', r.role),
           p_hold, p_key, clock_timestamp()
    from (
      select s.primary_owner_id as id, 'owner' as role, 1 as rank where p_kind <> 'reminder_12h'
      union all
      select s.backup_owner_id, 'backup', 2 where p_kind <> 'reminder_12h'
      union all
      select p.id, 'admin', 4 from public.profiles p
      where p.role = 'admin'
        and ((v_request and p_kind in ('requested', 'request_changed', 'withdrawn', 'not_approved'))
             or p_kind = 'reminder_12h')
      union all
      select w.approved_by, 'approver', 3
      where p_kind = 'didnt_start' and w.approved_by is distinct from w.created_by
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

-- ── claim_notifications: series rows only for a notifier that renders them ──────────────────────────
drop function public.claim_notifications(public.notification_channel, integer, uuid, boolean, boolean);
create function public.claim_notifications(
  p_channel public.notification_channel,
  p_limit integer default 20,
  p_incident_id uuid default null,
  p_oncall boolean default false,
  p_reports boolean default false,
  p_series boolean default false
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
      -- On-call rows only for a notifier that renders them (S10 B2b); report rows likewise (S14).
      and (p_oncall or oncall_event_id is null)
      and (p_reports or report_id is null)
      and (p_series or maintenance_series_id is null)
      and (hold_until is null or hold_until <= now())
      and (next_retry_at is null or next_retry_at <= now())
      and not exists (
        select 1 from public.notifications older
        where older.incident_id = notifications.incident_id and older.channel = notifications.channel
          and older.user_id is not distinct from notifications.user_id
          and older.status = 'queued' and older.created_at < notifications.created_at
          and not (older.template in ('flap_summary', 'down', 'problem', 'down_again', 'problem_again')
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
      -- A series' thread as a window's (S14 PR 2b): Chat behind its line and earlier actions, email per person.
      and not exists (
        select 1 from public.notifications older
        where older.maintenance_series_id = notifications.maintenance_series_id
          and older.channel = notifications.channel
          and (case when older.channel = 'google_chat'
                    then older.template = 'ms_line' or older.dedupe_key <> notifications.dedupe_key
                    else older.user_id is not distinct from notifications.user_id end)
          and older.status = 'queued' and older.created_at < notifications.created_at
      )
      -- An on-call subject's thread goes in order (S10): a swap's request before its accept.
      and not exists (
        select 1 from public.notifications older
        where notifications.oncall_event_id is not null and older.oncall_event_id is not null
          and older.channel = notifications.channel and older.thread_key = notifications.thread_key
          and older.user_id is not distinct from notifications.user_id
          and older.status = 'queued' and older.created_at < notifications.created_at
      )
    -- Incidents and system alerts first (security review B2a): a burst of on-call, window or report rows
    -- never delays a DOWN.
    order by (incident_id is null and system_alert_id is null), created_at
    limit p_limit
    for update skip locked
  )
  update public.notifications n
    set attempts = n.attempts + 1, next_retry_at = now() + interval '90 seconds'
    from due
    where n.id = due.id
  returning n.*;
$$;

revoke execute on function public.claim_notifications(public.notification_channel, integer, uuid, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_notifications(public.notification_channel, integer, uuid, boolean, boolean, boolean)
  to service_role;

-- ── expand_series: PR 2a body, plus SKIPPED for an overlap ─────────────────────────────────────────
-- `p_notify` false: the caller (create / approve) posts the skips after its own line.
drop function private.expand_series(uuid, timestamptz);
create function private.expand_series(p_series_id uuid, p_now timestamptz, p_notify boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.maintenance_series%rowtype;
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_key text;
  v_skip boolean;
  v_id uuid;
  v_n integer := 0;
begin
  select * into s from public.maintenance_series where id = p_series_id for update;
  if not found or s.approved_at is null or s.cancelled_at is not null then
    return 0;
  end if;
  -- A site that stopped monitoring gets no new occurrences (db review S14); they come back with it.
  if not exists (select 1 from public.sites where id = s.site_id and is_active) then
    return 0;
  end if;
  for v_day in
    select d::date from generate_series(
      greatest(s.starts_on, (p_now at time zone 'Asia/Bangkok')::date),
      least(coalesce(s.until_on, 'infinity'::date), ((p_now + interval '14 days') at time zone 'Asia/Bangkok')::date),
      interval '1 day') d
  loop
    continue when not private.series_matches(s.rule, v_day);
    v_start := (v_day + s.start_time) at time zone 'Asia/Bangkok';
    v_end := v_start + make_interval(mins => s.duration_min);
    -- One spelling of the time whatever the session's TimeZone, so a skip is noted once (db review S14).
    v_key := to_char(v_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"');
    continue when v_start <= p_now;
    -- Too close to start (an approval at 00:57 for 01:00): noted, not silently dropped (engine review L2).
    -- No SKIPPED line for it: the APPROVED line names it (Tao, 10 Nov 2026).
    if v_start < p_now + interval '5 minutes' then
      if not s.log @> jsonb_build_array(jsonb_build_object('action', 'skipped', 'starts_at', v_key)) then
        s.log := s.log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'skipped',
          'starts_at', v_key, 'reason', 'starts in less than 5 min'));
        update public.maintenance_series set log = s.log where id = s.id;
      end if;
      continue;
    end if;
    continue when exists (select 1 from public.maintenance_windows
                          where series_id = s.id and starts_at = v_start);
    -- Overlap checked first, so no subtransaction per night for a known clash (db review S14); the
    -- exception below is only the fallback for a window made meanwhile.
    if exists (select 1 from public.maintenance_windows w
               where w.site_id = s.site_id and w.kind = 'maintenance' and w.cancelled_at is null
                 and tstzrange(w.starts_at, coalesce(w.ended_at, w.ends_at)) && tstzrange(v_start, v_end)) then
      v_skip := true;
    else
      v_skip := false;
      begin
        insert into public.maintenance_windows
          (site_id, kind, starts_at, ends_at, reason, created_by, approved_by, approved_at, series_id, log)
        values (s.site_id, 'maintenance', v_start, v_end, s.reason, s.created_by, s.approved_by, s.approved_at,
                s.id, jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'created', 'series', s.id)))
        returning id into v_id;
        -- Its own audit row (System): the series' audited create / approve says who and why.
        insert into public.audit_log (action, entity, entity_id, after)
        values ('maintenance.create', 'maintenance_window', v_id,
                jsonb_build_object('site_id', s.site_id, 'starts_at', v_start, 'ends_at', v_end,
                                   'reason', s.reason, 'approved', true, 'series_id', s.id));
        v_n := v_n + 1;
      exception when exclusion_violation then
        v_skip := true;
      end;
    end if;
    if v_skip and not s.log @> jsonb_build_array(jsonb_build_object('action', 'skipped', 'starts_at', v_key)) then
      s.log := s.log || jsonb_build_array(jsonb_build_object('at', p_now, 'action', 'skipped',
        'starts_at', v_key, 'reason', 'overlaps another window'));
      update public.maintenance_series set log = s.log where id = s.id;
      -- §32.13: one System row per skipped window.
      insert into public.audit_log (action, entity, entity_id, after)
      values ('maintenance.occurrence_skip', 'maintenance_series', s.id,
              jsonb_build_object('site_id', s.site_id, 'starts_at', v_start, 'ends_at', v_end,
                                 'reason', 'overlaps another window'));
      if p_notify then
        perform private.queue_series_skip(s.id, v_start);
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke execute on function private.expand_series(uuid, timestamptz, boolean) from public, anon, authenticated;

-- ── create_maintenance_series: PR 2a body, plus first_starts_at and SCHEDULED / REQUESTED ──────────
create or replace function public.create_maintenance_series(
  p_site_id uuid,
  p_rule jsonb,
  p_start_time time,
  p_duration_min integer,
  p_starts_on date,
  p_until_on date,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_admin boolean := coalesce(public.current_app_role() = 'admin', false);
  v_reason text;
  v_first timestamptz;
  v_id uuid;
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
  if p_rule is null or not public.valid_series_rule(p_rule) then
    raise exception 'Pick weekdays, a day of the month, or which weekday of the month'
      using errcode = '22023', hint = 'bad_rule';
  end if;
  if p_start_time is null or p_duration_min is null or p_duration_min not between 5 and 1440 then
    raise exception 'Each occurrence lasts 5 min to 24 h' using errcode = '22023', hint = 'bad_length';
  end if;
  if p_starts_on is null or p_starts_on < (v_now at time zone 'Asia/Bangkok')::date then
    raise exception 'The first day is in the past' using errcode = '22023', hint = 'starts_in_past';
  end if;
  if p_until_on is not null and p_until_on < p_starts_on then
    raise exception 'The last day is before the first' using errcode = '22023', hint = 'ends_before_start';
  end if;
  -- A year ahead at most, each way: the first day, and the last (security review S14, L1).
  if p_starts_on > (v_now at time zone 'Asia/Bangkok')::date + 366
     or (p_until_on is not null and p_until_on > p_starts_on + 366 * 2) then
    raise exception 'Pick days within the next year or two' using errcode = '22023', hint = 'too_far';
  end if;
  -- The first window: a waiting series' deadline (§32.7) and the start its reminders count back from.
  select (d::date + p_start_time) at time zone 'Asia/Bangkok' into v_first
  from generate_series(p_starts_on, least(coalesce(p_until_on, p_starts_on + 366), p_starts_on + 366),
                       interval '1 day') d
  where private.series_matches(p_rule, d::date)
    and (d::date + p_start_time) at time zone 'Asia/Bangkok' >= v_now + interval '5 minutes'
  order by d limit 1;
  if v_first is null then
    raise exception 'No occurrence falls between those days — at least 5 min from now'
      using errcode = '22023', hint = 'no_occurrence';
  end if;

  insert into public.maintenance_series
    (site_id, rule, start_time, duration_min, starts_on, until_on, reason, created_by, approved_by, approved_at,
     first_starts_at)
  values (p_site_id, p_rule, p_start_time, p_duration_min, p_starts_on, p_until_on, v_reason, auth.uid(),
          case when v_admin then auth.uid() end, case when v_admin then v_now end, v_first)
  returning id into v_id;
  perform private.series_log(v_id, case when v_admin then 'created' else 'requested' end, v_reason);
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  select auth.uid(), case when v_admin then 'maintenance.series_create' else 'maintenance.series_request' end,
         'maintenance_series', s.id,
         jsonb_build_object('site_id', s.site_id, 'rule', s.rule, 'start_time', s.start_time,
                            'duration_min', s.duration_min, 'starts_on', s.starts_on, 'until_on', s.until_on,
                            'reason', s.reason, 'approved', s.approved_at is not null)
  from public.maintenance_series s where s.id = v_id;
  perform private.expand_series(v_id, v_now, false);
  perform public.engine_queue_series_messages(v_id, case when v_admin then 'scheduled' else 'requested' end,
    auth.uid(), null, case when v_admin then 'scheduled' else 'requested' end);
  perform private.queue_series_skips_at(v_id, v_now);
  return v_id;
end;
$$;

-- ── decide_maintenance_series: PR 2a body, plus the deadline and APPROVED / DECLINED ───────────────
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
begin
  if not coalesce(public.current_app_role() = 'admin', false) then
    raise exception 'Only an Admin approves a series' using errcode = '42501';
  end if;
  select * into s from public.maintenance_series where id = p_series_id for update;
  if not found then
    raise exception 'series not found' using errcode = 'P0002';
  end if;
  -- Not approved by its first window: nothing was scheduled, and it can't be approved now (§32.7).
  if s.outcome = 'not_approved'
     or (p_approve and s.approved_at is null and s.cancelled_at is null and s.declined_at is null
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
    perform public.engine_queue_series_messages(s.id, 'approved', auth.uid(), null, 'approved',
      jsonb_build_object('windows', v_windows, 'tooSoon', v_soon));
    perform private.queue_series_skips_at(s.id, v_now);
  else
    perform public.engine_queue_series_messages(s.id, 'declined', auth.uid(), null, 'declined',
      jsonb_build_object('reason', v_reason));
  end if;
end;
$$;

-- ── cancel_maintenance_series: PR 2a body, plus CANCELLED / REQUEST WITHDRAWN ──────────────────────
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
  v_reason := private.require_reason(p_reason);
  v_withdraw := s.approved_at is null and s.created_by = auth.uid();
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
    auth.uid(), null, case when v_withdraw then 'withdrawn' else 'cancelled' end,
    jsonb_build_object('reason', v_reason,
                       'cancelled', (select coalesce(jsonb_agg(g -> 'starts_at'), '[]'::jsonb)
                                     from jsonb_array_elements(v_gone) g),
                       'running', exists (select 1 from public.maintenance_windows w
                                          where w.series_id = s.id and w.start_logged and not w.end_logged
                                            and w.cancelled_at is null)));
  return v_n;
end;
$$;

-- ── engine_window_reminders: S09b body, plus a waiting series (§32.7) ──────────────────────────────
-- The engine run calls it every minute, so a waiting series' reminders and its expiry live here: 12 h
-- before its first window (Chat + email to the Admins, STILL WAITING to the asker) and 1 h before
-- (Chat), once each; at that window's start, NOT APPROVED — nothing is scheduled. Returns how many it
-- queued.
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
