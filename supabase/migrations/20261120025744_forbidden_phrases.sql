-- S17 PR 3b (D-069, spec §41): the shared forbidden-phrase list moves from code to the database, with
-- no change in behaviour, so PR 3c can let Admins edit it.
--   · forbidden_phrases — one row per phrase in one of the board's five groups, seeded from the list
--     in @dxt/shared (`FORBIDDEN_GROUPS`; `forbidden-seed.test.ts` holds the two equal). The Vercel
--     probes, the crawler, the monitor test and the engine read it with the service role each run;
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
-- created_at a second apart keeps the code list's order (a VALUES list is read in order)
select g, p, timestamptz '2026-10-13 00:00:00+00' + make_interval(secs => (row_number() over ())::int)
from (values
  ('gambling_th', 'สล็อตออนไลน์'),
  ('gambling_th', 'สล็อตเว็บตรง'),
  ('gambling_th', 'เว็บสล็อต'),
  ('gambling_th', 'สล็อต pg'),
  ('gambling_th', 'บาคาร่า'),
  ('gambling_th', 'แทงบอล'),
  ('gambling_th', 'เว็บพนัน'),
  ('gambling_th', 'คาสิโนออนไลน์'),
  ('gambling_th', 'เว็บตรงไม่ผ่านเอเย่นต์'),
  ('gambling_th', 'ฝากถอนออโต้'),
  ('gambling_th', 'สล็อตเครดิตฟรี'),
  ('gambling_th', 'หวยออนไลน์'),
  ('gambling_th', 'แทงหวย'),
  ('gambling_en', 'slot online'),
  ('gambling_en', 'online slot'),
  ('gambling_en', 'slot gacor'),
  ('gambling_en', 'situs slot'),
  ('gambling_en', 'judi online'),
  ('gambling_en', 'online casino'),
  ('gambling_en', 'casino online'),
  ('gambling_en', 'baccarat online'),
  ('gambling_en', 'pg slot'),
  ('brands', 'slotxo'),
  ('brands', 'ufabet'),
  ('brands', 'sbobet'),
  ('brands', 'joker123'),
  ('adult', 'porn video'),
  ('adult', 'xxx video'),
  ('adult', 'sex video'),
  ('adult', 'คลิปโป๊'),
  ('adult', 'หนังโป๊'),
  ('pharma', 'buy viagra'),
  ('pharma', 'cheap viagra'),
  ('pharma', 'viagra online'),
  ('pharma', 'cialis online'),
  ('pharma', 'buy cialis')
) as s (g, p);

create table public.crawler_clean_pages (
  monitor_id uuid not null references public.monitors (id) on delete cascade,
  -- CRAWLER_VIEWS + FINGERPRINT_VIEW (@dxt/shared)
  view text not null
    constraint crawler_clean_pages_view_check check (view in ('googlebot', 'google_referer', 'plain')),
  -- the fetch the text is from (updated on every clean fetch, even when the text is the same)
  checked_at timestamptz not null,
  -- sha-256 of `body`, so a run sends the text only when it changed
  body_hash text not null constraint crawler_clean_pages_hash_check check (body_hash ~ '^[0-9a-f]{64}$'),
  -- normalizeForMatch(the decoded page), up to the crawler's 3 MB read
  body text not null constraint crawler_clean_pages_body_check check (char_length(body) <= 3200000),
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
