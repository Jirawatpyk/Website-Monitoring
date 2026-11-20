-- S17 PR 3b (D-069): the shared forbidden list in the database, and each site's newest clean crawler
-- fetch. Admins read the list (3c's section); nobody but the service role reads or writes either table
-- (the probes, the crawler and the engine run as the service role); the seed is the code list.
begin;
\ir _helpers.psql
select plan(23);

-- ── The seed and the table's own rules ────────────────────────────────────────────────────────────
select is((select count(*)::int from public.forbidden_phrases), 36, 'seeded with the 36 entries of the code list');
select is((select count(distinct phrase_group)::int from public.forbidden_phrases), 5, 'in the board’s five groups');
select is((select phrase from public.forbidden_phrases order by created_at, id limit 1), 'สล็อตออนไลน์',
          'read in the code list’s order');
select throws_ok($$ insert into public.forbidden_phrases (phrase_group, phrase) values ('gambling_en', 'Slot   ONLINE') $$,
                 '23505', null, 'one entry per phrase as the matcher sees it (case, runs of spaces)');
select throws_ok($$ insert into public.forbidden_phrases (phrase_group, phrase) values ('spam', 'some phrase') $$,
                 '23514', null, 'only the five groups');
select throws_ok($$ insert into public.forbidden_phrases (phrase_group, phrase) values ('brands', ' padded ') $$,
                 '23514', null, 'no leading or trailing space');
select throws_ok(
  format($$ insert into public.forbidden_phrases (phrase_group, phrase) values ('brands', %L) $$, repeat('a', 61)),
  '23514', null, 'at most 60 characters');

-- ── Who reads them ───────────────────────────────────────────────────────────────────────────────
update public.profiles set is_active = false where true;
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated;
insert into ids values
  ('tao', tests.create_user('tao-fp@pgtap.test', 'admin')),
  ('arm', tests.create_user('arm-fp@pgtap.test', 'responder'));
create function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;
grant execute on function pg_temp.uid(text) to authenticated;

-- A live site's primary monitor (the seed has them).
insert into public.crawler_clean_pages (monitor_id, view, checked_at, url, body_hash, body)
select m.id, 'plain', now(), m.url, repeat('a', 64), '<p>welcome</p>'
from public.monitors m join public.sites s on s.id = m.site_id
where m.is_primary and m.enabled and m.removed_at is null and s.is_active
limit 1;

select tests.authenticate_as(pg_temp.uid('tao'));
select is((select count(*)::int from public.forbidden_phrases), 36, 'an Admin reads the list');
select throws_ok($$ insert into public.forbidden_phrases (phrase_group, phrase) values ('brands', 'newbrand') $$,
                 '42501', null, 'an Admin can’t write it directly (3c: through audited functions)');
select throws_ok($$ select count(*) from public.crawler_clean_pages $$, '42501', null,
                 'an Admin can’t read stored page content');

select throws_ok($$ update public.forbidden_phrases set phrase = 'x y' $$, '42501', null, 'nor update it');
select throws_ok($$ delete from public.forbidden_phrases $$, '42501', null, 'nor delete from it');
select throws_ok($$ delete from public.crawler_clean_pages $$, '42501', null, 'nor delete stored pages');
select throws_ok($$ select public.crawler_prune_clean_pages() $$, '42501', null, 'nor run the crawler’s prune');

select tests.authenticate_as(pg_temp.uid('arm'));
select is((select count(*)::int from public.forbidden_phrases), 0, 'a Responder sees no list');
select throws_ok($$ select count(*) from public.crawler_clean_pages $$, '42501', null,
                 'nor stored page content');

select tests.as_anon();
select throws_ok($$ select count(*) from public.forbidden_phrases $$, '42501', null, 'anon reads nothing');
select throws_ok($$ select count(*) from public.crawler_clean_pages $$, '42501', null, 'nor stored pages');
reset role;

select is((select count(*)::int from public.crawler_clean_pages), 1, 'the service role keeps one row per monitor and view');
select throws_ok(
  $$ insert into public.crawler_clean_pages (monitor_id, view, checked_at, url, body_hash, body)
     select id, 'other', now(), url, repeat('a', 64), 'x' from public.monitors limit 1 $$,
  '23514', null, 'only the crawler’s views');
select throws_ok(
  $$ update public.crawler_clean_pages set body_hash = 'not-a-hash' $$, '23514', null, 'a sha-256 hash');

-- The prune keeps the page of a live primary at its URL and drops one of an old URL.
update public.crawler_clean_pages c set url = m.url
from public.monitors m join public.sites s on s.id = m.site_id
where m.id = c.monitor_id and m.is_primary and m.enabled and m.removed_at is null and s.is_active;
select is(public.crawler_prune_clean_pages(), 0, 'a live primary’s page at its URL stays');
update public.crawler_clean_pages set url = 'https://old.example.test/';
select is(public.crawler_prune_clean_pages(), 1, 'the page of an old URL goes');

select * from finish();
rollback;
