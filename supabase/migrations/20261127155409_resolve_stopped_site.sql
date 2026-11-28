set local lock_timeout = '5s';

-- D-079: an incident on a site whose monitoring was stopped can be resolved without 2 OK rounds (none
-- can come); a drop still in progress ends at the stop through a `monitoring_stopped` event. Body as
-- 20261127084535_preventive_action.sql otherwise.
create or replace function public.resolve_incident(
  p_incident_id uuid,
  p_category text,
  p_what text,
  p_fix text,
  p_accept_check_id uuid default null,
  p_prevent text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_now timestamptz := now();
  v_hold timestamptz := now() + interval '10 seconds';
  v_rc jsonb;
  v_prevent text;
  v_name text;
  v_context jsonb;
  v_accept boolean := p_accept_check_id is not null;
  v_check_site uuid;
  v_stopped_at timestamptz;
  v_end_drop boolean := false;
begin
  select * into v_inc from public.incidents where id = p_incident_id for no key update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if not private.can_ack(v_inc.site_id) then
    raise exception 'This role can''t resolve this incident' using errcode = '42501';
  end if;
  if v_inc.state in ('resolved', 'in_review', 'closed') then
    raise exception 'This incident is already resolved' using errcode = '55000';
  end if;
  v_rc := private.root_cause_input(p_category, p_what, p_fix);
  v_prevent := case when p_prevent is null then v_inc.preventive_action
                    else private.preventive_input(p_prevent) end;

  if v_accept then
    if not coalesce(public.current_app_role() = 'admin', false) then
      raise exception 'Only an Admin can accept a new baseline' using errcode = '42501';
    end if;
    if v_inc.trigger <> 'content_change' or v_rc->>'category' <> 'client_change' then
      raise exception 'Only a Page change resolved as a client-side change can accept the page'
        using errcode = '22023';
    end if;
    select m.site_id into v_check_site
      from public.crawler_checks c join public.monitors m on m.id = c.monitor_id
      where c.id = p_accept_check_id;
    if v_check_site is distinct from v_inc.site_id then
      raise exception 'This fetch can''t become the baseline' using errcode = '22023';
    end if;
  elsif not (select s.is_active from public.sites s where s.id = v_inc.site_id) then
    -- D-079: the site's monitoring was stopped, so no OK round can ever come: the 2-OK-rounds
    -- condition is waived. A drop still in progress ends at the stop (nobody watched after it).
    select max(a.at) into v_stopped_at from public.audit_log a
      where a.entity = 'site' and a.entity_id = v_inc.site_id
        and (a.before ->> 'is_active') = 'true' and (a.after ->> 'is_active') = 'false';
    v_end_drop := v_inc.state not in ('monitoring', 'needs_root_cause') or v_inc.recovered_at is null;
  elsif v_inc.state not in ('monitoring', 'needs_root_cause') or v_inc.recovered_at is null
     or not exists (select 1 from public.incident_events
                    where incident_id = p_incident_id and type = 'ok_two_rounds'
                      and at >= v_inc.recovered_at) then
    raise exception 'It needs 2 OK rounds in a row before it can be resolved' using errcode = '55000';
  end if;
  if v_inc.client_update_required and v_inc.client_updated_at is null then
    raise exception 'Mark the client update first' using errcode = '55000';
  end if;
  if v_rc->>'category' = 'unknown' then
    raise exception 'Unknown keeps the incident open — pick a category' using errcode = '55000';
  end if;

  if v_accept then
    perform private.accept_baseline(p_accept_check_id, left(v_rc->>'what', 500), p_incident_id);
    perform public.engine_cancel_ladder(p_incident_id, 'Resolved with a new baseline');
    perform public.engine_cancel_held_problem(p_incident_id, 'Resolved with a new baseline');
    -- D-047: resolved inside the 5-min grace — its alert email never goes.
    update public.notifications
      set status = 'cancelled', error = 'Resolved within 5 min — no email (D-047)', next_retry_at = null
      where incident_id = p_incident_id and channel = 'email' and template in ('down', 'problem', 'down_again', 'problem_again')
        and status = 'queued' and attempts = 0 and hold_until > now() and hold_until <= created_at + interval '5 minutes';
  end if;

  if v_end_drop then
    perform public.engine_cancel_ladder(p_incident_id, 'Resolved: monitoring stopped');
    perform public.engine_cancel_held_problem(p_incident_id, 'Resolved: monitoring stopped');
    insert into public.incident_events (incident_id, type, actor_id, payload, at)
    values (p_incident_id, 'monitoring_stopped', auth.uid(),
            jsonb_build_object('stoppedAt', v_stopped_at), least(greatest(coalesce(v_stopped_at, v_now), v_inc.started_at), v_now));
  end if;

  select display_name into v_name from public.profiles where id = auth.uid();
  -- D-077: the preventive action stays out of the messages' context (internal only).
  v_context := jsonb_build_object('resolvedBy', v_name, 'resolvedById', auth.uid(),
                                  'resolvedAt', v_now) || v_rc;

  update public.incidents
    set state = 'resolved', resolved_at = v_now, resolved_by = auth.uid(),
        root_cause_category = v_rc->>'category', root_cause = v_rc->>'what',
        root_cause_fix = v_rc->>'fix',
        preventive_action = v_prevent
    where id = p_incident_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.resolved', 'incident', p_incident_id,
          jsonb_build_object('state', v_inc.state, 'category', v_inc.root_cause_category,
                             'what', v_inc.root_cause, 'fix', v_inc.root_cause_fix,
                             'prevent', v_inc.preventive_action),
          jsonb_build_object('state', 'resolved', 'resolved_at', v_now,
                             'accepted_check', p_accept_check_id, 'prevent', v_prevent) || v_rc);

  -- A held flapping summary would read after RESOLVED; Undo puts it back.
  update public.notifications
    set status = 'cancelled', error = 'Superseded: resolved', next_retry_at = null
    where incident_id = p_incident_id and template = 'flap_summary'
      and status = 'queued' and attempts = 0;

  insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
  select p_incident_id, 'google_chat', 'resolved', p_incident_id::text, v_context, v_hold
  where exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat'
      and template in ('down', 'problem') and status <> 'cancelled'
  )
  on conflict do nothing;

  insert into public.notifications
    (incident_id, user_id, channel, template, thread_key, context, hold_until)
  select distinct p_incident_id, n.user_id, 'email'::public.notification_channel, 'resolved',
         p_incident_id::text, v_context, v_hold
  from public.notifications n
  join public.profiles p on p.id = n.user_id and p.is_active
  where n.incident_id = p_incident_id and n.channel = 'email' and n.status = 'sent'
  on conflict do nothing;

  insert into public.incident_events (incident_id, type, actor_id, payload, at)
  values (p_incident_id, 'resolved', auth.uid(),
          v_rc || jsonb_build_object('prevent', v_prevent, 'by', v_name, 'from', v_inc.state,
            'posts_at', v_hold, 'accepted_check', p_accept_check_id, 'monitoring_stopped', v_end_drop,
            'notifies', exists (select 1 from public.notifications
                                where incident_id = p_incident_id and template = 'resolved'
                                  and status = 'queued')),
          v_now);

  return v_hold;
