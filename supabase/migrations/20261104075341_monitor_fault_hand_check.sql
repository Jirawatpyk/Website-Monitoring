-- S12b · monitor fault: the hand check, the manual incident, Escalate now (spec §30, D-053 item 5, D-055).
--   · agent_heartbeats keeps `engine-run`, stamped by every engine run (the cron or after a Bangkok batch).
--     Nothing escalates on its own only while that beat is 3 min old or more (D-055 item 1): only then do
--     Escalate now and the client-update reminder by hand work. The hand check and the manual incident
--     follow the sweep fault (`engine-sweep`, D-053 item 1), as the Overview banner does.
--   · hand_checks records each Loads OK / Down press on a Tier 1 site; staff read it (the Overview card),
--     only the functions below write it, each with its audit row. Append-only: a row never changes.
--   · open_manual_incident opens a DOWN with trigger Manual (hand check) and queues L0 as the engine does:
--     the Chat line with no hold (the action sends it from the request), the emails with D-047's grace
--     (D-055 item 2). Never on a muted site or one in maintenance (§15.1: no new alerts). It moves the
--     site's round clock to the hand check, so the engine's first round after it is the first evidence
--     (§30.5) — an OK round from before it was opened never recovers it (db review H1).
--   · escalate_now and send_client_update_reminder write what the engine's own steps write (the level,
--     the step_fired event, the dedupe keys; client_update_required), so the automatic ticks never
--     repeat them once the engine is back (S12b Done-when 2), plus who pressed.
--   · Who presses is the Acknowledge rule (private.can_ack, spec §30.3).

set local lock_timeout = '5s';

-- ── Beats ────────────────────────────────────────────────────────────────────
alter table public.agent_heartbeats drop constraint agent_heartbeats_name_check;
alter table public.agent_heartbeats add constraint agent_heartbeats_name_check
  check (name in ('verifier', 'engine-sweep', 'engine-run', 'notifier', 'crawler', 'vps-watchdog'));

-- A beat 3 min old or more (D-053 amended: "> 3 min" means 3 min or more). No row yet = no data, not a
-- fault (a fresh deploy before its first minute), as isSweepStale / isEngineStopped in @dxt/engine.
create function private.beat_missed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select last_seen_at <= now() - interval '3 minutes'
                   from public.agent_heartbeats where name = p_name), false);
$$;

create function private.engine_fault()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.beat_missed('engine-sweep'); $$;

create function private.engine_stopped()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.beat_missed('engine-run'); $$;

revoke execute on function private.beat_missed(text), private.engine_fault(), private.engine_stopped()
  from public, anon, authenticated;

-- ── hand_checks ──────────────────────────────────────────────────────────────
create table public.hand_checks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  checked_by uuid not null references public.profiles (id) on delete restrict,
  checked_at timestamptz not null default now(),
  outcome text not null check (outcome in ('ok', 'down')),
  -- A Down press is the incident it opened; incidents are never deleted.
  incident_id uuid references public.incidents (id) on delete restrict,
  note text check (note is null or (btrim(note) <> '' and char_length(note) <= 500)),
  created_at timestamptz not null default now(),
  constraint hand_checks_down_has_incident check (outcome = 'ok' or incident_id is not null)
);

-- The Overview reads each Tier 1 site's checks since the sweep stopped. Rows come only from people
-- pressing during a fault, so no retention job: they stay, like the incidents they belong to.
create index hand_checks_site_at_idx on public.hand_checks (site_id, checked_at desc);
create index hand_checks_incident_idx on public.hand_checks (incident_id) where incident_id is not null;

alter table public.hand_checks enable row level security;
create policy hand_checks_select_staff on public.hand_checks
  for select to authenticated using ((select public.is_staff()));

revoke all on public.hand_checks from public, anon, authenticated;
grant select on public.hand_checks to authenticated;
grant all on public.hand_checks to service_role;

