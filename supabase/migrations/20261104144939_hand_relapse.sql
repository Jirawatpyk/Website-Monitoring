-- S12b follow-up (D-055 items 6–7, spec §30): "Down again" by hand, and the engine-back timeline line.
--   · report_down_by_hand: during the sweep fault, a Tier 1 site whose incident is still open — recovered
--     (Monitoring / Needs root cause) or a PROBLEM — is reported DOWN by hand. A recovered DOWN relapses
--     (DOWN AGAIN in its thread, the ladder clock and fired levels kept, D-004); a PROBLEM is raised to
--     DOWN (D-021). The engine's own functions do the write, so their guards and messages hold; the
--     round passed is the site's stored one, so the engine's clock never moves.
--   · incidents.manual_at: when a drop was last reported by hand. The runner judges such an incident only
--     on rounds after it (`judgedFrom`); a manual open counts from its started_at.
--   · engine_mark_engine_back: the first engine run after a stop writes one `engine_back` event on each
--     open incident that had a by-hand action during it (§30.8).

set local lock_timeout = '5s';

alter table public.incidents add column manual_at timestamptz;

create function public.report_down_by_hand(p_incident_id uuid, p_note text, p_outside_hours boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_inc public.incidents%rowtype;
  v_actor text;
  v_round timestamptz;
  v_context jsonb;
  v_kind text;
  v_ok boolean;
begin
  select * into v_inc from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  -- The hand check's rules: may act, a live Tier 1 site, the sweep fault open.
  perform private.hand_check_site(v_inc.site_id);
  if char_length(v_note) > 500 then
    raise exception 'note too long' using errcode = '22001';
  end if;
  if exists (select 1 from public.maintenance_windows w
             where w.site_id = v_inc.site_id and public.window_state(w, v_now) = 'active') then
    raise exception 'the site is muted or in maintenance' using errcode = '55000', hint = 'paused';
  end if;

  if v_inc.state in ('resolved', 'in_review', 'closed') then
    raise exception 'the incident is closed' using errcode = '55000', hint = 'not_down_again';
  elsif v_inc.severity = 'problem' then
    v_kind := 'raise';
  elsif v_inc.state in ('monitoring', 'needs_root_cause') or v_inc.episode_severity = 'problem' then
    v_kind := 'relapse';
  else
    -- Still down: it is already the alert.
    raise exception 'the site is down already' using errcode = '55000', hint = 'not_down_again';
  end if;

  select display_name into v_actor from public.profiles where id = auth.uid();
  v_context := jsonb_build_object('manual', true, 'openedBy', v_actor, 'note', v_note);
  -- The engine's own round: site_status never moves to a round nobody judged.
  select coalesce(st.last_round_at, v_now) into v_round
  from public.site_status st where st.site_id = v_inc.site_id;
  v_round := coalesce(v_round, v_now);

  if v_kind = 'relapse' then
    v_ok := public.engine_relapse_incident(p_incident_id, 'down', 'manual', v_now, v_now, v_round,
                                            v_context, false, true);
  else
    v_ok := public.engine_escalate_incident(p_incident_id, v_now, v_round, v_context, true, null, null,
                                             false, coalesce(p_outside_hours, false));
  end if;
  if not v_ok then
    raise exception 'the incident moved on' using errcode = '55000', hint = 'not_down_again';
  end if;

  -- Who reported it, on the event the engine function just wrote.
  update public.incident_events
    set actor_id = auth.uid()
    where id = (select e.id from public.incident_events e
                where e.incident_id = p_incident_id and e.actor_id is null
                  and e.type = case when v_kind = 'relapse' then 'relapsed' else 'escalated_to_down' end
                  and e.at = v_now
                limit 1);

  update public.incidents set manual_at = v_now where id = p_incident_id;
  update public.site_status set status = 'down', since = v_now where site_id = v_inc.site_id;

  insert into public.hand_checks (site_id, checked_by, checked_at, outcome, incident_id, note)
  values (v_inc.site_id, auth.uid(), v_now, 'down', p_incident_id, v_note);

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.hand_down', 'incident', p_incident_id,
          jsonb_build_object('state', v_inc.state, 'severity', v_inc.severity),
          jsonb_build_object('kind', v_kind, 'note', v_note, 'outside_hours', coalesce(p_outside_hours, false)));
  return v_kind;
end;
$$;

revoke execute on function public.report_down_by_hand(uuid, text, boolean) from public, anon;
grant execute on function public.report_down_by_hand(uuid, text, boolean) to authenticated;

-- §30.8: one `engine_back` event per open incident with a by-hand action since the engine stopped.
create function public.engine_mark_engine_back(p_stopped_since timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with by_hand as (
    select e.incident_id, max(e.at) as last_at
    from public.incident_events e
    join public.incidents i on i.id = e.incident_id
    where i.state not in ('resolved', 'in_review', 'closed')
      and e.at >= p_stopped_since
      and ((e.type in ('detected', 'relapsed', 'escalated_to_down') and (e.payload ->> 'manual')::boolean)
           or (e.type in ('step_fired', 'client_update_due') and (e.payload ->> 'byHand')::boolean))
    group by e.incident_id
  ), fresh as (
    select b.incident_id from by_hand b
    where not exists (select 1 from public.incident_events x
                      where x.incident_id = b.incident_id and x.type = 'engine_back' and x.at >= b.last_at)
  ), ins as (
    insert into public.incident_events (incident_id, type, payload, at)
    select incident_id, 'engine_back', jsonb_build_object('stoppedSince', p_stopped_since), now() from fresh
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

revoke execute on function public.engine_mark_engine_back(timestamptz) from public, anon, authenticated;
grant execute on function public.engine_mark_engine_back(timestamptz) to service_role;
