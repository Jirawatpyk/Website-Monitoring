# apps/test-target

A switchable site for staging checks (S02a), deployed as its own Vercel project `dxt-test-target`
(root `apps/test-target`) so it never depends on the app it helps test. Every path answers by the
`mode` item in the Global Config (formerly Edge Config) store `dxt-test-target-global-config` connected to the project (env `GLOBAL_CONFIG`): `ok` → 200,
`error` → 500, `timeout` → held 45 s (probe User-Agent only; anyone else gets 200 at once); S03 adds the blocked
rounds for the browser verifier: `challenge` → a probe gets a Cloudflare-style 403 challenge, a browser the page (OK with
the note), `challenge-down` → the probe is challenged and a browser gets 503 (DOWN), `challenge-all` → everyone is
challenged (PROBLEM, D-020). S04a adds `keyword-missing` → 200 without "Test target" on the page (PROBLEM · Keyword, with the
staging monitor's `must_contain = {Test target}`) and `slow` → a probe waits 6 s (PROBLEM · Slow after 3 rounds). S05b (D-027) adds `waf-partial` → a WAF challenge (403 + `cf-mitigated`) for every caller outside Thailand (`x-vercel-ip-country` ≠ TH) and the page in Thailand — with the staging site flagged Behind WAF that is OK with "Verified from BKK; SIN, TYO blocked by bot protection" — and `waf-partial-down` → the same block abroad and a 503 in Thailand (DOWN on the Bangkok probe alone). D-039 adds `waf-partial-slow` → the same block abroad and a probe in Thailand waits 6 s (PROBLEM · Slow on the Bangkok probe alone). S09c (D-041) adds the defacement modes, each keeping "Test target" on the page so only the forbidden phrases fire: `defaced` → everyone gets shared-list phrases (PROBLEM · Keyword from the probes), `cloaked-ua` → only a Googlebot User-Agent gets them ("(as Googlebot)" from the crawler), `cloaked-referer` → a non-probe, non-Googlebot caller with a `https://www.google.…` Referer gets a 302 to `https://example.com/` (PROBLEM · Redirect "(from Google search)"), `deep-spam` → everyone gets them after 300 KB, past the probes' 256 KB sample (only the crawler's whole-body read sees them). The phrases (`SPAM`) are copied from `packages/shared/src/forbidden.ts`; keep them on that list. S09d (D-046) adds the page-change modes, read by the crawler's plain fetch: `defaced-title` → the `<title>` reads `Test target | Lucky Deals` (no shared-list phrase, the h1 keeps the brand) — PROBLEM · Page change on the 3rd plain fetch (~1 h); `injected-script` → a `<script src="https://evil-cdn.example/x.js">` after ~400 KB — PROBLEM · Page change on the next plain fetch. Point the staging test monitor at it (`supabase/staging/test-target.sql`) and flip `mode`
to trigger a DOWN / RECOVERED or a blocked round.

A new mode also goes in the `verifier-staging` skill's mode table (`.claude/skills/verifier-staging/SKILL.md`), with the outcome to expect.

No secrets, no data, no auth: it only says which mode it is in.

Vercel runs `api/index.ts` as native ESM: relative imports there must end in `.js` (`../src/handler.js`), or the function fails with `ERR_MODULE_NOT_FOUND` though tests pass.
