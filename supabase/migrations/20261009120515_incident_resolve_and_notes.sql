-- S07 (FR-06, D-033): people write notes and root causes and resolve incidents — through security
-- definer functions shaped like ack_incident / undo_ack (S02b), the only way people change an
-- incident: who may act (private.can_ack: Admin anywhere, Responder on own sites, D-016), state,
-- timeline, audit and messages in one transaction.

-- ── Columns ─────────────────────────────────────────────────────────────────
-- Root cause = category + "What happened" (root_cause, PRD §11) + "What fixed it" (optional).
alter table public.incidents
  add column root_cause_fix text,
  add column resolved_by uuid references public.profiles (id) on delete restrict;

create index incidents_resolved_by_idx on public.incidents (resolved_by) where resolved_by is not null;

-- The nine categories of the Incident / Resolve boards (mirrors ROOT_CAUSE_CATEGORIES in
-- packages/shared/src/domain.ts). Staging's reset script wrote 'test' before S07: such values are
-- cleared first (with an audit row), so the table is small enough to validate here.
with cleared as (
  update public.incidents
    set root_cause_category = null
    where root_cause_category is not null
      and root_cause_category not in ('hosting', 'deploy', 'dns', 'ssl', 'third_party', 'traffic',
                                      'client_change', 'false_alarm', 'unknown')
    returning id
)
insert into public.audit_log (action, entity, entity_id, before, after)
select 'incident.root_cause', 'incident', id, jsonb_build_object('category', 'not one of the nine'),
       jsonb_build_object('category', null, 'by', 'S07 migration')
from cleared;

alter table public.incidents
  add constraint incidents_root_cause_category_check check (
    root_cause_category in ('hosting', 'deploy', 'dns', 'ssl', 'third_party', 'traffic',
                            'client_change', 'false_alarm', 'unknown')
  );

-- ── Shared input check ──────────────────────────────────────────────────────
-- The root-cause fields as one checked jsonb (errors read as the form's: 22023).
create function private.root_cause_input(p_category text, p_what text, p_fix text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_what text := nullif(btrim(coalesce(p_what, '')), '');
  v_fix text := nullif(btrim(coalesce(p_fix, '')), '');
begin
  if p_category is null or p_category not in ('hosting', 'deploy', 'dns', 'ssl', 'third_party',
      'traffic', 'client_change', 'false_alarm', 'unknown') then
    raise exception 'Choose a root cause category' using errcode = '22023';
  end if;
  if v_what is null then
    raise exception 'Say what happened' using errcode = '22023';
  end if;
  if length(v_what) > 2000 or length(coalesce(v_fix, '')) > 500 then
    raise exception 'The root cause is too long' using errcode = '22023';
  end if;
  return jsonb_build_object('category', p_category, 'what', v_what, 'fix', v_fix);
end;
$$;

-- ── Note ────────────────────────────────────────────────────────────────────
-- A note on the timeline and, when the incident has a Chat thread, the NOTE reply in it at once
-- (§16.5: no @mention, no email; the 10 s hold is for ack and resolve). Each note is its own message
-- (dedupe_key = the event id), so a second note isn't dropped by notifications_once_per_incident.
-- Errors: 42501 not allowed · P0002 not found · 22023 empty / too long. Returns the event id.
create function public.add_incident_note(p_incident_id uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_text text := btrim(coalesce(p_text, ''));
  v_name text;
  v_event uuid;
begin
  select * into v_inc from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if not private.can_ack(v_inc.site_id) then
    raise exception 'This role can''t add notes to this incident' using errcode = '42501';
  end if;
  if v_text = '' then
    raise exception 'Write the note first' using errcode = '22023';
  end if;
  if length(v_text) > 2000 then
    raise exception 'Keep the note under 2,000 characters' using errcode = '22023';
  end if;

  select display_name into v_name from public.profiles where id = auth.uid();

  insert into public.incident_events (incident_id, type, actor_id, payload)
  values (p_incident_id, 'note', auth.uid(), jsonb_build_object('text', v_text, 'by', v_name))
  returning id into v_event;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'incident.note', 'incident', p_incident_id,
          jsonb_build_object('event', v_event, 'text', v_text));

  -- Into the thread only where there is one (a muted incident has none).
  insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
  select p_incident_id, 'google_chat', 'note', p_incident_id::text,
         jsonb_build_object('text', v_text, 'by', v_name, 'byId', auth.uid()), v_event::text
  where exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat'
      and template in ('down', 'problem') and status <> 'cancelled'
  )
  on conflict do nothing;

  return v_event;
end;
$$;

-- ── Root cause ──────────────────────────────────────────────────────────────
-- Saves the root cause without resolving ("Save, keep open"): allowed while still down (a draft) and
-- any time before Resolved. Each save joins the timeline; Unknown never meets the condition (§16.3).
-- Errors: 42501 · P0002 · 22023 (fields) · 55000 already resolved.
create function public.save_root_cause(p_incident_id uuid, p_category text, p_what text, p_fix text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_rc jsonb;
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

  select display_name into v_name from public.profiles where id = auth.uid();

  update public.incidents
    set root_cause_category = v_rc->>'category', root_cause = v_rc->>'what',
        root_cause_fix = v_rc->>'fix',
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
          v_rc || jsonb_build_object('by', v_name, 'state', v_inc.state,
                                     'first', v_inc.root_cause_category is null));

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.root_cause', 'incident', p_incident_id,
          jsonb_build_object('category', v_inc.root_cause_category, 'what', v_inc.root_cause,
                             'fix', v_inc.root_cause_fix),
          v_rc);
