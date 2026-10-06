-- DxT Monitor · S02b delivery: per-person email next to the Chat post, a log of every send
-- attempt, retries with backoff + email fallback (PRD §9), and acknowledge with a 10 s Undo
-- (spec §14.3, §16.8; D-016).

-- ── One live message per incident / channel / template / person ──────────
-- A cancelled message (Undo) no longer counts, so ack → Undo → ack again can queue a new one.
drop index public.notifications_once_per_incident;
create unique index notifications_once_per_incident
  on public.notifications (incident_id, channel, template, user_id) nulls not distinct
  where status <> 'cancelled';

-- ── notification_attempts ─────────────────────────────────────────────────
-- Delivery status of every attempt (PRD §9 "record delivery status for every message").
-- Append-only like audit_log: `at` is the attempt time and a row never changes.
create table public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  attempt smallint not null check (attempt >= 1),
  ok boolean not null,
  error text,
  provider_message_id text,
  at timestamptz not null default now(),
  unique (notification_id, attempt)
);

alter table public.notification_attempts enable row level security;
create policy notification_attempts_select_admin on public.notification_attempts
  for select to authenticated using ((select public.current_app_role()) = 'admin');

revoke all on public.notification_attempts from public, anon, authenticated;
grant select on public.notification_attempts to authenticated;
grant all on public.notification_attempts to service_role;

-- ── Engine writes: email next to Chat ─────────────────────────────────────
-- Same as S02a, plus the DOWN email to the primary owner (L0; locked, so `notify_email` doesn't
-- turn it off — PRD §8, D-016).
create or replace function public.engine_open_incident(
  p_site_id uuid,
  p_monitor_id uuid,
  p_trigger public.incident_trigger,
  p_severity public.severity,
  p_started_at timestamptz,
  p_detected_at timestamptz,
  p_round_at timestamptz,
  p_context jsonb,
  p_notify boolean
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.incidents (site_id, monitor_id, trigger, severity, started_at, detected_at)
  values (p_site_id, p_monitor_id, p_trigger, p_severity, p_started_at, p_detected_at)
  on conflict (site_id) where state not in ('resolved', 'in_review', 'closed') do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.incident_events (incident_id, type, payload, at)
  values (v_id, 'detected', p_context, p_detected_at);

  insert into public.audit_log (action, entity, entity_id, after)
  values ('incident.opened', 'incident', v_id,
          jsonb_build_object('state', 'unacked', 'severity', p_severity, 'trigger', p_trigger,
                             'site_id', p_site_id, 'started_at', p_started_at));

  insert into public.site_status as s
    (site_id, status, since, last_evaluated_at, last_round_at, ok_rounds)
  values (p_site_id, p_severity::text::public.site_state, p_started_at, p_detected_at, p_round_at, 0)
  on conflict (site_id) do update
    set status = excluded.status, since = excluded.since,
        last_evaluated_at = excluded.last_evaluated_at, last_round_at = excluded.last_round_at,
        ok_rounds = 0;

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context)
    values (v_id, 'google_chat', p_severity::text, v_id::text, p_context);

    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context)
    select v_id, s.primary_owner_id, 'email', p_severity::text, v_id::text, p_context
    from public.sites s
    where s.id = p_site_id and s.primary_owner_id is not null;
  end if;

  return v_id;
end;
$$;

-- Same as S02a, plus the RECOVERED email to everyone already emailed about the incident.
create or replace function public.engine_recover_incident(
  p_incident_id uuid,
  p_from public.incident_state,
  p_to public.incident_state,
  p_recovered_at timestamptz,
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
begin
  update public.incidents
    set state = p_to, recovered_at = p_recovered_at
    where id = p_incident_id and state = p_from
    returning site_id into v_site_id;

  if v_site_id is null then
    return false;
  end if;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'recovered', p_context, p_recovered_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.recovered', 'incident', p_incident_id,
          jsonb_build_object('state', p_from),
          jsonb_build_object('state', p_to, 'recovered_at', p_recovered_at));

  update public.site_status
    set ok_rounds = 1, last_evaluated_at = p_recovered_at, last_round_at = p_round_at
    where site_id = v_site_id;

  if p_notify then
    insert into public.notifications (incident_id, channel, template, thread_key, context)
    values (p_incident_id, 'google_chat', 'recovered', p_incident_id::text, p_context)
    on conflict do nothing;

    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context)
    select distinct p_incident_id, n.user_id, 'email'::public.notification_channel, 'recovered',
           p_incident_id::text, p_context
    from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'email' and n.status <> 'cancelled'
      and n.user_id is not null
    on conflict do nothing;
  end if;

  return true;