end;
$$;

-- D-079: Undo refuses a resolve that ended a stopped site's drop. Body as 20261015053442_page_change.sql otherwise.
create or replace function public.undo_resolve(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_from public.incident_state;
  v_accepted uuid;
begin
  select * into v_inc from public.incidents where id = p_incident_id for no key update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if v_inc.state <> 'resolved' or v_inc.resolved_by is null or v_inc.auto_resolved then
    raise exception 'Nothing to undo' using errcode = '55000';
  end if;
  if v_inc.resolved_by is distinct from auth.uid() then
    raise exception 'Only the person who resolved it can undo it' using errcode = '42501';
  end if;
  -- D-079 (engine review M1): a resolve that ended a stopped site's drop can't be undone — the incident
  -- would reopen with its drop closed at the stop, and a restart would never relapse it (no recovery).
  if exists (
    select 1 from public.incident_events
    where incident_id = p_incident_id and type = 'resolved'
      and coalesce((payload ->> 'monitoring_stopped')::boolean, false)
      and at = v_inc.resolved_at
  ) then
    raise exception 'This resolve closed the outage of a site whose monitoring is stopped — it can''t be undone'
      using errcode = '55000';
  end if;
  if now() >= v_inc.resolved_at + interval '10 seconds' then
    raise exception 'The undo window has closed' using errcode = '55000';
  end if;

  perform 1 from public.notifications
    where incident_id = p_incident_id and template = 'resolved' and status = 'queued'
    for update;
  if exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and template = 'resolved'
      and (status = 'sent' or (status = 'queued' and attempts > 0))
  ) then
    raise exception 'The undo window has closed' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.incidents
    where site_id = v_inc.site_id and id <> p_incident_id
      and state not in ('resolved', 'in_review', 'closed')
  ) then
    raise exception 'The site has a new incident — this one stays resolved' using errcode = '55000';
  end if;

  update public.notifications
    set status = 'cancelled', next_retry_at = null
    where incident_id = p_incident_id and template = 'resolved' and status = 'queued';

  update public.notifications
    set status = 'queued', error = null, next_retry_at = null
    where incident_id = p_incident_id and template = 'flap_summary' and status = 'cancelled'
      and error = 'Superseded: resolved';

  select (payload->>'from')::public.incident_state, (payload->>'accepted_check')::uuid
    into v_from, v_accepted
  from public.incident_events
  where incident_id = p_incident_id and type = 'resolved'
  order by at desc
  limit 1;
  v_from := coalesce(v_from, 'needs_root_cause');

  if v_accepted is not null then
    perform private.undo_baseline(c.monitor_id, p_incident_id)
      from public.crawler_checks c where c.id = v_accepted;
  end if;

  begin
    update public.incidents
      set state = v_from, resolved_at = null, resolved_by = null
      where id = p_incident_id;
  exception when unique_violation then
    -- The engine opened a new incident for the site between the check above and here.
    raise exception 'The site has a new incident — this one stays resolved' using errcode = '55000';
  end;

  insert into public.incident_events (incident_id, type, actor_id, payload)
  values (p_incident_id, 'resolve_undone', auth.uid(), jsonb_build_object('state', v_from));

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.resolve_undone', 'incident', p_incident_id,
          jsonb_build_object('state', 'resolved', 'resolved_at', v_inc.resolved_at),
          jsonb_build_object('state', v_from));
end;
$$;