end;
$$;

-- ── Resolve ─────────────────────────────────────────────────────────────────
-- Resolves an incident when all three conditions hold (§15.4, §16.1–3, T10) — checked here, never
-- trusted from the page: OK for 2 rounds (an ok_two_rounds event since the latest recovery: Needs
-- root cause, or Monitoring when the root cause was written first, §16.4), the client
-- update not required or marked (D-002; nothing requires it until S11), and a root cause other than
-- Unknown. Saves the root cause with it, cancels a held flapping summary (it would post after
-- RESOLVED, S04b carry-over) and holds the RESOLVED reply (no @mention) and an email to everyone
-- already emailed about the incident for the 10 s Undo window. Returns when they go out.
-- Errors: 42501 · P0002 · 22023 (fields) · 55000 a condition not met (the message names it).
create function public.resolve_incident(p_incident_id uuid, p_category text, p_what text, p_fix text)
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
  v_name text;
  v_context jsonb;
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
  if v_inc.state not in ('monitoring', 'needs_root_cause') or v_inc.recovered_at is null
     or not exists (select 1 from public.incident_events
                    where incident_id = p_incident_id and type = 'ok_two_rounds'
                      and at >= v_inc.recovered_at) then
    raise exception 'It needs 2 OK rounds in a row before it can be resolved' using errcode = '55000';
  end if;
  if v_inc.client_update_required and v_inc.client_updated_at is null then
    raise exception 'Mark the client update first' using errcode = '55000';
  end if;
  v_rc := private.root_cause_input(p_category, p_what, p_fix);
  if v_rc->>'category' = 'unknown' then
    raise exception 'Unknown keeps the incident open — pick a category' using errcode = '55000';
  end if;

  select display_name into v_name from public.profiles where id = auth.uid();
  v_context := jsonb_build_object('resolvedBy', v_name, 'resolvedById', auth.uid(),
                                  'resolvedAt', v_now) || v_rc;

  update public.incidents
    set state = 'resolved', resolved_at = v_now, resolved_by = auth.uid(),
        root_cause_category = v_rc->>'category', root_cause = v_rc->>'what',
        root_cause_fix = v_rc->>'fix'
    where id = p_incident_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.resolved', 'incident', p_incident_id,
          jsonb_build_object('state', v_inc.state, 'category', v_inc.root_cause_category,
                             'what', v_inc.root_cause, 'fix', v_inc.root_cause_fix),
          jsonb_build_object('state', 'resolved', 'resolved_at', v_now) || v_rc);

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

  -- Everyone really emailed about this incident (PRD §7: everyone who got the DOWN email; EmailAlert:
  -- someone whose email never went out isn't told).
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
          v_rc || jsonb_build_object('by', v_name, 'from', v_inc.state, 'posts_at', v_hold,
            'notifies', exists (select 1 from public.notifications
                                where incident_id = p_incident_id and template = 'resolved'
                                  and status = 'queued')),
          v_now);

  return v_hold;
