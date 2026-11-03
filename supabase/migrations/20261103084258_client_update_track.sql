-- S11 · client-update track (FR-20, spec §9, §16.2, §16.6; D-002, D-052).
--   · incidents.client_update_not_needed: "Not needed" + reason. Either mark stamps
--     client_updated_at / _by and the note, so resolve_incident's gate (S07) stays as it is.
--   · engine_client_update_due (service role): the runner calls it once the track is due — Tier 1 DOWN
--     15 min from the first failed check, Tier 2 60 min inside response hours (the due time is
--     @dxt/engine's `clientUpdateDueAt`; SQL never works out hours). The AM is @mentioned in the
--     incident's thread and emailed, acked or not; no active AM → the Admins (D-052 item 2).
--   · mark_client_update (signed in): Mark client updated (optional note) or Not needed (reason
--     required) — Admin, a Responder on own sites, the client's AM (§16.6).

set local lock_timeout = '5s';

alter table public.incidents
  add column client_update_not_needed boolean not null default false,
  add constraint incidents_client_update_not_needed_marked
    check (not client_update_not_needed or client_updated_at is not null);

-- ── Who may mark it (spec §16.6) ───────────────────────────────────────────────
-- Admin · Responder: own sites · Stakeholder (AM): own clients · Viewer —. Not can_ack: the person on
-- call acknowledges any Tier 1 site but marks the client update only on sites they own.
create function private.can_client_update(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: a person without an active profile has no role (null), which must read as "no".
  select coalesce(
    public.current_app_role() = 'admin'
    or exists (
      select 1 from public.incidents i
      join public.sites s on s.id = i.site_id
      join public.clients c on c.id = s.client_id
      where i.id = p_incident_id and auth.uid() is not null
        and ((public.current_app_role() = 'responder' and public.owns_site(s.id))
             -- The client's AM whatever their role (a Responder can be an AM too), never a Viewer.
             or (public.current_app_role() in ('stakeholder', 'responder') and c.am_user_id = auth.uid()))),
    false);
$$;

revoke execute on function private.can_client_update(uuid) from public, anon, authenticated;

-- ── The track fires ───────────────────────────────────────────────────────────
create function public.engine_client_update_due(
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
  v_tier smallint;
  v_internal boolean;
  v_people uuid[];
  v_am uuid;
  v_am_name text;
  v_payload jsonb;
  v_no_am boolean;
  v_at timestamptz;
begin
  if p_due_at is null or p_due_at > now() then
    return false;
  end if;
  -- Cheap answers before the lock: the runner asks every minute until it fires (db review M1).
  -- Re-checked under the lock below.
  perform 1 from public.incidents
  where id = p_incident_id and not client_update_required and severity = 'down'
    and state not in ('resolved', 'in_review', 'closed');
  if not found then
    return false;
  end if;

  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.client_update_required then
    return false;
  end if;
  -- A DOWN incident that is still open. Recovered is fine when the recovery came at or after the due
  -- time: the runner fires it when a DOWN drop covered the due time, and a recovery in that same
  -- minute may have been judged first. Recovered before it was due: never (db review M3).
  if v_inc.severity <> 'down' or v_inc.state in ('resolved', 'in_review', 'closed') then
    return false;
  end if;
  if v_inc.state in ('monitoring', 'needs_root_cause') and v_inc.recovered_at < p_due_at then
    return false;
  end if;

  select s.tier, c.is_internal, c.am_user_id into v_tier, v_internal, v_am
  from public.sites s join public.clients c on c.id = s.client_id
  where s.id = v_inc.site_id;
  -- Tier 3 goes to the report only; an internal client has nobody to tell (§9).
  if v_tier not in (1, 2) or v_internal then
    return false;
  end if;

  -- The thread needs its first alert (as engine_fire_step): an incident on a site muted before it
  -- opened waits for its late alert, one alerted before the mute keeps its track (§15.1, T09).
  if not public.engine_thread_live(p_incident_id) then
    return false;
  end if;

  -- The client's AM while active; otherwise every active Admin (D-052 item 2).
  select coalesce(array_agg(pe.user_id), '{}') into v_people
  from public.escalation_people(p_incident_id, '["site_am"]'::jsonb) pe;
  v_no_am := cardinality(v_people) = 0;
  if v_no_am then
    select coalesce(array_agg(pe.user_id), '{}') into v_people
    from public.escalation_people(p_incident_id, '["admins"]'::jsonb) pe;
  else
    select display_name into v_am_name from public.profiles where id = v_am;
  end if;

  update public.incidents
    set client_update_required = true, client_update_due_at = p_due_at
    where id = p_incident_id;

  v_payload := jsonb_build_object(
    'dueAt', p_due_at, 'tier', v_tier, 'minutes', case when v_tier = 1 then 15 else 60 end,
    'am', v_am_name, 'noAm', v_no_am, 'notified', to_jsonb(v_people),
    'mentioned', to_jsonb(v_people));

  -- The timeline shows when it fell due (10:03:12), not the run that noticed — but never before the
  -- thread's first alert: an incident a mute silenced gets its track once its late alert went
  -- (`alerted_at`, db review M2).
  v_at := greatest(p_due_at, coalesce(v_inc.alerted_at, p_due_at));
  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'client_update_due', v_payload, v_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.client_update_due', 'incident', p_incident_id,
          jsonb_build_object('client_update_required', false),
          jsonb_build_object('client_update_required', true, 'client_update_due_at', p_due_at,
                             'notified', to_jsonb(v_people)));

  insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
  values (p_incident_id, 'google_chat', 'client_update_due', p_incident_id::text,
          p_context || v_payload, 'client_update')
  on conflict do nothing;

  insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
  select p_incident_id, u, 'email', 'client_update_due', p_incident_id::text,
         p_context || v_payload, 'client_update'
  from unnest(v_people) u
  on conflict do nothing;

  return true;
end;
$$;

revoke execute on function public.engine_client_update_due(uuid, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.engine_client_update_due(uuid, timestamptz, jsonb) to service_role;

-- ── Mark client updated / Not needed ──────────────────────────────────────────
create function public.mark_client_update(p_incident_id uuid, p_not_needed boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_name text;
begin
  select * into v_inc from public.incidents where id = p_incident_id for no key update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if not private.can_client_update(p_incident_id) then
    raise exception 'This role can''t mark the client update of this incident' using errcode = '42501';
  end if;
  if not v_inc.client_update_required then
    raise exception 'No client update is due for this incident' using errcode = '55000';
  end if;
  if v_inc.client_updated_at is not null then
    raise exception 'The client update is already marked' using errcode = '55000';
  end if;
  if coalesce(p_not_needed, false) and v_note is null then
    raise exception 'Give a reason the client update isn''t needed' using errcode = '22023';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'Keep it under 500 characters' using errcode = '22001';
  end if;

  select display_name into v_name from public.profiles where id = auth.uid();

  update public.incidents
    set client_updated_at = now(), client_updated_by = auth.uid(), client_update_note = v_note,
        client_update_not_needed = coalesce(p_not_needed, false)
    where id = p_incident_id;

  insert into public.incident_events (incident_id, type, actor_id, payload)
  values (p_incident_id,
          case when p_not_needed then 'client_update_not_needed' else 'client_update_marked' end,
          auth.uid(), jsonb_build_object('by', v_name, 'note', v_note));

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.client_update', 'incident', p_incident_id,
          jsonb_build_object('client_updated_at', null),
          jsonb_build_object('client_updated_at', now(), 'not_needed', coalesce(p_not_needed, false),
                             'note', v_note));
end;
$$;

revoke execute on function public.mark_client_update(uuid, boolean, text) from public, anon;
grant execute on function public.mark_client_update(uuid, boolean, text) to authenticated;