end;
$$;

-- ── Notifier ──────────────────────────────────────────────────────────────
-- Claims due messages of one channel. SKIP LOCKED keeps two runs apart; the 90 s lease (longer
-- than a run's 60 s maxDuration) covers a run that dies. After an attempt the notifier sets
-- `next_retry_at` itself: the backoff (30 s, 2 min, 8 min) or nothing when sent.
create or replace function public.claim_notifications(
  p_channel public.notification_channel,
  p_limit integer default 20
)
returns setof public.notifications
language sql
set search_path = ''
as $$
  with due as (
    select id from public.notifications
    where status = 'queued'
      and channel = p_channel
      and (hold_until is null or hold_until <= now())
      and (next_retry_at is null or next_retry_at <= now())
    order by created_at
    limit p_limit
    for update skip locked
  )
  update public.notifications n
    set attempts = n.attempts + 1, next_retry_at = now() + interval '90 seconds'
    from due
    where n.id = due.id
  returning n.*;
$$;

-- Chat failed after its last retry: email the same alert to the site's backup and every active
-- Admin who doesn't already have it (D-016). Returns how many emails were queued.
create function public.queue_fallback_emails(p_notification_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.notifications (incident_id, user_id, channel, template, thread_key, context)
  select n.incident_id, r.user_id, 'email', n.template, n.thread_key,
         n.context || jsonb_build_object('fallback', true)
  from public.notifications n
  join public.incidents i on i.id = n.incident_id
  join public.sites s on s.id = i.site_id
  cross join lateral (
    select s.backup_owner_id as user_id
    union
    select p.id from public.profiles p where p.role = 'admin' and p.is_active
  ) r
  where n.id = p_notification_id and n.channel = 'google_chat' and r.user_id is not null
    and not exists (
      select 1 from public.notifications e
      where e.incident_id = n.incident_id and e.channel = 'email' and e.template = n.template
        and e.user_id = r.user_id and e.status <> 'cancelled'
    )
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz, timestamptz, timestamptz, jsonb, boolean),
  public.engine_recover_incident(uuid, public.incident_state, public.incident_state, timestamptz, timestamptz, jsonb, boolean),
  public.claim_notifications(public.notification_channel, integer),
  public.queue_fallback_emails(uuid)
  from public, anon, authenticated;
grant execute on function
  public.engine_open_incident(uuid, uuid, public.incident_trigger, public.severity, timestamptz, timestamptz, timestamptz, jsonb, boolean),
  public.engine_recover_incident(uuid, public.incident_state, public.incident_state, timestamptz, timestamptz, jsonb, boolean),
  public.claim_notifications(public.notification_channel, integer),
  public.queue_fallback_emails(uuid)
  to service_role;

-- ── Acknowledge + Undo (signed-in people) ─────────────────────────────────
-- Who may acknowledge (PRD §3, D-012, D-016): an Admin on any site; a Responder on sites they own
-- (primary or backup). On-call Tier 1 access comes with on-call shifts (S10).
create function private.can_ack(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: a person without an active profile has no role (null), which must read as "no".
  select coalesce(public.current_app_role() = 'admin'
      or (public.current_app_role() = 'responder' and public.owns_site(p_site_id)), false);
$$;

-- Acknowledges an open, unacknowledged incident as the signed-in person, in one transaction:
-- state, timeline, audit, and the ACKNOWLEDGED messages held for the 10 s Undo window — the Chat
-- reply (only when the DOWN was posted) and an email to everyone already emailed. Returns the time
-- the messages go out. Errors: 42501 not allowed · P0002 not found · 55000 not unacknowledged.
create function public.ack_incident(p_incident_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_now timestamptz := now();
  v_hold timestamptz := now() + interval '10 seconds';
  v_name text;
  v_context jsonb;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if not private.can_ack(v_inc.site_id) then
    raise exception 'This role can''t acknowledge this incident' using errcode = '42501';
  end if;
  if v_inc.state not in ('unacked', 'escalated') then
    raise exception 'incident is not waiting for an acknowledgement' using errcode = '55000';
  end if;

  select display_name into v_name from public.profiles where id = auth.uid();
  v_context := jsonb_build_object('ackedBy', v_name, 'ackedById', auth.uid(), 'ackedAt', v_now);

  update public.incidents
    set state = 'acknowledged', acked_at = v_now, acked_by = auth.uid()
    where id = p_incident_id;

  insert into public.incident_events (incident_id, type, actor_id, payload, at)
  values (p_incident_id, 'acknowledged', auth.uid(),
          jsonb_build_object('from', v_inc.state, 'posts_at', v_hold), v_now);

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.ack', 'incident', p_incident_id,
          jsonb_build_object('state', v_inc.state),
          jsonb_build_object('state', 'acknowledged', 'acked_at', v_now));

  insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
  select p_incident_id, 'google_chat', 'acknowledged', p_incident_id::text, v_context, v_hold
  where exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat' and template = 'down'
  );

  insert into public.notifications
    (incident_id, user_id, channel, template, thread_key, context, hold_until)
  select distinct p_incident_id, n.user_id, 'email'::public.notification_channel, 'acknowledged',
         p_incident_id::text, v_context, v_hold
  from public.notifications n
  where n.incident_id = p_incident_id and n.channel = 'email' and n.status <> 'cancelled'
    and n.user_id is not null;

  return v_hold;
end;
$$;

-- Takes back the signed-in person's own acknowledgement inside its 10 s window: the held messages
-- are cancelled (nothing was sent) and the incident goes back to its previous state. Too late once
-- the window has passed or the notifier has claimed a message (attempts > 0) — the claim takes
-- only rows whose hold_until has passed, and these rows are locked here, so the two never overlap.
create function public.undo_ack(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_from public.incident_state;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if v_inc.state <> 'acknowledged' or v_inc.acked_by is distinct from auth.uid() then
    raise exception 'Only the person who acknowledged can undo it' using errcode = '42501';
  end if;
  if now() >= v_inc.acked_at + interval '10 seconds' then
    raise exception 'The undo window has closed' using errcode = '55000';
  end if;

  perform 1 from public.notifications
    where incident_id = p_incident_id and template = 'acknowledged' and status = 'queued'
    for update;
  if exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and template = 'acknowledged'
      and (status = 'sent' or (status = 'queued' and attempts > 0))
  ) then
    raise exception 'The undo window has closed' using errcode = '55000';
  end if;

  select (payload->>'from')::public.incident_state into v_from
  from public.incident_events
  where incident_id = p_incident_id and type = 'acknowledged'
  order by at desc
  limit 1;

  update public.notifications
    set status = 'cancelled', next_retry_at = null
    where incident_id = p_incident_id and template = 'acknowledged' and status = 'queued';

  update public.incidents
    set state = coalesce(v_from, 'unacked'), acked_at = null, acked_by = null
    where id = p_incident_id;

  insert into public.incident_events (incident_id, type, actor_id, payload)
  values (p_incident_id, 'ack_undone', auth.uid(),
          jsonb_build_object('state', coalesce(v_from, 'unacked')));

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.ack_undone', 'incident', p_incident_id,
          jsonb_build_object('state', 'acknowledged', 'acked_at', v_inc.acked_at),
          jsonb_build_object('state', coalesce(v_from, 'unacked')));
end;
$$;

revoke execute on function private.can_ack(uuid) from public, anon, authenticated;
revoke execute on function public.ack_incident(uuid), public.undo_ack(uuid) from public, anon;
grant execute on function public.ack_incident(uuid), public.undo_ack(uuid) to authenticated;