-- ── The hand check (spec §30.2) ──────────────────────────────────────────────
-- The checks shared by Loads OK and Down: may act on the site, a live Tier 1 site, the sweep fault open.
create function private.hand_check_site(p_site_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tier smallint;
  v_active boolean;
begin
  select s.tier, s.is_active into v_tier, v_active from public.sites s where s.id = p_site_id;
  if v_tier is null then
    raise exception 'site not found' using errcode = 'P0002';
  end if;
  if not private.can_ack(p_site_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_tier <> 1 or not v_active then
    raise exception 'the hand check covers live Tier 1 sites only' using errcode = '55000', hint = 'not_tier1';
  end if;
  if not private.engine_fault() then
    raise exception 'monitoring is running' using errcode = '55000', hint = 'engine_running';
  end if;
end;
$$;

revoke execute on function private.hand_check_site(uuid) from public, anon, authenticated;

create function public.record_hand_check(p_site_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.hand_check_site(p_site_id);

  insert into public.hand_checks (site_id, checked_by, outcome)
  values (p_site_id, auth.uid(), 'ok')
  returning id into v_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'site.hand_check', 'site', p_site_id,
          jsonb_build_object('outcome', 'ok', 'hand_check_id', v_id));
  return v_id;
end;
$$;

-- p_outside_hours: the server action's response-hours verdict (`isInsideHours` from @dxt/engine, as the
-- engine runner passes it — SQL never works hours out, S10): outside them L0 pages the person on call.
create function public.open_manual_incident(p_site_id uuid, p_note text, p_outside_hours boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_actor text;
  v_monitor uuid;
  v_id uuid;
  v_context jsonb;
begin
  perform private.hand_check_site(p_site_id);
  if char_length(v_note) > 500 then
    raise exception 'note too long' using errcode = '22001';
  end if;
  -- A mute or maintenance stops new alerts (§15.1, security review M1): no page by hand either.
  if exists (select 1 from public.maintenance_windows w
             where w.site_id = p_site_id and public.window_state(w, v_now) = 'active') then
    raise exception 'the site is muted or in maintenance' using errcode = '55000', hint = 'paused';
  end if;
  -- The primary monitor, so the engine's rounds recover it once it is back (D-023's home page).
  select m.id into v_monitor from public.monitors m where m.site_id = p_site_id and m.is_primary;
  if v_monitor is null then
    raise exception 'the site has no home page monitor' using errcode = '55000', hint = 'no_monitor';
  end if;
  select display_name into v_actor from public.profiles where id = auth.uid();

  v_context := jsonb_build_object('manual', true, 'openedBy', v_actor, 'note', v_note);

  insert into public.incidents (site_id, monitor_id, trigger, severity, episode_severity, started_at,
                                detected_at, escalation_plan, l0_user_id, is_manual)
  select s.id, v_monitor, 'manual', 'down', 'down', v_now, v_now, public.escalation_plan_for(s.tier, 'down'),
         -- S10: outside response hours L0 pages the person on call.
         case when coalesce(p_outside_hours, false) then public.oncall_person_at(v_now) end,
         true
  from public.sites s where s.id = p_site_id
  on conflict (site_id) where state not in ('resolved', 'in_review', 'closed') do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'the site already has an open incident' using errcode = '55000', hint = 'already_open';
  end if;

  insert into public.incident_events (incident_id, type, actor_id, payload, at)
  values (v_id, 'detected', auth.uid(), v_context, v_now);

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'incident.opened', 'incident', v_id,
          jsonb_build_object('state', 'unacked', 'severity', 'down', 'trigger', 'manual',
                             'site_id', p_site_id, 'started_at', v_now, 'note', v_note,
                             'l0_user_id', (select l0_user_id from public.incidents where id = v_id)));

  -- The site reads DOWN at once, and its round clock moves to the hand check (site and monitors alike,
  -- so the runner's carry check sees them in step): the rounds the engine missed are before the incident
  -- and never recover it; its first round after this one is the first evidence (db review H1).
  insert into public.site_status as st (site_id, status, since, last_evaluated_at, last_round_at, ok_rounds)
  values (p_site_id, 'down', v_now, v_now, v_now, 0)
  on conflict (site_id) do update
    set status = 'down', since = v_now, last_evaluated_at = v_now, ok_rounds = 0,
        last_round_at = greatest(st.last_round_at, v_now);
  update public.monitor_status ms
    set last_round_at = greatest(ms.last_round_at, v_now)
    from public.monitors m
    where m.id = ms.monitor_id and m.site_id = p_site_id;

  -- L0: the Chat line leaves from the request (D-053 item 5); the emails wait out D-047's grace.
  insert into public.notifications (incident_id, channel, template, thread_key, context)
  values (v_id, 'google_chat', 'down', v_id::text, v_context);
  perform public.engine_queue_l0_emails(v_id, 'down', v_context, v_now + interval '5 minutes', null, false);

  insert into public.hand_checks (site_id, checked_by, checked_at, outcome, incident_id, note)
  values (p_site_id, auth.uid(), v_now, 'down', v_id, v_note);
  return v_id;
end;
$$;

-- ── By hand while the engine is stopped (spec §30.6–7) ───────────────────────
-- The incident, locked, when the person may act and nothing escalates on its own (D-055 item 1). Who
-- may act is asked before the lock, so a caller who may not never holds the engine up (security L4).
create function private.by_hand_incident(p_incident_id uuid)
returns public.incidents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_inc public.incidents%rowtype;
begin
  select site_id into v_site from public.incidents where id = p_incident_id;
  if v_site is null then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if not private.can_ack(v_site) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.engine_stopped() then
    raise exception 'the engine is running' using errcode = '55000', hint = 'engine_running';
  end if;
  select * into v_inc from public.incidents where id = p_incident_id for update;
  return v_inc;
end;
$$;

revoke execute on function private.by_hand_incident(uuid) from public, anon, authenticated;

-- The next level of the incident's plan, now, as engine_fire_step sends it (the engine then never
-- repeats it: its level guard, the step_fired event, the `<severity>:L<n>` dedupe key). p_level is the
-- level the person saw on the button: two people pressing at once send one level, not two (db M1).
-- Returns the level sent and how many people it told (0: everyone it names had heard already).
create function public.escalate_now(p_incident_id uuid, p_level smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_level smallint;
  v_actor text;
  v_event uuid;
  v_notified integer;
begin
  v_inc := private.by_hand_incident(p_incident_id);
  if v_inc.state not in ('unacked', 'escalated') then
    raise exception 'only an incident waiting for an ack escalates' using errcode = '55000', hint = 'not_waiting';
  end if;

  select min((s ->> 'level')::smallint) into v_level
  from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s
  where (s ->> 'level')::smallint > v_inc.escalation_level;
  if v_level is null then
    raise exception 'no level left to send' using errcode = '55000', hint = 'no_level';
  end if;
  if v_level <> p_level then
    raise exception 'the incident moved on' using errcode = '55000', hint = 'level_moved';
  end if;

  select display_name into v_actor from public.profiles where id = auth.uid();
  loop
    exit when public.engine_fire_step(p_incident_id, v_level, now(),
                                      jsonb_build_object('byHand', true, 'sentBy', v_actor));
    -- An FYI already sent while Acknowledged, then Undone: engine_fire_step moved the level past it
    -- without a second FYI. Send the one after it (security review, for engine-reviewer).
    if (select escalation_level from public.incidents where id = p_incident_id) < v_level then
      raise exception 'the level could not be sent' using errcode = '55000', hint = 'not_sent';
    end if;
    select min((s ->> 'level')::smallint) into v_level
    from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s
    where (s ->> 'level')::smallint > v_level;
    if v_level is null then
      raise exception 'no level left to send' using errcode = '55000', hint = 'no_level';
    end if;
  end loop;

  -- The event engine_fire_step just wrote, in this transaction, gets who pressed: still one write of
  -- history, as the timeline is append-only.
  update public.incident_events
    set actor_id = auth.uid(), payload = payload || jsonb_build_object('byHand', true, 'sentBy', v_actor)
    where id = (select e.id from public.incident_events e
                where e.incident_id = p_incident_id and e.type = 'step_fired' and e.actor_id is null
                  and (e.payload ->> 'level')::smallint = v_level and e.at = now()
                limit 1)
    returning id, jsonb_array_length(payload -> 'notified') into v_event, v_notified;
  if v_event is null then
    raise exception 'the step''s event is missing' using errcode = 'XX000';
  end if;

  -- engine_fire_step's own row says what moved; this one says who pressed.
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'incident.escalate_now', 'incident', p_incident_id,
          jsonb_build_object('level', v_level, 'notified', v_notified));
  return jsonb_build_object('level', v_level, 'notified', v_notified);
