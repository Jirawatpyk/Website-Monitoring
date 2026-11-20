-- S17 PR 3c (D-069, spec §41 items 4–8): Admins edit the shared forbidden list on Settings ›
-- Organisation, one phrase at a time, each with a required note.
--   · check_forbidden_phrase — "Check phrase": where a phrase is found in the live sites' stored clean
--     pages (crawler_clean_pages, 3b). Admins only; returns counts and at most five short snippets,
--     never a page.
--   · add_forbidden_phrase / remove_forbidden_phrase — Admins only, a note (≤ 500), one audit row each
--     (forbidden_phrase.create / .delete, the note in `after`). Every rule the page shows is enforced
--     here too, so a direct call can't skip one: 1–60 characters, trimmed; not a single short word
--     (one word under 6 letters, or under 4 Thai characters not counting vowel and tone marks); at
--     most 300 phrases; not already in the list as the matcher sees it; not on a live site's stored
--     clean page; the last phrase of a group can't be removed.
--   · Matching: the stored pages are normalizeForMatch() text (lower case, any run of whitespace or
--     &nbsp; as one space); the needle here is lower(phrase) with runs of whitespace as one space —
--     the same comparison for any phrase made of letters and spaces.
--   · One change at a time: an advisory lock covers the cap and the last-of-group rule.

set local lock_timeout = '5s';

-- A phrase with its spaces as the matcher folds them (JS \s, which Postgres \s may not cover: the
-- no-break and other Unicode spaces, U+FEFF), trimmed. Entities never reach here: a phrase with & < >
-- is refused (security review: "of&nbsp;the" would be "of the" to the matcher).
create function private.phrase_clean(p_phrase text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(coalesce(p_phrase, ''), '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'));
$$;