end;
$$;

-- Takes back the signed-in person's own resolve inside its 10 s window: the held messages are
-- cancelled, a summary it set aside is due again, and the incident goes back to the state it was
-- resolved from (Needs root cause or Monitoring; the root cause stays saved). Too late once the window passed, a message was claimed, or the site
-- opened a new incident meanwhile. Errors: 42501 · P0002 · 55000.
create function public.undo_resolve(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_from public.incident_state;
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

  select (payload->>'from')::public.incident_state into v_from
  from public.incident_events
  where incident_id = p_incident_id and type = 'resolved'
  order by at desc
  limit 1;
  v_from := coalesce(v_from, 'needs_root_cause');

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

revoke execute on function private.root_cause_input(text, text, text) from public, anon, authenticated;
revoke execute on function
  public.add_incident_note(uuid, text),
  public.save_root_cause(uuid, text, text, text),
  public.resolve_incident(uuid, text, text, text),
  public.undo_resolve(uuid)
  from public, anon;
grant execute on function
  public.add_incident_note(uuid, text),
  public.save_root_cause(uuid, text, text, text),
  public.resolve_incident(uuid, text, text, text),
  public.undo_resolve(uuid)
  to authenticated;

-- ── S06 review carry-over (L2) ──────────────────────────────────────────────
-- engine_relapse_incident as in S04b (20261007130253), plus the guard: a DOWN drop on a PROBLEM
-- incident is refused here (false, nothing queued); the runner already escalates first.
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
  p_status public.site_state default null
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
                     when escalation_level > 0 then 'escalated'::public.incident_state
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
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
    values (p_incident_id, 'google_chat', p_severity::text || '_again', p_incident_id::text,
            p_context, to_char(p_round_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    on conflict do nothing;
  end if;

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;

-- ── OK for 2 rounds, on the timeline every time ─────────────────────────────
-- engine_settle_incident as in S04a (20261007091143), except that the ok_two_rounds event is written
-- once per recovery — also when the incident stays in Monitoring because its root cause was written
-- first (§16.4). resolve_incident reads it (engine-review H1); the audit row stays for a state change.
create or replace function public.engine_settle_incident(
  p_incident_id uuid,
  p_from public.incident_state,
  p_to public.incident_state,
  p_at timestamptz,
  p_round_at timestamptz,
  p_monitors jsonb default null,
  p_status public.site_state default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_site_id uuid;
begin
  update public.incidents
    set state = p_to
    where id = p_incident_id and state = p_from
    returning site_id into v_site_id;

  if v_site_id is null then
    return false;
  end if;

  -- Once per recovery: overlapping runs queue on the row lock above, and the second sees the first's
  -- event (READ COMMITTED); a relapse moves recovered_at, so the next recovery gets its own.
  insert into public.incident_events (incident_id, type, payload, at)
  select p_incident_id, 'ok_two_rounds', jsonb_build_object('state', p_to), p_at
  where p_to is distinct from p_from
     or not exists (
       select 1 from public.incident_events e
       where e.incident_id = p_incident_id and e.type = 'ok_two_rounds'
         and e.at >= (select recovered_at from public.incidents where id = p_incident_id));

  if p_to is distinct from p_from then
    insert into public.audit_log (action, entity, entity_id, before, after)
    values ('incident.state', 'incident', p_incident_id,
            jsonb_build_object('state', p_from), jsonb_build_object('state', p_to));
  end if;

  update public.site_status
    set status = 'ok', since = p_at, ok_rounds = 2, last_evaluated_at = p_at,
        last_round_at = p_round_at
    where site_id = v_site_id and (last_round_at is null or last_round_at <= p_round_at);

  perform public.engine_write_monitors(v_site_id, p_round_at, p_monitors, p_status);
  return true;
end;
$$;
