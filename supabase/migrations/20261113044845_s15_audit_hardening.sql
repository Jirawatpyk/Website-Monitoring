-- S15 security review (D-061): the audit log is now on a page Admins read, so every row in it must
-- come from the change it describes.
--
-- 1. write_audit goes (M1). Any signed-in Responder or Stakeholder could call it with any action,
--    entity and before / after, and the row could never be removed. Nothing calls it: every change
--    writes its own row in its own transaction.
-- 2. engine_post_late_alert writes incident.alerted (M2). The first alert after a mute restarts the
--    ladder clock (alerted_at) and sets the L0 person (l0_user_id), who may acknowledge. Body
--    otherwise as 20261029144512_oncall_routing.sql.
-- 3. profiles gets the row-change audit trigger (M3). An Admin can update profiles directly
--    (role, is_active) through PostgREST, and that wrote nothing. Rows are profile.create / update /
--    delete, under Access.

drop function public.write_audit(text, text, uuid, jsonb, jsonb);

create or replace function public.engine_post_late_alert(
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
  -- S15: who may acknowledge, and when the ladder counts from, change here (System row).
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  select null, 'incident.alerted', 'incident', p_incident_id,
         jsonb_build_object('alerted_at', v_inc.alerted_at, 'l0_user_id', v_inc.l0_user_id),
         jsonb_build_object('alerted_at', i.alerted_at, 'l0_user_id', i.l0_user_id, 'after_mute', true)
  from public.incidents i where i.id = p_incident_id;
  perform public.engine_queue_l0_emails(p_incident_id, v_sev, v_context,
                                         greatest(v_hold, now() + interval '5 minutes'), null, false); -- D-047
  return true;
end;
$$;

create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function private.audit_row_change('profile');
