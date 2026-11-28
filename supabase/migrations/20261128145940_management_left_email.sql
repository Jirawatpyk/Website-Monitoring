-- D-078 PR 3b (spec §34, §43.5): the role-change email says "You also left Management."
--   · `private.account_event` freezes `left_management`: the person was Management before the change
--     (`p_user` is the row from before the update) and is no longer an Admin afterwards. The trigger
--     `private.management_follows_role` has cleared the tag and written its `user.management` audit row
--     in the same transaction.
--   · Otherwise the body is 20261114131240's, unchanged.
set local lock_timeout = '5s';

create or replace function private.account_event(p_kind text, p_user public.profiles, p_to public.app_role, p_before jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_moves jsonb;
begin
  select coalesce(jsonb_agg(q.m order by q.ord, q.sort), '[]'::jsonb) into v_moves
  from (
    select 1 as ord, s.name as sort, jsonb_build_object('kind', 'owner', 'place', s.name, 'with', p.display_name) as m
      from jsonb_array_elements_text(p_before -> 'owner') x (id)
      join public.sites s on s.id = x.id::uuid
      join public.profiles p on p.id = s.primary_owner_id
      where s.primary_owner_id <> p_user.id
    union all
    select 2, s.name, jsonb_build_object('kind', 'backup', 'place', s.name, 'with', p.display_name)
      from jsonb_array_elements_text(p_before -> 'backup') x (id)
      join public.sites s on s.id = x.id::uuid
      join public.profiles p on p.id = s.backup_owner_id
      where s.backup_owner_id <> p_user.id
    union all
    select 3, c.name, jsonb_build_object('kind', 'am', 'place', c.name, 'with', p.display_name)
      from jsonb_array_elements_text(p_before -> 'am') x (id)
      join public.clients c on c.id = x.id::uuid
      join public.profiles p on p.id = c.am_user_id
      where c.am_user_id <> p_user.id
    union all
    select 4, x ->> 'starts',
           jsonb_build_object('kind', 'shift', 'starts', x -> 'starts', 'ends', x -> 'ends', 'with', p.display_name)
      from jsonb_array_elements(p_before -> 'shifts') x
      cross join lateral (
        select coalesce(
          (select sh.user_id from public.oncall_shifts sh
            where sh.id = (x ->> 'id')::uuid and sh.user_id <> p_user.id),
          (select sh.user_id from public.oncall_shifts sh
            where sh.handed_over_from = p_user.id and sh.ends_at = (x ->> 'ends')::timestamptz
              and sh.starts_at = now() and sh.user_id <> p_user.id
            order by sh.created_at desc limit 1)) as holder
      ) h
      join public.profiles p on p.id = h.holder
  ) q;

  insert into public.account_events (kind, user_id, actor_id, from_role, to_role, facts)
  values (p_kind, p_user.id, auth.uid(), p_user.role, p_to, jsonb_build_object(
    'actor', (select a.display_name from public.profiles a where a.id = auth.uid()),
    'was_am', coalesce((p_before ->> 'was_am')::boolean, false),
    'manages_clients', exists (select 1 from public.clients c where c.am_user_id = p_user.id),
    'left_rotation', coalesce((p_before ->> 'rotation')::boolean, false)
                     and not exists (select 1 from public.oncall_rotation r where r.user_id = p_user.id),
    -- D-078: the tag went with the role (management_follows_role). A deactivation sets it too, but the
    -- Access removed email has no lists and never reads it.
    'left_management', p_user.is_management and p_to is distinct from 'admin',
    'admins', case when p_to = 'admin' then
      (select coalesce(jsonb_agg(a.display_name order by a.display_name), '[]'::jsonb)
       from public.profiles a where a.role = 'admin' and a.is_active and a.id <> p_user.id)
      else '[]'::jsonb end,
    'moves', v_moves))
  returning id into v_id;

  -- One email, to the person only (spec §34): no Chat row, nobody else.
  insert into public.notifications (account_event_id, channel, template, user_id, thread_key)
  values (v_id, 'email', 'account_email', p_user.id, 'account-' || v_id);
  return v_id;
end;
$$;
revoke execute on function private.account_event(text, public.profiles, public.app_role, jsonb)
  from public, anon, authenticated;
