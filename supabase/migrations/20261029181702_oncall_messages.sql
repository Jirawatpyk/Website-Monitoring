-- S10 B2a · on-call messages (D-048 items 6, 10). Every on-call event queues its Chat line and emails
-- in the same transaction, through private.oncall_event (one place, as the window messages): the
-- request, accept, decline, approve, decline by an Admin, withdraw and expiry of a swap; a hand-over;
-- a rotation change; the day-before reminder; and the test alert, in its own "TEST — no action" thread
-- mentioning only the tester (spec §10). The notifier renders them (B2b): until then a queued row is
-- left queued: claim_notifications hands on-call rows only to a caller that passes p_oncall (B2b), so
-- the old dispatch never claims or fails them. Production has no rotation yet, so no events either.
-- `context` never carries a reason, a note or the test token (staff read notifications): the renderer
-- reads them as the service role (oncall_notes, oncall_checklist).

-- ── Who an event tells ──────────────────────────────────────────────────────
-- One row per person and role; only active Admins and Responders (D-048 item 10).
create function private.oncall_recipients(p_event_id uuid)
returns table (user_id uuid, role text)
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select ev.*, w.requester_id, w.counterpart_id
    from public.oncall_events ev
    left join public.oncall_swaps w on w.id = ev.swap_id
    where ev.id = p_event_id
  ), people (uid, role, ord) as (
    select e.counterpart_id, 'asked', 1 from e where e.kind in ('swap_requested', 'swap_withdrawn')
    union all
    select e.requester_id, 'requester', 1 from e where e.kind in ('swap_accepted', 'swap_declined')
    union all
    select x.uid, x.role, x.ord from e
      cross join lateral (values (e.requester_id, 'requester', 1), (e.counterpart_id, 'asked', 2)) x (uid, role, ord)
      where e.kind in ('swap_approved', 'swap_admin_declined', 'swap_expired')
    union all
    -- Accepted: the Admins approve next.
    select a.id, 'admin', 3 from e, public.profiles a
      where e.kind = 'swap_accepted' and a.role = 'admin' and a.is_active and a.id <> e.counterpart_id
    union all
    select x.uid, x.role, x.ord from e
      cross join lateral (values (e.user_id, 'new', 1), ((e.payload ->> 'from')::uuid, 'previous', 2)) x (uid, role, ord)
      where e.kind = 'handed_over'
    union all
    select r::uuid, 'rotation', 1 from e, jsonb_array_elements_text(e.payload -> 'order') r
      where e.kind = 'rotation_changed'
    union all
    select r::uuid, 'removed', 2 from e, jsonb_array_elements_text(coalesce(e.payload -> 'removed', '[]')) r
      where e.kind = 'rotation_changed'
    union all
    select e.user_id, 'self', 1 from e where e.kind in ('shift_reminder', 'test_alert')
  )
  select distinct on (p.id) p.id, x.role
  from people x
  join public.profiles p on p.id = x.uid and p.is_active and p.role in ('admin', 'responder')
  order by p.id, x.ord;
$$;

-- ── Queue an event's messages ───────────────────────────────────────────────
-- One Chat line in the subject's thread, @mentioning everyone it tells (`context.mention`), and an
-- email each — except the rotation change and the test alert, which are Chat only.
create function private.queue_oncall_messages(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.oncall_events%rowtype;
  v_thread text;
  v_people jsonb;
  v_count integer;
begin
  select * into v_e from public.oncall_events where id = p_event_id;
  if not found then
    return 0;
  end if;
  v_thread := case
    when v_e.swap_id is not null then 'oncall-swap-' || v_e.swap_id
    when v_e.kind = 'handed_over' then 'oncall-handover-' || v_e.shift_id
    when v_e.kind = 'shift_reminder' then 'oncall-reminder-' || v_e.shift_id
    when v_e.kind = 'test_alert' then 'oncall-test-' || v_e.user_id
    else 'oncall-rotation-' || v_e.id end;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.user_id, 'role', r.role) order by r.role, r.user_id), '[]')
    into v_people from private.oncall_recipients(p_event_id) r;
  if jsonb_array_length(v_people) = 0 then
    return 0;
  end if;

  insert into public.notifications (oncall_event_id, channel, template, thread_key, context)
  values (p_event_id, 'google_chat', 'oncall', v_thread,
          jsonb_build_object('kind', v_e.kind, 'people', v_people))
  on conflict do nothing;
  insert into public.notifications (oncall_event_id, user_id, channel, template, thread_key, context)
  select p_event_id, (p ->> 'id')::uuid, 'email', 'oncall', v_thread,
         jsonb_build_object('kind', v_e.kind, 'role', p ->> 'role')
  from jsonb_array_elements(v_people) p
  where v_e.kind not in ('rotation_changed', 'test_alert')
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count + 1;
end;
$$;

