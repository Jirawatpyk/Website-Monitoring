-- S17 PR 2 (D-069, spec §10, D-062 item 12): a test alert for every role.
--   · send_channel_test('chat' | 'email') — any active person: a Chat card in its own "TEST — no
--     action" thread @mentioning only them, or a "TEST — no action" email to them alone. One a minute
--     per person and channel. It rides the on-call event path (kind `channel_test`), so the notifier,
--     its retries and the delivery log treat it like every other message.
--   · Unlike the on-call phone test (`test_alert`) it doesn't touch the on-call checklist.
--   · No audit row: it changes no config or incident state (as send_oncall_test).

set local lock_timeout = '5s';

alter table public.oncall_events drop constraint oncall_events_kind_check;
alter table public.oncall_events add constraint oncall_events_kind_check check (kind in (
  'rotation_changed', 'swap_requested', 'swap_accepted', 'swap_declined', 'swap_approved',
  'swap_admin_declined', 'swap_withdrawn', 'swap_expired', 'handed_over', 'test_alert', 'shift_reminder',
  'channel_test'));

-- The cooldown reads the person's latest test per channel.
create index oncall_events_channel_test_idx on public.oncall_events (user_id, at desc)
  where kind = 'channel_test';

-- Who an event tells: as before, plus the tester of a channel test, whatever their role.
create or replace function private.oncall_recipients(p_event_id uuid)
returns table (user_id uuid, role text)
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select ev.*, w.requester_id, w.counterpart_id, w.responded_at
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
    select a.id, 'admin', case when e.kind = 'swap_accepted' and a.id = e.requester_id then 0 else 3 end
      from e, public.profiles a
      where a.role = 'admin' and a.is_active and a.id <> e.counterpart_id
        and (e.kind = 'swap_accepted'
             or (e.kind in ('swap_withdrawn', 'swap_expired') and e.responded_at is not null))
        and not (e.kind = 'swap_withdrawn' and a.id = e.requester_id)
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
    select e.user_id, 'self', 1 from e where e.kind in ('shift_reminder', 'test_alert', 'channel_test')
  )
  select distinct on (p.id) p.id, x.role
  from people x
  join public.profiles p on p.id = x.uid and p.is_active
    and (p.role in ('admin', 'responder')
         or exists (select 1 from e where e.kind = 'channel_test'))
  order by p.id, x.ord;
$$;

-- An event's messages: as before, plus a channel test — its own thread `test-<event>`, and only the
-- channel it tests (Chat or email).
create or replace function private.queue_oncall_messages(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.oncall_events%rowtype;
  v_thread text;
  v_people jsonb;
  v_count integer := 0;
  v_chat boolean;
  v_email boolean;
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
    when v_e.kind = 'channel_test' then 'test-' || v_e.id
    else 'oncall-rotation-' || v_e.id end;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.user_id, 'role', r.role) order by r.role, r.user_id), '[]')
    into v_people from private.oncall_recipients(p_event_id) r;
  if jsonb_array_length(v_people) = 0 then
    return 0;
  end if;
  v_chat := v_e.kind <> 'channel_test' or v_e.payload ->> 'channel' = 'chat';
  v_email := v_e.kind not in ('rotation_changed', 'test_alert')
             and (v_e.kind <> 'channel_test' or v_e.payload ->> 'channel' = 'email');

  if v_chat then
    insert into public.notifications (oncall_event_id, channel, template, thread_key, context)
    values (p_event_id, 'google_chat', 'oncall', v_thread,
            jsonb_build_object('kind', v_e.kind, 'people', v_people))
    on conflict do nothing;
    get diagnostics v_count = row_count;
  end if;
  if v_email then
    insert into public.notifications (oncall_event_id, user_id, channel, template, thread_key, context)
    select p_event_id, (p ->> 'id')::uuid, 'email', 'oncall', v_thread,
           jsonb_build_object('kind', v_e.kind, 'role', p ->> 'role')
    from jsonb_array_elements(v_people) p
    on conflict do nothing;
    return v_count + (select count(*)::int from public.notifications where oncall_event_id = p_event_id and channel = 'email');
  end if;
  return v_count;
end;
$$;

-- "Send test card" / "Send test email" (Alert channels) and Profile's test for every role.
create function public.send_channel_test(p_channel text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
begin
  select * into v_me from public.profiles where id = auth.uid() and is_active;
  if not found or not private.session_alive() then
    raise exception 'Sign in again to send a test' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('chat', 'email') then
    raise exception 'Pick Chat or email' using errcode = '22023', hint = 'bad_channel';
  end if;
  if p_channel = 'chat' and nullif(btrim(coalesce(v_me.google_chat_user_id, '')), '') is null then
    raise exception 'You have no Google Chat id yet — add it in My profile first'
      using errcode = '22023', hint = 'no_chat_id';
  end if;
  -- One at a time per person, so two quick presses can't both pass the cooldown.
  perform pg_advisory_xact_lock(hashtextextended('channel_test:' || v_me.id::text, 0));
  if exists (
    select 1 from public.oncall_events
    where kind = 'channel_test' and user_id = v_me.id and payload ->> 'channel' = p_channel
      and at > now() - interval '1 minute'
  ) then
    raise exception 'A test went less than a minute ago — wait a moment' using errcode = '55000', hint = 'test_too_soon';
  end if;
  return private.oncall_event('channel_test', v_me.id, null, null, jsonb_build_object('channel', p_channel));
end;
$$;
revoke execute on function public.send_channel_test(text) from public, anon;
grant execute on function public.send_channel_test(text) to authenticated;