end;
$$;

-- The client-update reminder, now (§30.7): what engine_client_update_due sends, before its due time if
-- need be (D-055 item 3). Due: Tier 1 the first failed check + 15 min, as the engine's track; Tier 2's
-- 60 min count only inside response hours, so its due time is when it was sent.
create function public.send_client_update_reminder(p_incident_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_tier smallint;
  v_internal boolean;
  v_am uuid;
  v_am_name text;
  v_people uuid[];
  v_no_am boolean;
  v_due timestamptz;
  v_actor text;
  v_payload jsonb;
begin
  v_inc := private.by_hand_incident(p_incident_id);
  if v_inc.client_update_required then
    raise exception 'the reminder went already' using errcode = '55000', hint = 'already_sent';
  end if;
  -- Down now: a recovered incident waits for the engine's track, which knows whether it fell due (db M2).
  if v_inc.severity <> 'down' or v_inc.state not in ('unacked', 'escalated', 'acknowledged') then
    raise exception 'only an incident that is down now' using errcode = '55000', hint = 'not_down';
  end if;

  select s.tier, c.is_internal, c.am_user_id into v_tier, v_internal, v_am
  from public.sites s join public.clients c on c.id = s.client_id
  where s.id = v_inc.site_id;
  if v_tier not in (1, 2) or v_internal then
    raise exception 'no client update for this site' using errcode = '55000', hint = 'no_track';
  end if;
  -- The thread needs its DOWN alert, as the engine's track.
  if not exists (
    select 1 from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'google_chat'
      and n.template in ('down', 'down_again')
      and (n.status <> 'cancelled' or n.attempts > 0)
      and (n.hold_until is null or n.hold_until <= now())
  ) then
    raise exception 'the DOWN alert hasn''t gone yet' using errcode = '55000', hint = 'no_thread';
  end if;

  select coalesce(array_agg(pe.user_id), '{}') into v_people
  from public.escalation_people(p_incident_id, '["site_am"]'::jsonb) pe;
  v_no_am := cardinality(v_people) = 0;
  if v_no_am then
    select coalesce(array_agg(pe.user_id), '{}') into v_people
    from public.escalation_people(p_incident_id, '["admins"]'::jsonb) pe;
  else
    select display_name into v_am_name from public.profiles where id = v_am;
  end if;
  select display_name into v_actor from public.profiles where id = auth.uid();

  v_due := case when v_tier = 1 then date_trunc('milliseconds', v_inc.started_at) + interval '15 minutes'
                else now() end;
  update public.incidents
    set client_update_required = true, client_update_due_at = v_due
    where id = p_incident_id;

  v_payload := jsonb_build_object(
    'dueAt', v_due, 'tier', v_tier, 'minutes', case when v_tier = 1 then 15 else 60 end,
    'am', v_am_name, 'noAm', v_no_am, 'notified', to_jsonb(v_people), 'mentioned', to_jsonb(v_people),
    'byHand', true, 'sentBy', v_actor);

  insert into public.incident_events (incident_id, type, actor_id, payload, at)
  values (p_incident_id, 'client_update_due', auth.uid(), v_payload, now());

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.client_update_due', 'incident', p_incident_id,
          jsonb_build_object('client_update_required', false),
          jsonb_build_object('client_update_required', true, 'client_update_due_at', v_due,
                             'notified', to_jsonb(v_people), 'by_hand', true));

  insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
  values (p_incident_id, 'google_chat', 'client_update_due', p_incident_id::text, v_payload, 'client_update')
  on conflict do nothing;
  insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
  select p_incident_id, u, 'email', 'client_update_due', p_incident_id::text, v_payload, 'client_update'
  from unnest(v_people) u
  on conflict do nothing;
  return true;
end;
$$;

revoke execute on function public.record_hand_check(uuid), public.open_manual_incident(uuid, text, boolean),
  public.escalate_now(uuid, smallint), public.send_client_update_reminder(uuid) from public, anon;
grant execute on function public.record_hand_check(uuid), public.open_manual_incident(uuid, text, boolean),
  public.escalate_now(uuid, smallint), public.send_client_update_reminder(uuid) to authenticated;
