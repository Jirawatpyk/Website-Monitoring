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
  v_flip_ok boolean;
  v_flap boolean;
begin
  -- Locked first, as the engine functions lock incident before site_status: no deadlock with a run,
  -- and the kind is chosen from the row the change is made to.
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or not private.can_ack(v_inc.site_id) then
    raise exception 'not allowed' using errcode = '42501';
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
  -- What the runner gives a relapse too (fromState, backSince, startedAt), so DOWN AGAIN reads
  -- "was back for …" and the state it left; `raised` words a PROBLEM raised by hand ("reported down").
  v_context := jsonb_build_object('manual', true, 'openedBy', v_actor, 'note', v_note,
                                  'startedAt', v_now, 'fromState', v_inc.state, 'trigger', 'manual')
               || case when v_inc.recovered_at is not null
                       then jsonb_build_object('backSince', v_inc.recovered_at) else '{}'::jsonb end
               || case when v_kind = 'raise' then jsonb_build_object('raised', true) else '{}'::jsonb end;
  -- The engine's own round: site_status never moves to a round nobody judged.
  select coalesce(st.last_round_at, v_now) into v_round
  from public.site_status st where st.site_id = v_inc.site_id;
  v_round := coalesce(v_round, v_now);

  -- The drop counts toward flapping at the press (D-004): the 3rd change in 30 min tags it, as the
  -- runner does (isFlapping). No change recorded (the site was failing already): never a new tag.
  select st.flip_ok into v_flip_ok from public.site_status st where st.site_id = v_inc.site_id;
  perform public.engine_record_flip(v_inc.site_id, v_now, false);
  select coalesce(v_flip_ok, false)
         and (select count(*) from unnest(st.flips) f where f > v_now - interval '30 minutes') >= 3
    into v_flap
  from public.site_status st where st.site_id = v_inc.site_id;
  v_flap := coalesce(v_flap, false);
  if v_kind = 'relapse' then
    v_ok := public.engine_relapse_incident(p_incident_id, 'down', 'manual', v_now, v_now, v_round,
                                            v_context, v_flap, true);
  else
    v_ok := public.engine_escalate_incident(p_incident_id, v_now, v_round, v_context, true, null, null,
                                             v_flap, coalesce(p_outside_hours, false));
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
          jsonb_build_object('kind', v_kind, 'note', v_note)
            || case when v_kind = 'raise' then jsonb_build_object('outside_hours', coalesce(p_outside_hours, false))
                    else '{}'::jsonb end);
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
  -- Engine runs overlap: the second "first run after a stop" waits here and then sees the first's lines.
  perform pg_advisory_xact_lock(hashtext('engine_mark_engine_back'));
  with by_hand as (
    -- From the open incidents (incidents_one_open_per_site), one (incident_id, at) probe each.
    select i.id as incident_id, h.last_at
    from public.incidents i
    cross join lateral (
      select max(e.at) as last_at
      from public.incident_events e
      where e.incident_id = i.id and e.at >= p_stopped_since
        and ((e.type in ('detected', 'relapsed', 'escalated_to_down') and e.payload -> 'manual' = 'true'::jsonb)
             or (e.type in ('step_fired', 'client_update_due') and e.payload -> 'byHand' = 'true'::jsonb))
    ) h
    where i.state not in ('resolved', 'in_review', 'closed') and h.last_at is not null
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

-- A run that read the incident before a hand DOWN (D-055 item 7, engine review M1): its recover is
-- refused, as judgedFrom refuses rounds from before manual_at in the runner. Body as 20261029144512.
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
      -- D-055 item 7: a run that judged a round from before a hand DOWN never undoes it (judgedFrom in SQL).
      and (manual_at is null or p_round_at > manual_at)
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
