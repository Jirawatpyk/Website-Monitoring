-- Code review (S09b follow-up): a held action posted at once keeps its actor and ends its 10 s, so a
-- late Undo is told "Too late to undo — it has been posted" instead of "Only the person who did it".
-- 20261012060746 body, with undo_until = now and the other undo columns kept.

create or replace function public.post_window_action_now(p_window_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.maintenance_windows%rowtype;
  v_now timestamptz := now();
  v_last integer;
begin
  select * into w from public.maintenance_windows where id = p_window_id for update;
  if not found then
    raise exception 'window not found' using errcode = 'P0002';
  end if;
  if w.undo_by is null or w.undo_by is distinct from auth.uid() then
    raise exception 'Only the person who did it can post it now' using errcode = '42501';
  end if;
  if w.undo_until is null or v_now >= w.undo_until then
    raise exception 'Already posted' using errcode = '22023', hint = 'undo_expired';
  end if;
  update public.notifications
    set hold_until = v_now
    where maintenance_window_id = w.id and dedupe_key = w.undo_key and status = 'queued';
  -- The held action's line: the last one with a posting time (the engine may have added one of its own
  -- since, which has none — db review L1).
  select max(e.ord)::int - 1 into v_last
    from jsonb_array_elements(w.log) with ordinality as e(v, ord) where e.v ? 'posts_at';
  update public.maintenance_windows
    -- The 10 s end now; the actor and the key stay, so a late Undo is told it was posted.
    set undo_until = v_now,
        log = case when v_last is not null
                   then jsonb_set(w.log, array[v_last::text, 'posts_at'], to_jsonb(v_now))
                   else w.log end
    where id = w.id;
end;
$$;
