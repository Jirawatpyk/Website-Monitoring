-- D-077 (27 Nov 2026, Bua's review before CEO approval): an optional, internal "Preventive action" on
-- the root cause — what stops it happening again. Saved by save_root_cause and resolve_incident, kept in
-- the timeline and the audit log, shown on the incident page, the CSV and the CEO's weekly summary.
-- Never in the client report and never in a RESOLVED message: it stays out of `root_cause_input`'s
-- jsonb and so out of resolve_incident's notification context.

alter table public.incidents
  add column preventive_action text
    constraint incidents_preventive_action_length check (length(preventive_action) <= 500);

-- Trimmed, empty → null, at most 500 characters (as the form says).
create function private.preventive_input(p_prevent text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_prevent, '')), '');
begin
  if length(v) > 500 then
    raise exception 'Keep the preventive action under 500 characters' using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke execute on function private.preventive_input(text) from public, anon, authenticated;

-- ── save_root_cause: + p_prevent (last, defaulted; dropped first so PostgREST never sees two) ──────
drop function public.save_root_cause(uuid, text, text, text);

create function public.save_root_cause(
  p_incident_id uuid,
  p_category text,
  p_what text,
  p_fix text,
  p_prevent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_rc jsonb;
  v_prevent text;
  v_name text;
begin
  select * into v_inc from public.incidents where id = p_incident_id for no key update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if not private.can_ack(v_inc.site_id) then
    raise exception 'This role can''t write the root cause of this incident' using errcode = '42501';
  end if;
  if v_inc.state in ('resolved', 'in_review', 'closed') then
    raise exception 'This incident is already resolved' using errcode = '55000';
  end if;
  v_rc := private.root_cause_input(p_category, p_what, p_fix);
  v_prevent := private.preventive_input(p_prevent);

  select display_name into v_name from public.profiles where id = auth.uid();

  update public.incidents
    set root_cause_category = v_rc->>'category', root_cause = v_rc->>'what',
        root_cause_fix = v_rc->>'fix', preventive_action = v_prevent,
        -- Settled in Monitoring because a root cause was written (§16.4), now Unknown: it needs one.
        state = case
          when state = 'monitoring' and v_rc->>'category' = 'unknown' and recovered_at is not null
               and exists (select 1 from public.incident_events e
                           where e.incident_id = p_incident_id and e.type = 'ok_two_rounds'
                             and e.at >= recovered_at)
          then 'needs_root_cause'::public.incident_state
          else state end
    where id = p_incident_id;

  -- `first` and `state` let the timeline say written / draft (still down) / edited.
  insert into public.incident_events (incident_id, type, actor_id, payload)
  values (p_incident_id, 'root_cause', auth.uid(),
          v_rc || jsonb_build_object('prevent', v_prevent, 'by', v_name, 'state', v_inc.state,
                                     'first', v_inc.root_cause_category is null));

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.root_cause', 'incident', p_incident_id,
          jsonb_build_object('category', v_inc.root_cause_category, 'what', v_inc.root_cause,
                             'fix', v_inc.root_cause_fix, 'prevent', v_inc.preventive_action),
          v_rc || jsonb_build_object('prevent', v_prevent));
end;
$$;

revoke execute on function public.save_root_cause(uuid, text, text, text, text) from public, anon;
grant execute on function public.save_root_cause(uuid, text, text, text, text) to authenticated;

-- ── resolve_incident: as 20261016081115_alert_email_grace.sql, + p_prevent ────────────────────────
drop function public.resolve_incident(uuid, text, text, text, uuid);

create function public.resolve_incident(
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
  v_prevent := private.preventive_input(p_prevent);

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

  select display_name into v_name from public.profiles where id = auth.uid();
  -- D-077: the preventive action stays out of the messages' context (internal only).
  v_context := jsonb_build_object('resolvedBy', v_name, 'resolvedById', auth.uid(),
                                  'resolvedAt', v_now) || v_rc;

  update public.incidents
    set state = 'resolved', resolved_at = v_now, resolved_by = auth.uid(),
        root_cause_category = v_rc->>'category', root_cause = v_rc->>'what',
        root_cause_fix = v_rc->>'fix', preventive_action = v_prevent
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
            'posts_at', v_hold, 'accepted_check', p_accept_check_id,
            'notifies', exists (select 1 from public.notifications
                                where incident_id = p_incident_id and template = 'resolved'
                                  and status = 'queued')),
          v_now);

  return v_hold;
end;
$$;

revoke execute on function public.resolve_incident(uuid, text, text, text, uuid, text) from public, anon;
grant execute on function public.resolve_incident(uuid, text, text, text, uuid, text) to authenticated;
