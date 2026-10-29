-- S10 B1a · on-call routing (D-048). Routing is inert until the engine passes p_outside_hours (B1b);
-- the on-call access below works at once, but only once a rotation has shifts (none on production yet).
--   · The L0 person is frozen in incidents.l0_user_id when the ladder clock starts: open, a D-021 raise
--     that restarts it (not acknowledged), and the first alert after a mute. Tier 1 outside response
--     hours (the runner's verdict: nights, weekends, company holidays) → the person on call; otherwise,
--     or with nobody on call, null = the owner. A relapse keeps it.
--   · "Owner / on-call": escalation_people's owner token reads it (active, else the owner), so the
--     ladder's told-already set, the reminders and the fallback follow; L0's emails go to everyone L0
--     names (the pencil, D-034 → S10).
--   · The on-call person acts on Tier 1 incidents (ack, notes, root cause, resolve) through private.can_ack
--     and may mute (and end / shorten their own mute) — not owns_site, which also lets an owner edit the
--     site, and not every maintenance right (can_pause keeps the owner / backup rule).

-- ── Who L0 names ─────────────────────────────────────────────────────────────
create function public.engine_l0_people(p_incident_id uuid)
returns table (user_id uuid)
language sql
stable
set search_path = ''
as $$
  select distinct pe.user_id
  from public.incidents i
  cross join lateral public.escalation_people(i.id, coalesce(
    (select st -> 'targets' from jsonb_array_elements(i.escalation_plan -> 'steps') st
     where (st ->> 'level')::smallint = 0 limit 1),
    '["owner"]'::jsonb)) pe
  where i.id = p_incident_id;
$$;

-- L0's alert email to everyone L0 names, when L0 emails (always the owner / on-call before the pencil).
-- p_only_unemailed: a relapse emails only an L0 person not emailed about this incident yet (D-047).
create function public.engine_queue_l0_emails(
  p_incident_id uuid, p_template text, p_context jsonb, p_hold timestamptz, p_dedupe text,
  p_only_unemailed boolean
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.notifications
    (incident_id, user_id, channel, template, thread_key, context, dedupe_key, hold_until)
  select p_incident_id, l.user_id, 'email', p_template, p_incident_id::text, p_context, coalesce(p_dedupe, ''), p_hold
  from public.engine_l0_people(p_incident_id) l
  where coalesce((
      select st -> 'channels' ? 'email'
      from public.incidents i, jsonb_array_elements(i.escalation_plan -> 'steps') st
      where i.id = p_incident_id and (st ->> 'level')::smallint = 0 limit 1), true)
    and not (p_only_unemailed and exists (
      select 1 from public.notifications e
      where e.incident_id = p_incident_id and e.channel = 'email' and e.status <> 'cancelled'
        and e.user_id = l.user_id))
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.engine_l0_people(uuid),
  public.engine_queue_l0_emails(uuid, text, jsonb, timestamptz, text, boolean)
  from public, anon, authenticated;
grant execute on function public.engine_l0_people(uuid),
  public.engine_queue_l0_emails(uuid, text, jsonb, timestamptz, text, boolean)
  to service_role;

-- ── Owner / on-call ──────────────────────────────────────────────────────────

create or replace function public.escalation_people(p_incident_id uuid, p_targets jsonb)
returns table (user_id uuid, token text, chat_user_id text)
language sql
stable
set search_path = ''
as $$
  select distinct on (x.uid) x.uid, x.token, p.google_chat_user_id
  from (
    -- "Owner / on-call" (S10): the L0 person frozen on the incident while active, else the owner.
    select coalesce(l.id, s.primary_owner_id) as uid, 'owner' as token, 1 as ord
      from public.incidents i join public.sites s on s.id = i.site_id
      left join public.profiles l on l.id = i.l0_user_id and l.is_active and l.role in ('admin', 'responder')
      where i.id = p_incident_id and p_targets ? 'owner'
    union all
    select s.backup_owner_id, 'backup', 2
      from public.incidents i join public.sites s on s.id = i.site_id
      where i.id = p_incident_id and p_targets ? 'backup'
    union all
    select c.am_user_id, 'site_am', 3
      from public.incidents i join public.sites s on s.id = i.site_id
      join public.clients c on c.id = s.client_id
      where i.id = p_incident_id and p_targets ? 'site_am'
    union all
    select a.id, 'admins', 4
      from public.profiles a
      where a.role = 'admin' and a.is_active and p_targets ? 'admins'
    union all
    -- The CEO (D-032): a stakeholder who manages no client.
    select c.id, 'ceo', 5
      from public.profiles c
      where c.role = 'stakeholder' and c.is_active and p_targets ? 'ceo'
        and not exists (select 1 from public.clients k where k.am_user_id = c.id)
  ) x
  join public.profiles p on p.id = x.uid and p.is_active
  where x.uid is not null
  order by x.uid, x.ord;
$$;



-- ── The on-call person acts on Tier 1 incidents ─────────────────────────────
-- On call now, or the L0 person of an open incident on that site (a Monday 09:05 ack of a Sunday page).
create function private.oncall_acts_on(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.sites s
    where s.id = p_site_id and s.tier = 1
      and (public.oncall_person_at(now()) = auth.uid()
           or exists (select 1 from public.incidents i
                      where i.site_id = s.id and i.l0_user_id = auth.uid()
                        and i.state not in ('resolved', 'in_review', 'closed'))));
$$;

create or replace function private.can_ack(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: a person without an active profile has no role (null), which must read as "no".
  select coalesce(public.current_app_role() = 'admin'
      or (public.current_app_role() = 'responder'
          and (public.owns_site(p_site_id) or private.oncall_acts_on(p_site_id))), false);
$$;

revoke execute on function private.oncall_acts_on(uuid) from public, anon, authenticated;

-- Mute and maintenance keep the owner / backup rule (PRD §3, D-012); can_ack's on-call branch would
-- otherwise hand the person on call every window on every Tier 1 site. On call may mute (D-048 item 10)
-- and end or shorten a mute they set.
create or replace function private.can_pause(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin'
      or (public.current_app_role() = 'responder' and public.owns_site(p_site_id)), false);
$$;

create function private.can_mute_oncall(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'responder' and private.oncall_acts_on(p_site_id), false);
$$;

revoke execute on function private.can_mute_oncall(uuid) from public, anon, authenticated;

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
  if not (private.can_pause(p_site_id) or private.can_mute_oncall(p_site_id)) then
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
  if not (private.can_pause(w.site_id)
          or (w.kind = 'mute' and w.created_by = auth.uid() and private.can_mute_oncall(w.site_id))) then
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
  if not (private.can_pause(w.site_id)
          or (w.kind = 'mute' and w.created_by = auth.uid() and private.can_mute_oncall(w.site_id))) then
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


-- ── L0: frozen at the ladder clock start, emails to everyone L0 names ───────

-- ── New p_outside_hours parameter: drop the old signatures, same grants ─────
drop function public.engine_open_incident(
  uuid, uuid, public.incident_trigger, public.severity, timestamptz, timestamptz, timestamptz, jsonb,
  boolean, jsonb, public.site_state, timestamptz);
drop function public.engine_escalate_incident(
  uuid, timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state, boolean);
drop function public.engine_post_late_alert(uuid, timestamptz, timestamptz);

create function public.engine_open_incident(
  p_site_id uuid,
  p_monitor_id uuid,
  p_trigger public.incident_trigger,
  p_severity public.severity,
  p_started_at timestamptz,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean,
  p_monitors jsonb default null,
  p_status public.site_state default null,
  p_hold_until timestamptz default null,
  p_outside_hours boolean default false
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_verify_job uuid := nullif(p_context ->> 'verifyJobId', '')::uuid;
  v_hold timestamptz := case when p_severity = 'problem' and p_hold_until > p_detected_at
                             then p_hold_until end;
begin
  insert into public.incidents (site_id, monitor_id, trigger, severity, episode_severity, started_at,
                                detected_at, escalation_plan, l0_user_id)
  select p_site_id, p_monitor_id, p_trigger, p_severity, p_severity, p_started_at, p_detected_at,
         public.escalation_plan_for(s.tier, p_severity),
         -- S10: Tier 1 outside response hours (nights, weekends, holidays) pages the person on call.
         case when s.tier = 1 and p_outside_hours then public.oncall_person_at(p_detected_at) end
  from public.sites s where s.id = p_site_id
  on conflict (site_id) where state not in ('resolved', 'in_review', 'closed') do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.incident_events (incident_id, type, payload, at)
  values (v_id, 'detected',
          case when v_hold is null then p_context else p_context || jsonb_build_object('heldUntil', v_hold) end,
          p_detected_at);

  insert into public.audit_log (action, entity, entity_id, after)
  values ('incident.opened', 'incident', v_id,
          jsonb_build_object('state', 'unacked', 'severity', p_severity, 'trigger', p_trigger,
                             'site_id', p_site_id, 'started_at', p_started_at,
                             'l0_user_id', (select l0_user_id from public.incidents where id = v_id)));

  insert into public.site_status as s
    (site_id, status, since, last_evaluated_at, last_round_at, ok_rounds)
  values (p_site_id, p_severity::text::public.site_state, p_started_at, p_detected_at, p_round_at, 0)
  on conflict (site_id) do update
    set status = excluded.status, since = excluded.since,
        last_evaluated_at = excluded.last_evaluated_at, last_round_at = excluded.last_round_at,
        ok_rounds = 0
    where s.last_round_at is null or s.last_round_at <= excluded.last_round_at;

  perform public.engine_record_flip(p_site_id, p_round_at, false);

  if p_trigger = 'hard_fail' then
    -- The browser's verdict links its job; without its screenshot, an evidence job takes one.
    if v_verify_job is not null then
      update public.verification_jobs set incident_id = v_id where id = v_verify_job;
      insert into public.incident_events (incident_id, type, payload, at)
      select v_id, 'evidence',
             jsonb_build_object('screenshotPath', j.screenshot_path, 'result', j.result, 'jobId', j.id),
             coalesce(j.completed_at, p_detected_at)
      from public.verification_jobs j
      where j.id = v_verify_job and j.screenshot_path is not null;
    end if;
    if not exists (select 1 from public.incident_events e where e.incident_id = v_id and e.type = 'evidence') then
      insert into public.verification_jobs (kind, monitor_id, site_id, incident_id, url)
      select 'evidence', m.id, p_site_id, v_id, m.url
      from public.monitors m where m.id = p_monitor_id
      on conflict do nothing;
    end if;
  end if;

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
    values (v_id, 'google_chat', p_severity::text, v_id::text, p_context, v_hold);

    -- D-047: the email waits 5 min — a drop that recovers inside it sends no email at all.
    perform public.engine_queue_l0_emails(v_id, p_severity::text, p_context,
                                           greatest(v_hold, now() + interval '5 minutes'), null, false);
  end if;

  perform public.engine_write_monitors(p_site_id, p_round_at, p_monitors, p_status);
  return v_id;
end;
$$;


create function public.engine_escalate_incident(
  p_incident_id uuid,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean,
  p_monitors jsonb default null,
  p_status public.site_state default null,
  p_flapping boolean default false,
  p_outside_hours boolean default false
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_from public.incident_state;
  v_to public.incident_state;
  v_verify_job uuid := nullif(p_context ->> 'verifyJobId', '')::uuid;
begin
  select site_id, state into v_site_id, v_from
  from public.incidents
  where id = p_incident_id and severity = 'problem' and state not in ('resolved', 'in_review', 'closed')
  for update;

  if v_site_id is null then
    return false;
  end if;

  update public.incidents i
    set severity = 'down',
        episode_severity = 'down',
        detected_at = p_detected_at,
        is_flapping = is_flapping or coalesce(p_flapping, false),
        recovered_at = case when state in ('monitoring', 'needs_root_cause') then null else recovered_at end,
        escalation_plan = public.escalation_plan_for(s.tier, 'down'),
        escalation_level = case when acked_at is not null then escalation_level else 0 end,
        -- The ladder clock restarts unless acknowledged: so does who L0 pages (S10).
        l0_user_id = case when acked_at is not null then l0_user_id
                          when s.tier = 1 and p_outside_hours then public.oncall_person_at(p_detected_at) end,
        state = case
          when acked_at is not null then
            case when state in ('monitoring', 'needs_root_cause') then 'acknowledged'::public.incident_state
                 else state end
          else 'unacked'::public.incident_state
        end
    from public.sites s
    where i.id = p_incident_id and s.id = i.site_id
    returning i.state into v_to;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'escalated_to_down', p_context, p_detected_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.severity', 'incident', p_incident_id,
          jsonb_build_object('severity', 'problem', 'state', v_from),
          jsonb_build_object('severity', 'down', 'state', v_to,
                             'l0_user_id', (select l0_user_id from public.incidents where id = p_incident_id)));

  update public.site_status
    set status = 'down', ok_rounds = 0, last_evaluated_at = p_detected_at, last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  perform public.engine_record_flip(v_site_id, p_round_at, false);
  perform public.engine_cancel_flap_summary(p_incident_id);
  perform public.engine_cancel_held_problem(p_incident_id, 'Superseded: went down');
  -- The PROBLEM ladder ends here: its step or reminder still waiting never goes before the DOWN card.
  perform public.engine_cancel_ladder(p_incident_id, 'Superseded: went down');

  -- The browser's screenshot joins the timeline as evidence.
  if v_verify_job is not null then
    update public.verification_jobs set incident_id = p_incident_id where id = v_verify_job;
    insert into public.incident_events (incident_id, type, payload, at)
    select p_incident_id, 'evidence',
           jsonb_build_object('screenshotPath', j.screenshot_path, 'result', j.result, 'jobId', j.id),
           coalesce(j.completed_at, p_detected_at)
    from public.verification_jobs j
    where j.id = v_verify_job and j.screenshot_path is not null;
  end if;

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context)
    values (p_incident_id, 'google_chat', 'down', p_incident_id::text, p_context)
    on conflict do nothing;

    perform public.engine_queue_l0_emails(p_incident_id, 'down', p_context,
                                           now() + interval '5 minutes', null, false); -- D-047
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;


create function public.engine_post_late_alert(
  p_incident_id uuid, p_at timestamptz, p_hold_until timestamptz default null,
  p_outside_hours boolean default false
)
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
  -- The ladder clock starts now (alerted_at): L0 pages whoever responds now (S10), then emails them.
  update public.incidents i
    set alerted_at = p_at,
        l0_user_id = case when s.tier = 1 and p_outside_hours then public.oncall_person_at(p_at) end
    from public.sites s
    where i.id = p_incident_id and s.id = i.site_id;
  perform public.engine_queue_l0_emails(p_incident_id, v_sev, v_context,
                                         greatest(v_hold, now() + interval '5 minutes'), null, false); -- D-047
  return true;
end;
$$;


create or replace function public.engine_relapse_incident(
  p_incident_id uuid,
  p_severity public.severity,
  p_trigger public.incident_trigger,
  p_started_at timestamptz,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_flapping boolean,
  p_notify boolean,
  p_monitors jsonb default null,
  p_status public.site_state default null,
  p_hold_until timestamptz default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_from public.incident_state;
  v_before public.severity;
  v_to public.incident_state;
  v_after public.severity;
begin
  select site_id, state, severity into v_site_id, v_from, v_before
  from public.incidents
  where id = p_incident_id
    -- A DOWN never relapses a PROBLEM incident: that is engine_escalate_incident (D-021), which
    -- writes the escalated_to_down event (S06 engine-review L2).
    and not (p_severity = 'down' and severity = 'problem')
    and (state in ('monitoring', 'needs_root_cause')
         -- D-023: the DOWN ended, a key page carried on as a PROBLEM, and the home page fails again.
         or (p_severity = 'down' and severity = 'down' and episode_severity = 'problem'
             and state not in ('resolved', 'in_review', 'closed')))
  for update;

  if v_site_id is null then
    return false;
  end if;

  update public.incidents
    set severity = case when p_severity = 'down' then 'down'::public.severity else severity end,
        episode_severity = p_severity,
        recovered_at = null,
        is_flapping = is_flapping or coalesce(p_flapping, false),
        state = case when acked_at is not null then 'acknowledged'::public.incident_state
                     -- Escalated only when a step of this severity really paged someone (D-034).
                     when exists (select 1 from public.incident_events e
                                  where e.incident_id = p_incident_id and e.type = 'step_fired'
                                    and e.payload ->> 'severity' = severity::text
                                    and jsonb_array_length(e.payload -> 'notified') > 0)
                       then 'escalated'::public.incident_state
                     else 'unacked'::public.incident_state end
    where id = p_incident_id
    returning state, severity into v_to, v_after;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'relapsed',
          coalesce(p_context, '{}') || jsonb_build_object(
            'severity', p_severity, 'trigger', p_trigger, 'startedAt', p_started_at,
            'flapping', coalesce(p_flapping, false)),
          p_detected_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.relapsed', 'incident', p_incident_id,
          jsonb_build_object('state', v_from, 'severity', v_before),
          jsonb_build_object('state', v_to, 'severity', v_after, 'episode', p_severity));

  update public.site_status
    set ok_rounds = 0, last_evaluated_at = p_detected_at, last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  perform public.engine_record_flip(v_site_id, p_round_at, false);
  perform public.engine_cancel_flap_summary(p_incident_id);

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key, hold_until)
    values (p_incident_id, 'google_chat', p_severity::text || '_again', p_incident_id::text,
            p_context, to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            case when p_severity = 'problem' and p_hold_until > p_detected_at then p_hold_until end)
    on conflict do nothing;

    -- D-047: an L0 person who hasn't been emailed about this incident (every earlier drop came back inside
    -- its grace): this drop's email waits out its own 5 min, as the first alert's did.
    perform public.engine_queue_l0_emails(
      p_incident_id, p_severity::text || '_again', p_context,
      greatest(case when p_severity = 'problem' and p_hold_until > p_detected_at then p_hold_until end,
               now() + interval '5 minutes'),
      to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), true);
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;


