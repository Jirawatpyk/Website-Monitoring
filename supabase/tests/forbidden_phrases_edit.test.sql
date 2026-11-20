-- S17 PR 3c (D-069, spec §41): Admins add / remove shared forbidden phrases with a note, and check a
-- phrase against the live sites' stored clean pages. Every rule the page shows holds here too. The
-- short-word cases are the same as `phraseRefusal` in packages/shared/src/forbidden.test.ts.
begin;
\ir _helpers.psql
select plan(43);

-- ── Who may call them ───────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.add_forbidden_phrase(text,text,text)', 'execute'), 'anon can’t add');
select ok(not has_function_privilege('anon', 'public.remove_forbidden_phrase(uuid,text)', 'execute'), 'anon can’t remove');
select ok(not has_function_privilege('anon', 'public.check_forbidden_phrase(text)', 'execute'), 'anon can’t check');
select ok(not has_function_privilege('authenticated', 'private.phrase_hits(text)', 'execute'), 'the page search is private');

-- ── The short-word rule (same cases as the TS rule) ─────────────────────────────────────────────
select is(private.phrase_is_short('slot'), true, '“slot” is a single short word');
select is(private.phrase_is_short('Slot'), true, 'in any case');
select is(private.phrase_is_short('ufa365'), false, 'a 6-letter brand passes');
select is(private.phrase_is_short('พนัน'), true, '“พนัน” is 3 Thai characters (the vowel mark doesn’t count)');
select is(private.phrase_is_short('สล็อต'), false, '“สล็อต” is 4');
select is(private.phrase_is_short('time slot'), false, 'a phrase with a space passes');
select is(private.phrase_is_short('casino'), false, 'a 6-letter word passes');
select is(private.phrase_is_short('หวย'), true, '“หวย” is 3 Thai characters');
select is(private.phrase_clean(E'\t รับเครดิตฟรี\n'), 'รับเครดิตฟรี', 'a tab or newline at either end is trimmed');
select is((select count(*)::int from public.forbidden_phrases where private.phrase_is_short(phrase)), 0,
          'no seeded phrase is short');

