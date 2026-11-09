-- D-058: Escalate now refuses during a D-023 key-page drop. On a DOWN incident whose home page is back
-- while a key page still fails (`episode_severity = 'problem'`), the DOWN ladder waits: the engine fires
-- nothing (`upSince`) and the Escalation card no longer offers the button. A page rendered before the
-- home page came back could still press it, so the function refuses too (spec check, D-058).
-- Same body as 20261104075341_monitor_fault_hand_check.sql plus the one guard.
create or replace function public.escalate_now(p_incident_id uuid, p_level smallint)
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
  if v_inc.escalation_plan ->> 'severity' = 'down' and v_inc.episode_severity = 'problem' then
    raise exception 'the home page is back: the DOWN ladder waits' using errcode = '55000', hint = 'home_back';
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
