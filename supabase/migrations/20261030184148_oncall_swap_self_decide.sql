-- D-048 ruling 12.17 in SQL: neither person in an on-call swap approves or declines it, unless they
-- are the only active Admin. The On-call page already offered the decision only that way; until now
-- the RPC let any Admin decide, so an Admin in a swap could approve their own (S10 code review,
-- security review L2). Same signature: `create or replace` keeps the grants. The body is the B0 one
-- (20261029105753_oncall.sql) with the check after the row lock.

create or replace function public.decide_oncall_swap(p_swap_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.oncall_swaps%rowtype;
  v_note text := private.oncall_note(p_note);
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception 'Only an Admin can approve or decline a swap' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Approve or decline' using errcode = '22023', hint = 'invalid';
  end if;
  select * into v from public.oncall_swaps where id = p_swap_id for update;
  if not found then
    raise exception 'That request doesn''t exist any more' using errcode = 'P0002';
  end if;
  -- 12.17: someone in the swap decides only as the only active Admin (else nobody could).
  if auth.uid() in (v.requester_id, v.counterpart_id)
     and (select count(*) from public.profiles where role = 'admin' and is_active) > 1 then
    raise exception 'Another Admin decides on a swap you’re part of' using errcode = '42501', hint = 'swap_self';
  end if;
  if v.status not in ('waiting', 'accepted') then
    raise exception 'This request is closed' using errcode = '55000', hint = 'swap_closed';
  end if;
  if p_approve and v.status <> 'accepted' then
    raise exception 'Approve unlocks once the person asked accepts' using errcode = '55000', hint = 'swap_not_accepted';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Say why — both of them see this' using errcode = '22023', hint = 'swap_reason';
  end if;
  if p_approve then
    if not (private.oncall_eligible(v.requester_id) and private.oncall_eligible(v.counterpart_id)) then
      raise exception 'Only active Admins and Responders can be on call' using errcode = '22023', hint = 'rotation_person';
    end if;
    if exists (select 1 from public.oncall_shifts where id in (v.requester_shift_id, v.counterpart_shift_id)
               and starts_at <= now()) then
      raise exception 'The live shift can’t be swapped — hand it over in Users' using errcode = '22023', hint = 'swap_live';
    end if;
    -- A week handed over earlier now belongs to someone else: its hand-over (and private reason) goes.
    update public.oncall_shifts set user_id = v.counterpart_id, handed_over_from = null, handover_reason = null
      where id = v.requester_shift_id;
    update public.oncall_shifts set user_id = v.requester_id, handed_over_from = null, handover_reason = null
      where id = v.counterpart_shift_id;
  end if;
  update public.oncall_swaps
    set status = case when p_approve then 'approved' else 'admin_declined' end,
        decided_by = auth.uid(), decided_at = now(), decision_note = v_note
    where id = v.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case when p_approve then 'oncall.swap_approve' else 'oncall.swap_admin_decline' end,
          'oncall_swap', v.id, jsonb_build_object('status', v.status),
          jsonb_build_object('status', case when p_approve then 'approved' else 'admin_declined' end, 'note', v_note));
  perform private.oncall_event(case when p_approve then 'swap_approved' else 'swap_admin_declined' end,
                               null, v.id, v.requester_shift_id);
end;
$$;
