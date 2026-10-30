-- S10 B2c fix: Save rotation failed through the API with "DELETE requires a WHERE clause" — Supabase
-- preloads pg_safeupdate for PostgREST's `authenticator` role, so a bare DELETE inside a function the
-- app calls is refused (pgTAP runs as postgres and never saw it). Same body, `where true`.
-- Guard: supabase/tests/safeupdate.test.sql scans every function for a DELETE / UPDATE with no WHERE.
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
  -- `where true`: the API preloads pg_safeupdate, which refuses a DELETE with no WHERE.
  delete from public.oncall_rotation where true;
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
