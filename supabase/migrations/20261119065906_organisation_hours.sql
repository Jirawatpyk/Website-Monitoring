-- S17 PR 1 (D-069): the Organisation page saves the response hours.
--   · save_response_hours — the one writer of organisation_settings' hours (spec §7, §14.14): an
--     Admin, a required note, From < To on the board's 30-min grid (06:00–22:00), the board's day sets
--     (Mon–Fri, Mon–Sat, every day); one audit row with before / after and the note. The hours are
--     read live (D-034), so the next engine run and notifier batch use them — open incidents too
--     (D-069 item 2); PROBLEM cards already held keep their hold_until.
--   · organisation_storage — the database size for the "Data kept" card, Admins only.

set local lock_timeout = '5s';

create function public.save_response_hours(p_start time, p_end time, p_days smallint[], p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_days smallint[] := (select array_agg(d order by d) from (select distinct unnest(p_days) d) x);
  v_before jsonb;
  v_after jsonb;
begin
  perform private.require_admin('Only an Admin can change the response hours');
  if v_note is null then
    raise exception 'Add a short note — it goes in the audit log with the change'
      using errcode = '22023', hint = 'note_required';
  end if;
  if length(v_note) > 500 then
    raise exception 'The note is too long' using errcode = '22023', hint = 'note_too_long';
  end if;
  if p_start is null or p_end is null
     or p_start < '06:00' or p_end > '22:00'
     or extract(second from p_start) <> 0 or extract(second from p_end) <> 0
     or extract(minute from p_start)::int % 30 <> 0 or extract(minute from p_end)::int % 30 <> 0 then
    raise exception 'Pick times between 06:00 and 22:00, on the hour or half hour'
      using errcode = '22023', hint = 'hours_grid';
  end if;
  if p_start >= p_end then
    raise exception '“To” must be after “From”' using errcode = '22023', hint = 'hours_order';
  end if;
  if v_days is null or v_days not in (array[1, 2, 3, 4, 5]::smallint[], array[1, 2, 3, 4, 5, 6]::smallint[],
                                       array[1, 2, 3, 4, 5, 6, 7]::smallint[]) then
    raise exception 'Pick Mon–Fri, Mon–Sat or Every day' using errcode = '22023', hint = 'days_invalid';
  end if;

  select jsonb_build_object('start', to_char(o.response_start, 'HH24:MI'), 'end', to_char(o.response_end, 'HH24:MI'),
                            'days', to_jsonb(o.response_days))
    into v_before
  from public.organisation_settings o where o.singleton for update;

  update public.organisation_settings
    set response_start = p_start, response_end = p_end, response_days = v_days
    where singleton
      and (response_start, response_end, response_days) is distinct from (p_start, p_end, v_days);

  if found then
    v_after := jsonb_build_object('start', to_char(p_start, 'HH24:MI'), 'end', to_char(p_end, 'HH24:MI'),
                                  'days', to_jsonb(v_days));
    insert into public.audit_log (actor_id, action, entity, before, after)
    values (auth.uid(), 'organisation.response_hours', 'organisation', v_before,
            v_after || jsonb_build_object('note', v_note));
  end if;
end;
$$;
revoke execute on function public.save_response_hours(time, time, smallint[], text) from public, anon;
grant execute on function public.save_response_hours(time, time, smallint[], text) to authenticated;

-- The database's size in bytes for the Organisation page (Admins only; a read, nothing changes).
create function public.organisation_storage()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('Only an Admin can see the storage used');
  return pg_catalog.pg_database_size(pg_catalog.current_database());
end;
$$;
revoke execute on function public.organisation_storage() from public, anon;
grant execute on function public.organisation_storage() to authenticated;