-- Every on-call event goes through here: it writes the event and queues its messages.
create or replace function private.oncall_event(
  p_kind text, p_user uuid, p_swap uuid, p_shift uuid, p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.oncall_events (kind, actor_id, user_id, swap_id, shift_id, payload)
  values (p_kind, auth.uid(), p_user, p_swap, p_shift, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  perform private.queue_oncall_messages(v_id);
  return v_id;
end;
$$;

create or replace function public.save_oncall_rotation(p_user_ids uuid[], p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_u uuid;
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception 'Only an Admin can change the rotation' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_user_ids), 0) = 0 then
    raise exception 'Add at least one person to the rotation' using errcode = '22023', hint = 'rotation_empty';
  end if;
  if (select count(distinct u) from unnest(p_user_ids) u) <> cardinality(p_user_ids) then
    raise exception 'Each person can be in the rotation once' using errcode = '22023', hint = 'rotation_duplicate';
  end if;
  foreach v_u in array p_user_ids loop
    if not private.oncall_eligible(v_u) then
      raise exception 'Only active Admins and Responders can be on call' using errcode = '22023', hint = 'rotation_person';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext('oncall_extend_shifts'));
  select coalesce(jsonb_agg(user_id order by position), '[]'::jsonb) into v_before from public.oncall_rotation;
  delete from public.oncall_rotation;
  insert into public.oncall_rotation (user_id, position)
  select u, o::smallint from unnest(p_user_ids) with ordinality as t(u, o);

  insert into public.audit_log (actor_id, action, entity, before, after)
  values (auth.uid(), 'oncall.rotation', 'oncall_rotation', jsonb_build_object('order', v_before),
          jsonb_build_object('order', to_jsonb(p_user_ids), 'note', nullif(btrim(coalesce(p_note, '')), '')));
  perform private.oncall_event('rotation_changed', null, null, null, jsonb_build_object(
    'order', to_jsonb(p_user_ids),
    'removed', coalesce((select jsonb_agg(b) from jsonb_array_elements_text(v_before) b
                         where not (b::uuid = any (p_user_ids))), '[]'::jsonb)));
  perform public.oncall_extend_shifts(now() + interval '28 days');
end;
$$;

