# apps/test-target

A switchable site for staging checks (S02a), deployed as its own Vercel project `dxt-test-target`
(root `apps/test-target`) so it never depends on the app it helps test. Every path answers by the
`mode` item in the Global Config (formerly Edge Config) store `dxt-test-target-global-config` connected to the project (env `GLOBAL_CONFIG`): `ok` → 200,
`error` → 500, `timeout` → held 45 s (probe User-Agent only; anyone else gets 200 at once); S03 adds the blocked
rounds for the browser verifier: `challenge` → a probe gets a Cloudflare-style 403 challenge, a browser the page (OK with
the note), `challenge-down` → the probe is challenged and a browser gets 503 (DOWN), `challenge-all` → everyone is
challenged (PROBLEM, D-020). S04a adds `keyword-missing` → 200 without "Test target" on the page (PROBLEM · Keyword, with the
staging monitor's `must_contain = {Test target}`) and `slow` → a probe waits 6 s (PROBLEM · Slow after 3 rounds). S05b (D-027) adds `waf-partial` → a WAF challenge (403 + `cf-mitigated`) for every caller outside Thailand (`x-vercel-ip-country` ≠ TH) and the page in Thailand — with the staging site flagged Behind WAF that is OK with "Verified from BKK; SIN, TYO blocked by bot protection" — and `waf-partial-down` → the same block abroad and a 503 in Thailand (DOWN on the Bangkok probe alone). Point the staging test monitor at it (`supabase/staging/test-target.sql`) and flip `mode`
to trigger a DOWN / RECOVERED or a blocked round.

A new mode also goes in the `verifier-staging` skill's mode table (`.claude/skills/verifier-staging/SKILL.md`), with the outcome to expect.

No secrets, no data, no auth: it only says which mode it is in.

Vercel runs `api/index.ts` as native ESM: relative imports there must end in `.js` (`../src/handler.js`), or the function fails with `ERR_MODULE_NOT_FOUND` though tests pass.
