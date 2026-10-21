# Implementation plan

26 vertical slices in 4 phases, following PRD §12: Phase 0 prep → a thin end-to-end slice for one site → the rest of the MVP (P0) → team go-live (P1) → client-facing (P2). Each slice ships something that runs end to end and has observable **Done when** checks; phase gates repeat the PRD §12 exit criteria.

- **Status** is updated by `/slice-review <ID>` when every Done-when line has evidence. Values: `Todo` · `In progress` · `In review` · `Done` · `Blocked`. A line that can only be checked on production keeps the slice `In review` after the merge; a close-out PR sets `Done` with its evidence ([`workflow.md`](workflow.md) step 9).
- How a slice is worked: [`workflow.md`](workflow.md). Settled conflicts: [`decisions.md`](decisions.md). Board → route map: [`design/screens.md`](design/screens.md). Coverage is checked by `pnpm plan:check`.
- **Size** (one developer): **S** ≤ 2 days · **M** 3–4 days · **L** 5 days. Nothing is larger than a week; split a slice that grows past L and run `pnpm plan:check`. Sizes stay as relative effort; the calendar comes from the measured pace in [Timeline](#timeline) (re-baselined 7 Oct 2026).
- **PRD week** is the PRD §12 target (week 1 = Mon 28 Sep 2026). Q7 is settled: measure, then re-baseline — done 7 Oct 2026 from six measured slices ([Timeline](#timeline)); the gates land back on the PRD weeks.

## Slices

| ID | Slice | Phase | Size | FRs | Depends on | PRD week | Status |
|---|---|---|---|---|---|---|---|
| S00 | Prep, decisions, accounts & staging | 0 | — | — | — | 1 | Done |
| S01 | Foundation: schema, auth, app shell | 1 · P0 | M | — | S00 | 2 | Done |
| S02a | Thin slice: probe → engine → DOWN / RECOVERED in Chat | 1 · P0 | S | FR-02 | S01 | 2 | Done |
| S02b | Email, delivery guarantees, Ack + Undo | 1 · P0 | M | FR-07 | S02a | 2 | Done |
| S03 | Bangkok probe & browser verifier | 1 · P0 | L | FR-04 | S02b | 2–3 | Done |
| S04a | PROBLEM triggers & status rules | 1 · P0 | L | FR-03 | S03 | 3 | Done |
| S04b | Relapse, flapping & auto-resolve | 1 · P0 | L | — | S04a | 3 | Done |
| S05 | Sites & monitors | 1 · P0 | L | FR-01 | S01 | 3 | In review |
| S05b | Sites behind a WAF: trusted location + control check | 1 · P0 | M | FR-04 | S05 (merged) | 3 | Done |
| S05c | Sites list (board) | 1 · P0 | M | FR-05 | S05 (merged) | 3 | Done |
| S06 | Site detail & check rollups | 1 · P0 | L | FR-08 | S02a, S05 (merged) | 3 | Done |
| S06b | Overview (option A) | 1 · P0 | L | FR-05 | S06, S02b | 3 | Done |
| S07 | Incidents, timeline & resolve | 1 · P0 | L | FR-06 | S04b | 3 | Done |
| S08 | Escalation L0–L1 & response hours | 1 · P0 | M | FR-09a | S07 | 3 | Done |
| S09 | Maintenance windows & mute | 1 · P0 | L | FR-10a, FR-14 | S06b, S08 | 3 | Done |
| S09b | Maintenance messages | 1 · P0 | M | — (FR-10a, FR-14 messages, §24) | S09 + ChatAlert / EmailAlert boards | 3 | Done |
| S09c | Defacement: shared forbidden words & crawler view | 1 · P0 | M | — (FR-03 defacement, PRD §2 / §5, D-041) | S04a | 3 | Done |
| S09d | Defacement: page-change detection | 1 · P1 | L | — (PRD §2 content-change, D-041, D-046) | S09c (merged), S07 | 3–4 (alert on after a 2-week record) | In review |
| G1 | **MVP gate** | 1 | — | — | S01–S09 (incl. S04a, S04b; S09c Done-when 1, 2, 4) | end 3 (≈ 16–21 Oct) | Todo |
| S10 | Escalation L2–L3 & on-call | 2 · P1 | L | FR-09b | G1 | 4 | Todo |
| S11 | Client-update track | 2 · P1 | M | FR-20 | S08 | 4 | Todo |
| S12 | Monitor-fault mode & probes | 2 · P1 | M | FR-21 | S06b, S10, S11 | 4 | Todo |
| S13 | SSL & domain expiry | 2 · P1 | S | FR-11 | S04a | 4 | Todo |
| S14 | Digest, weekly summary & recurring maintenance | 2 · P1 | M | FR-12, FR-10b | S09, S11 | 5 | Todo |
| S15 | Audit log | 2 · P1 | S | FR-13 | S09 | 5 | Todo |
| S16 | Users & access | 2 · P1 | M | — | S10 | 5 | Todo |
| S17 | Alert channels & organisation settings | 2 · P1 | M | — | S10, S11 | 5 | Todo |
| S18 | User guide | 2 · P1 | S | FR-22 | S16 | 5 | Todo |
| S19 | Go-live readiness: UAT, game day, parallel run | 2 | M | — | S10–S18 | buffer + 2-week run | Todo |
| G2 | **Team go-live gate** | 2 | — | — | S19 | end 5 + run (≈ 18–20 Nov) | Todo |
| S20 | Uptime reports & monthly PDF | 3 · P2 | L | FR-15 | G2 | 6 | Todo |
| S21 | Client status page | 3 · P2 | L | FR-16 | S20 | 7 | Todo |
| S22 | Post-incident review | 3 · P2 | M | FR-18 | G2 | 8 | Todo |
| S23 | Synthetic transactions | 3 · P2 | L | FR-17 | G2 | 8–9 | Todo |
| S24 | Public API & webhooks | 3 · P2 | M | FR-19 | G2 | 9–10 | Todo |
| G3 | **Client-facing gate** | 3 | — | — | S20–S24 | end 10 (≈ 27 Nov – 4 Dec) | Todo |

Every slice also meets the [Definition of Done](workflow.md#definition-of-done) (checks, reviews, no dead controls, docs updated). Each slice's **Review** line names the domain agents; `/code-review high` (step 6, Claude) and `/verify` (step 7, Claude invokes it — Tao may too — when the slice has a runtime surface) run on every slice in addition.

## Timeline

| Phase | PRD target | Sum of sizes (1 developer, 28 Sep) | Re-baselined 7 Oct 2026 (measured pace) |
|---|---|---|---|
| 0 Prep | week 1 | week 1 | Done 6 Oct |
| 1 MVP (S01–S09) | weeks 2–3 (10 working days), gate end of week 3 = Fri 16 Oct | ≈ 45 days ≈ 9 weeks | S01–S04b done 7 Oct; S05–S09 ≈ 6 working days → **G1 ≈ Fri 16 – Wed 21 Oct** |
| 2 Team go-live (S10–S19) | weeks 4–5 + buffer, then 2-week parallel run (≈ Fri 13 Nov) | ≈ 36 days ≈ 7 weeks | S10–S18 ≈ 8–10 working days, S19 UAT + game day ≈ 2–3, then the 2-week run (10 working days, fixed) → **G2 ≈ Wed 18 – Fri 20 Nov** |
| 3 Client-facing (S20–S24) | weeks 6–10, gate end of week 10 = Fri 4 Dec | ≈ 23 days ≈ 5 weeks | ≈ 7–9 working days after G2 → **G3 ≈ Fri 27 Nov – Fri 4 Dec** |

**Re-baseline (7 Oct 2026, Q7).** Six slices are measured: S01 (M) about 1 working day, S02a (S) 2 h, S02b (M) 2 h 45 min, S03 (L) 4 h, S04a (L) 3 h, S04b (L) 2.5 h. Each includes `/code-review`, the domain reviewers (often two rounds), staging, Tao's `/verify` and the merge. The calendar per slice is set well above those hours, because the build is no longer the slow part. What sets the pace now is review rounds, waiting for Tao (`/verify`, merges, approvals) and screens (several boards checked at 390 / 820 / 1440 in light and dark):
- a logic slice ≈ 0.5 working day;
- an M with screens ≈ 1 day;
- an L with screens ≈ 1.5 days;
- plus about 20 % buffer.

The dates skip the Thai public holidays on Tue 13 Oct and Fri 23 Oct. The order, dependencies and gates don't change. Fixed waits that the pace doesn't shorten:
- **G1:** all 17 sites entered on production through the UI (S05 Done-when 1). This needs the Site Registration Checklist completed by owners and AMs, and is G1's long pole. G1 also needs a second Admin and the runbook.
- **G2:** UAT with owners on phones, the game day and the restore drill (S19), then the 2-week parallel run against the CEO's checks, which can't be compressed.
- **G3:** P2 scope is confirmed with the CEO at G2. A smaller P2 lands earlier.

Re-measure after S06 / S06b (the first slices heavy on screens) and adjust if screen slices run longer than 1.5 days.

---

## Phase 0 — Prep (week 1, owner: Tao, mostly outside the code)

### S00 · Prep, decisions, accounts & staging

- **Scope:** PRD §12 Phase 0. Close CEO decisions (PRD §13): tiers, owners / backups, on-call members, CEO at L2, Twilio, budget ceiling ($60 / month — no PITR add-on, D-005) — collected in a decisions memo as a Claude Doc the CEO answers in place. Site Registration Checklist for 17 sites (URL + key pages, owner, backup, client, AM, hosting, WAF, credential reference) — a Claude Doc that owners and AMs fill in. Docs: [CEO decisions memo](https://claude.ai/code/artifact/acb02ea0-685a-4aaf-abd8-2a8c45dce8a1) and [Site Registration Checklist](https://claude.ai/code/artifact/1bf65388-99fd-4700-96d2-8ee034e1e349) (created 28 Sep 2026; names in both are drafts from the spec until confirmed). Twilio voice is not used for now (Tao, 28 Sep 2026) — Tier 1 after hours is best effort, which the CEO is asked to accept in the memo. Accounts: Supabase Pro project (production) and a staging project in a separate free organisation (D-005). Two Vercel projects on the same repo, both with root `apps/web` (D-006): `dxt-monitor` (production branch `main`) and `dxt-monitor-staging` (production branch `staging`, env pointing at the staging Supabase project, the staging Chat space and its own `CRON_SECRET` / `INGEST_TOKEN`; Healthchecks URLs left empty or separate checks). Ignored Build Step so each project builds only its own branches — staging: `[ "$VERCEL_GIT_COMMIT_REF" != "staging" ]`, production: `[ "$VERCEL_GIT_COMMIT_REF" = "staging" ]` (exit 0 skips the build). Thai VPS (2 GB), Healthchecks.io checks, Resend sending domain, company domain (the primary address domain people sign in with, D-007). Access list (D-007): every person who will get a role, with that role — kept outside the repo (private, but no personal data in git), loaded as SQL in S01. Database access per environment: `.env.staging.local` from `scripts/db-staging.env.example` (staging connection string + both project refs), and the GitHub repository secret `SUPABASE_PROD_DB_URL` for the `migrate-production` CI job (D-008). Sign-in per environment (Supabase Auth handles Google): one Google OAuth client (Web) in a Google Cloud project of the company's Workspace organisation, consent screen **Internal** (D-007), whose authorised redirect URIs are the Supabase callbacks of **both** projects (`https://<prod-ref>.supabase.co/auth/v1/callback`, `https://<staging-ref>.supabase.co/auth/v1/callback`) — app URLs don't go there. Each Supabase project's Auth URL configuration holds the app URLs: production — Site URL = production domain, redirect `https://<prod-domain>/auth/callback`; staging — Site URL `https://monitor-staging.dxtspace.com`, redirects `https://monitor-staging.dxtspace.com/auth/callback` and the PR-preview pattern `https://*-<vercel-team>.vercel.app/**` (PR previews use the staging database). Custom domains: production `monitor.dxtspace.com`, staging `monitor-staging.dxtspace.com`, both DNS-only CNAMEs to Vercel (Cloudflare proxy off). Google Chat spaces "DxT Website Alerts", "DxT Website Reports" and a "DxT Monitor — staging" space for tests, each with an incoming webhook. HTTP vs Playwright capture of Tubtong / Cando Asia block pages; ask WAF owners to allowlist the probe UA + secret header and the VPS IP.
- **Depends on:** —
- **Done when:**
  1. CEO has approved tiers and the escalation ladder (PRD §12 exit), answered in the decisions memo and copied to the PRD's decisions list.
  2. The checklist is complete for every Tier 1 site (PRD §12 exit) and has owner, backup, client and AM for all 17.
  3. Both Vercel projects, both Supabase projects and the VPS have every variable name from `apps/web/.env.example` / `apps/vps-agent/.env.example` set (`vercel env ls` lists the names; values never shared in chat).
  4. A webhook test message appears in each of the three Chat spaces.
  5. Captured Tubtong / Cando block responses (status, headers, body sample) are saved under `docs/phase0/` for `packages/probe` challenge signatures.
  6. Pushing to `staging` deploys `dxt-monitor-staging` to its production URL, and its Vercel cron logs show `/api/cron/engine` called every minute (401 / 501 responses are expected until S02a); pushing a slice branch builds nothing on the staging project.
  7. The Google OAuth client lists both Supabase callbacks, and each Supabase project's Redirect URLs list matches the URLs above (checked by Tao).
  8. `pnpm db:push:staging --dry-run` against the empty staging database lists migrations 0001–0002 and exits 0; then `pnpm db:push:staging` applies them (output in the S00 notes) — the guarded scripts are proven before S02a needs them.
  9. The OAuth consent screen is Internal, and everyone on the access list has confirmed that their Google Account → 2-Step Verification page says it is required and can't be turned off (D-007); anyone for whom it can be turned off is raised with IT and left off the list.
- **Notes (evidence as it lands):**
  - 28 Sep 2026 — CEO decisions memo and Site Registration Checklist created (links in Scope); names are drafts until confirmed. Awaiting the CEO's answers (Done-when 1) and owners' entries (Done-when 2).
  - 29 Sep 2026 — Supabase: production `dxt-monitor` (ref `lirbdsexmabumgdeaetk`) in the existing Pro organisation, staging `dxt-monitor-staging` (ref `ctxmmrhvrjbkpodpgkqd`) in a separate free organisation, both Singapore. `.env.staging.local` set; repository secret `SUPABASE_PROD_DB_URL` set (D-008).
  - 29 Sep 2026 — **Done-when 8 ✓**: `pnpm db:push:staging --dry-run` listed `20260928000001_extensions_and_enums.sql` and `20260928000002_signup_domain_hook.sql`; `pnpm db:push:staging` applied both; a second dry run reported "Remote database is up to date."
  - 29 Sep 2026 — Production migrations: the first `migrate-production` run applied 0001–0002 on merge of PR #12. Google OAuth client (Internal) created; Vercel `dxt-monitor` (monitor.dxtspace.com) and `dxt-monitor-staging` (monitor-staging.dxtspace.com) deployed; Chat spaces + webhooks, Resend (`notify.dxtspace.com`) and Healthchecks set up — **Done-when 4 ✓** (webhook tests).
  - 5 Oct 2026 — **Done-when 2 ✓**: Site Registration Checklist filled from the OMG Group Asia Systems Audit Tracker and checked against the live sites; all 17 marked checked (DxT follows the live site: Wix, active). Credential storage locations still to be added by owners.
  - 5 Oct 2026 — **Done-when 5 ✓**: block captures in `docs/phase0/` (`waf-captures.md`): Bangkok Airways 403 from Akamai (allowlist request deferred), Cando Asia filters some UAs but passes `DxT-Monitor/1.0`, Tubtong not blocked from a Thai IP. Re-check from Vercel IPs in S02a.
  - 5 Oct 2026 — **Done-when 6 ✓**: Vercel env set on both projects (production: prod Supabase; `dxt-monitor` Preview: staging Supabase, public keys only; `dxt-monitor-staging`: staging). `staging` fast-forwarded to `main`; `monitor-staging.dxtspace.com` redirects to `/login`, and Vercel logs show all four crons every minute, `/api/cron/engine` answering 501 (auth passes, engine not built yet). A Redeploy of a `main` deployment on the staging project is cancelled by its Ignored Build Step — staging deploys only by pushing `staging`.
  - 5 Oct 2026 — **Done-when 7 ✓**: Supabase URL configuration set by Tao (prod: `monitor.dxtspace.com`; staging: `monitor-staging.dxtspace.com` + PR-preview pattern). Google provider stays off until S01 adds the allowlist.
  - 5 Oct 2026 — **Done-when 1 ✓**: the CEO answered all 8 memo items (tiers and the escalation ladder as proposed; synthetic checks capped at PROBLEM; budget $60 / month; CEO at L2 / L3 as proposed; Tier 1 after hours best effort, no Twilio; status page and reports in Phase 3). Item 3 approved with changes: owners / backups per the checklist; for now Admin = Tao only (second Admin needed before G1) and on-call = Tle (rotation of ≥ 3 before G2). Copied to the PRD decisions list (Claude Doc rev 168, `docs/prd.md`).
  - 5 Oct 2026 — **Done-when 9 ✓**: OAuth consent screen is Internal; Tao confirms Google Workspace enforces 2-Step Verification for everyone who will get a role (his own page says required and can't be turned off). Per D-007 the self-check stays a step of every allowlist invite, so a person in an OU without enforcement is still caught.
  - 5 Oct 2026 — VPS rented: LightNode Bangkok, 2 vCPU / 4 GB, Ubuntu 24.04, `dxt-monitor-bkk`, public IP `38.60.233.62` (geolocates to Bangkok, AS154177), ~$13.70 / month. Hardened: SSH key only (password and keyboard-interactive login off, root by key only), ufw deny-incoming except 22/tcp, unattended security upgrades on (provider image had the apt timers masked), upgraded and rebooted, timezone UTC. SSH key `~/.ssh/dxt_vps` on Tao's machine (RSA — LightNode accepts RSA only).
  - 6 Oct 2026 — **Done-when 3 ✓ (Vercel / Supabase part)**: every variable is set on both Vercel projects. The VPS agent's env file (`/etc/dxt-agent/env`) moves to S03 Done-when 6, where the agent is installed (D-010). **S00 Done.**
- **Review:** Tao sign-off; no code review.

## Phase 1 — MVP, P0

### S01 · Foundation: schema, auth, app shell

- **Scope:** Tables `profiles` (auto-created on first sign-in, email as the default notification channel), `clients`, `sites`, `monitors`, `audit_log` with RLS per role (PRD §3) and explicit grants; role helpers (`current_app_role()`, `owns_site(site_id)`); `audit_log` append-only with a write helper. Google SSO sign-in (Login, MLogin) with `?next=`; company domain in `private.allowed_email_domains`; email allowlist `private.allowed_emails (email, role)` — stored lower-case, compared with `lower()`, and refusing any address whose domain isn't allowed (so a DxT alias can't be added) — checked by the `before_user_created` hook, and the profile created on first sign-in with the allowlisted role (D-007). Until the Users screen (S16) an Admin edits the allowlist with SQL per environment, from a committed template with placeholders — real addresses never enter the repo. Users without an active profile read nothing (RLS). The proxy keeps the domain check only (no database query per request). App shell (SideNav with `live` flags, account footer), shared empty / loading / no-access states using the `@dxt/shared` formats. Dev seed from the spec sample data. SQL tests with pgTAP (`supabase/tests/`), run in a CI `db` job (Supabase CLI starts the local stack in Docker, then `supabase test db`), required on `main` alongside `check`.
- **Already in place from the setup:** enums (migration 0001), sign-up domain hook (0002), auth proxy with segment-wise public paths, `/auth/callback`, `safeNextPath` / `isAllowedEmail`, app shell and nav `live` flags, placeholder Login / Overview pages; web test tooling — Vitest + Testing Library (`pnpm --filter @dxt/web test`) and Playwright e2e at 1440 / 390 (`pnpm test:e2e`), both in CI.
- **Boards:** Login, MLogin, EmptyStates · **Tables:** profiles, clients, sites, monitors, audit_log · **Test plan:** T12
- **Depends on:** S00 (Supabase projects, OAuth client, company domain, access list)
- **Done when:**
  1. **T12:** an allowlisted company account signs in at `/login` and lands on `/` with its allowlisted role — locally, on `dxt-monitor-staging` and on one PR preview. Signing in with different capitals still matches the allowlist. A company account that isn't on the allowlist and a non-company account are both refused by the `before_user_created` hook with a message to ask an Admin (pgTAP tests); inserting an allowlist row on a domain that isn't allowed fails (pgTAP); a non-company session is also refused by the proxy (`?error=domain`); a user whose profile is inactive reads nothing (pgTAP).
  2. Opening `/incidents/x` signed out → sign-in → back on `/incidents/x` (evidence: the URL after sign-in; the page itself 404'd until S02b built it, D-016).
  3. `pnpm exec supabase test db` passes locally and in the CI `db` job: anon reads nothing; viewer can't write `sites`; responder updates only the mute fields of own sites (D-012); `authenticated` can't UPDATE / DELETE `audit_log`.
  4. `pnpm db:reset` builds from zero with seed; `pnpm db:types` output committed; `pnpm check` green.
  5. spec-checker passes Login, MLogin, EmptyStates at 390 and 1440 px, light and dark.
- **Review:** security-reviewer, db-reviewer, spec-checker.
- **Notes (evidence):** merged 6 Oct 2026 as PR #25 (`5d1fcde`); time spent ≈ 1 working day (planned M, 3–4 days).
  - **Done-when 1 ✓**
    - Real Google sign-in as the allowlisted Admin works on staging, on PR #25's preview and on production (Tao, 6 Oct). Each lands on `/` with role Admin; Claude re-checked staging in the browser at 09:19Z.
    - Refusals, lower-case matching, alias-domain rows, Google-only sign-up and "inactive reads nothing" are covered by pgTAP `access.test.sql` / `rls.test.sql`. A real local GoTrue sign-up with mixed case got its profile and role, and both refusals returned the hook's "ask an Admin" messages.
    - The proxy's `?error=domain` is covered by `proxy.test.ts`.
    - The signed-in flows are in `e2e/auth.spec.ts`: lands on `/` with its role, no profile → "No access yet", deactivated, sign out. They run in the CI `db` job.
  - **Done-when 2 ✓** On staging, real Google sign-in returned to `/incidents/x`. On production at 09:19Z, `/incidents/x` → `/login?next=%2Fincidents%2Fx`. Also covered by the e2e "goes back to the page they opened" and the callback unit tests.
  - **Done-when 3 ✓** pgTAP: 3 files, 72 tests, locally and in the CI `db` job (PR #25 and `main`).
  - **Done-when 4 ✓** `pnpm db:reset` builds from zero with the seed and `pnpm check` is green. Types were stale after a late migration edit; they're regenerated in the close-out PR, and the `db` job now fails on stale types.
  - **Done-when 5 ✓** spec-checker found no High, and M1–M6 are fixed. Checked at 390 / 820 / 1440 in light and dark. Not built on purpose: the 2-step states (D-007), invite-email copy (D-011), and the MLogin incident card / ack / Viewer / Done states (S02b, S07).
  - **Production setup** done by Tao after the merge: Google on, Email off, `before_user_created` hook on, allowlist row.
  - **Deferred:** a change and its audit row in one transaction → S09 (security-reviewer L1). Skeleton row geometry, a skip link and per-page loading labels → the pages that use them (spec-checker L2, L8, L9).

### S02a · Thin slice: probe → engine → DOWN / RECOVERED in Chat

- **Scope:** PRD §12 "days 1–3" slice cut to the smallest end-to-end path: one monitor, two Vercel locations (a DOWN needs both to fail until Bangkok joins in S03), Google Chat only. Tables `probe_locations`, `check_results` (monthly partitions), `site_status`, `incidents`, `incident_events`, `notifications` (one row per message: channel, thread key, status). Probes `probe-sin` / `probe-tyo` (region check via `VERCEL_REGION`, `DxT-Monitor/1.0` UA + WAF secret header). Engine cron: hard-fail DOWN via `evaluateRound` + recheck (`after`) + `confirmsDown`, recovery to OK, incident open / recover with events. Notifier: Google Chat card + text line for DOWN and RECOVERED in one thread per incident (`threadKey` = incident id). Healthchecks ping from each cron. A test target (`apps/test-target`, deployed separately) answering 200 / 500 / timeout on demand.
- **Already in place from the setup:** `evaluateRound` / `confirmsDown` / `faultyLocations` / `isRegionalProblem` / `decideVerification`, the lifecycle incl. D-003, `canResolve`, `autoResolves`, `clientUpdateRequired` and uptime in `@dxt/engine` (unit-tested, not yet wired), `runHttpCheck` + `classifyResponse` in `@dxt/probe`, `buildChatTextLine` in `@dxt/notifier`, authenticated cron / ingest / jobs route stubs (501), `vercel.json` crons and region pinning.
- **Out of scope (S02b):** email, retries and fallback, the 30 s delivery target, acknowledge, undo.
- **Boards:** ChatAlert (DOWN and RECOVERED rows) · **Tables:** probe_locations, check_results, site_status, incidents, incident_events, notifications
- **Depends on:** S01
- **Done when:**
  1. On staging (`dxt-monitor-staging`, slice branch pushed to `staging` — cron runs only there, D-006), switching the test target to 500 posts `DOWN · <site>` in the staging Chat space within **3 min** of the switch (timestamps in the PR).
  2. Switching back to 200 posts `RECOVERED · <site>` as a reply in the same thread.
  3. An integration test drives the engine with stored results: both locations fail on the first check and the recheck → one incident opened; only one location fails → no incident; a location that didn't recheck doesn't vote twice.
  4. Healthchecks shows pings from probe-sin, probe-tyo and the engine; the probe functions log `sin1` / `hnd1`.
  5. message-checker passes the DOWN and RECOVERED text lines and cards against ChatAlert.
  6. Actual time spent is recorded in the PR, for the re-baseline check in [Timeline](#timeline).
- **Review:** engine-reviewer, message-checker, security-reviewer (cron, RLS), db-reviewer (partitions).
- **Notes (evidence):** merged 6 Oct 2026 as PR #27 (`e812ef2`); production migration applied by `migrate-production` 13:23:54Z. Started 10:32Z; staging verified 12:15Z — time spent ≈ 1 h 45 min to a verified run, ≈ 2 h 15 min with review rounds (planned S, ≤ 2 days). Chat copy per D-013; owners' Chat ids per D-015; schema choices D-014.
  - **Done-when 1 ✓** Staging, 6 Oct: test target switched to `error` at 12:07:12Z (first 500 seen); the engine opened INC-0001 and sent DOWN at 12:09:39Z (Vercel log `engine … opened:1, delivery.sent:1`) — **2 min 27 s**. Round 12:07 was split (TYO passed before the switch); round 12:08 failed on both checks and both rechecks.
  - **Done-when 2 ✓** Switched to `ok` at 12:11:21Z; RECOVERED sent 12:13:39Z (`recovered:1, delivery.sent:1`), shown by Tao's Chat screenshot as a reply in the DOWN thread ("RECOVERED · Test target · down 3 min · add a root cause"); the next round settled the incident to Needs root cause (12:14:39Z, `settled:1`).
  - **Re-run after engine-reviewer round 2** (deploy `e1ea685`, after `reset-test-incident.sql`): switched to `error` 12:37:00Z → INC-0002 DOWN sent 12:38:39Z (**1 min 39 s**); back to `ok` 12:41:17Z → RECOVERED 12:43:39Z as a reply in the same thread, reading "down 4 min (19:37–19:42)" — now from the first failed check; settled 12:44:39Z (Tao's Chat screenshot, Vercel logs).
  - **Done-when 3 ✓** `pnpm --filter @dxt/web test:int` (`src/server/pipeline.int.test.ts`, 5 cases on the local stack, also in the CI `db` job): both fail on check + recheck → 1 incident, 1 DOWN, a second run adds nothing; one location fails → none; no recheck → no double vote; a newer incomplete round doesn't hide the complete one; recovery → Monitoring + RECOVERED in the same thread → Needs root cause. Engine rules: `packages/engine/src/monitor.test.ts` (incl. real staging cron offsets). pgTAP `probes.test.sql` (35).
  - **Done-when 4 ✓** Healthchecks project "DxT Monitor — staging" (separate from production): engine, probe-sin, probe-tyo, notifier all Up, last pings 11–54 s ago (checked by Claude in the browser, 12:17Z); all 4 still Up on the final deploy `e1ea685` (12:51Z). Vercel logs: `probe-sin … region:"sin1"`, `probe-tyo … region:"hnd1"` every minute.
  - **Done-when 5 ✓** message-checker: no open High; Mediums fixed (sub-minute duration floor, owner-without-Chat-id → D-015) — the live cards match ChatAlert minus the D-013 omissions.
  - **Done-when 6 ✓** ≈ 1 h 45 min of build to a verified staging run, against an S estimate — record for the Q7 re-baseline.
  - Known limits (by design, in later slices): a confirmed relapse while the incident is open is logged, not alerted, and after the second OK round the site shows OK — so no real site may be probed on production before S04b (D-004) is Done (see S05). On staging run `supabase/staging/reset-test-incident.sql` before repeating a DOWN test.
  - Engine-reviewer round 2 (fixed before the PR): rounds judged oldest first; OK = majority of reporting locations; the incident starts at the first failed check, even in a split round before (the staging run would now read 19:07:46); checks stamped with the probe run's start; monitor timeouts capped at 30 s (PRD §5) with probe `maxDuration` 90 s; RECOVERED only after a queued DOWN.

### S02b · Email, delivery guarantees, Ack + Undo

- **Scope:** FR-07 complete on the S02a path. Resend email threaded per incident (one subject, `In-Reply-To` / `References`, per-recipient footer). Delivery: the engine calls the notifier as soon as it enqueues (the cron is only the sweep) so alerts leave within 30 s (PRD §9); retry 30 s / 2 min / 8 min, then email fallback; delivery status per attempt. MobileAck (+ dark): the card link opens the incident on a signed-in phone, ack in one tap, Undo toast, `hold_until` 10 s before ACKNOWLEDGED goes to Chat and email. If this passes 4 days, split email + delivery from Ack + Undo.
- **Boards:** MobileAck, MobileAckDark, ChatAlert (ACKNOWLEDGED row), EmailAlert (Down, Acknowledged, Recovered) · **Test plan:** T08
- **Depends on:** S02a
- **Done when:**
  1. On staging (`dxt-monitor-staging`), the DOWN email arrives within **3 min** of the switch, and RECOVERED lands in the same email thread.
  2. `notifications.sent_at − incidents.detected_at` ≤ **30 s** for the DOWN alert (query output in the PR).
  3. With the Chat webhook pointed at a failing URL, attempts are recorded at +30 s, +2 min, +8 min and the email fallback is sent (test + `notifications` rows).
  4. From a phone, the card link opens the incident signed in; one tap acknowledges; ACKNOWLEDGED appears after 10 s under that person's name.
  5. **T08:** Ack → Undo within 10 s → no Chat post and no email (the rows end `cancelled`).
  6. message-checker passes the email events and the ACKNOWLEDGED row; spec-checker passes MobileAck and MobileAckDark.
- **Review:** message-checker, engine-reviewer, security-reviewer (ack action, RLS), db-reviewer (notifications), spec-checker (MobileAck, MobileAckDark).
- **Notes (evidence):** merged 6 Oct 2026 as PR #29 (`246ca6c`); production migration by `migrate-production` 17:22:45Z, and Vercel promoted the production deployment only after it (Deployment Checks — "Running Checks" until then; production logs: 0 errors). Started 14:03Z. Ack rights, fallback audience, copy cuts and the incident route per D-016; email threading per D-017.
  - Staging run 1 (deploy `3ab200c`, 6 Oct): test target → `error` 15:44:11Z; the probe-sin run whose recheck failed ran the engine itself and sent INC-0003 at once — DOWN email 15:46:17.26Z, Chat 15:46:17.81Z (**2 min 6 s** after the switch; Tao's inbox and Chat screenshots: subject `Test target · Tier 1 · INC-0003`, button "Open / acknowledge", footer ack sentence). Resend accepted the custom `Message-ID`.
  - **Done-when 2:** `sent_at − detected_at` for the DOWN = **0.9 s** (email) / **1.4 s** (Chat); `detected_at` = the confirming recheck 15:46:16Z (staging SQL, Tao).
  - Ack (desktop, Tao) 15:50:58Z → "Undo · N s" countdown → ACKNOWLEDGED posted to Chat + email 15:51:10–11Z (window 10 s + 2 s margin); the page then read "Posted to the Chat thread + email at 22:51:10" and the log "(posted 22:51:10)". ACKNOWLEDGED email: "Jirawat (Tao) Piyakit has Test target", footer "you acknowledged this incident".
  - Test target → `ok` 15:52:44Z; RECOVERED by the engine cron 15:54:39Z to Chat and email.
  - Staging run 2 (deploy `48a3256`): → `error` 16:12:15Z; DOWN INC-0004 to Chat + email at 16:14:17Z (**2 min 2 s**). **Done-when 4 (phone, Tao):** the card's "Open / acknowledge" on an iPhone opened sign-in, then straight back to INC-0004 signed in as the owner; one tap acknowledged ("Undo · 7 s").
  - **Done-when 5 / T08 on staging:** ack 16:15:11Z → Undo inside the window → both ACKNOWLEDGED rows `cancelled`, `attempts 0`, nothing sent; the page went back to Acknowledge and logged "Acknowledgement undone". Re-ack 16:15:24Z → ACKNOWLEDGED sent 16:15:37.9Z (Chat) / 16:15:38.3Z (email). RECOVERED 16:18:40Z (staging SQL, Claude).
  - Email threading: Resend/SES replace the Message-ID we set (Gmail "Show original" of INC-0003: `…@ap-northeast-1.amazonses.com`), and the send-only API key can't read it back — so emails now carry a stable incident id in `References` (+ `In-Reply-To` after a person's first), deploy `2170815`. The test inbox has Gmail "Conversation view off", which shows every email as its own row regardless.
  - **Done-when 4 ✓** The phone ack's ACKNOWLEDGED (INC-0004, re-ack after the Undo) went out 16:15:37.9Z (Chat) / 16:15:38.3Z (email) with `ackedBy` = the acker's own profile name (staging SQL, Claude) — 13 s after the ack.
  - **Done-when 6 ✓** message-checker and spec-checker, two rounds each: no High; every Medium fixed (round 2: copy after the retries end, D-017 for threading); Lows fixed or justified in the PR. Also `/code-review high` (8 fixed), engine-reviewer ×2, security-reviewer, db-reviewer.
  - Time spent: started 14:03Z, staging verified 16:46Z — ≈ 2 h 45 min with three review rounds (planned M, 3–4 days).
  - **Done-when 1 ✓** Staging run 3 (deploy `2170815`): → `error` 16:40:01Z; DOWN INC-0005 email 16:41Z; ack (Claude, browser) 16:43:14Z; → `ok` 16:43:47Z; RECOVERED 16:45:40Z. Gmail "Show original": DOWN `References: <inc-c5226de9…@notify.dxtspace.com>`, ACKNOWLEDGED / RECOVERED `In-Reply-To` + `References` the same id. With Conversation view on (Tao's screenshot) INC-0005 is **one conversation of 3** (DOWN → ACKNOWLEDGED → RECOVERED); INC-0003 (old design, references to an id SES replaced) split 2 + 1 — the bug the fix closed. Google's rule for notification threading: same subject and references that consistently refer to the same message id (Workspace Updates, Mar 2019).

### S03 · Bangkok probe & browser verifier

- **Scope:** FR-04 and the third location. VPS agent: Bangkok probe loop → `/api/ingest` (location fixed server-side), Healthchecks ping per loop. Blocked rounds → browser verifier: Playwright on the VPS, Job API with leases over pgmq, at most 3 sessions, Admin alert when > 5 jobs queue, screenshots to Supabase Storage deleted after 30 days, async evidence screenshot for hard-fail DOWN. D-001: verifier unavailable → PROBLEM (unverified) at once + Admin email. Test target gains a 403-challenge mode.
- **Test plan:** T03
- **Depends on:** S02b (the Admin email for D-001)
- **Done when:**
  1. The staging site shows three locations voting; stopping the VPS agent leaves two voting and no false DOWN.
  2. 403-challenge mode with the page loading → OK with the note "Automated check blocked by bot protection; verified via browser".
  3. **T03:** verifier stopped → a hard-fail site still goes DOWN on time; a blocked site shows PROBLEM (unverified) at once and the Admin is emailed.
  4. The Job API refuses a wrong token and an expired lease; Ingest refuses results > 5 min old (tests).
  5. A Storage lifecycle job removes screenshots older than 30 days (test or SQL check).
  6. The VPS has every variable name from `apps/vps-agent/.env.example` set in `/etc/dxt-agent/staging.env` and `/etc/dxt-agent/production.env`, one per agent instance (moved from S00 Done-when 3, D-010; two instances, D-019; names listed, values never shared).
- **Review:** security-reviewer (Job API, Storage, VPS unit), db-reviewer (pgmq queues, leases), engine-reviewer.
- **Carried from S02b review:** a round can be completed by Bangkok's result arriving through Ingest; Ingest must run the engine (`engineAndDeliver`) like a failing probe recheck does, or DOWN waits up to a minute for the engine cron (PRD §9: 30 s).
- **Notes (evidence):** merged 7 Oct 2026 as PR #35 (`3d76f4c`); production migrations by `migrate-production` 08:06:26Z, and the production deploy answers the new APIs (401 without a token). Started 03:15Z, staging verified 07:03Z — ≈ 4 h with five review rounds (planned L, 5 days). Queue, PROBLEM (unverified) without its Chat card until S04a, Admin alerts and the two agent instances per D-019; blocked in the browser too → PROBLEM per D-020; a PROBLEM that turns into an outage is raised to DOWN per D-021. Staging: migrations 0007-01/02/03 by `pnpm db:push:staging`; `dxt-agent@staging` on the VPS (VERIFIER_MAX_SESSIONS 1); Healthchecks `probe-bkk` + `browser-verifier` (staging project) both Up.
  - **Done-when 1 ✓** Staging SQL 05:55Z: BKK, SIN and TYO each report every round (Test target, attempt 1, all `pass`). Agent stopped 06:00:26Z → rounds 06:10–06:11 show SIN + TYO only, mode `ok`, no incident opened and the open PROBLEM (INC-0008) recovered to Monitoring; agent restarted 06:12:44Z → BKK back from round 06:13. Engine tests: `expects Bangkok only while its agent beats` (run-engine.test.ts), `a stopped Bangkok agent leaves two voting` (monitor.test.ts), `a DOWN two locations confirmed is judged without waiting for a beating Bangkok`.
  - **Done-when 2 ✓** Test target `challenge` 05:56:30Z → verify job for round 05:57 `done / loaded / HTTP 200`, screenshot `2026-10/048a6c82….jpg` stored, 5.6 s from job to verdict; `site_status` = `ok` with note "Automated check blocked by bot protection; verified via browser". Again after the blocked-check trigger (deploy `782a182`): job created 1.0 s after the round's last check, verdict 4 s later. Local run with real Chromium: same result + screenshot viewed.
  - **Done-when 3 ✓ (T03)** Verifier (agent) stopped 06:00:26Z, Test target `error` 06:00:32Z → the open PROBLEM INC-0006 raised to DOWN (D-021) and DOWN sent 06:02:17.5Z email / 06:02:18.1Z Chat — **1 min 45 s** after the switch, 1.2 s / 1.8 s after the confirm. Blocked with the verifier stopped: INC-0008 `blocked_unverified / problem`, note "Blocked, not verified", no 10-min grace; the Admin "verifier unavailable" email (reason `not_picked_up`, site Test target) sent 06:02:17.9Z, one per outage; the alert cleared by itself 06:12:48Z when the verifier came back. D-020: `challenge-all` → INC-0006 `blocked_unverified / problem`, 0 messages, no Admin alert. Int tests: `verifier stopped: two blocked sites → PROBLEM (unverified) at once and one email per Admin`.
  - **Done-when 4 ✓** Route tests `refuses a wrong token`, `refuses a verdict after the lease ran out with 409` (api/jobs/route.test.ts), `refuses a batch with a result more than 5 min old / ahead` (api/ingest/route.test.ts); pgTAP `a result after the lease ran out is refused` (verifier.test.sql); int test `a verdict after the lease ran out is refused` (pipeline.int.test.ts). Staging: a wrong token got 401 from both APIs (seen while the env was being set).
  - **Done-when 5 ✓** `housekeeping.int.test.ts` on real local Storage: a screenshot back-dated 31 days is removed, a new one kept; unit tests in housekeeping.test.ts; daily cron `/api/cron/housekeeping` 20:30Z in vercel.json.
  - **Done-when 6 ✓** `sed 's/=.*//'` on `/etc/dxt-agent/staging.env` and `/etc/dxt-agent/production.env` lists every name in `apps/vps-agent/.env.example` (secret values written by Tao, never shared; both root:root 0600). The production token answers 200 on `monitor.dxtspace.com` and differs from staging's. `dxt-agent@production` (3 sessions) runs beside `dxt-agent@staging` since 08:14Z; production Healthchecks `probe-bkk` + `browser-verifier` Up (verifier: email only, as the Probes board says). Production has no monitor yet (sites wait for S04), so its rounds check nothing until S05. **S03 Done.**
  - `/verify` (Tao, 7 Oct 06:46–07:03Z, PASS): three locations voting; `challenge` → `loaded`, `ok` + note; clean T03 path with the verifier stopped and no open incident: `error` 06:59:12Z → INC-0010 `hard_fail` DOWN, email 07:01:18.4Z / Chat 07:01:18.8Z (**2 min 6 s**, 1.9 s / 2.3 s after the confirm); API probes: no / wrong token 401, stale result 422, empty batch 400, unknown job 409. Finding carried to S07 (evidence screenshot after a verifier outage).
  - Reviews: security-reviewer (2 Medium + 4 Low fixed), db-reviewer (1 Medium + Lows fixed), engine-reviewer ×2 (H1, H2, N1 fixed; M2–M4, N2–N4 fixed; M1 carried to S04), a general code review by an agent (5 Medium + 5 Low fixed) and `/code-review high` (6 fixed, no High). Re-checked on staging after the last fixes (agent build `b1c9c25`): `challenge` → verify job `loaded` at 06:33:54Z. Found on staging and fixed: zod left external in the agent bundle, Node's dual-stack race timing out Healthchecks pings (no IPv6 route on the VPS), staging needing a redeploy after its env changed, blocked checks waiting for the engine cron.

### S04a · PROBLEM triggers & status rules

- **Scope:** FR-03 complete except relapse and flapping (split from S04 on 7 Oct 2026; rules per D-022).
  - **PROBLEM triggers:**
    - slow: p50 over the tier threshold for 3 rounds;
    - keyword: a must-contain missing or a must-not-contain found;
    - key page: a 4xx / 5xx, or any other problem on a non-primary monitor;
    - regional: one location failing for ≥ 5 min;
    - redirect: a final host outside the allowlist.
  - **Probes:** every monitor of a site is probed, not only the primary. The probe records the final URL and the keyword result, and the VPS agent ships the same fields.
  - **Status rules:** each monitor gets a verdict every round. Only the primary monitor can make a site DOWN. Site status = the worst verdict, and while an open incident hasn't recovered it never drops below that incident's severity. The per-monitor state that carries between rounds lives in `monitor_status`. This also fixes S03 engine M1.
  - **Wired into the engine cron:** the faulty-location exclusion (`faultyLocations`, spec §15.3) and the regional PROBLEM (`isRegionalProblem`), with integration tests.
  - **Admin alert:** fewer than 2 locations beating → one Admin email (system alert `probe_locations_low`).
  - **Messages:**
    - the ChatAlert PROBLEM rows and their email: PROBLEM, PROBLEM (unverified) (the D-019 card), and ACKNOWLEDGED / RECOVERED for a PROBLEM;
    - a PROBLEM is sent at any hour until S08 adds response hours (D-022);
    - the 60-min PROBLEM reminder belongs to S08.
  - **Test target:** gains `keyword-missing` and `slow` modes.
- **Boards:** StatusModel, ChatAlert (PROBLEM rows) · **Tables:** monitor_status · **Test plan:** T01 (the expiring-cert path finishes in S13)
- **Carried from S03 review (engine M1):** a blocked round the verifier can't decide, while the site's incident is already open (e.g. in Monitoring / Needs root cause, site OK), records the round and the note "Blocked, not verified" but leaves `site_status` OK. S04a's status rules must show it as PROBLEM (D-001) and clear it on the next OK round. Moving the incident back to Unacked / Acknowledged is the relapse in S04b.
- **Depends on:** S03
- **Done when:**
  1. **T01:** on staging, each test-target mode gives the StatusModel outcome:
     - 200 → OK;
     - 500 / timeout → DOWN;
     - 403-challenge + the page loads → OK with the note;
     - keyword missing → PROBLEM (Keyword);
     - slow for 3 rounds → PROBLEM (Slow).
  2. A key-page monitor returning 500 while the home page is fine gives PROBLEM, never DOWN (test).
  3. message-checker passes the PROBLEM rows: PROBLEM, PROBLEM (unverified), and ACKNOWLEDGED / RECOVERED for a PROBLEM.
  4. M1: a blocked round the verifier can't decide while the incident is open shows the site as PROBLEM, and the next OK round clears it (engine + integration tests).
  5. Fewer than 2 locations beating → one Admin email; it clears when they come back (test).
- **Review:** engine-reviewer, message-checker, security-reviewer (migration, probe / ingest fields), db-reviewer (`monitor_status`, `check_results` columns).
- **Notes (evidence):** merged 7 Oct 2026 as PR #39 (`77f2547`); `migrate-production` applied `problem_triggers`, the production deploy is Ready (`/login` 200) and `dxt-agent@production` runs the new build (keyword result + final URL from Bangkok). `/verify` (Tao) PASS; its two copy findings fixed before the merge. **S04a Done.** Started 7 Oct 2026 ~09:00Z; staging verified 11:43Z — ≈ 3 h with three review rounds (planned L). Split from S04 and engine rules per D-022; PROBLEM copy from the ChatAlert / EmailAlert rows and spec §19 design added the same day. Staging: migration `problem_triggers` by `pnpm db:push:staging` (before the code, as its header says); `dxt-agent@staging` redeployed (keyword result + final URL from Bangkok too); test-target modes `keyword-missing` / `slow`; the staging monitor's `must_contain = {Test target}`; `reset-test-incident.sql` between modes (relapse is S04b).
  - **Done-when 1 (T01) ✓** staging, 7 Oct (UTC):
    - `keyword-missing` 11:19:01 → INC-0011 PROBLEM `keyword` detected 11:20:01.5; email 11:20:02.2, Chat 11:20:02.9; cause "Missing “Test target” on / (BKK, SIN, TYO)" (all three locations, Bangkok included). → `ok` 11:23:35 → RECOVERED email 11:25:02.8 / Chat 11:25:03.2, incident Monitoring.
    - `slow` 11:26:39 → rounds 11:27 / 11:28 / 11:29 p50 ≈ 6.1 s → INC-0012 PROBLEM `slow` detected 11:30:07.5 (`monitor_status.slow_rounds` 3); email 11:30:08.2, Chat 11:30:08.8; cause "p50 6.1 s (BKK, SIN, TYO) · over the Tier 1 limit of 3 s for 3 checks in a row". → `ok` → RECOVERED 11:32:02.
    - `challenge` 11:33:13 → verify job round 11:34 `done / loaded / HTTP 200`, screenshot stored; site `ok` with note "Automated check blocked by bot protection; verified via browser".
    - `error` 11:35:23 → INC-0013 DOWN `hard_fail`, email 11:36:22.5 / Chat 11:36:23.0 (the 11:35 round straddled the switch, part challenged, so the browser decided: "Browser: page didn’t load (HTTP 500)"). → `ok` → RECOVERED 11:39:02, Needs root cause.
    - `timeout` 11:41:22 → INC-0014 DOWN, confirmed 11:41:32.3, email 11:41:44.1 / Chat 11:41:44.9, cause "Timeout > 10 s (BKK, TYO)".
    - `ok` before and between modes → OK.
  - **Done-when 2 ✓** `site.test.ts` "a key page returning 500 while the home page is fine → PROBLEM (Key page), never DOWN"; `run-engine.test.ts` same case; int test `a key page returning 500 while the home page is fine → PROBLEM, never DOWN; it recovers with RECOVERED` (`pnpm --filter @dxt/web test:int`).
  - **Done-when 3 ✓** message-checker: no High; Mediums fixed (Cause row on a PROBLEM's ACKNOWLEDGED email; Admin email site lines with tier) or justified in the PR (incident number / start in the verifier email's site lines); Lows fixed (what to check names the missing locations) or justified. Builders tested in `problem-alerts.test.ts`, `problem-cause.test.ts`, `email-alerts.test.ts`, `render.test.ts`.
  - **Done-when 4 ✓** `site.test.ts` "M1: blocked and unverified while the incident is in Monitoring → PROBLEM shown" / "M1: the next OK round shows OK again"; int test `M1: unverified while the incident is in Needs root cause shows PROBLEM; the next OK round shows OK (S04a)`.
  - **Done-when 5 ✓** `run-engine.test.ts` "fewer than 2 locations beating → one Admin alert; it clears 10 min later once 2 beat again"; int test `fewer than 2 probe locations beating → one Admin email, cleared once 2 beat again (D-022)`.
  - Reviews: `/code-review high` (5: 4 fixed, deploy order documented), engine-reviewer ×2 (H1 faulty location making a round ready too early — fixed; M1–M2, L1–L3 fixed; round 2: 3 Medium + 3 Low fixed), security-reviewer (M1 cause length could stop the whole engine run — fixed with caps and per-site isolation; L1 redirect host markup — fixed), db-reviewer (no High; paging dedupe, `<=` guard, keyword bounds, Map grouping, pgTAP fixed; 200-monitor URL length → follow-up), message-checker (above).

### S04b · Relapse, flapping & auto-resolve

- **Scope:** D-004 complete.
  - **Relapse:** a new DOWN / PROBLEM on an open incident that has recovered (Monitoring / Needs root cause) joins it. The incident goes back to Acknowledged if it was acked, otherwise to Unacked / Escalated. Severity only goes up, and the "down again" / "PROBLEM again" reply goes in the same thread. All of this happens in one state-guarded SQL function (`engine_relapse_incident`), with a dedupe key on `notifications` so a template can repeat (D-014).
  - **Flapping:**
    - the 3rd status change within 30 min tags `is_flapping`;
    - the incident still moves through its states as normal, but RECOVERED replies are held;
    - after 15 min of continuous OK, one summary goes out (Tao, 7 Oct 2026; D-022).
  - **Auto-resolve:** a PROBLEM that recovers within 5 min and was never acknowledged auto-resolves (`autoResolves`, spec §16.1).
  - **D-003 lifecycle:** checked end to end.
  - **D-023:** a DOWN incident recovers when the primary monitor is OK; a key page still failing rejoins the same incident as a PROBLEM relapse.
  - **Carried from S04a review:**
    - **VPS agent release per instance:** `dxt-agent@staging` and `dxt-agent@production` run from one build in `/opt/dxt-agent`, so a staging release changes what production runs after its next restart. Give each instance its own release folder (`/opt/dxt-agent/<instance>/`, shared browsers), update the systemd template, `apps/vps-agent/deploy/install.md`, the runbook and the `verifier-staging` skill; moving the VPS to the new layout is OK'd by Tao (7 Oct 2026).
    - **Engine loads by RPC (db-reviewer M2):** `run-engine.ts` / `verifier-state.ts` pass every monitor id in a GET query string (`in (…)`), near the gateway's 8 KB limit at the PRD's 200 monitors. Load checks, `monitor_status` and verify jobs through service-role RPCs with keyset paging, before S05 adds real sites.
  - **Messages:** the "down again", "PROBLEM again" and flapping summary rows.
- **Boards:** ChatAlert (relapse, flapping rows) · **Test plan:** —
- **Carried from S02b review:** engine runs overlap (the probe trigger and the cron). Relapse handling must be one state-guarded SQL function, or a relapse alerts once per run.
- **Depends on:** S04a
- **Done when:**
  1. Engine tests cover D-003, and D-004 with the VOCA sample: flapped ×4 → one incident, 41 min down, one ack.
  2. A relapse while the incident is in Monitoring sends one "down again" reply in the same thread, even when two engine runs overlap (integration test).
  3. While a site is flapping, no RECOVERED goes out until it has been OK for 15 min continuously, then one summary (integration test).
  4. A PROBLEM that recovers in under 5 min with no ack is auto-resolved (test).
  5. message-checker passes the relapse and flapping rows.
- **Review:** engine-reviewer, message-checker, db-reviewer (notifications dedupe).
- **Notes (evidence):** merged 7 Oct 2026 as PR #41 (`86cd0e4`); `migrate-production` applied `relapse_and_flapping`, the production deploy is Ready (`/login` 200) and `dxt-agent@production` runs its own release (`release.sh production`, first probe round 15:41:01Z; previous release kept for rollback). `/verify` (Tao) PASS. **S04b Done.** Started 7 Oct 2026 ~13:00Z; staging verified 15:12Z — ≈ 2.5 h with two review rounds (planned L). Rules per D-024; spec §19.4 / §19.6 / §19.7 and the ChatAlert / EmailAlert / PostIncident rows design added the same day (same-round D-023, auto-resolve counted from when the PROBLEM was flagged). Staging: migration `relapse_and_flapping` by `pnpm db:push:staging` before the code; `release.sh staging` (the VPS moved to one release folder per instance, OK'd by Tao; production restarted onto its own folder with the same build).
  - **Done-when 1 ✓** `relapse.test.ts` "INC-0133 VOCA end to end": one `open`, DOWN AGAIN at 03:24 (now flapping), 03:38, 03:55; held summaries; 4 drops; 41 min; one ack. D-003 in "D-003: a PROBLEM passes through Monitoring and Needs root cause…". `pnpm --filter @dxt/engine test` (181).
  - **Done-when 2 ✓** int test "a relapse in Monitoring sends one DOWN AGAIN in the same thread, even when two runs overlap"; pgTAP `relapse_and_flapping.test.sql` (second call false, one reply). Staging INC-0017: `down_again` Chat at 14:44:34 and 14:49:34 in the same Chat thread (`spaces/…/messages/OqryyVIBqL4.*`); card "DOWN AGAIN · Test target · was back for 2 min (21:42–21:44)" read in the Chat space.
  - **Done-when 3 ✓** int test "while flapping no RECOVERED goes; one summary is held 15 min and a new drop cancels it" (delivery included). Staging INC-0017: the recovery at 14:47 held a summary until 15:02, cancelled at the drop at 14:49 ("Superseded: down again"); the recovery at 14:51 → one summary at 15:06:21 (Chat "RECOVERED · Test target · stable 15 min · flapped ×3, down 8 min in total · add a root cause", email in the thread).
  - **Done-when 4 ✓** `relapse.test.ts` auto-resolve rows (4:59 → Resolved, 5:00 → Monitoring, acked / DOWN never); int test "a PROBLEM that recovers in under 5 min with no ack is auto-resolved"; staging INC-0018 keyword → `resolved`, `auto_resolved`, RECOVERED with no mention "resolved automatically" (Chat + email).
  - **Done-when 5 ✓** message-checker: every row word for word against the boards; Mediums fixed (partial recovery while flapping never holds RECOVERED; AGAIN fallback email reaches the person it mentions, D-024); Lows fixed or carried to S08 / S10.
  - Reviews: `/code-review high` (6: 5 fixed, 1 altitude fixed later with one `notified` count), engine-reviewer ×2 (H1 home page down again during a D-023 PROBLEM → DOWN AGAIN; M1 drops; L-items fixed or carried to S07 / S08), db-reviewer ×2 (H1 `engine_checks` generic-plan seq scan → plpgsql `execute`; M2–M4, L5–L6 fixed; L8 justified), security-reviewer (no High / Medium; Low staging folder → `mktemp`). `/verify` (Tao) PASS.

### S05 · Sites & monitors

- **Scope:** FR-01. `/sites` list, Add site with the registration checklist, Edit monitors (URL, method, expected status, timeout, keywords, headers, thresholds, primary, key pages, redirect allowlist). An owner must have signed in once and have a notification channel (PRD §3). Monitor URLs rejected when they resolve to private, link-local or metadata addresses (the probe enforces the same on every hop since S02a). Real sites are entered on production only once S04b is Done — before that a relapse during an open incident isn't alerted (D-004, S02a engine review). Every change writes `audit_log` with before / after. Production clients and AMs load from a reviewed SQL script (UI in S17).
- **Boards:** AddSite, EditMonitors · route `/sites`
- **Depends on:** S01 (S02a for probes to pick the monitors up)
- **Done when:**
  1. All 17 sites and their primary monitors are entered through the UI on production with owner, backup, client and hosting (PRD §12 MVP exit: "ข้อมูล 17 เว็บครบ 100%").
  2. `http://169.254.169.254/`, `http://10.0.0.5/` and a hostname resolving to `127.0.0.1` are rejected (tests).
  3. Create / update / delete of a site or monitor each leave one `audit_log` row with before / after (test).
  4. spec-checker passes AddSite and EditMonitors; nav "Sites" is live.
  5. A site can't be saved with an owner or backup who has no Google Chat user id; the form names them (D-015, test).
- **Review:** spec-checker, security-reviewer (SSRF, RLS), db-reviewer (audit trigger).
- **Notes (evidence):** In review — Done-when 2–5 verified; Done-when 1 is production data entry after the merge (close-out PR). Built 8 Oct 2026 in one day with two review rounds (planned L). Staging: migration `sites_registration` by `pnpm db:push:staging`, `release.sh staging` (the Bangkok probe sends custom headers).
  - **Done-when 1 — after merge:** owners sign in → `supabase/access/clients.template.sql` and `chat-ids.template.sql` (reviewed, run by Claude with Tao's OK) → the 17 sites entered as Drafts through Add site → Tao starts each → close-out PR with the production SQL count (17 active, both owners linked, client, hosting) and the `site.create` audit rows.
  - **Done-when 2 ✓** `mutations.test.ts` "refuses http://169.254.169.254/ / http://10.0.0.5/ / a host resolving to 127.0.0.1" (injected DNS, nothing saved), `test-check.test.ts`, probe `target.test.ts`; staging `/verify`: both addresses refused "This address points inside a private network — monitors check public sites only".
  - **Done-when 3 ✓** pgTAP `sites_registration.test.sql` (41: one row per create / update / delete of a site and a monitor, before / after, actor, no-op skipped, script actor null); e2e `sites.spec.ts` audit sequence; staging `audit_log` after `/verify`: site.create, monitor.create ×2, monitor.delete ×2, site.delete — all by Tao.
  - **Done-when 4 ✓** spec-checker AddSite + EditMonitors, two rounds each (High: a key page's Test check said DOWN → PROBLEM; Mediums fixed in 784a425 / 41c83da; `/verify` focus-after-Undo fixed in 04caa21 and re-checked on staging). Nav "Sites" live; `layout-consistency` passes and now also covers the Sites detail pages.
  - **Done-when 5 ✓** (as D-025 reads it) pgTAP "Owners need a Google Chat id: Nok", empty-owner Draft saves, Start refused without two linked owners; `site-form.test.tsx` "Arm · no Chat id" disabled and "Arm has no Google Chat id — ask an Admin to add it"; staging Edit site on Test target names "Jirawat (Tao) Piyakit has no Google Chat id".
  - Reviews: `/code-review high` (10 fixed), security-reviewer (no High; M1 browser verifier headers → removed; Lows fixed incl. a table trigger for header names; re-review clean), db-reviewer (M1 open-incident monitors kept; M2 justified — credential-like header names are refused, so the audit log holds none), spec-checker ×2 rounds. `/verify` (Tao): one FAIL (focus after Undo) → fixed, re-checked.
- **Notes:** started 8 Oct 2026; rules per D-025 (Drafts may leave owners empty, Start needs two linked owners — Done-when 5 reads so). Grew M → L at planning (Test check routes, custom headers through the probes and verifier, Draft / Start / Stop); it finished in one day, so nothing split off (S05b now names the WAF slice).

### S05b · Sites behind a WAF: trusted location + control check

- **Scope:** D-027. A site marked "Behind WAF" whose WAF blocks some probe locations (Bangkok Airways TW / CN: Akamai answers SIN and TYO with 403, the browser verifier too, while the Bangkok probe gets 200) is judged on the locations that are not blocked. A location counts as WAF-blocked only on a header-level WAF signature (Akamai: a 403 with `Server: AkamaiGHost`, "Access Denied" and "Reference #" together, Cloudflare `cf-mitigated`, Sucuri); a body-only match stays an ordinary blocked result. The VPS checks two control URLs from different providers each round; only when both fail is the Bangkok result "no data" for WAF sites (PROBLEM unverified, never DOWN). All locations blocked → the browser verifier as before (spec §6); through the WAF a 5xx or timeout in the browser is DOWN. Non-WAF sites are unchanged.
- **Boards:** — (StatusModel rules; the site note "Verified from BKK; SIN, TYO blocked by bot protection") · **Tables:** — (columns on `check_results`)
- **Depends on:** S05 (merged; its Done-when 1 is production data entry, not code — Tao, 8 Oct 2026)
- **Done when:**
  1. Engine table tests: (a) WAF site, BKK 5xx ×2 (with recheck), SIN/TYO Akamai 403 → DOWN; (b) VPS control both fail + BKK fail → PROBLEM (unverified), not DOWN; (c) every location blocked → verifier decides, browser blocked → PROBLEM (unverified); (d) verifier through the WAF gets 5xx / timeout → DOWN; (e) BKK pass + SIN/TYO Akamai 403 → OK with the note; (f) the same results on a site not behind a WAF → today's rule.
  2. Probe classifier tests: Akamai 403 with `Server: AkamaiGHost` and "Reference #" → blocked with the WAF signature; a 403 without it keeps D-022 behaviour.
  3. The VPS agent reports the two control results with each batch; one control down is not a control failure (test).
  4. On production Bangkok Airways TW and CN show OK with the note while SIN / TYO stay blocked (SQL: site_status, check_results), and staging `challenge` mode still goes through the verifier on a non-WAF site.
- **Review:** engine-reviewer, security-reviewer (agent → Ingest payload), db-reviewer (check_results columns).
- **Notes (evidence):** Done — merged in #48 (8 Oct 2026). Grew in review: D-027 rules 2b–2d (Akamai control, DOWN starts at proof, "Confirmed by" names who confirmed it) and D-028 (Admin alert when the BKK network check fails). Reviews: `/code-review high` (8 fixed), engine-reviewer ×3, db-reviewer ×2, message-checker ×2, security (none).
  - **Done-when 1 ✓** `packages/engine/src/waf.test.ts` "D-027 — sites behind a WAF" (a)–(f) plus "D-027 invariants over every combination"; engine 234 tests, coverage 98.8 / 93.6.
  - **Done-when 2 ✓** `packages/probe/src/classify.test.ts` "wafSignature (D-027)" with the real Akamai page; a plain 403 keeps D-022; an Akamai 5xx origin-error page stays a fail.
  - **Done-when 3 ✓** `apps/vps-agent/src/probe-loop.test.ts` "runProbeRound — control check (D-027)"; `dxt-agent@production` journal `{"event":"probe_round","checked":20,…,"controlOk":true}` (08:58 UTC); production `check_results` BKK rows `control_ok = true, akamai_ok = true`.
  - **Done-when 4 ✓** Production (08:55 UTC): `site_status` Bangkok Airways – Taiwan and – China `ok`, note "Verified from BKK; SIN, TYO blocked by bot protection"; `check_results` SIN / TYO `blocked 403, waf = akamai`, BKK `pass 200`; INC-0001 / INC-0002 (PROBLEM unverified) recovered 08:52:01. Staging `/verify` (Tao, PASS): flag off + `challenge` → verify jobs `loaded`, OK with the browser note; `waf-partial` / `waf-partial-down` / `challenge-all` as the `verifier-staging` table says.
  - Seen at the deploy (not S05b): SIN / TYO wrote no results 08:48–08:50 UTC while the new production deployment waited for `migrate-production`, so `probe_locations_low` opened 08:51 and cleared 09:01 (one Admin email).

### S05c · Sites list (board)

- **Scope:** Spec §20, boards Sites and MSites: the `/sites` management list rebuilt from the boards (it was built in S05 without one) — status (badge + Muted overlay + open incident link), site (name, client · AM, URL), tier, owner · backup, locations (latest round glyphs), checked, Visit site, ⋯ menu, search, status chips, Tier / Owner / Client filters, "Needs attention", sorts, drafts last with "Finish setup", empty state, mobile grouped by status. Columns that need later data show "—" until their slice: Response 24h and Uptime 30d (S06 rollups), Expiry (S13); Mute / Schedule maintenance in the ⋯ menu are disabled with the reason until S09.
- **Boards:** Sites, MSites
- **Depends on:** S05 (merged — its close-out waits only on owners signing in, as for S05b)
- **Done when:**
  1. spec-checker passes Sites and MSites at 390 / 820 / 1440, light and dark.
  2. Filters, chips, "Needs attention" and the three sorts behave as spec §20 (component tests); drafts sort last and count in "N sites" but not "monitored".
  3. `layout-consistency` passes with the new list.
- **Review:** spec-checker.
- **Notes (evidence):** Done — merged in #53 after the migration-first #52 (8 Oct 2026). Production (8 Oct, 14:18 UTC, Tao's session): `/sites` shows "17 sites · 11 monitored · 6 drafts", the table fits (1270/1270), Cando Asia Problem with "INC-0003 · 3 h 17 min unacked" and three TLS chain glyphs (D-029), Bangkok Airways TW / CN with BKK pass and SIN / TYO blocked. On merge the `db` job first failed on the runner ("port 54322 already in use", a leftover container) and passed on a re-run. Reviews: `/code-review high` (9: 8 fixed, "N min unacked" doesn't tick until S06 Realtime), spec-checker Sites and MSites ×2 (no High / Medium left), db-reviewer (no High / Medium; Lows fixed), security-reviewer (pass), slice-verifier. Changes from the boards Tao decided: D-030; the Sites list glyphs: D-029.
  - **Done-when 1 ✓** spec-checker re-checks: Sites "All four High/Medium items are fixed, nothing new at High or Medium"; MSites "fixed every requested item, no new High or Medium". Screens: local Playwright 390 / 820 / 1440 light + dark; staging (8 Oct, browser pane) 1440 / 1360 / 820 dark, a 383 px phone in dark, `/verify` drives (filters, search, sorts, Test target error → Down + INC link + red glyphs, keyword-missing → Problem, phone chips, the menu drawer closing on a tap).
  - **Done-when 2 ✓** `apps/web/src/features/sites/components/site-list.test.ts` (filters, Needs attention, the four sorts with drafts last, counts, `listMeta` "9 sites · 8 monitored · 1 draft") and `sites-list.test.tsx` (chips, Clear keeps the sort, no-match, Admin / non-Admin rows, phone groups / All / Mine / Clear); `pnpm check` green.
  - **Done-when 3 ✓** `E2E_LOCAL_SUPABASE=1 pnpm --filter @dxt/web exec playwright test e2e/layout-consistency.spec.ts` passed; it now also fails a box inside the page that scrolls sideways (caught a 956/770 table in a trial).

### S06 · Site detail & check rollups

- **Scope:** FR-08 and the data the Overview needs. Split from the old S06 (Overview + Site detail) on 9 Oct 2026, Site detail first so every Overview link has its target (D-031). `check_rollups` hourly and daily per monitor and per location via pg_cron (hour rows 90 days, day rows 2 years; no uptime column — uptime is DOWN minutes from incidents, spec §5), next to the existing monthly partition job (create ahead, drop raw > 90 days, built in S02a). Site detail (`/sites/[siteId]`): status and since, info strip, availability for 24 h / 7 d / 30 d / 90 d (uptime, p50, p95, incidents), response time per location, latest round, monitors, incident history (90 days), check log with today's CSV. The Sites list rows open it for every role and its Response 24h / Uptime 30d columns get values. Mute / Schedule maintenance stay disabled with the reason until S09; the phone back arrow comes with S07 and BottomNav with S06b (D-018 as amended by D-031).
- **Boards:** SiteDetail, MSite · **Tables:** check_rollups
- **Depends on:** S02a, S05 (merged — its close-out waits only on owners signing in, as for S05b / S05c)
- **Done when:**
  1. pg_cron jobs exist for hourly / daily rollups, next-month partitions and dropping raw partitions > 90 days (SQL test).
  2. Site detail uptime for the sample equals `siteUptime` (MuvMi 30 d = 99.77%).
  3. spec-checker passes SiteDetail and MSite at 390 / 820 / 1440, light and dark; Sites list rows open Site detail for every role and show Response 24h and Uptime 30d.
- **Review:** spec-checker, db-reviewer, security-reviewer (rollup grants, the read function).
- **Notes (evidence):** Done — merged in #56 after the migration-first #55 (9 Oct 2026); `migrate-production` passed. Production (9 Oct, Tao’s session): `/sites` phone rows read "Tier 1 · 100.00% · 30 d" and open Site detail; Cando Asia Site detail shows Problem since yesterday 18:00, uptime 100.00% (a PROBLEM is not downtime, spec §5), the open INC-0003 under Incidents in range, Latest round Vote 0/3 pass with TLS chain error at BKK / SIN / TYO and the next round time. The close-out PR also fixes two layout points Tao found on the merged page: the phone Incidents in range hover now reaches the card edges, and the Incident history and Check log footers sit on one line at 1440. Built 9 Oct 2026 in one day (planned L after the split, D-031).
  - **Done-when 1 ✓** pgTAP `supabase/tests/check_rollups.test.sql` (28): the three pg_cron jobs and their schedules (`check-rollups-hourly` `5 * * * *`, `check-rollups-daily` `20 17 * * *`, `check-results-partitions` `17 19 * * *`), next month's partition, an old partition dropped; rollup counts (TLS chain not a hard fail), Bangkok-midnight days, retention, catch-up after missed runs, staff / client / anon access, the bounded read functions. `pnpm db:test` 366 PASS. Applied on staging with `pnpm db:push:staging`. Local load (90 days, 3,344,673 rows, 1,040 MB): day rollup 267 ms, hour 40 ms, `site_list_response_24h` 24 ms, `site_response_series` 15m 8 ms.
  - **Done-when 2 ✓** `apps/web/src/features/sites/detail.int.test.ts` "MuvMi 30 d = 99.77% = siteUptime over the same 101 DOWN minutes" (`loadSiteDetail` on the local stack; `test:int` 27/27); engine `uptime.test.ts` (downMinutesIn, siteUptimeOver, D-021 escalations, VOCA 41 min, a resolved incident without a recovered row).
  - **Done-when 3 ✓** spec-checker SiteDetail and MSite ×3 rounds (round 3: no High / Medium on either); `sites-list.test.tsx` "every role opens a live row on Site detail"; `queries.test.ts` Response 24h / Uptime 30d. `/verify` (Tao, staging, 9 Oct): first FAIL — cards past a 375 px phone (a long cause grew the grid), INC links with the browser's focus ring — fixed (5d6d7dc) and re-checked: 375 light / dark, 820 light / dark, 1440 light / dark; range switch instant with `aria-busy`, 442 ms; today's CSV 4,403 rows = "4,403 checks today"; 404 on a bad id; Site not found; `/sites` row 383 ms · 98.19% opens Site detail; Tab focus and hover on the range control, Export, Download, incident links. `layout-consistency` now also fails boxes past the screen edge (proved against the bug). Staging's generated data deleted afterwards.
  - Reviews: `/code-review high` (8, fixed), db-reviewer (no High; M1–M3 fixed), security-reviewer (H1 load-script guard fixed), engine-reviewer ×2 (no High; fixed; three items carried to S07), message-checker (flap summary — messages keep the S04b drop view, carried to S07), slice-verifier. Lows fixed: the tab title carries the site name, the phone header skeleton matches the page.
- **Carried → built 14 Oct 2026 (`fix/S06-site-detail-menu`):** Site detail's ⋯ menu with Edit site (Admin) and Visit site (everyone), spec §25, boards SiteDetail / MSite drawn from brief `docs/design/briefs/site-detail-edit-menu.md`. Built before G1 rather than after: UI only, and the G1 items left wait on people. On phones ⋯ sits beside the title with Visit site only (D-043).
- **Dropped 14 Oct 2026 (D-044):** the §22.5 view-only follow-up for Add site, Edit site and Edit monitors. The site editors stay editable on phones, and the phone ⋯ offers Edit site.
- **Carried → built 14 Oct 2026 (D-045, before G1):** the phone top bar follows spec §22.1 — back arrow off the tabs, the page title, the page's own phone buttons (Site detail's ⋯), the avatar — from the `@bar` slot; page headers drop what the bar repeats below lg.

### S06b · Overview (option A)

- **Scope:** FR-05, spec §21. Overview (`/`): incident banners (unacked DOWN, at most 2 + "and N more"), KPIs (Sites OK, Open incidents, MTTA / MTTD once 3 DOWN incidents in 30 days, Uptime 30d), Live issues (one reason, Since, Next step, ownership chips), All sites tiles (AURA 5.34 StatusTile / TileGrid) with the Tier filter, Response 24h sparkline (AURA Sparkline, 15-min p50), Recent events; dark NOC board; phone Overview (banners, Open / Unacked / third card by role, Live issues, "All N sites" row). Acknowledge with the 10 s undo from the banner and Live issues; AM / CEO / Viewer see "Open INC-…" (D-016, D-031). Realtime: `site_status` and `incidents` changes refresh the page (`monitor_status` left out, D-032). Phone shell (D-018): AURA `BottomNav` with the four sections of the phone boards (Overview, Incidents, Sites, On-call; the live ones only) below lg, phones and tablets; the menu drawer stays for the other pages. Not in S06b (§21.9): the On-call card, the Maintenance & mutes card and header button, the phone guide icon. Until their slices: no escalation line on banners (S08 / S10), "Add root cause" reads "Open INC-…" (S07), the Undo line has no "webhooks" (S24).
- **Boards:** Main3, MainDark3, MOverview4 (Main, MainDark, MOverview are pre-S06 references, superseded by §21)
- **Depends on:** S06, S02b
- **Done when:**
  1. With 17 sites and 90 days of generated check data (local Supabase — staging's free tier can't hold 90 days of raw checks, D-031), `/` renders in < 2 s (server timing in the PR), and on staging a status change shows in < 5 s via Realtime (PRD §9).
  2. Live issues inclusion, reason, Since, sort and Next step behave as spec §21.4 (table tests from the board's states), banners as §21.1, KPIs as §21.2–3.
  3. spec-checker passes Main3, MainDark3 and MOverview4 at 390 / 820 / 1440, light and dark; BottomNav shows below lg; the Overview nav item (live since S01 as the landing page) now shows the real dashboard.
- **Review:** spec-checker, db-reviewer, security-reviewer (Realtime, the read functions).
- **Notes (evidence):** Done 9 Oct 2026 — migration #58 (`migrate-production` on `main`), page #59. Production `/` checked after the deploy (phone width): "10 of 11 sites OK · 3 live issues", Probes 3/3, Open / Unacked / Yours, Live issues (TLS chain, root cause not added), All sites row, BottomNav; TTFB 192 ms; no console errors. Built 9 Oct 2026 in one day (L). Decisions in D-032 (links that wait for S07, copy for what doesn't run yet, MTTA / MTTD means, AM vs CEO, Unacked = DOWN, BottomNav behaviour); AURA 5.34; AURA requests 11–14.
  - **Done-when 1 ✓** Local, 90 days generated (`supabase/dev/generate-checks.sql`: 3,344,118 `check_results` rows, 17 seed sites + test sites): full `GET /` signed in as the Admin 0.44–0.64 s (dev server, 36 live sites); `loadOverview` 194 ms cold / 122 ms warm (`overview.int.test.ts`, RLS as the Admin, asserts < 2 s); `overview_response_24h` 16.8 ms. Staging Realtime (Tao's `/verify`): INC-0024 row 10:00:34.551 → page 10:00:37.675 = 3.1 s; INC-0023 09:39:34.040 → 09:39:36.378 = 2.3 s.
  - **Done-when 2 ✓** `features/overview/model.test.ts` (inclusion, reason, Since, sort, Next step by role, banners incl. ack / relapse / D-023, counts, KPI captions, chips, tiles, events), `assemble.test.ts`, `packages/engine/src/metrics.test.ts` (MTTA / MTTD, D-021 outage start, early ack), `components/overview-view.test.tsx`, `use-live-refresh.test.tsx`; `pnpm check` green (web 652, engine 307).
  - **Done-when 3 ✓** spec-checker Main3 / MainDark3 / MOverview4 ×2 rounds (round 2: all three pass; its Medium and Lows fixed); `layout-consistency.spec.ts` passes at 390 / 820 / 1440; BottomNav below lg (`layout.test.tsx`, `ack.spec.ts` phone: gone on the incident page, slides away on scroll). `/verify` (Tao, staging, 9 Oct): banner buttons at the row end; Acknowledge → banner gone, focus on Live issues, toast "Posting to Chat and email in 10 s — nothing is sent until then | Undo · 10 s"; Undo brought it back and INC-0025's ACKNOWLEDGED rows are `cancelled`; 820 dark glyphs, no sideways scroll; tier filter; Recent events; 390 banner card, counts, rows, All sites row; incident page bar at the edge without BottomNav. Its two findings (owner name squeezing Site · why at 1440, "1 monitored sites") fixed; Owner widened to 176 px at Tao's request.
  - Reviews: `/code-review high` (8, fixed), db-reviewer (H1 PostgREST cap, M1 index, M2 `monitor_status` out — fixed), security-reviewer ×2 (no High / Medium; Lows fixed), engine-reviewer (H1, M1–M4, L1 fixed), spec-checker ×2, slice-verifier.

### S07 · Incidents, timeline & resolve

- **Scope:** FR-06. Incidents list (filters, "N short PROBLEMs auto-resolved (hidden)"), Incident detail (state badges §11 / §14.3, timeline that only grows, notes, root cause, MTTA / MTTR), mobile list and detail, Resolve dialog with the three conditions, resolve held 10 s, NOTE and RESOLVED Chat replies, RESOLVED email. Until S11 builds the client-update track it never fires, so that condition shows "Not required" (D-002, spec §16.2). Phone detail pages get the top bar's back arrow (MobileAck, MIncident → Incidents; D-018).
- **Boards:** Incidents, MIncidents, Incident, MIncident, Resolve · **Test plan:** T10
- **Depends on:** S04b
- **Done when:**
  1. **T10:** Resolve stays disabled, naming the unmet condition, until OK 2 rounds + client update (or Not required) + root cause; "Unknown — keep investigating" doesn't count (UI test + engine test).
  2. Each incident state renders the exact badge from spec §11 / §14.3 (component test per state).
  3. A note appears on the timeline and as `NOTE · <site> · <name>: …` in the thread; RESOLVED goes to everyone who got the DOWN email, after the 10 s hold.
  4. spec-checker passes the five boards; nav "Incidents" live.
- **Review:** spec-checker, engine-reviewer (resolve gate), message-checker.
- **Notes (evidence):** Done 10 Oct 2026 — migration #62, runtime #63 (`migrate-production` on `main` applied `20261009150650`). Staging `/verify` (9–10 Oct): Resolve locked while down; NOTE in the Chat thread; Unknown → kept open; Resolve → Undo → Needs root cause; a fresh INC-0028 resolved → "Posted to Chat and email at 01:23:30" without a reload, RESOLVED email 01:23:31 in the incident thread (RECOVERED "down 9 min" = the page); 390 / 820 / 1440 light and dark, focus rings, evidence screenshot. Production `/incidents` checked after the deploy: 3 open, nav Incidents live, CSP `img-src` with the Supabase origin. Decisions in D-033 (amended: one outage rule — DOWN drops, clock minutes; Resolve's Uptime box with S09); AURA request 15 (table cells clip focus rings). Spec-checker Lows left for follow-up are listed in #63; the Overview Live issues table at 820 with long waits went to its own fix.
- **Carried from S03 `/verify`:** an evidence job queued while the verifier was down is taken when it comes back (up to 15 min later), so its screenshot can show the recovered page. The Incident board's evidence card shows the capture time next to "Confirmed down"; skip or label a screenshot taken after `recovered_at`.
- **Carried from S04b review:**
  - A resolve made by hand inside a flapping incident's 15-min hold must cancel its held summary (`engine_cancel_flap_summary`); otherwise the summary posts after RESOLVED (db-reviewer L-a, engine-reviewer L4).
  - The timeline orders RECOVERED before PROBLEM AGAIN when both have the same `at` (D-023, spec §19.7); `episodesOf` already does this.
  - `incidents.auto_resolved` drives the hidden "N short PROBLEMs auto-resolved" filter.
- **Carried from S06 review** (engine-reviewer; existed before S06):
  - RECOVERED words its drop by the incident's severity (`render.ts` `problemOf` / `recoveryOf`): a D-023 key-page PROBLEM drop on a DOWN incident says "back · down X" instead of "back to normal · problem for X". Take the severity (and the trigger, from its `relapsed` payload) from the drop that recovered (N3).
  - `engine_relapse_incident` lets a PROBLEM incident relapse as DOWN without an `escalated_to_down` event; the runner always escalates first, but add the SQL guard `not (p_severity = 'down' and severity = 'problem')` with a pgTAP test (L2).
  - Flap summary and "Down X so far" for a mixed incident (D-021 PROBLEM → DOWN, D-023 key-page PROBLEM drops): S06 split a D-021 incident's drops at the escalation for uptime, but `render.ts` `dropsOf` keeps the S04b view for messages (the PROBLEM time reads as part of the outage). Decide with Tao and message-checker how a mixed incident is worded — DOWN-only totals as uptime counts them (spec §5), flips / span / "stable since" over every drop, "Down once" for one — record a D-xxx, then drop the S04b view.

### S08 · Escalation L0–L1 & response hours

- **Scope:** FR-09a. `escalation_policies`, `escalation_steps` seeded for Tier 1 DOWN, Tier 2–3 DOWN, PROBLEM. Organisation settings table for response hours (one value for Tier 2–3, spec §14.14) and a company holidays table, seeded (UI in S17). Engine ladder: L0 at confirm, L1 at +15 min to backup + Tao minus anyone already paged; Tier 2–3 timers pause outside response hours and on holidays, resume 09:00; PROBLEM outside hours held until 09:00; reminders every 15 min (DOWN) / 60 min (PROBLEM) in the thread; ack stops L1. Escalation page: policies with L0–L1 editing and the guardrails that apply (§14.7: L0 pinned, ≥ +15 min, ≥ 1 channel).
- **Boards:** Escalation (L0–L1), MEscalation (view only, §22) · **Tables:** escalation_policies, escalation_steps, organisation_settings, company_holidays · **Decisions:** D-034, D-035
- **Depends on:** S07
- **Carried from S04b review:**
  - DOWN AGAIN / PROBLEM AGAIN mention the L0 person. That is the owner until on-call exists, so for Tier 1 at night it moves to the on-call person in S10 (message-checker L3).
  - `engine_escalate_incident` resets `detected_at` (D-021), while a relapse keeps the original escalation clock (D-004). The ladder must not re-fire levels that already fired (engine-reviewer L1).
  - Add "outside response hours · timers paused until 09:00" to DOWN AGAIN, and "Not yet — outside response hours" to the summary email's Acknowledged row (D-013).
- **Done when:**
  1. Engine tests: INC-0142 → L1 at 10:03:41 (15 min after confirmed 09:48:41); a Tier 2 DOWN confirmed Thu 22:14 (like INC-0139) that stays down → L0 posted at once, L1 at Fri 09:15; the same on a company holiday → L1 on the next working day; ack at 10:07 → no L1.
  2. On staging (with the fixture people of D-035), an unacknowledged DOWN posts `ESCALATED · L1` mentioning the backup with "Tao FYI" 15 min after confirm.
  3. Saving a step < +15 min or with no channel is refused with the spec's message (UI test).
  4. spec-checker passes Escalation for L0–L1; nav "Escalation policies" live.
- **Review:** engine-reviewer, message-checker, spec-checker, security-reviewer, db-reviewer.

### S09 · Maintenance windows & mute

- **Scope:** FR-10a and FR-14 (pulled forward from P1: the Maintenance dialog's guard offers Mute, so both ship together). One-off windows: schedule, suppress alerts, excluded from uptime, reason required, > 24 h needs Admin approval (Admins approve their own), can't start on a DOWN site or one with an open incident (§14.5). Mute: reason required, max 24 h, auto-expires, stops new alerts only and never counts as an ack (§15.1). End early / edit / cancel from the Overview "Maintenance & mutes" card, all logged.
- **Boards:** Maintenance, MMaintenance, MaintenancePage, MMaintenanceList (spec §23, 11 Oct) · the Overview card and phone row (Main3 / MOverview4 "+ Maint.", §23.8) · **Tables:** maintenance_windows · **Test plan:** T09 · **Decisions:** D-036
- **Not in S09 → S09b:** every maintenance message (§23.6, §23.10 "Who is told": the request to the Admin, the 12 h / 1 h reminders, the Alerts Space line and owner / backup messages, approve / decline to the asker); status-page subscriber emails go with the status page (Phase 3).
- **Depends on:** S06b, S08
- **Done when:**
  1. **T09:** muting a site with an open incident keeps its escalation running (test); the L3 FYI and client-update parts are re-checked in S10 / S11.
  2. Starting a window now on a DOWN site is blocked with the spec text and offers Mute.
  3. Uptime for a site with a 2 h window excludes those minutes from both sides (test).
  4. A Responder's 30 h window waits for Admin approval; a 25 h mute is refused.
  5. spec-checker passes Maintenance and MMaintenance; nav "Maintenance" live.
- **Review:** spec-checker, engine-reviewer, security-reviewer, db-reviewer.

### S09b · Maintenance messages

- **Scope:** the messages spec §23.6 and §23.10 add (split from S09 on 11 Oct 2026, D-036): the approval request to the Admin when a Responder asks for maintenance over 24 h, the reminders 12 h and 1 h before a pending request's start, one line in the site's Alerts Space thread plus a message to the owner and backup on every create / approve / decline / edit / cancel / end early, approve / decline to the asker in Chat, and "Didn't start — site was DOWN" to the owner, backup and approver. Status-page subscriber emails ("Include planned maintenance notices") go with the status page (Phase 3).
- **Also (spec §24, rev 4):** 10 s Undo for approve / decline / end now / change end / cancel / withdraw (§24.8), the "Held by a mute until …" line on an incident's first alert after a mute and "INC-… posted" on MUTE ENDED (§24.7), the incident-thread line when a mute starts on a site with an open incident (§24.4), and the confirmed dialog copy (§24.9). No Chat DMs yet: DM texts are Space replies that @mention the person (D-037).
- **Boards:** ChatAlert (STATE: approval request · reminders · approved / declined · Alerts Space thread · didn't start · first alert after a mute) and EmailAlert ('Maintenance · approval', 'Maintenance · owner & backup'), drawn 11 Oct 2026 · **Decisions:** D-037
- **Depends on:** S09
- **Done when:**
  1. A Responder's request over 24 h reaches every active Admin in Chat (a line @mentioning each, D-037) and email; the reminders go 12 h and 1 h before its start while it still waits (tests; staging can't sign in a Responder, D-007).
  2. Each maintenance action posts its one line in the site's Alerts Space thread and messages the owner and backup (tests); message-checker passes the new ChatAlert / EmailAlert rows.
- **Review:** message-checker, engine-reviewer.

### G1 · MVP gate (PRD §12 Phase 1 exit)

- ข้อมูล 17 เว็บครบ 100% ก่อน go-live (S05 Done-when 1).
- DOWN จำลองแล้ว alert ถึงภายใน 3 นาที — on production, against the test target, for a Tier 1 monitor.
- A second Admin is active, with their 2-Step Verification page confirmed per D-007 (PRD §9: "ต้องมี admin คนที่ 2 ก่อน Phase 2"), and Healthchecks alerts go to both Admins. They are added to `.github/CODEOWNERS` and review every PR before `pnpm pr:merge` (D-008; with GitHub Pro the ruleset "main" would require 1 code-owner approval instead).
- `docs/runbook.md` v1 exists and the second Admin has walked through it once: what each heartbeat / Healthchecks alert means, restarting the VPS agent, checking Vercel Cron and function logs, pausing alerts with maintenance, rotating `CRON_SECRET` / `INGEST_TOKEN` / webhook URLs, and who to call (PRD §13 bus-factor mitigation).
- From here every production deploy happens inside a maintenance window, and the parallel run with the CEO's hourly monitor starts; S19 keeps its log.

## Phase 2 — Team go-live, P1

### S09c · Defacement: shared forbidden words & crawler view

- **Scope:** PRD §2 / §5 "content-change/defacement detection" (D-041). Today a defaced page is caught only by a missing `must_contain` or by a site's own `must_not_contain` ("Index of /, Database error"). This slice adds:
  - **Shared forbidden list (all sites).** A reviewed list in `@dxt/shared`, applied to every monitor on top of its own `must_not_contain`. It is versioned in code; S17 makes it Admin-editable.
    - It holds **phrases, never single ambiguous words**: "slot online", "สล็อต", "บาคาร่า", "แทงบอล", "เว็บพนัน" … — not "slot", which matches "time slot" on a booking page.
    - Thai has no spaces between words, so every Thai entry is checked against normal Thai pages for substring hits before it joins the list.
    - Matching is case-insensitive and treats runs of whitespace as one.
  - **Crawler view, every 30 min from SIN.** Each live site's home page gets two extra fetches, each with the keyword and redirect-allowlist checks:
    1. as Googlebot — catches spam cloaked by User-Agent;
    2. as a mobile browser with `Referer: https://www.google.com/` — catches Thai gambling hacks that redirect visitors arriving from Google search without looking at the User-Agent.

    Each crawler fetch reads the **whole body** up to `KEYWORD_SCAN_BYTES` (3 MB, D-026), not the 256 KB sample: injected links and scripts usually sit at the end of `<body>`. Every 30 min, that costs little.

  - **What fires and how it reads.**
    - A forbidden phrase, or a redirect off the allowlist, is PROBLEM `keyword` / `redirect` (D-022). The cause names the phrase or the host, where it was seen, and "(as Googlebot)" or "(from Google search)" for a crawler fetch.
    - One crawler fetch is enough: it is a single location by design.
  - **Not a round.** Crawler fetches are not a fourth location and don't go through `decideSite`'s round logic. A 30-min cron (sin1) stores each one in its own table, `crawler_checks`: monitor, view (`googlebot` / `google_referer` / `plain` for S09d), checked_at, outcome, status, final URL, the keywords found and the S09d fingerprint. It has RLS like `check_results`, 30-day retention and no partitions (~3 rows × live sites × 48 a day). The engine reads each monitor's latest crawler result beside its round, and opens or clears the PROBLEM on it.
  - **Size:** M, not S. It needs a cron, the table, probe User-Agent / Referer plumbing, an engine case, notifier wording and four test-target modes. Against G1 (16–21 Oct), Done-when 1, 2 and 4 must land first.
    - **A crawler fetch that isn't a 2xx/3xx answer — a WAF 403, a challenge, a timeout — is no data, never PROBLEM.** Akamai and Cloudflare check that "Googlebot" is real, and a fake one from Vercel's IPs is usually refused (Bangkok Airways sits behind Akamai).
- **Boards:** none new (the ChatAlert / EmailAlert PROBLEM · Keyword and Redirect rows).
- **Depends on:** S04a
- **Done when:**
  1. Table-driven tests (packages/probe, engine) cover:
     - a shared-list phrase in the body → PROBLEM `keyword` naming it;
     - "time slot" / "Select a time slot" on a booking page → no PROBLEM (no single-word "slot" match);
     - a clean body → OK;
     - a phrase only in the Googlebot view → PROBLEM "(as Googlebot)";
     - a redirect only with the Google Referer → PROBLEM `redirect` "(from Google search)";
     - a phrase past 256 KB → caught by the crawler fetch (whole body);
     - **a crawler fetch answered 403 / challenge / timeout → no data, no PROBLEM**;
     - case and spacing tolerance.
  2. On staging, the test target's new modes each raise their PROBLEM with the right cause and recover on `ok`:
     - `defaced`;
     - `cloaked-ua`;
     - `cloaked-referer`;
     - `deep-spam` (the phrase after 300 KB).

     `waf-partial` on a crawler fetch stays no data.

  3. **(After G1, as S05's production line):** replay every live site's current home page, both crawler views included, through the list before the alert goes on. Then a week of production checks with no false positive.
  4. message-checker passes the PROBLEM · Keyword / Redirect card and email with the new cause wording.
- **G1 needs Done-when 1, 2 and 4.** Done-when 3 was collected on production after the merge (#102, 13 Oct 2026); the close-out turned `DEFACEMENT_ALERTS` on there.
- **Done-when 3 evidence (production, 13 Oct 12:00 – 21 Oct 06:30 UTC, over 7 days, the shared list unchanged since #102):**
  - `crawler_checks`: 4,114 Googlebot fetches (3,739 usable) and 4,114 from-Google-search fetches (2,991 usable) of the 11 live home pages, whole body; 0 with a forbidden word, 0 that ended on another host. The crawler stores what it finds whatever the flag, so 0 is a real result.
  - `check_results` (BKK, SIN, TYO every minute): 0 with a forbidden word; no Keyword / Redirect incident.
  - Coverage: 8 sites read in both views; Bangkok Airways China and Taiwan in the Googlebot view only (the from-Google-search view gets 403 on every run, Akamai); Cando Asia in neither (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` on every fetch, the probes' too: its open PROBLEM · TLS chain since 8 Oct, D-029). The crawler rows those views lost are no data by design (D-042), not a PROBLEM; Cando Asia gets crawler coverage once the client fixes the chain.
- **Review:** engine-reviewer, db-reviewer (`crawler_checks`), message-checker, security-reviewer (the crawler fetches: fixed User-Agents and Referer, the same SSRF guard).
- **Not in this slice:** "the page changed from its last version" is S09d.

### S09d · Defacement: page-change detection

- **Scope:** D-041, the other half of PRD §2 "content-change". To keep false alarms out, the slice compares a small **fingerprint of what a defacer changes** on each live site's home page against an accepted baseline, not the whole page. The fingerprint holds:
  - `<title>`, meta description and robots;
  - the canonical URL;
  - the first `<h1>`;
  - the set of domains the page links to or loads scripts / iframes from.

  It is built from a **whole-body fetch in S09c's 30-min crawler run** (the probe's own User-Agent, up to 3 MB). It is not built from the per-minute probe: reading a page's tail means downloading all of it, and D-026 keeps the per-minute probe to its sample. Injected scripts usually sit at the end of `<body>`. The fingerprint is stored per monitor.

- **What fires:**
  - a new external script or iframe domain → PROBLEM `content_change` on the next 30-min fetch (the common injected-malware sign);
  - a changed title / description / h1 / canonical, or new link domains, holding for 3 fetches (~1 h) → PROBLEM `content_change`.

  The cause shows before → after.

- **Baseline:** set from the first usable fetch after monitoring starts (and again when the home page URL changes), or with "Accept as new baseline" on the incident or site page (Admin, audited, 10 s Undo that applies only when it closes). Resolving a Page change as **Client-side change** offers "Also accept the current page as the new baseline" to Admins (D-046; no "Expected change" category).
- **Rules settled in D-046:** the fingerprint fetch is its own view `plain` (the probe's own User-Agent), not a keyword view; "holding for 3 fetches" = the last 3 usable fetches each differ; removed domains never alert; no data holds an open PROBLEM; a 14-day recording per site (from its first baseline); `PAGE_CHANGE_ALERTS` (`on` | `off`, default `off`) gates the alert in the engine runner like `DEFACEMENT_ALERTS` — staging `on`, production `off` until Done-when 3.
- **Boards:** IncidentPageChange, MIncidentPageChange, IncidentPageChange820, IncidentPageChangeDark, MIncidentPageChangeDark; the Page fingerprint card on SiteDetail and MSite; the ChatAlert Page change cause row (spec §26, drawn 15 Oct).
- **Tables:** page_baselines; `crawler_checks` gains the `plain` view and `fingerprint`.
- **Size:** L (was M): schema, probe, crawler, engine, notifier, two screens, test target. Three PRs: the migration first; the data path next, merged early so the 2-week production record starts; then the screens.
- **Depends on:** S09c (merged — its Done-when 3 is a production week, as S05b started on S05 merged), S07
- **Done when:**
  1. Table-driven tests cover:
     - an injected `<script src="evil.example">` at the end of a 400 KB page → PROBLEM on that fetch;
     - a title change → PROBLEM on the 3rd fetch;
     - a rotating banner, prices or a news list (text outside the fingerprint) → no PROBLEM;
     - tracking domains on an allowlist (Google Analytics, Tag Manager, Meta pixel …) → no PROBLEM.
  2. Staging: the test target's `defaced-title` and `injected-script` modes fire with before → after; "Accept as new baseline" clears it and writes `audit_log`.
  3. Two weeks of fingerprints from the 17 production sites (recorded, not alerting) show no false positive before the alert is switched on.
- **Review:** engine-reviewer, db-reviewer (fingerprint table), security-reviewer (the HTML parser, the accept RPCs), message-checker, spec-checker (IncidentPageChange ×5, SiteDetail, MSite).
- **Phase:** Phase 1 · P1. It doesn't block G1: its alert switches on only after the two-week record (Done-when 3).
- **Not in this slice:** a script that JavaScript adds at runtime isn't in the HTML, so the probes can't see it. Only the browser verifier (S03) renders the page, and it runs only for blocked rounds. This slice does not cover runtime-injected scripts.
### S10 · Escalation L2–L3 & on-call

- **Scope:** FR-09b. L2 CEO step on (approved 5 Oct 2026, D-009 — no "pending CEO" tag); voice "Configured · off" (Twilio not used for now); Tier 1 L3 FYI to CEO + AM at +60 min even after ack, never a call; Tier 2–3 L2 reminder to Tao. Full editor guardrails (§14.7, §15.5). `oncall_shifts`, rotation page, swap request / accept, hand over shift with reason, reminder a day before, on-call phone checklist with test alert; Tier 1 nights, weekends and holidays page the on-call person.
- **Boards:** OnCall, MOnCall, Escalation (L2–L3) · **Tables:** oncall_shifts · **Test plan:** T05
- **Depends on:** G1
- **Done when:**
  1. **T05:** with no ack, a Tier 1 DOWN on staging walks L0 → L1 → L2 (enabled on staging) → L3 on time; with ack at +5 min, L1–L2 stop and L3 still sends the FYI at +60 min (timestamps in the PR).
  2. The editor refuses: CEO token on Tier 2–3 or before L2, voice on the CEO + AM step, removing that step, a DOWN policy with no step after L0 (tests).
  3. At 23:00 on a weekday, a Tier 1 DOWN mentions the on-call person, not the owner (test + staging).
  4. T09 re-check: a muted site with an open Tier 1 incident still gets its L3 FYI.
  5. spec-checker passes OnCall, MOnCall, Escalation; nav "On-call" live.
- **Review:** engine-reviewer, message-checker, spec-checker, security-reviewer, db-reviewer.

### S11 · Client-update track

- **Scope:** FR-20. At Tier 1 DOWN 15 min from the first failed check (D-002) or Tier 2 DOWN 60 min inside response hours: AM mentioned in the thread with a TH / EN draft and a "Client update due" email. Incident card: AM, due time, draft, Mark client updated (who + when), Not needed + reason, Copy draft. Permissions §16.6 (no "acknowledge only" lock — D-007). Feeds the resolve condition and "Client notified".
- **Boards:** Incident (client-update card), EmailAlert (Client update) · **Tables:** — (columns on `incidents`)
- **Depends on:** S08
- **Done when:**
  1. Replaying INC-0142 (first failed 09:48:12) posts the AM mention and email at exactly 10:03:12, acked or not.
  2. Engine tests: Tier 1 DOWN of 14 min → Not required; exactly 15:00 → required; 16 min can't be resolved until marked or Not needed + reason.
  3. A Viewer and an AM of another client can't mark it (RLS / action test).
  4. T09 re-check: a muted site with an open incident still gets its client-update mention.
  5. message-checker passes the client-update rows.
- **Review:** engine-reviewer, message-checker, security-reviewer.

### S12 · Monitor-fault mode & probes

- **Scope:** FR-21, PRD §9. Heartbeat routing: engine missing > 3 min → email Tao + Alerts Space post mentioning on-call through a sender that doesn't depend on the engine; a single probe missing > 3 min → email Tao only, suppressed during an engine fault. Overview fault banner with "as of" data; hand check → manual incident (L0 through the fallback sender, client-update track started, "Escalate now" by hand). VPS watchdog. Probes & heartbeat page.
- **Boards:** MainFault, Probes · **Test plan:** T02, T04, T11
- **Depends on:** S06b, S10, S11
- **Done when:**
  1. **T02:** stopping one probe → no false DOWN on any site and Tao gets the probe email only.
  2. **T04:** disabling Vercel Cron on staging → Healthchecks alerts reach both Admins and the VPS watchdog posts on its own.
  3. **T11:** engine heartbeat off → Tao email + on-call @mention; one probe off → Tao email only.
  4. "Down — open incident" from the hand check posts L0 through the fallback sender while the engine is stopped.
  5. spec-checker passes MainFault and Probes; nav "Probes & heartbeat" live.
- **Review:** engine-reviewer, message-checker, spec-checker.

### S13 · SSL & domain expiry

- **Scope:** FR-11. Daily SSL certificate and domain (RDAP / WHOIS) checks; PROBLEM at SSL < 14 days / domain < 30 days (internal only, §12); routing per the SSL row; Expiry page. Test target gains an expiring-cert mode (or a fixture host).
- **Boards:** Expiry · **Test plan:** T01 cert path
- **Depends on:** S04
- **Done when:**
  1. An expiring-cert target opens PROBLEM "SSL expiring"; a domain 20 days from expiry opens PROBLEM "Domain expiring".
  2. Days-left on the page match a fixed "today" (spec §15.8 figures in a test).
  3. spec-checker passes Expiry; nav "SSL & domains" live.
- **Review:** engine-reviewer, spec-checker.

### S14 · Digest, weekly summary & recurring maintenance

- **Scope:** FR-12 daily digest at 09:00 and Monday weekly summary to "DxT Website Reports" (CEO format + Overall X/17), with a Healthchecks check so a missing digest raises an alarm (PRD §13). FR-10b recurring windows (RRULE).
- **Boards:** WeeklySummary
- **Depends on:** S09, S11
- **Done when:**
  1. message-checker passes the digest and weekly cards against WeeklySummary (incl. "— (no DOWN inside response hours)").
  2. Digests arrive at 09:00 on three consecutive staging days; skipping one triggers the Healthchecks alert.
  3. A weekly recurring window suppresses alerts on its next two occurrences (test).
- **Review:** message-checker, engine-reviewer.

### S15 · Audit log

- **Scope:** FR-13. Audit log page (filters, CSV export) and a coverage test that runs in CI: every server action / route that changes config or incident state must write `audit_log`.
- **Boards:** AuditLog
- **Depends on:** S09
- **Done when:**
  1. The coverage test enumerates the mutating actions and routes, and fails on a fixture action that deliberately skips `audit_log` (so slices after S15 are held to it).
  2. CSV export returns the filtered rows only.
  3. spec-checker passes AuditLog; nav "Audit log" live.
- **Review:** security-reviewer, spec-checker.

### S16 · Users & access

- **Scope:** Users & roles (invite = add to the allowlist with a role, change role, deactivate with the "Used in" check and reassignment, §14.9), Security (sessions, sign out everywhere, confirm dialogs), Profile (notification channels incl. the Google Chat user id that alerts mention, D-015; on-call checklist). No 2-step status, required date or lock — Google Workspace enforces 2-step (D-007); the invite dialog asks for the person's primary Google address (not a DxT alias) and reminds the Admin to have them confirm their 2-Step Verification page.
- **Boards:** Users, Security, Profile, MProfile
- **Depends on:** S10
- **Done when:**
  1. Inviting an address adds it to the allowlist with the chosen role and that person can then sign in; deactivating removes the entry, bans the auth user and ends their sessions (test). Every change writes `audit_log`.
  2. Changing Nok's role lists every place Nok is used (escalation levels, AM, owner / backup, shifts) and won't save until each is reassigned.
  3. After "Sign out everywhere", the person's refresh tokens are rejected and their sessions stop working within the JWT lifetime (`jwt_expiry` = 3600 s) (test).
  4. spec-checker passes Users, Security, Profile; nav "Settings" live.
- **Review:** security-reviewer, spec-checker.

### S17 · Alert channels & organisation settings

- **Scope:** Alert channels & routing ("who gets what" with DOWN / PROBLEM rows read-only, delivery log, test alert in its own thread). Organisation: tiers, clients & AMs, response hours for Tier 2–3 (confirm with before / after, "Affects N sites"), company holidays, data retention, cost. The shared forbidden-word list becomes Admin-editable here; S09c ships it as a reviewed list in code (D-025, D-041).
- **Boards:** AlertChannels, Organisation
- **Depends on:** S10, S11
- **Done when:**
  1. Changing Tier 2–3 response hours needs a note, shows "Affects N sites", and the engine uses the new hours on the next sweep (test).
  2. A test alert posts in a "TEST — no action" thread mentioning only the tester.
  3. spec-checker passes both boards.
- **Review:** spec-checker, message-checker, security-reviewer.

### S18 · User guide

- **Scope:** FR-22. Guide with search, role chips (default to the viewer's role, or On-call while on duty), topics per spec §18; mobile guide.
- **Boards:** Guide, MGuide
- **Depends on:** S16
- **Done when:**
  1. Each role chip shows exactly the spec §18 topic matrix (test).
  2. spec-checker passes Guide and MGuide; nav "User guide" live.
- **Review:** spec-checker.

### S19 · Go-live readiness

- **Scope:** PRD §12 buffer + Phase 2 exit: runbook extended to everything built in Phase 2 (fault mode, hand check, on-call swaps), Supabase Pro daily backups checked (7-day retention, no PITR — D-005) and one restore drill from the latest daily backup, UAT with owners twice, game day, and the parallel-run log comparing every incident from the CEO's hourly monitor with DxT Monitor.
- **Test plan:** T06, T07
- **Depends on:** S10–S18
- **Done when:**
  1. **T06:** two UAT rounds with owners on phones (ack, mute, maintenance), findings fixed or logged.
  2. **T07:** game day — a real test site taken down; MTTD ≤ 3 min (Tier 1) and MTTA ≤ 15 min recorded (PRD §2).
  3. All 12 test-plan items (T01–T12) re-run and ticked in `docs/test-plan-results.md`.
  4. `docs/parallel-run-log.md` covers two weeks and shows no incident seen by the hourly monitor that DxT Monitor missed.
  5. The second Admin has run the updated runbook in a drill (engine heartbeat stopped → fault mode → hand check), and a restore from backup into a scratch project succeeded.
- **Review:** slice-verifier, Tao sign-off.

### G2 · Team go-live gate (PRD §12 Phase 2 exit)

- Parallel run 2 weeks ไม่พลาด incident → ปิด monitor รายชั่วโมง (S19 Done-when 4).
- Buffer: ผ่าน test plan ครบทุกข้อ (S19 Done-when 3).

## Phase 3 — Client-facing, P2

### S20 · Uptime reports & monthly PDF

- **Scope:** FR-15. Reports page (client-visible counts only: Outage + Degraded, §12, §14.12) and the monthly A4 PDF per client; AM note only on manual sends (§16.12). Pick the PDF renderer first (Q2).
- **Boards:** Reports, ReportPDF
- **Depends on:** G2
- **Done when:**
  1. September sample figures on the page and PDF match spec §5 (BA 11 min, MuvMi 101 min, Cando 12, ORCA 8) and internal-only PROBLEMs are absent (test).
  2. The PDF renders at A4 with no clipped content (file attached to the PR).
  3. spec-checker passes both boards; nav "Uptime reports" live.
- **Review:** spec-checker, security-reviewer (client data isolation).

### S21 · Client status page

- **Scope:** FR-16. Public status page per client (custom subdomain), mapping per §12 (Outage / Degraded / Planned maintenance, internal-only hidden, "Live status temporarily unavailable" on stale data), per-IP rate limit, no data from other clients.
- **Boards:** StatusPage, MStatusPage
- **Depends on:** S20
- **Done when:**
  1. Each §12 mapping row renders as specified (component test per row); data older than 5 min shows the neutral message and no green banner.
  2. One client's page can't return another client's sites (test); more than 60 requests / min from one IP get HTTP 429 (test).
  3. spec-checker passes both boards.
- **Review:** security-reviewer, spec-checker.

### S22 · Post-incident review

- **Scope:** FR-18. Review template on every DOWN incident, "Client notified" from the client-update record, Resolved → In review → Closed with Tao's sign-off.
- **Boards:** PostIncident
- **Depends on:** G2
- **Done when:**
  1. Submitting a review moves the incident to In review; Tao's sign-off moves it to Closed; a PROBLEM can't enter review (tests).
  2. spec-checker passes PostIncident.
- **Review:** spec-checker, engine-reviewer.

### S23 · Synthetic transactions

- **Scope:** FR-17. Multi-step Playwright scripts on the VPS (e.g. search → booking), results capped at PROBLEM (Q5).
- **Boards:** Synthetic
- **Depends on:** G2
- **Done when:**
  1. A scripted search → booking check runs every 5 min on staging and a broken step opens PROBLEM, never DOWN (test).
  2. spec-checker passes Synthetic.
- **Review:** engine-reviewer, security-reviewer (scripts on the VPS), spec-checker.

### S24 · Public API & webhooks

- **Scope:** FR-19. API keys (scoped, hashed, revocable), read API, outgoing webhooks signed and held 10 s like Chat / email (§15.4), delivery log.
- **Boards:** ApiWebhooks
- **Depends on:** G2
- **Done when:**
  1. `incident.acknowledged` is delivered at ack + 10 s and not at all after an Undo (test).
  2. Payloads carry an HMAC signature verified by a test receiver; a revoked key gets 401.
  3. spec-checker passes ApiWebhooks.
- **Review:** security-reviewer, message-checker, spec-checker.

### G3 · Client-facing gate (PRD §12 Phase 3 exit)

- Report เดือนแรกส่งลูกค้า Tier 1 ได้.

---

## Risks

| # | Risk | Mitigation in this plan |
|---|---|---|
| R1 | One developer; the sizes add up to about twice the PRD timeline (bus factor 1, PRD §13) | Re-baseline after S02a with its measured duration (Q7), then tell the CEO. Gates are scope gates: when a phase slips, its gate moves, never its Done-when lines. Second Admin at G1. |
| R2 | Vercel Cron is the single point of failure for probes, engine and notifier | Healthchecks pings from S02a; watchdog and fault mode in S12 before go-live. |
| R3 | WAF blocks grow and the verifier gets busy | S00 allowlist requests; S03 caps the verifier at 3 sessions and alerts at > 5 queued jobs. |
| R4 | Alert fatigue during the parallel run | Majority vote, dedupe and flapping (S04a, S04b, D-004); false-alert review in the S19 log. |

## Open questions for Tao

| # | Question | Blocks |
|---|---|---|
| Q1 | ~~The spec's "2-step required from Mon 5 Oct": Workspace policy date or the app's lock?~~ **Closed 28 Sep 2026 (D-007):** Workspace already enforces 2-step; the app has no lock or date. | — |
| Q2 | PDF renderer for monthly reports (server-side React PDF vs headless Chromium on the VPS). | S20 |
| Q3 | ~~Voice call at L2: CEO or owner / on-call?~~ **Deferred 28 Sep 2026:** Twilio isn't used for now; decide the callee only if voice is enabled later. | — |
| Q4 | ~~Healthchecks grace time and recipients.~~ **Answered 28 Sep 2026:** as designed — 3 min / 30 min, email Tao (the second Admin joins at G1). | — |
| Q5 | ~~Confirm synthetic checks cap at PROBLEM.~~ **Answered 5 Oct 2026:** confirmed by the CEO. | — |
| Q6 | ~~Google Workspace admin access for the Directory API (2-Step status).~~ **Closed 28 Sep 2026 (D-007):** not needed — no Directory API. | — |
| Q7 | ~~Timeline: re-baseline, add a developer, or cut scope?~~ **Answered 28 Sep 2026:** measure S02a first, then decide with real numbers. | — |
| Q8 | D-022 counts a home page answering 403 without a WAF signature as a pass ("home page 4xx is not a trigger"), so an origin that answers 403 by misconfiguration stays green. Keep, or treat a home-page 403 as a hard fail? (raised in the S05b review, 8 Oct 2026; not changed there) | — |

## Appendix — coverage matrix

Every FR, board, table and go-live test item maps to exactly one slice (`pnpm plan:check`).

### Functional requirements

| FR | Slice |
|---|---|
| FR-01 | S05 |
| FR-02 | S02a |
| FR-03 | S04a |
| FR-04 | S03 |
| FR-05 | S06b |
| FR-06 | S07 |
| FR-07 | S02b |
| FR-08 | S06 |
| FR-09a | S08 |
| FR-09b | S10 |
| FR-10a | S09 |
| FR-10b | S14 |
| FR-11 | S13 |
| FR-12 | S14 |
| FR-13 | S15 |
| FR-14 | S09 |
| FR-15 | S20 |
| FR-16 | S21 |
| FR-17 | S23 |
| FR-18 | S22 |
| FR-19 | S24 |
| FR-20 | S11 |
| FR-21 | S12 |
| FR-22 | S18 |

### Boards

| Board | Slice |
|---|---|
| Login | S01 |
| MLogin | S01 |
| EmptyStates | S01 |
| MobileAck | S02b |
| MobileAckDark | S02b |
| ChatAlert | S02a |
| EmailAlert | S02b |
| StatusModel | S04a |
| AddSite | S05 |
| EditMonitors | S05 |
| Sites | S05c |
| MSites | S05c |
| Main | S06b |
| MOverview | S06b |
| MainDark | S06b |
| Main3 | S06b |
| MainDark3 | S06b |
| MOverview4 | S06b |
| SiteDetail | S06 |
| MSite | S06 |
| Incidents | S07 |
| MIncidents | S07 |
| Incident | S07 |
| MIncident | S07 |
| Resolve | S07 |
| Escalation | S08 |
| MEscalation | S08 |
| Maintenance | S09 |
| MMaintenance | S09 |
| MaintenancePage | S09 |
| MMaintenanceList | S09 |
| IncidentPageChange | S09d |
| MIncidentPageChange | S09d |
| IncidentPageChange820 | S09d |
| IncidentPageChangeDark | S09d |
| MIncidentPageChangeDark | S09d |
| OnCall | S10 |
| MOnCall | S10 |
| MainFault | S12 |
| Probes | S12 |
| Expiry | S13 |
| WeeklySummary | S14 |
| AuditLog | S15 |
| Users | S16 |
| Security | S16 |
| Profile | S16 |
| MProfile | S16 |
| AlertChannels | S17 |
| Organisation | S17 |
| Guide | S18 |
| MGuide | S18 |
| Reports | S20 |
| ReportPDF | S20 |
| StatusPage | S21 |
| MStatusPage | S21 |
| PostIncident | S22 |
| Synthetic | S23 |
| ApiWebhooks | S24 |

ChatAlert starts in S02a and EmailAlert in S02b; both gain rows in every slice that adds an event; Escalation is extended in S10; Incident gains the client-update card in S11.

### Tables (PRD §11)

| Table | Slice |
|---|---|
| profiles | S01 |
| clients | S01 |
| sites | S01 |
| monitors | S01 |
| audit_log | S01 |
| probe_locations | S02a |
| check_results | S02a |
| site_status | S02a |
| incidents | S02a |
| incident_events | S02a |
| notifications | S02a |
| check_rollups | S06 |
| escalation_policies | S08 |
| escalation_steps | S08 |
| maintenance_windows | S09 |
| oncall_shifts | S10 |

Tables the plan adds beyond PRD §11: organisation settings and company holidays (S08), API keys and webhooks (S24), `private.allowed_email_domains` (done, migration 0002), `private.allowed_emails` (S01, D-007).

### Go-live test plan (PRD §12)

| Test | What | Slice |
|---|---|---|
| T01 | Staging site forced through every status path | S04a |
| T02 | One probe off → no false DOWN, Admin alerted | S12 |
| T03 | Verifier off → hard fail still DOWN; blocked → PROBLEM (unverified) | S03 |
| T04 | Vercel Cron off → Healthchecks alerts 2 people, VPS watchdog alerts | S12 |
| T05 | No ack → L0–L3 on time | S10 |
| T06 | UAT with owners twice on mobile | S19 |
| T07 | Game day, MTTD / MTTA measured | S19 |
| T08 | Ack → Undo within 10 s → nothing sent | S02b |
| T09 | Mute with open incident → escalation, L3 FYI, client update continue | S09 |
| T10 | Resolve blocked until 3 conditions | S07 |
| T11 | Engine heartbeat off → Tao email + on-call mention; probe off → email only | S12 |
| T12 | Only allowlisted company accounts get in; 2-step enforced by Workspace (D-007) | S01 |
