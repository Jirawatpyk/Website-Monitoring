-- S17 PR 3a (D-069, spec §41): Admins edit the company holidays on Settings › Organisation.
--   · company_holidays.kind — 'public' (a Thai public holiday) or 'company' (a company day off), for
--     the list's badge. The seeded rows are public holidays. The engine reads only `day`.
--   · add_company_holiday / rename_company_holiday / remove_company_holiday — Admins only, one change
--     at a time, no note (the board: the date and name say what changed). Each change writes one
--     audit row through the existing row trigger (holiday.create / .update / .delete, actor = the
--     Admin). Past days can't be added or changed: "today" is the Bangkok date, never current_date.
--     A day runs from today to 31 Dec next year (the list shows this year and the next).
--   · The hours are read live (D-034, D-069 item 2), so the next engine run and notifier batch use
--     the new calendar, open incidents too; PROBLEM cards already held keep their hold_until.

set local lock_timeout = '5s';

alter table public.company_holidays
  add column kind text not null default 'public'
    constraint company_holidays_kind_check check (kind in ('public', 'company'));

create function private.holiday_window_check(p_day date)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if p_day is null or p_day < v_today then
    raise exception 'Pick today or a later day — past days can’t be added'
      using errcode = '22023', hint = 'holiday_past';
  end if;
  if p_day > make_date(extract(year from v_today)::int + 1, 12, 31) then
    raise exception 'Pick a day up to 31 Dec next year' using errcode = '22023', hint = 'holiday_too_far';
  end if;
end;
$$;

create function private.holiday_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v is null then
    raise exception 'Give the day a name' using errcode = '22023', hint = 'name_required';
  end if;
  if length(v) > 100 then
    raise exception 'Up to 100 characters' using errcode = '22023', hint = 'name_too_long';
  end if;
  return v;
end;
$$;

create function public.add_company_holiday(p_day date, p_name text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_taken text;
  v_id uuid;
begin
  perform private.require_admin('Only an Admin can change the company holidays');
  perform private.holiday_window_check(p_day);
  v_name := private.holiday_name(p_name);
  if p_kind is null or p_kind not in ('public', 'company') then
    raise exception 'Pick Public holiday or Company day off' using errcode = '22023', hint = 'kind_invalid';
  end if;
  -- One per day: a taken day (or one a concurrent add just took) is refused with its name.
  insert into public.company_holidays (day, name, kind) values (p_day, v_name, p_kind)
    on conflict (day) do nothing
    returning id into v_id;
  if v_id is null then
    select h.name into v_taken from public.company_holidays h where h.day = p_day;
    raise exception 'That day is already a holiday' using errcode = '23505', hint = 'holiday_taken', detail = v_taken;
  end if;
  return v_id;
end;
$$;

create function public.rename_company_holiday(p_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_day date;
begin
  perform private.require_admin('Only an Admin can change the company holidays');
  v_name := private.holiday_name(p_name);
  select h.day into v_day from public.company_holidays h where h.id = p_id for update;
  if not found then
    raise exception 'That holiday is gone — reload the page' using errcode = 'P0002', hint = 'holiday_missing';
  end if;
  if v_day < (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'Past days can’t be changed' using errcode = '22023', hint = 'holiday_past';
  end if;
  -- The same name again changes nothing: no audit row, no new updated_at.
  update public.company_holidays set name = v_name where id = p_id and name is distinct from v_name;
end;
$$;

create function public.remove_company_holiday(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
begin
  perform private.require_admin('Only an Admin can change the company holidays');
  select h.day into v_day from public.company_holidays h where h.id = p_id for update;
  if not found then
    raise exception 'That holiday is gone — reload the page' using errcode = 'P0002', hint = 'holiday_missing';
  end if;
  if v_day < (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'Past days can’t be changed' using errcode = '22023', hint = 'holiday_past';
  end if;
  delete from public.company_holidays where id = p_id;
end;
$$;

revoke execute on function private.holiday_window_check(date), private.holiday_name(text) from public, anon, authenticated;
revoke execute on function public.add_company_holiday(date, text, text), public.rename_company_holiday(uuid, text),
  public.remove_company_holiday(uuid) from public, anon;
grant execute on function public.add_company_holiday(date, text, text), public.rename_company_holiday(uuid, text),
  public.remove_company_holiday(uuid) to authenticated;