-- What the matcher looks for: the clean phrase in lower case.
create function private.phrase_needle(p_phrase text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(private.phrase_clean(p_phrase));
$$;

-- A single short word (spec §41 item 5): no space, and under 6 letters — or, with any Thai in it,
-- under 4 Thai characters not counting the combining vowel and tone marks ("พนัน" is 3).
create function private.phrase_is_short(p_phrase text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select position(' ' in private.phrase_needle(p_phrase)) = 0
    and case
      when private.phrase_needle(p_phrase) ~ '[฀-๿]'
        then char_length(regexp_replace(private.phrase_needle(p_phrase), '[ัิ-ฺ็-๎]', '', 'g')) < 4
      else char_length(private.phrase_needle(p_phrase)) < 6
    end;
$$;

-- The live sites (primary monitors of active sites) and their stored pages at the current URL.
create function private.phrase_hits(p_needle text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  -- Each page is searched once (db-reviewer: a late match walked it three times); the snippet is cut
  -- only for the five hits returned, and the counts never carry a body.
  with live as (
    select m.id, m.url, s.id as site_id, s.name
    from public.monitors m
    join public.sites s on s.id = m.site_id
    where m.is_primary and m.enabled and m.removed_at is null and s.is_active
  ),
  pages as (
    select l.site_id, l.name, c.monitor_id, c.view, c.checked_at
    from live l
    join public.crawler_clean_pages c on c.monitor_id = l.id and c.url = l.url
  ),
  found as (
    select p.site_id, p.name, p.monitor_id, p.view, p.checked_at, x.pos
    from pages p
    join public.crawler_clean_pages c on c.monitor_id = p.monitor_id and c.view = p.view
    cross join lateral (select position(p_needle in c.body) as pos) x
    where p_needle <> '' and x.pos > 0
  ),
  hits as (
    select h.* from (
      select distinct on (site_id) * from found order by site_id, checked_at desc
    ) h
    order by name
    limit 5
  )
  select jsonb_build_object(
    'sites', (select count(*) from live),
    'checked', (select count(distinct site_id) from pages),
    'unchecked', coalesce((select jsonb_agg(name order by name) from live
                           where site_id not in (select site_id from pages)), '[]'::jsonb),
    'found', (select count(distinct site_id) from found),
    'hits', coalesce((
      select jsonb_agg(jsonb_build_object('site', h.name, 'view', h.view, 'checkedAt', h.checked_at,
        'snippet', substring(c.body from greatest(h.pos - 80, 1) for char_length(p_needle) + 160))
        order by h.name)
      from hits h
      join public.crawler_clean_pages c on c.monitor_id = h.monitor_id and c.view = h.view
    ), '[]'::jsonb)
  );
$$;

create function public.check_forbidden_phrase(p_phrase text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('Only an Admin can check a forbidden phrase');
  if char_length(coalesce(p_phrase, '')) > 200 then
    raise exception 'Up to 60 characters' using errcode = '22023', hint = 'phrase_too_long';
  end if;
  return private.phrase_hits(private.phrase_needle(p_phrase));
end;
$$;

create function private.phrase_note(p_note text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_note is null then
    raise exception 'Add a short note — it goes in the audit log with the change'
      using errcode = '22023', hint = 'note_required';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'The note is too long' using errcode = '22023', hint = 'note_too_long';
  end if;
  return v_note;
end;
$$;

create function public.add_forbidden_phrase(p_group text, p_phrase text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_phrase text := private.phrase_clean(p_phrase);
  v_needle text := private.phrase_needle(p_phrase);
  v_note text;
  v_hits jsonb;
  v_id uuid;
begin
  perform private.require_admin('Only an Admin can change the shared forbidden words');
  v_note := private.phrase_note(p_note);
  if p_group is null or p_group not in ('gambling_th', 'gambling_en', 'brands', 'adult', 'pharma') then
    raise exception 'Pick a group' using errcode = '22023', hint = 'group_invalid';
  end if;
  if v_phrase = '' then
    raise exception 'Type the phrase' using errcode = '22023', hint = 'phrase_required';
  end if;
  if char_length(v_phrase) > 60 then
    raise exception 'Up to 60 characters' using errcode = '22023', hint = 'phrase_too_long';
  end if;
  if v_phrase ~ '[&<>]' then
    raise exception 'Use words only — no &, < or >' using errcode = '22023', hint = 'phrase_markup';
  end if;
  if private.phrase_is_short(v_phrase) then
    raise exception 'Use a phrase — a single short word is refused'
      using errcode = '22023', hint = 'phrase_short';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.forbidden_phrases'));
  if (select count(*) from public.forbidden_phrases) >= 300 then
    raise exception 'The list holds at most 300 phrases' using errcode = '22023', hint = 'phrases_full';
  end if;
  if exists (select 1 from public.forbidden_phrases
             where lower(regexp_replace(phrase, '\s+', ' ', 'g')) = v_needle) then
    raise exception 'Already in the list' using errcode = '23505', hint = 'phrase_taken';
  end if;
  v_hits := private.phrase_hits(v_needle);
  if jsonb_array_length(v_hits -> 'hits') > 0 then
    raise exception 'Found on a live site’s clean page'
      using errcode = '22023', hint = 'phrase_found', detail = v_hits -> 'hits' -> 0 ->> 'site';
  end if;
  insert into public.forbidden_phrases (phrase_group, phrase, created_by)
  values (p_group, v_phrase, auth.uid())
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'forbidden_phrase.create', 'forbidden_phrase', v_id, null,
          jsonb_build_object('group', p_group, 'phrase', v_phrase, 'note', v_note));
  return v_id;
end;
$$;

create function public.remove_forbidden_phrase(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_note text;
  v_row public.forbidden_phrases;
begin
  perform private.require_admin('Only an Admin can change the shared forbidden words');
  v_note := private.phrase_note(p_note);
  perform pg_advisory_xact_lock(hashtext('public.forbidden_phrases'));
  select * into v_row from public.forbidden_phrases where id = p_id for update;
  if not found then
    raise exception 'That phrase isn’t in the list any more' using errcode = 'P0002', hint = 'phrase_missing';
  end if;
  if (select count(*) from public.forbidden_phrases where phrase_group = v_row.phrase_group) <= 1 then
    raise exception 'A group keeps at least one phrase' using errcode = '22023', hint = 'group_last';
  end if;
  delete from public.forbidden_phrases where id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'forbidden_phrase.delete', 'forbidden_phrase', p_id,
          jsonb_build_object('group', v_row.phrase_group, 'phrase', v_row.phrase),
          jsonb_build_object('note', v_note));
end;
$$;

revoke execute on function private.phrase_clean(text) from public, anon, authenticated;
revoke execute on function private.phrase_needle(text) from public, anon, authenticated;
revoke execute on function private.phrase_is_short(text) from public, anon, authenticated;
revoke execute on function private.phrase_hits(text) from public, anon, authenticated;
revoke execute on function private.phrase_note(text) from public, anon, authenticated;
revoke execute on function public.check_forbidden_phrase(text) from public, anon;
revoke execute on function public.add_forbidden_phrase(text, text, text) from public, anon;
revoke execute on function public.remove_forbidden_phrase(uuid, text) from public, anon;
grant execute on function public.check_forbidden_phrase(text) to authenticated;
grant execute on function public.add_forbidden_phrase(text, text, text) to authenticated;
grant execute on function public.remove_forbidden_phrase(uuid, text) to authenticated;
