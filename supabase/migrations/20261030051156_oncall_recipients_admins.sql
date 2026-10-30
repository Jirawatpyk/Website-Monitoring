-- S10 follow-up (message-check B2b, D-048): who an on-call event tells.
--   · A requester who is an Admin gets the "approve it?" message when their swap is accepted — with one
--     Admin, nobody was asked before.
--   · The Admins asked to approve an accepted swap hear when it closes without a decision: withdrawn by the
--     requester, or expired when its week started.
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
    -- Accepted: the Admins approve next — the requester too when they're an Admin (perhaps the only one),
    -- so someone always gets "approve it?". They also hear when it closes before that: withdrawn, or
    -- expired after the accept (`responded_at` set and still open until then means it was accepted).
    select a.id, 'admin', case when e.kind = 'swap_accepted' and a.id = e.requester_id then 0 else 3 end
      from e, public.profiles a
      where a.role = 'admin' and a.is_active and a.id <> e.counterpart_id
        and (e.kind = 'swap_accepted'
             or (e.kind in ('swap_withdrawn', 'swap_expired') and e.responded_at is not null))
        -- An Admin who withdraws their own request isn't told about it.
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
    select e.user_id, 'self', 1 from e where e.kind in ('shift_reminder', 'test_alert')
  )
  select distinct on (p.id) p.id, x.role
  from people x
  join public.profiles p on p.id = x.uid and p.is_active and p.role in ('admin', 'responder')
  order by p.id, x.ord;
$$;