-- ── People and a live site with a stored page ───────────────────────────────────────────────────
update public.profiles set is_active = false where true;
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated;
insert into ids values
  ('tao', tests.create_user('tao-fpe@pgtap.test', 'admin')),
  ('arm', tests.create_user('arm-fpe@pgtap.test', 'responder'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
grant execute on function pg_temp.uid(text) to authenticated;

insert into public.crawler_clean_pages (monitor_id, view, checked_at, url, body_hash, body)
select m.id, 'plain', now(), m.url, repeat('a', 64), '<p>book a time slot · รับเครดิตฟรี 50 บาท</p>'
from public.monitors m join public.sites s on s.id = m.site_id
where m.is_primary and m.enabled and m.removed_at is null and s.is_active
limit 1;

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_hint;
  return v;
end;
$$;
grant execute on function pg_temp.hint_of(text) to authenticated;

-- ── A Responder is refused ──────────────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('arm'));
select throws_ok($$ select public.add_forbidden_phrase('brands', 'newbrand365', 'note') $$, '42501', null,
                 'a Responder can’t add');
select throws_ok($$ select public.check_forbidden_phrase('anything here') $$, '42501', null,
                 'nor check');
select throws_ok(format($$ select public.remove_forbidden_phrase(%L, 'n') $$,
                   (select id from public.forbidden_phrases order by created_at limit 1)),
                 '42501', null, 'nor remove');

-- ── An Admin ────────────────────────────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select is((public.check_forbidden_phrase('Time  Slot') -> 'hits' -> 0 ->> 'snippet') like '%time slot%', true,
          'check finds a phrase on a stored page, case and spacing aside, with a snippet');
select is((public.check_forbidden_phrase('slot vip room') -> 'hits'), '[]'::jsonb, 'and nothing for a clean phrase');
select ok((public.check_forbidden_phrase('slot vip room') ->> 'checked')::int >= 1, 'it counts the sites checked');
select is(pg_temp.hint_of($$ select public.add_forbidden_phrase('brands', 'newbrand365', '  ') $$), 'note_required',
          'a note is required');
select is(pg_temp.hint_of($$ select public.add_forbidden_phrase('spam', 'newbrand365', 'n') $$), 'group_invalid',
          'only the five groups');
select is(pg_temp.hint_of($$ select public.add_forbidden_phrase('gambling_en', 'slot', 'n') $$), 'phrase_short',
          'a single short word is refused');
select is(pg_temp.hint_of($$ select public.add_forbidden_phrase('gambling_en', 'SLOT   online', 'n') $$), 'phrase_taken',
          'a phrase already in the list, as the matcher sees it, is refused');
select is(pg_temp.hint_of($$ select public.add_forbidden_phrase('gambling_th', 'รับเครดิตฟรี', 'n') $$), 'phrase_found',
          'a phrase on a live site’s clean page is refused');
select is(pg_temp.hint_of($$ select public.add_forbidden_phrase('gambling_en', 'of&nbsp;the', 'n') $$), 'phrase_markup',
          'an entity is refused: the matcher would read it as a space (security review)');
select is(pg_temp.hint_of($$ select public.add_forbidden_phrase('gambling_en', '<script src', 'n') $$), 'phrase_markup',
          'markup is refused');
select is(pg_temp.hint_of(format($$ select public.add_forbidden_phrase('gambling_en', %L, 'n') $$,
            'slot' || chr(160) || 'online')), 'phrase_taken',
          'a no-break space folds like the matcher’s, so the duplicate is caught');
select is(pg_temp.hint_of(format($$ select public.check_forbidden_phrase(%L) $$, repeat('a', 201))), 'phrase_too_long',
          'check takes no more than the dialog sends');
select is(pg_temp.hint_of(format($$ select public.add_forbidden_phrase('brands', %L, 'n') $$, repeat('ab ', 21))),
          'phrase_too_long', 'at most 60 characters');

select is(pg_temp.hint_of($$ select public.add_forbidden_phrase('gambling_th', E'\tรับเครดิตฟรี', 'n') $$), 'phrase_found',
          'a tab in front doesn’t get a phrase past the page check (db-reviewer)');
select is(pg_temp.hint_of(format($$ select public.add_forbidden_phrase('brands', 'new brand phrase', %L) $$, repeat('n', 501))),
          'note_too_long', 'a note of at most 500 characters');
select is((public.check_forbidden_phrase('time slot') ->> 'found')::int, 1, 'check counts the sites it was found on');

-- A page at the monitor's old URL isn't searched.
reset role;
update public.crawler_clean_pages set url = 'https://old.example.test/';
select tests.authenticate_as(pg_temp.uid('tao'));
select is(public.check_forbidden_phrase('time slot') -> 'hits', '[]'::jsonb, 'a page of an old URL isn’t searched');
reset role;
update public.crawler_clean_pages c set url = m.url from public.monitors m where m.id = c.monitor_id;
select tests.authenticate_as(pg_temp.uid('tao'));

create temp table added (id uuid) on commit drop;
grant all on added to authenticated;
insert into added select public.add_forbidden_phrase('gambling_en', '  slot   vip  room ', 'Seen on a client site');
select is((select phrase from public.forbidden_phrases where id = (select id from added)), 'slot vip room',
          'an Admin adds a phrase, stored trimmed with single spaces');
select is((select created_by from public.forbidden_phrases where id = (select id from added)), pg_temp.uid('tao'),
          'with who added it');

reset role;
select is((select count(*)::int from public.audit_log
           where action = 'forbidden_phrase.create' and entity_id = (select id from added)
             and actor_id = pg_temp.uid('tao') and after ->> 'note' = 'Seen on a client site'
             and after ->> 'phrase' = 'slot vip room'), 1,
          'one forbidden_phrase.create row naming the Admin, with the note');

-- ── Remove ──────────────────────────────────────────────────────────────────────────────────────
select tests.authenticate_as(pg_temp.uid('tao'));
select is(pg_temp.hint_of(format($$ select public.remove_forbidden_phrase(%L, '') $$, (select id from added))),
          'note_required', 'removing needs a note too');
select lives_ok(format($$ select public.remove_forbidden_phrase(%L, 'Added by mistake') $$, (select id from added)),
                'an Admin removes it');
select is(pg_temp.hint_of(format($$ select public.remove_forbidden_phrase(%L, 'again') $$, (select id from added))),
          'phrase_missing', 'a phrase already gone says so');
reset role;
select is((select count(*)::int from public.audit_log
           where action = 'forbidden_phrase.delete' and entity_id = (select id from added)
             and before ->> 'phrase' = 'slot vip room' and after ->> 'note' = 'Added by mistake'), 1,
          'one forbidden_phrase.delete row with what it was and the note');

-- The last phrase of a group stays.
delete from public.forbidden_phrases where phrase_group = 'pharma' and phrase <> 'buy viagra';
select tests.authenticate_as(pg_temp.uid('tao'));
select is(pg_temp.hint_of(format($$ select public.remove_forbidden_phrase(%L, 'n') $$,
            (select id from public.forbidden_phrases where phrase = 'buy viagra'))),
          'group_last', 'the last phrase of a group can’t be removed');

-- The cap.
reset role;
insert into public.forbidden_phrases (phrase_group, phrase)
select 'brands', 'filler phrase ' || n from generate_series(1, 300 - (select count(*)::int from public.forbidden_phrases)) n;
select tests.authenticate_as(pg_temp.uid('tao'));
select is(pg_temp.hint_of($$ select public.add_forbidden_phrase('brands', 'one more brand', 'n') $$), 'phrases_full',
          'at most 300 phrases');
reset role;

select * from finish();
rollback;
