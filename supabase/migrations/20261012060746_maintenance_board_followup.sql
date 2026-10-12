-- S09b follow-up (redrawn ChatAlert / EmailAlert / MaintenancePage boards, spec §24.12–17, D-037 amended):
-- who a window's emails reach, one MUTED reply naming owner and backup, and posting a held action at
-- once when its actor moves on to the next one.

-- S09b body (20261011174143), with the recipients the redrawn boards draw.
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


-- A held action posts at once when its actor starts another, opens a row or a dialog (§24.12): its
-- messages leave on the notifier's next claim, it can no longer be undone, and its log line gets the
-- real posting time. Only the actor, and only while it is held: after the 10 s it is refused, so a
-- repeated call can't make the app dispatch again (security review L1).
create function public.post_window_action_now(p_window_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.maintenance_windows%rowtype;
  v_now timestamptz := now();
  v_last integer;
begin
  select * into w from public.maintenance_windows where id = p_window_id for update;
  if not found then
    raise exception 'window not found' using errcode = 'P0002';
  end if;
  if w.undo_by is null or w.undo_by is distinct from auth.uid() then
    raise exception 'Only the person who did it can post it now' using errcode = '42501';
  end if;
  if w.undo_until is null or v_now >= w.undo_until then
    raise exception 'Already posted' using errcode = '22023', hint = 'undo_expired';
  end if;
  update public.notifications
    set hold_until = v_now
    where maintenance_window_id = w.id and dedupe_key = w.undo_key and status = 'queued';
  -- The held action's line: the last one with a posting time (the engine may have added one of its own
  -- since, which has none — db review L1).
  select max(e.ord)::int - 1 into v_last
    from jsonb_array_elements(w.log) with ordinality as e(v, ord) where e.v ? 'posts_at';
  update public.maintenance_windows
    set undo_until = null, undo_by = null, undo_action = null, undo_key = null, undo_before = null,
        log = case when v_last is not null
                   then jsonb_set(w.log, array[v_last::text, 'posts_at'], to_jsonb(v_now))
                   else w.log end
    where id = w.id;
end;
$$;

revoke execute on function public.post_window_action_now(uuid) from public, anon;
grant execute on function public.post_window_action_now(uuid) to authenticated;