create or replace function public.request_oncall_swap(p_shift_id uuid, p_with_shift_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.oncall_shifts%rowtype;
  v_b public.oncall_shifts%rowtype;
  v_id uuid;
begin
  select * into v_a from public.oncall_shifts where id = p_shift_id for update;
  select * into v_b from public.oncall_shifts where id = p_with_shift_id for update;
  if not private.oncall_eligible(auth.uid()) then
    raise exception 'Only Admins and Responders take on-call weeks' using errcode = '42501';
  end if;
  if v_a.id is null or v_b.id is null then
    raise exception 'That week doesn''t exist any more' using errcode = 'P0002';
  end if;
  if not private.oncall_eligible(v_b.user_id) then
    raise exception 'Only active Admins and Responders can be on call' using errcode = '22023', hint = 'rotation_person';
  end if;
  if v_a.user_id is distinct from auth.uid() then
    raise exception 'You can ask to swap only your own week' using errcode = '42501';
  end if;
  if v_a.user_id = v_b.user_id then
    raise exception 'Pick a week someone else has' using errcode = '22023', hint = 'swap_same_person';
  end if;
  -- The live shift can't be swapped: it's handed over instead (OnCall board).
  if v_a.starts_at <= now() or v_b.starts_at <= now() then
    raise exception 'The live shift can’t be swapped — hand it over in Users' using errcode = '22023', hint = 'swap_live';
  end if;
  if exists (select 1 from public.oncall_swaps s where s.status in ('waiting', 'accepted')
             and (s.requester_shift_id in (v_a.id, v_b.id) or s.counterpart_shift_id in (v_a.id, v_b.id))) then
    raise exception 'A swap is already waiting' using errcode = '22023', hint = 'swap_open';
  end if;
  -- At most 5 requests in 10 minutes (security review B2a): each one messages the person asked, and a
  -- request → withdraw loop would otherwise spam them. Checked last, so the plain refusals come first.
  if (select count(*) from public.oncall_swaps w
      where w.requester_id = auth.uid() and w.created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many swap requests — wait a few minutes' using errcode = '55000', hint = 'swap_too_soon';
  end if;
  insert into public.oncall_swaps (requester_shift_id, counterpart_shift_id, requester_id, counterpart_id, reason)
  values (v_a.id, v_b.id, v_a.user_id, v_b.user_id, private.oncall_note(p_reason))
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'oncall.swap_request', 'oncall_swap', v_id,
          jsonb_build_object('shift', v_a.id, 'with', v_b.id, 'counterpart', v_b.user_id));
  perform private.oncall_event('swap_requested', v_b.user_id, v_id, v_a.id);
  return v_id;
end;
$$;

-- ── The day-before reminder (D-048 item 6) ──────────────────────────────────
-- Once per shift and person: a shift that starts within a day reminds the person who holds it. The
-- engine runner calls it every run (B2b); a shift handed over after its reminder reminds the new person.
create function public.engine_oncall_reminders(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_id uuid;
  v_count integer := 0;
begin
  for v in
    select s.id, s.user_id from public.oncall_shifts s
    join public.profiles p on p.id = s.user_id and p.is_active and p.role in ('admin', 'responder')
    where s.starts_at > p_now and s.starts_at <= p_now + interval '1 day' and s.handed_over_from is null
      and not exists (select 1 from public.oncall_events e
                      where e.kind = 'shift_reminder' and e.shift_id = s.id and e.user_id = s.user_id)
    for update of s skip locked
  loop
    insert into public.oncall_events (kind, user_id, shift_id)
    values ('shift_reminder', v.user_id, v.id)
    on conflict (shift_id, user_id) where kind = 'shift_reminder' do nothing
    returning id into v_id;
    if v_id is not null then
      perform private.queue_oncall_messages(v_id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

drop function public.claim_notifications(public.notification_channel, integer, uuid);
create function public.claim_notifications(
  p_channel public.notification_channel,
  p_limit integer default 20,
  p_incident_id uuid default null,
  p_oncall boolean default false
)
returns setof public.notifications
language sql
set search_path = ''
as $$
  with due as (
    select id from public.notifications
    where status = 'queued'
      and channel = p_channel
      and (p_incident_id is null or incident_id = p_incident_id)
      -- On-call rows only for a notifier that renders them (S10 B2b).
      and (p_oncall or oncall_event_id is null)
      and (hold_until is null or hold_until <= now())
      and (next_retry_at is null or next_retry_at <= now())
      and not exists (
        select 1 from public.notifications older
        where older.incident_id = notifications.incident_id and older.channel = notifications.channel
          and older.user_id is not distinct from notifications.user_id
          and older.status = 'queued' and older.created_at < notifications.created_at
          and not (older.template in ('flap_summary', 'down', 'problem', 'down_again', 'problem_again')
                   and coalesce(older.hold_until > now(), false))
      )
      and not exists (
        select 1 from public.notifications older
        where older.maintenance_window_id = notifications.maintenance_window_id
          and older.channel = notifications.channel
          -- Chat: behind the action's own line and anything of an earlier action; one action's mention
          -- replies go together (db review M4). Email: in order per person.
          and (case when older.channel = 'google_chat'
                    then older.template = 'mw_line' or older.dedupe_key <> notifications.dedupe_key
                    else older.user_id is not distinct from notifications.user_id end)
          and older.status = 'queued' and older.created_at < notifications.created_at
      )
      -- An on-call subject's thread goes in order (S10): a swap's request before its accept.
      and not exists (
        select 1 from public.notifications older
        where notifications.oncall_event_id is not null and older.oncall_event_id is not null
          and older.channel = notifications.channel and older.thread_key = notifications.thread_key
          and older.user_id is not distinct from notifications.user_id
          and older.status = 'queued' and older.created_at < notifications.created_at
      )
    -- Incidents and system alerts first (security review B2a): a burst of on-call or window rows
    -- never delays a DOWN.
    order by (incident_id is null and system_alert_id is null), created_at
    limit p_limit
    for update skip locked
  )
  update public.notifications n
    set attempts = n.attempts + 1, next_retry_at = now() + interval '90 seconds'
    from due
    where n.id = due.id
  returning n.*;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────
revoke execute on function public.claim_notifications(public.notification_channel, integer, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_notifications(public.notification_channel, integer, uuid, boolean)
  to service_role;
-- The on-call thread order (db review L3): queued rows of one thread, without a scan of the whole queue.
create index notifications_oncall_thread_queued on public.notifications (thread_key, channel, created_at)
  where status = 'queued' and oncall_event_id is not null;
revoke execute on function
  private.oncall_recipients(uuid),
  private.queue_oncall_messages(uuid),
  public.engine_oncall_reminders(timestamptz)
  from public, anon, authenticated;
grant execute on function public.engine_oncall_reminders(timestamptz) to service_role;
