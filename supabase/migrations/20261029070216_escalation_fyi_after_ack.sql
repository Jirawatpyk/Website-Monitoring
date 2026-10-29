-- S10 · the FYI after an ack, review round 2 (engine-reviewer M1, M2, L1; db-reviewer L3, L4; D-048).
--   · engine_fire_step: an FYI sent while Acknowledged leaves `escalation_level` alone (an Undo lets L2
--     still page the CEO) and goes once per drop severity, told by its `step_fired` event — not by
--     the level, which a D-021 raise from a PROBLEM ladder keeps. A reminder step keeps its people out
--     of `notified` (a relapse doesn't read it as a page). The audit row is `incident.step_sent` when
--     nothing moved.
--   · engine_remind: `not exists` for the CEO / AM exclusion.

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
  v_is_fyi boolean;
  v_told uuid[];
  v_new uuid[];
  v_mention uuid[];
  v_fyi uuid[];
  v_others boolean;
  v_reminder boolean := false;
  v_state public.incident_state;
  v_payload jsonb;
  v_acker text;
  v_sent boolean;
begin
  -- An FYI step goes once per drop severity (the event says so, not the level): answered before the
  -- lock, as every run asks while an acknowledged Tier 1 DOWN stays open.
  select exists (
    select 1 from public.incident_events e join public.incidents i on i.id = e.incident_id
    where e.incident_id = p_incident_id and e.type = 'step_fired'
      and (e.payload ->> 'fyiStep')::boolean and (e.payload ->> 'level')::smallint = p_level
      and e.payload ->> 'severity' = i.severity::text
  ) into v_sent;

  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or p_level < 1 then
    return false;
  end if;

  select s into v_step
  from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s
  where (s ->> 'level')::smallint = p_level;
  if v_step is null then
    return false;
  end if;
  v_is_fyi := coalesce((v_step ->> 'fyi')::boolean, false);

  -- While it waits for an ack the levels go one at a time, once each. After an ack only the FYI goes,
  -- whatever level a PROBLEM ladder reached before a D-021 raise (engine review M2).
  if v_inc.state in ('unacked', 'escalated') and v_inc.escalation_level >= p_level then
    return false;
  end if;
  if v_is_fyi and v_sent then
    -- Sent while Acknowledged, then the ack was undone: the ladder moves past it without a second FYI.
    if v_inc.state in ('unacked', 'escalated') then
      update public.incidents set escalation_level = p_level where id = p_incident_id;
    end if;
    return false;
  end if;

  if not (v_inc.state in ('unacked', 'escalated')
          or (v_is_fyi and v_inc.state = 'acknowledged')) then
    return false;
  end if;
  -- The FYI says "still DOWN": not on a drop that is only a PROBLEM now (D-023).
  if v_is_fyi and coalesce(v_inc.episode_severity, v_inc.severity) <> 'down' then
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

  if v_is_fyi then
    select coalesce(array_agg(pe.user_id), '{}') into v_new
    from public.escalation_people(p_incident_id, v_step -> 'targets') pe;
    v_mention := v_new;
    v_fyi := '{}';
  else
    select coalesce(array_agg(pe.user_id), '{}'),
           coalesce(bool_or(pe.token <> 'admins'), false)
      into v_new, v_others
    from public.escalation_people(p_incident_id, v_step -> 'targets') pe
    where pe.user_id <> all (v_told);

    if cardinality(v_new) = 0 and p_level >= 2 then
      -- Everyone this step names heard already: remind them (Tier 2–3 L2, "REMINDER · L2" to Tao).
      -- L1 keeps S08's rule (nobody new → the level passes quietly).
      select coalesce(array_agg(pe.user_id), '{}') into v_new
      from public.escalation_people(p_incident_id, v_step -> 'targets') pe;
      v_reminder := cardinality(v_new) > 0;
      v_mention := v_new;
      v_fyi := '{}';
    else
      select coalesce(array_agg(pe.user_id) filter (where not (v_others and pe.token = 'admins')), '{}'),
             coalesce(array_agg(pe.user_id) filter (where v_others and pe.token = 'admins'), '{}')
        into v_mention, v_fyi
      from public.escalation_people(p_incident_id, v_step -> 'targets') pe
      where pe.user_id = any (v_new);
    end if;
  end if;

  -- Escalated only when someone new was paged while it waits for an ack (spec §14.3).
  v_state := case
    when v_inc.state in ('unacked', 'escalated') and cardinality(v_new) > 0 and not v_reminder
      then 'escalated'::public.incident_state
    else v_inc.state end;
  -- An FYI after an ack doesn't move the level: an Undo puts the ladder back where it was, so L2 can
  -- still page the CEO (engine review M1).
  update public.incidents
    set state = v_state,
        escalation_level = case when v_inc.state = 'acknowledged' then escalation_level else p_level end
    where id = p_incident_id;

  if v_inc.acked_by is not null then
    select display_name into v_acker from public.profiles where id = v_inc.acked_by;
  end if;

  v_payload := jsonb_build_object(
    'level', p_level, 'severity', v_inc.severity, 'dueAt', p_due_at,
    'notified', case when v_reminder then '[]'::jsonb else to_jsonb(v_new) end,
    'reminded', case when v_reminder then to_jsonb(v_new) else '[]'::jsonb end,
    'mentioned', to_jsonb(v_mention), 'fyi', to_jsonb(v_fyi),
    'channels', v_step -> 'channels', 'fyiStep', v_is_fyi, 'reminder', v_reminder)
    || case when v_inc.state = 'acknowledged'
         then jsonb_build_object('ackedBy', v_acker, 'ackedAt', v_inc.acked_at) else '{}'::jsonb end;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'step_fired', v_payload, now());

  insert into public.audit_log (action, entity, entity_id, before, after)
  values (case when v_state is distinct from v_inc.state or v_inc.state <> 'acknowledged' and not v_reminder
               then 'incident.escalated' else 'incident.step_sent' end,
          'incident', p_incident_id,
          jsonb_build_object('state', v_inc.state, 'escalation_level', v_inc.escalation_level),
          jsonb_build_object('state', v_state, 'escalation_level',
                             case when v_inc.state = 'acknowledged' then v_inc.escalation_level else p_level end));

  if cardinality(v_new) > 0 and v_step -> 'channels' ?| array['chat', 'space'] then
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
    values (p_incident_id, 'google_chat', 'step_fired', p_incident_id::text,
            p_context || v_payload, v_inc.severity || ':L' || p_level)
    on conflict do nothing;
  end if;

  -- Voice is configured on the Tier 1 L2 step but never sent until approved (D-009): no row for it.
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

  -- The people asked to act: L0's (not the Admins) and everyone a fired step @mentioned — except the
  -- CEO and the site's AM, who are told once at L2 / L3 and never asked to acknowledge (spec §8, §18).
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
  ) t
  where not exists (
    select 1 from public.escalation_people(p_incident_id, '["ceo", "site_am"]') pe where pe.user_id = t.u);

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

