-- DxT Monitor · S03 (engine review H2, D-021): a DOWN confirmed while the site's open incident is a
-- PROBLEM — blocked, not verified (D-001 / D-020), the commonest open PROBLEM until S04 — must not
-- be swallowed as a relapse. The same incident becomes DOWN and the DOWN alert goes out in its thread.

-- Raises the open PROBLEM incident to DOWN in one transaction: severity, "Confirmed down" (the
-- 30 s alert clock, PRD §9), back to waiting for an ack when it had recovered (as D-004), the
-- timeline, audit, site status and (unless muted) the DOWN Chat post + owner email. Returns false
-- when the incident is no longer an open PROBLEM (another engine run got there first).
create function public.engine_escalate_incident(
  p_incident_id uuid,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean
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

  update public.incidents
    set severity = 'down',
        detected_at = p_detected_at,
        recovered_at = case when state in ('monitoring', 'needs_root_cause') then null else recovered_at end,
        state = case
          when state in ('monitoring', 'needs_root_cause') then
            case when acked_at is not null then 'acknowledged'::public.incident_state else 'unacked'::public.incident_state end
          else state
        end
    where id = p_incident_id
    returning state into v_to;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'escalated_to_down', p_context, p_detected_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.severity', 'incident', p_incident_id,
          jsonb_build_object('severity', 'problem', 'state', v_from),
          jsonb_build_object('severity', 'down', 'state', v_to));

  update public.site_status
    set status = 'down', ok_rounds = 0, last_evaluated_at = p_detected_at, last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

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

    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context)
    select p_incident_id, s.primary_owner_id, 'email', 'down', p_incident_id::text, p_context
    from public.sites s
    join public.profiles p on p.id = s.primary_owner_id and p.is_active
    where s.id = v_site_id
    on conflict do nothing;
  end if;

  return true;
end;
$$;

revoke execute on function public.engine_escalate_incident(uuid, timestamptz, timestamptz, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.engine_escalate_incident(uuid, timestamptz, timestamptz, jsonb, boolean)
  to service_role;
