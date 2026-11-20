-- S17 PR 3b (D-069, spec §41): the shared forbidden-phrase list moves from code to the database, with
-- no change in behaviour, so PR 3c can let Admins edit it.
--   · forbidden_phrases — one row per phrase in one of the board's five groups, seeded from the list
--     in @dxt/shared (`FORBIDDEN_GROUPS`; `forbidden-list.test.ts` holds the two equal). The Vercel
--     probes and the crawler read it with the service role each run, the Test check as the Admin;
--     the Bangkok agent gets it in the Ingest GET. A failed read falls back to the code list.
--     Admins read it (3c's section); 3c adds the audited add / remove functions.
--   · crawler_clean_pages — each live home page's newest clean fetch per crawler view (usable, no
--     forbidden hit), the text as the matcher reads it. 3c's "Check phrase" looks for a new phrase
--     here (Tao, 20 Nov: option A). One row per monitor and view, overwritten; client page content,
--     so no policy at all: only the service role reads it, and the check returns a short snippet.

set local lock_timeout = '5s';

create table public.forbidden_phrases (
  id uuid primary key default gen_random_uuid(),
  -- mirrors FORBIDDEN_GROUP_IDS (@dxt/shared)
  phrase_group text not null
    constraint forbidden_phrases_group_check
      check (phrase_group in ('gambling_th', 'gambling_en', 'brands', 'adult', 'pharma')),
  -- as written (Thai or English); matched case-insensitively, a run of spaces as one (D-042)
  phrase text not null
    constraint forbidden_phrases_phrase_check
      check (char_length(phrase) between 1 and 60 and phrase = btrim(phrase)),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one entry per phrase as the matcher sees it ("Slot  Online" is "slot online")
create unique index forbidden_phrases_match_key
  on public.forbidden_phrases (lower(regexp_replace(phrase, '\s+', ' ', 'g')));

create trigger forbidden_phrases_set_updated_at before update on public.forbidden_phrases
  for each row execute function private.set_updated_at();

alter table public.forbidden_phrases enable row level security;

create policy forbidden_phrases_select_admin on public.forbidden_phrases
  for select to authenticated
  using ((select coalesce(public.current_app_role() = 'admin', false)));

revoke all on public.forbidden_phrases from public, anon, authenticated;
grant select on public.forbidden_phrases to authenticated;
grant all on public.forbidden_phrases to service_role;

-- The code list as of 20 Nov 2026 (packages/shared/src/forbidden.ts), in its order.
insert into public.forbidden_phrases (phrase_group, phrase, created_at)
-- created_at a second apart keeps the code list's order
select g, p, timestamptz '2026-10-13 00:00:00+00' + make_interval(secs => n)
from (values
  (1, 'gambling_th', 'สล็อตออนไลน์'),
  (2, 'gambling_th', 'สล็อตเว็บตรง'),
  (3, 'gambling_th', 'เว็บสล็อต'),
  (4, 'gambling_th', 'สล็อต pg'),
  (5, 'gambling_th', 'บาคาร่า'),
  (6, 'gambling_th', 'แทงบอล'),
  (7, 'gambling_th', 'เว็บพนัน'),
  (8, 'gambling_th', 'คาสิโนออนไลน์'),
  (9, 'gambling_th', 'เว็บตรงไม่ผ่านเอเย่นต์'),
  (10, 'gambling_th', 'ฝากถอนออโต้'),
  (11, 'gambling_th', 'สล็อตเครดิตฟรี'),
  (12, 'gambling_th', 'หวยออนไลน์'),
  (13, 'gambling_th', 'แทงหวย'),
  (14, 'gambling_en', 'slot online'),
  (15, 'gambling_en', 'online slot'),
  (16, 'gambling_en', 'slot gacor'),
  (17, 'gambling_en', 'situs slot'),
  (18, 'gambling_en', 'judi online'),
  (19, 'gambling_en', 'online casino'),
  (20, 'gambling_en', 'casino online'),
  (21, 'gambling_en', 'baccarat online'),
  (22, 'gambling_en', 'pg slot'),
  (23, 'brands', 'slotxo'),
  (24, 'brands', 'ufabet'),
  (25, 'brands', 'sbobet'),
  (26, 'brands', 'joker123'),
  (27, 'adult', 'porn video'),
  (28, 'adult', 'xxx video'),
  (29, 'adult', 'sex video'),
  (30, 'adult', 'คลิปโป๊'),
  (31, 'adult', 'หนังโป๊'),
  (32, 'pharma', 'buy viagra'),
  (33, 'pharma', 'cheap viagra'),
  (34, 'pharma', 'viagra online'),
  (35, 'pharma', 'cialis online'),
  (36, 'pharma', 'buy cialis')
) as s (n, g, p);

create table public.crawler_clean_pages (
  monitor_id uuid not null references public.monitors (id) on delete cascade,
  -- CRAWLER_VIEWS + FINGERPRINT_VIEW (@dxt/shared)
  view text not null
    constraint crawler_clean_pages_view_check check (view in ('googlebot', 'google_referer', 'plain')),
  -- the fetch the text is from (updated on every clean fetch, even when the text is the same)
  checked_at timestamptz not null,
  -- the monitor's URL when it was fetched: a page of an old URL is pruned (security-reviewer)
  url text not null constraint crawler_clean_pages_url_check check (char_length(url) <= 2048),
  -- sha-256 of `body`, so a run sends the text only when it changed
  body_hash text not null constraint crawler_clean_pages_hash_check check (body_hash ~ '^[0-9a-f]{64}$'),
  -- normalizeForMatch(the decoded page), capped at 3.2M characters by the crawler. The check counts
  -- bytes (4 per character at most): octet_length reads the stored length, char_length would decompress
  -- the whole page on every checked_at-only update (db-reviewer).
  body text not null constraint crawler_clean_pages_body_check check (octet_length(body) <= 12800000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (monitor_id, view)
);

create trigger crawler_clean_pages_set_updated_at before update on public.crawler_clean_pages
  for each row execute function private.set_updated_at();

alter table public.crawler_clean_pages enable row level security;
-- No policy: client page content, read only by the service role (3c's check returns a snippet).
revoke all on public.crawler_clean_pages from public, anon, authenticated;
grant all on public.crawler_clean_pages to service_role;

-- After each crawler run: drop every stored page the crawler no longer reads — a stopped site, a
-- removed, disabled or no-longer-primary monitor, or a page of the monitor's old URL. Client content
-- isn't kept past its use, and 3c's check never reads a page nobody watches. Returns the rows dropped.
create function public.crawler_prune_clean_pages()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.crawler_clean_pages c
    where not exists (
      select 1
      from public.monitors m
      join public.sites s on s.id = m.site_id
      where m.id = c.monitor_id
        and m.url = c.url
        and m.is_primary
        and m.enabled
        and m.removed_at is null
        and s.is_active
    )
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke execute on function public.crawler_prune_clean_pages() from public, anon, authenticated;
grant execute on function public.crawler_prune_clean_pages() to service_role;