create or replace function public.engine_recover_incident(
  p_incident_id uuid,
  p_from public.incident_state,
  p_to public.incident_state,
  p_recovered_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean,
  p_monitors jsonb default null,
  p_status public.site_state default null,
  p_flip_ok boolean default null,
  p_auto_resolve boolean default false,
  p_hold_summary boolean default false
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_notify boolean;
  v_since timestamptz;
  -- The round in UTC, whatever the session's TimeZone / DateStyle: overlapping callers agree.
  v_key text := to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  -- Auto-resolve only for a PROBLEM nobody acknowledged (spec §16.1); DOWN never auto-resolves.
  if p_auto_resolve and p_to <> 'resolved' then
    raise exception 'auto-resolve must go to resolved';
  end if;

  -- D-038: a PROBLEM drop after a relapse emails RECOVERED only to whoever was emailed about that
  -- drop (a fallback for a failed PROBLEM AGAIN card, an escalation step) — its PROBLEM AGAIN was a
  -- Chat reply, and a RECOVERED email per cycle flooded owners while a site flapped. The first drop
  -- and any DOWN drop still email everyone already emailed (S02b).
  -- The drop began when the latest relapse was recorded: its audit row's time is that transaction's
  -- clock, always written (muted or not) and always after the previous drop's RECOVERED was queued —
  -- the event's `at` is the round's start, which can come before it.
  select (select max(a.at) from public.audit_log a
          where a.entity = 'incident' and a.entity_id = i.id and a.action = 'incident.relapsed')
    into v_since
  from public.incidents i
  where i.id = p_incident_id and i.episode_severity = 'problem';

  update public.incidents
    set state = p_to,
        recovered_at = p_recovered_at,
        resolved_at = case when p_auto_resolve then p_recovered_at else resolved_at end,
        auto_resolved = auto_resolved or p_auto_resolve
    where id = p_incident_id and state = p_from
      and (not p_auto_resolve or (severity = 'problem' and acked_at is null))
    returning site_id into v_site_id;

  if v_site_id is null then
    return false;
  end if;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'recovered', p_context, p_recovered_at);
  if p_auto_resolve then
    insert into public.incident_events (incident_id, type, payload, at)
    values (p_incident_id, 'auto_resolved', jsonb_build_object('state', p_to), p_recovered_at);
  end if;

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.recovered', 'incident', p_incident_id,
          jsonb_build_object('state', p_from),
          jsonb_build_object('state', p_to, 'recovered_at', p_recovered_at,
                             'auto_resolved', p_auto_resolve));

  update public.site_status
    set ok_rounds = 1, last_evaluated_at = p_recovered_at, last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  if p_flip_ok then
    perform public.engine_record_flip(v_site_id, p_round_at, true);
  end if;

  update public.notifications n
    set status = 'cancelled', error = 'Superseded: recovered first', next_retry_at = null
    where n.incident_id = p_incident_id and n.channel = 'google_chat'
      and n.template in ('down', 'problem', 'down_again', 'problem_again')
      and n.status = 'queued' and n.attempts > 0
      -- waiting for a retry, not in flight: every attempt it was claimed for is logged
      and n.attempts = (select count(*) from public.notification_attempts a where a.notification_id = n.id);

  -- D-047: back inside the 5-min grace → its alert email never goes (no RECOVERED email follows),
  -- once the team saw this drop in Chat (its latest alert card went). A card that never got through
  -- leaves the email as the only alert: it goes now, ahead of the RECOVERED email.
  if (select c.status from public.notifications c
      where c.incident_id = p_incident_id and c.channel = 'google_chat' and c.template in ('down', 'problem', 'down_again', 'problem_again')
      order by c.created_at desc limit 1) = 'sent' then
    update public.notifications
      set status = 'cancelled', error = 'Recovered within 5 min — no email (D-047)', next_retry_at = null
      where incident_id = p_incident_id and channel = 'email' and template in ('down', 'problem', 'down_again', 'problem_again')
        and status = 'queued' and attempts = 0
        and hold_until > p_recovered_at and hold_until <= created_at + interval '5 minutes';
  else
    update public.notifications
      set hold_until = now()
      where incident_id = p_incident_id and channel = 'email' and template in ('down', 'problem', 'down_again', 'problem_again')
        and status = 'queued' and attempts = 0 and hold_until > now() and hold_until <= created_at + interval '5 minutes';
  end if;

  perform public.engine_cancel_held_problem(p_incident_id, 'Superseded: recovered before response hours');
  perform public.engine_cancel_ladder(p_incident_id, 'Superseded: recovered first');

  -- Nothing to follow up when the thread never got an alert: one went (or is going), or was tried and
  -- set aside for a retry above — a held card cancelled before its hour never was (§19.6).
  v_notify := p_notify and exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat'
      and template in ('down', 'problem', 'down_again', 'problem_again')
      and (status <> 'cancelled' or attempts > 0));

  if v_notify and p_hold_summary then
    insert into public.notifications
      (incident_id, channel, template, thread_key, context, dedupe_key, hold_until)
    values (p_incident_id, 'google_chat', 'flap_summary', p_incident_id::text, p_context, v_key,
            p_recovered_at + interval '15 minutes')
    on conflict do nothing;

    insert into public.notifications
      (incident_id, user_id, channel, template, thread_key, context, dedupe_key, hold_until)
    select p_incident_id, l.user_id, 'email', 'flap_summary', p_incident_id::text,
           p_context, v_key, p_recovered_at + interval '15 minutes'
    from public.engine_l0_people(p_incident_id) l
    where true
      -- D-039: one summary per flapping run, to each L0 person emailed about the incident at all — the
      -- email thread would otherwise end on the first PROBLEM. D-047: for every drop, DOWN too — drops
      -- that each came back inside 5 min emailed nobody.
      and exists (
        select 1 from public.notifications e
        where e.incident_id = p_incident_id and e.channel = 'email' and e.status <> 'cancelled'
          and e.user_id = l.user_id)
    on conflict do nothing;
  elsif v_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
    values (p_incident_id, 'google_chat', 'recovered', p_incident_id::text, p_context, v_key)
    on conflict do nothing;

    insert into public.notifications
      (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
    select distinct p_incident_id, n.user_id, 'email'::public.notification_channel, 'recovered',
           p_incident_id::text, p_context, v_key
    from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'email' and n.status <> 'cancelled'
      and n.user_id is not null and (v_since is null or n.created_at >= v_since)
    on conflict do nothing;
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;


create or replace function public.queue_fallback_emails(p_notification_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- D-047: the Chat alert failed for good — the owner's alert email in its grace goes now.
  update public.notifications e
    set hold_until = now()
    from public.notifications n
    join public.incidents i on i.id = n.incident_id
    where n.id = p_notification_id and n.channel = 'google_chat' and n.template in ('down', 'problem', 'down_again', 'problem_again')
      and i.state in ('unacked', 'escalated')
      and e.incident_id = n.incident_id and e.channel = 'email' and e.template in ('down', 'problem', 'down_again', 'problem_again')
      and e.status = 'queued' and e.attempts = 0 and e.hold_until > now() and e.hold_until <= e.created_at + interval '5 minutes';

  insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
  select n.incident_id, r.user_id, 'email', n.template, n.thread_key,
         n.context || jsonb_build_object('fallback', true), n.dedupe_key
  from public.notifications n
  join public.incidents i on i.id = n.incident_id
  join public.sites s on s.id = i.site_id
  cross join lateral (
    select b.id as user_id from public.profiles b where b.id = s.backup_owner_id and b.is_active
    union
    select p.id from public.profiles p where p.role = 'admin' and p.is_active
    union
    select a.id from public.profiles a
    where n.template in ('down_again', 'problem_again') and a.is_active
      and a.id = coalesce(i.acked_by, (select o.user_id from public.escalation_people(i.id, '["owner"]') o))
  ) r
  where n.id = p_notification_id and n.channel = 'google_chat'
    and n.template <> 'reminder'
    and not (n.template in ('down', 'problem', 'step_fired') and i.state not in ('unacked', 'escalated'))
    -- An AGAIN reply is old news once the site is back (Monitoring); it still counts while acknowledged.
    and not (n.template in ('down_again', 'problem_again')
             and i.state not in ('unacked', 'escalated', 'acknowledged'))
    and not exists (
      select 1 from public.notifications e
      where e.incident_id = n.incident_id and e.channel = 'email' and e.template = n.template
        and e.dedupe_key = n.dedupe_key and e.user_id = r.user_id and e.status <> 'cancelled'
    )
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;



revoke execute on function
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state, timestamptz, boolean),
  public.engine_escalate_incident(uuid, timestamptz, timestamptz, jsonb, boolean, jsonb,
    public.site_state, boolean, boolean),
  public.engine_post_late_alert(uuid, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz,
    timestamptz, timestamptz, jsonb, boolean, jsonb, public.site_state, timestamptz, boolean),
  public.engine_escalate_incident(uuid, timestamptz, timestamptz, jsonb, boolean, jsonb,
    public.site_state, boolean, boolean),
  public.engine_post_late_alert(uuid, timestamptz, timestamptz, boolean)
  to service_role;


-- ── The L0 pencil ────────────────────────────────────────────────────────────

create or replace function public.save_escalation_policies(
  p_policies jsonb,
  p_down_reminder_min integer,
  p_problem_reminder_min integer,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_before jsonb;
  v_after jsonb;
  v_pol jsonb;
  v_policy public.escalation_policies%rowtype;
  v_step jsonb;
  v_level integer;
  v_prev integer;
  v_count integer;
  v_targets text[];
  v_channels text[];
  v_delay integer;
  v_is_fyi boolean;
  v_t1_down boolean;
  v_fyi_level integer;
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception 'Only an Admin can change escalation policies' using errcode = '42501';
  end if;
  if v_note is null then
    raise exception 'Add a short note — it goes in the audit log with the change'
      using errcode = '22023', hint = 'note_required';
  end if;
  if length(v_note) > 500 then
    raise exception 'The note is too long' using errcode = '22023', hint = 'note_too_long';
  end if;
  if p_down_reminder_min is null or p_down_reminder_min not between 1 and 1440
     or p_problem_reminder_min is null or p_problem_reminder_min not between 1 and 1440 then
    raise exception 'Whole minutes above 0, e.g. 15' using errcode = '22023', hint = 'reminder_invalid';
  end if;
  if jsonb_typeof(p_policies) is distinct from 'array' then
    raise exception 'Nothing to save' using errcode = '22023', hint = 'invalid';
  end if;

  -- One save at a time, so the audit row's "before" is what this save changed.
  perform 1 from public.organisation_settings where singleton for update;

  select jsonb_build_object(
    'policies', (select jsonb_agg(jsonb_build_object('severity', p.severity, 'tier', p.tier,
                   'steps', (select jsonb_agg(jsonb_build_object('level', s.level, 'delayMin', s.delay_min,
                                'targets', s.targets, 'channels', s.channels, 'fyi', s.fyi) order by s.level)
                             from public.escalation_steps s where s.policy_id = p.id))
                 order by p.severity, p.tier)
                 from public.escalation_policies p),
    'downReminderMin', o.down_reminder_min, 'problemReminderMin', o.problem_reminder_min)
    into v_before
  from public.organisation_settings o;

  for v_pol in select * from jsonb_array_elements(p_policies) loop
    select * into v_policy from public.escalation_policies where id = (v_pol ->> 'policyId')::uuid for update;
    if not found then
      raise exception 'Policy not found' using errcode = 'P0002';
    end if;
    v_t1_down := v_policy.severity = 'down' and v_policy.tier = 1;

    v_prev := null;
    v_count := 0;
    v_fyi_level := null;
    for v_step in
      select s from jsonb_array_elements(v_pol -> 'steps') s order by (s ->> 'level')::integer
    loop
      if jsonb_typeof(v_step -> 'level') is distinct from 'number'
         or jsonb_typeof(v_step -> 'delayMin') is distinct from 'number'
         or jsonb_typeof(v_step -> 'targets') is distinct from 'array'
         or jsonb_typeof(v_step -> 'channels') is distinct from 'array'
         or jsonb_typeof(coalesce(nullif(v_step -> 'fyi', 'null'::jsonb), 'false'::jsonb)) is distinct from 'boolean' then
        raise exception 'A step is missing its delay, people or channels' using errcode = '22023', hint = 'invalid';
      end if;
      v_level := (v_step ->> 'level')::integer;
      v_delay := (v_step ->> 'delayMin')::integer;
      v_targets := array(select jsonb_array_elements_text(v_step -> 'targets'));
      v_channels := array(select jsonb_array_elements_text(v_step -> 'channels'));
      v_is_fyi := coalesce((v_step ->> 'fyi')::boolean, false);
      if v_level is distinct from v_count then
        raise exception 'Steps must run L0, L1, … in order' using errcode = '22023', hint = 'levels';
      end if;
      if v_level > 3 then
        raise exception 'At most four steps, L0–L3' using errcode = '22023', hint = 'too_many_steps';
      end if;
      if not (v_targets <@ array['owner', 'backup', 'admins', 'site_am', 'ceo']
              and v_channels <@ array['chat', 'space', 'email', 'voice']) then
        raise exception 'Unknown person or channel' using errcode = '22023', hint = 'invalid';
      end if;
      -- L0 goes at once to the owner / on-call by Chat @mention and the Alerts Space (locked, spec §14.7);
      -- the pencil adds people and email (S10, D-034). engine_open_incident tells everyone it names.
      if v_level = 0 and not (v_delay = 0 and 'owner' = any (v_targets) and not v_is_fyi
                              and v_channels @> array['chat', 'space']
                              and v_channels <@ array['chat', 'space', 'email']) then
        raise exception 'L0 is pinned on every policy' using errcode = '22023', hint = 'l0_pinned';
      end if;
      if v_delay > 10080 then
        raise exception 'At most a week (10080 min)' using errcode = '22023', hint = 'step_too_late';
      end if;
      if cardinality(array_remove(v_channels, 'voice')) = 0 then
        raise exception 'No channel ticked — this step notifies nobody.' using errcode = '22023', hint = 'no_channel';
      end if;
      if cardinality(v_targets) = 0 then
        raise exception 'Pick at least one person.' using errcode = '22023', hint = 'no_person';
      end if;
      if v_level > 0 and (v_delay is null or v_delay < 15) then
        raise exception 'Must be at least +15 min.' using errcode = '22023', hint = 'step_too_early';
      end if;
      if v_level > 0 and v_delay <= v_prev then
        raise exception 'Must be later than L% (+% min).', v_level - 1, v_prev
          using errcode = '22023', hint = 'step_not_later';
      end if;
      -- The CEO is paged only on Tier 1 DOWN, from L2 onward (§15.5, D-009).
      if 'ceo' = any (v_targets) and not v_t1_down then
        raise exception 'The CEO is paged only on Tier 1 DOWN — remove CEO from this step.'
          using errcode = '22023', hint = 'ceo_not_allowed';
      end if;
      if 'ceo' = any (v_targets) and v_level < 2 then
        raise exception 'The CEO can be paged only from L2 onward.' using errcode = '22023', hint = 'ceo_too_early';
      end if;
      -- Voice: configured on the Tier 1 CEO step, off until approved; never on the FYI step.
      if 'voice' = any (v_channels) and (v_is_fyi or not ('ceo' = any (v_targets)) or not v_t1_down) then
        raise exception 'Only the L2 CEO step can carry a voice call, and it stays off until approved.'
          using errcode = '22023', hint = 'voice_not_here';
      end if;
      if v_is_fyi then
        if not v_t1_down or v_fyi_level is not null then
          raise exception 'Only Tier 1 DOWN has the CEO + AM FYI step' using errcode = '22023', hint = 'invalid';
        end if;
        if not (v_targets @> array['ceo', 'site_am']) then
          raise exception 'CEO + Site AM are fixed on this step: it’s the Tier 1 step that still sends an FYI after acknowledge (never a call). It can’t be removed.'
            using errcode = '22023', hint = 'fyi_people';
        end if;
        v_fyi_level := v_level;
      end if;
      v_prev := v_delay;
      v_count := v_count + 1;
    end loop;

    if v_count = 0 then
      raise exception 'L0 is pinned on every policy' using errcode = '22023', hint = 'l0_pinned';
    end if;
    if v_t1_down and v_fyi_level is null then
      raise exception 'The CEO + AM FYI step can’t be removed from Tier 1 DOWN'
        using errcode = '22023', hint = 'fyi_required';
    end if;
    -- A step after L0 that isn't the FYI: otherwise nobody is asked to acknowledge after the owner.
    if v_policy.severity = 'down' and v_count - (case when v_fyi_level is null then 0 else 1 end) < 2 then
      raise exception '% needs at least one step after L0 — otherwise nobody else is ever told.',
        'Tier ' || v_policy.tier || ' DOWN' using errcode = '22023', hint = 'down_needs_step';
    end if;

    delete from public.escalation_steps where policy_id = v_policy.id;
    insert into public.escalation_steps (policy_id, level, delay_min, targets, channels, fyi)
    select v_policy.id, (s ->> 'level')::smallint, (s ->> 'delayMin')::integer,
           array(select jsonb_array_elements_text(s -> 'targets')),
           array(select jsonb_array_elements_text(s -> 'channels')),
           coalesce((s ->> 'fyi')::boolean, false)
    from jsonb_array_elements(v_pol -> 'steps') s;
    update public.escalation_policies set updated_at = now() where id = v_policy.id;
  end loop;

  update public.organisation_settings
    set down_reminder_min = p_down_reminder_min, problem_reminder_min = p_problem_reminder_min
    where singleton
      and (down_reminder_min, problem_reminder_min) is distinct from (p_down_reminder_min, p_problem_reminder_min);

  select jsonb_build_object(
    'policies', (select jsonb_agg(jsonb_build_object('severity', p.severity, 'tier', p.tier,
                   'steps', (select jsonb_agg(jsonb_build_object('level', s.level, 'delayMin', s.delay_min,
                                'targets', s.targets, 'channels', s.channels, 'fyi', s.fyi) order by s.level)
                             from public.escalation_steps s where s.policy_id = p.id))
                 order by p.severity, p.tier)
                 from public.escalation_policies p),
    'downReminderMin', o.down_reminder_min, 'problemReminderMin', o.problem_reminder_min)
    into v_after
  from public.organisation_settings o;

  if v_after is distinct from v_before then
    insert into public.audit_log (actor_id, action, entity, before, after)
    values (auth.uid(), 'escalation.update', 'escalation', v_before,
            v_after || jsonb_build_object('note', v_note));
  end if;
end;
$$;

