# Implementation plan

26 vertical slices in 4 phases, following PRD §12: Phase 0 prep → a thin end-to-end slice for one site → the rest of the MVP (P0) → team go-live (P1) → client-facing (P2). Each slice ships something that runs end to end and has observable **Done when** checks; phase gates repeat the PRD §12 exit criteria.

- **Status** is updated by `/slice-review <ID>` when every Done-when line has evidence. Values: `Todo` · `In progress` · `In review` · `Done` · `Blocked`.
- How a slice is worked: [`workflow.md`](workflow.md). Settled conflicts: [`decisions.md`](decisions.md). Board → route map: [`design/screens.md`](design/screens.md). Coverage is checked by `pnpm plan:check`.
- **Size** (one developer): **S** ≤ 2 days · **M** 3–4 days · **L** 5 days. Nothing is larger than a week; split a slice that grows past L and run `pnpm plan:check`.
- **PRD week** is the PRD §12 target (week 1 = Mon 28 Sep 2026). The sizes add up to more than that — see [Timeline](#timeline); Q7 is settled: measure S02a, then re-baseline.

## Slices

| ID | Slice | Phase | Size | FRs | Depends on | PRD week | Status |
|---|---|---|---|---|---|---|---|
| S00 | Prep, decisions, accounts & staging | 0 | — | — | — | 1 | Todo |
| S01 | Foundation: schema, auth, app shell | 1 · P0 | M | — | S00 | 2 | Todo |
| S02a | Thin slice: probe → engine → DOWN / RECOVERED in Chat | 1 · P0 | S | FR-02 | S01 | 2 | Todo |
| S02b | Email, delivery guarantees, Ack + Undo | 1 · P0 | M | FR-07 | S02a | 2 | Todo |
| S03 | Bangkok probe & browser verifier | 1 · P0 | L | FR-04 | S02b | 2–3 | Todo |
| S04 | PROBLEM triggers, flapping & status rules | 1 · P0 | M | FR-03 | S03 | 3 | Todo |
| S05 | Sites & monitors | 1 · P0 | M | FR-01 | S01 | 3 | Todo |
| S06 | Overview dashboard & site detail | 1 · P0 | L | FR-05, FR-08 | S02a, S05 | 3 | Todo |
| S07 | Incidents, timeline & resolve | 1 · P0 | L | FR-06 | S04 | 3 | Todo |
| S08 | Escalation L0–L1 & response hours | 1 · P0 | M | FR-09a | S07 | 3 | Todo |
| S09 | Maintenance windows & mute | 1 · P0 | M | FR-10a, FR-14 | S06, S08 | 3 | Todo |
| G1 | **MVP gate** | 1 | — | — | S01–S09 | end 3 | Todo |
| S10 | Escalation L2–L3 & on-call | 2 · P1 | L | FR-09b | G1 | 4 | Todo |
| S11 | Client-update track | 2 · P1 | M | FR-20 | S08 | 4 | Todo |
| S12 | Monitor-fault mode & probes | 2 · P1 | M | FR-21 | S06, S10, S11 | 4 | Todo |
| S13 | SSL & domain expiry | 2 · P1 | S | FR-11 | S04 | 4 | Todo |
| S14 | Digest, weekly summary & recurring maintenance | 2 · P1 | M | FR-12, FR-10b | S09, S11 | 5 | Todo |
| S15 | Audit log | 2 · P1 | S | FR-13 | S09 | 5 | Todo |
| S16 | Users, access & 2-step | 2 · P1 | L | — | S10 | 5 | Todo |
| S17 | Alert channels & organisation settings | 2 · P1 | M | — | S10, S11 | 5 | Todo |
| S18 | User guide | 2 · P1 | S | FR-22 | S16 | 5 | Todo |
| S19 | Go-live readiness: UAT, game day, parallel run | 2 | M | — | S10–S18 | buffer + 2-week run | Todo |
| G2 | **Team go-live gate** | 2 | — | — | S19 | end 5 + run | Todo |
| S20 | Uptime reports & monthly PDF | 3 · P2 | L | FR-15 | G2 | 6 | Todo |
| S21 | Client status page | 3 · P2 | L | FR-16 | S20 | 7 | Todo |
| S22 | Post-incident review | 3 · P2 | M | FR-18 | G2 | 8 | Todo |
| S23 | Synthetic transactions | 3 · P2 | L | FR-17 | G2 | 8–9 | Todo |
| S24 | Public API & webhooks | 3 · P2 | M | FR-19 | G2 | 9–10 | Todo |
| G3 | **Client-facing gate** | 3 | — | — | S20–S24 | end 10 | Todo |

Every slice also meets the [Definition of Done](workflow.md#definition-of-done) (checks, reviews, no dead controls, docs updated).

## Timeline

| Phase | PRD target | Sum of sizes (1 developer) |
|---|---|---|
| 0 Prep | week 1 | week 1 |
| 1 MVP (S01–S09) | weeks 2–3 (10 working days) | ≈ 41 days ≈ 8 weeks |
| 2 Team go-live (S10–S19) | weeks 4–5 + buffer, then 2-week parallel run | ≈ 36 days ≈ 7 weeks (parallel run overlaps) |
| 3 Client-facing (S20–S24) | weeks 6–10 | ≈ 23 days ≈ 5 weeks |

The plan keeps the PRD's order and gates; only dates move. Q7 (answered 28 Sep 2026): keep the PRD order, build S02a, and decide on dates / capacity / scope with its real duration. Slices are sized without assuming AI-assisted speed-ups; S02a is deliberately small (≤ 2 days) so the first real measurement arrives early: if it takes longer than its size, re-baseline the plan before starting S02b.

---

## Phase 0 — Prep (week 1, owner: Tao, mostly outside the code)

### S00 · Prep, decisions, accounts & staging

- **Scope:** PRD §12 Phase 0. Close CEO decisions (PRD §13): tiers, owners / backups, on-call members, CEO at L2, Twilio, budget ceiling ($60 / month — no PITR add-on, D-005) — collected in a decisions memo as a Claude Doc the CEO answers in place. Site Registration Checklist for 17 sites (URL + key pages, owner, backup, client, AM, hosting, WAF, credential reference) — a Claude Doc that owners and AMs fill in. Link both docs here when they exist. Accounts: Supabase Pro project (production) and a staging project in a separate free organisation (D-005). Two Vercel projects on the same repo, both with root `apps/web` (D-006): `dxt-monitor` (production branch `main`) and `dxt-monitor-staging` (production branch `staging`, env pointing at the staging Supabase project, the staging Chat space and its own `CRON_SECRET` / `INGEST_TOKEN`; Healthchecks URLs left empty or separate checks). Ignored Build Step so each project builds only its own branches — staging: `[ "$VERCEL_GIT_COMMIT_REF" != "staging" ]`, production: `[ "$VERCEL_GIT_COMMIT_REF" = "staging" ]` (exit 0 skips the build). Thai VPS (2 GB), Healthchecks.io checks, Resend sending domain, company domain. Database access per environment: `.env.staging.local` from `scripts/db-staging.env.example` (staging connection string + both project refs), and the GitHub environment `production` with the secret `SUPABASE_PROD_DB_URL` for the `migrate-production` CI job. Sign-in per environment (Supabase Auth handles Google): one Google OAuth client (Web) whose authorised redirect URIs are the Supabase callbacks of **both** projects (`https://<prod-ref>.supabase.co/auth/v1/callback`, `https://<staging-ref>.supabase.co/auth/v1/callback`) — app URLs don't go there. Each Supabase project's Auth URL configuration holds the app URLs: production — Site URL = production domain, redirect `https://<prod-domain>/auth/callback`; staging — Site URL `https://dxt-monitor-staging.vercel.app`, redirects `https://dxt-monitor-staging.vercel.app/auth/callback` and the PR-preview pattern `https://*-<vercel-team>.vercel.app/**` (PR previews use the staging database). Google Chat spaces "DxT Website Alerts", "DxT Website Reports" and a "DxT Monitor — staging" space for tests, each with an incoming webhook. HTTP vs Playwright capture of Tubtong / Cando Asia block pages; ask WAF owners to allowlist the probe UA + secret header and the VPS IP.
- **Depends on:** —
- **Done when:**
  1. CEO has approved tiers and the escalation ladder (PRD §12 exit), answered in the decisions memo and copied to the PRD's decisions list.
  2. The checklist is complete for every Tier 1 site (PRD §12 exit) and has owner, backup, client and AM for all 17.
  3. Both Vercel projects, both Supabase projects and the VPS have every variable name from `apps/web/.env.example` / `apps/vps-agent/.env.example` set (`vercel env ls` lists the names; values never shared in chat).
  4. A webhook test message appears in each of the three Chat spaces.
  5. Captured Tubtong / Cando block responses (status, headers, body sample) are saved under `docs/phase0/` for `packages/probe` challenge signatures.
  6. Pushing to `staging` deploys `dxt-monitor-staging` to its production URL, and its Vercel cron logs show `/api/cron/engine` called every minute (401 / 501 responses are expected until S02a); pushing a slice branch builds nothing on the staging project.
  7. The Google OAuth client lists both Supabase callbacks, and each Supabase project's Redirect URLs list matches the URLs above (checked by Tao).
- **Review:** Tao sign-off; no code review.

## Phase 1 — MVP, P0

### S01 · Foundation: schema, auth, app shell

- **Scope:** Tables `profiles` (auto-created on first sign-in, email as the default notification channel), `clients`, `sites`, `monitors`, `audit_log` with RLS per role (PRD §3) and explicit grants; role helpers (`current_app_role()`, `owns_site(site_id)`); `audit_log` append-only with a write helper. Google SSO sign-in (Login, MLogin) with `?next=`; company domain in `private.allowed_email_domains`; roles assigned by a reviewed SQL script until the Users screen (S16). App shell (SideNav with `live` flags, account footer), shared empty / loading / no-access states using the `@dxt/shared` formats. Dev seed from the spec sample data. SQL tests with pgTAP (`supabase/tests/`), run in a CI `db` job (Supabase CLI starts the local stack in Docker, then `supabase test db`), required on `main` alongside `check`.
- **Already in place from the setup:** enums (migration 0001), sign-up domain hook (0002), auth proxy with segment-wise public paths, `/auth/callback`, `safeNextPath` / `isAllowedEmail`, app shell and nav `live` flags, placeholder Login / Overview pages; web test tooling — Vitest + Testing Library (`pnpm --filter @dxt/web test`) and Playwright e2e at 1440 / 390 (`pnpm test:e2e`), both in CI.
- **Boards:** Login, MLogin, EmptyStates · **Tables:** profiles, clients, sites, monitors, audit_log
- **Depends on:** S00 (Supabase projects, OAuth client, company domain)
- **Done when:**
  1. A company Google account signs in at `/login` and lands on `/` — locally, on `dxt-monitor-staging` and on one PR preview; a non-company account is refused by the `before_user_created` hook (pgTAP test) and by the proxy (`?error=domain`).
  2. Opening `/incidents/x` signed out → sign-in → back on `/incidents/x`.
  3. `pnpm exec supabase test db` passes locally and in the CI `db` job: anon reads nothing; viewer can't write `sites`; responder updates only own sites; `authenticated` can't UPDATE / DELETE `audit_log`.
  4. `pnpm db:reset` builds from zero with seed; `pnpm db:types` output committed; `pnpm check` green.
  5. spec-checker passes Login, MLogin, EmptyStates at 390 and 1440 px, light and dark.
- **Review:** security-reviewer, db-reviewer, spec-checker.

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
- **Review:** security-reviewer (Job API, Storage, VPS unit), db-reviewer (pgmq queues, leases), engine-reviewer.

### S04 · PROBLEM triggers, flapping & status rules

- **Scope:** FR-03 complete. PROBLEM triggers: slow (p50 over the tier threshold 3 rounds), keyword must / must-not, key page 4xx / 5xx, regional (one location ≥ 5 min), redirect outside the allowlist. Only the primary monitor can make a site DOWN; `< 2` locations → Admin alert. Relapse + flapping (D-004). Wire the rules that already exist in `@dxt/engine` into the engine cron — `faultyLocations`, `isRegionalProblem`, `autoResolves`, the D-003 lifecycle — with integration tests. ChatAlert PROBLEM rows (the 60-min PROBLEM reminder belongs to S08). Test target gains keyword-missing and slow modes.
- **Boards:** StatusModel · **Test plan:** T01 (the expiring-cert path finishes in S13)
- **Depends on:** S03
- **Done when:**
  1. **T01:** each test-target mode gives the StatusModel outcome on staging — 200 → OK, 500 / timeout → DOWN, 403-challenge + loads → OK with note, keyword missing → PROBLEM (Keyword), slow 3 rounds → PROBLEM (Slow).
  2. Engine tests cover every StatusModel row, D-003, and D-004 with the VOCA sample (flapped ×4 → one incident, 41 min down, one ack).
  3. A key-page monitor returning 500 while the home page is fine gives PROBLEM, never DOWN (test).
  4. message-checker passes the PROBLEM rows.
- **Review:** engine-reviewer, message-checker.

### S05 · Sites & monitors

- **Scope:** FR-01. `/sites` list, Add site with the registration checklist, Edit monitors (URL, method, expected status, timeout, keywords, headers, thresholds, primary, key pages, redirect allowlist). An owner must have signed in once and have a notification channel (PRD §3). Monitor URLs rejected when they resolve to private, link-local or metadata addresses. Every change writes `audit_log` with before / after. Production clients and AMs load from a reviewed SQL script (UI in S17).
- **Boards:** AddSite, EditMonitors · route `/sites`
- **Depends on:** S01 (S02a for probes to pick the monitors up)
- **Done when:**
  1. All 17 sites and their primary monitors are entered through the UI on production with owner, backup, client and hosting (PRD §12 MVP exit: "ข้อมูล 17 เว็บครบ 100%").
  2. `http://169.254.169.254/`, `http://10.0.0.5/` and a hostname resolving to `127.0.0.1` are rejected (tests).
  3. Create / update / delete of a site or monitor each leave one `audit_log` row with before / after (test).
  4. spec-checker passes AddSite and EditMonitors; nav "Sites" is live.
- **Review:** spec-checker, security-reviewer (SSRF, RLS).

### S06 · Overview dashboard & site detail

- **Scope:** FR-05, FR-08. Overview (desktop, mobile, dark NOC): X/17 OK, status per site with Realtime, filters (tier, owner, client), 24 h sparkline, open incidents; the "Maintenance & mutes" card lands in S09. Site detail: uptime 24 h / 7 d / 30 d / 90 d, response time per location, incident history, check log. `check_rollups` hourly and daily via pg_cron (daily kept 2 years); partition create / drop jobs (90-day raw retention).
- **Boards:** Main, MOverview, MainDark, SiteDetail, MSite · **Tables:** check_rollups
- **Depends on:** S02a, S05
- **Done when:**
  1. With 17 sites and 90 days of generated check data on staging, `/` renders in < 2 s (server timing in the PR) and a status change shows in < 5 s via Realtime (PRD §9).
  2. Site detail uptime for the seeded sample equals `siteUptime` (MuvMi 30 d = 99.77%).
  3. pg_cron jobs exist for hourly / daily rollups, next-month partition and dropping raw partitions > 90 days (SQL test).
  4. spec-checker passes all five boards at 390 / 820 / 1440, light and dark; the Overview nav item (live since S01 as the landing page) now shows the real dashboard.
- **Review:** spec-checker, db-reviewer, security-reviewer (rollup grants, Realtime).

### S07 · Incidents, timeline & resolve

- **Scope:** FR-06. Incidents list (filters, "N short PROBLEMs auto-resolved (hidden)"), Incident detail (state badges §11 / §14.3, timeline that only grows, notes, root cause, MTTA / MTTR), mobile list and detail, Resolve dialog with the three conditions, resolve held 10 s, NOTE and RESOLVED Chat replies, RESOLVED email. Until S11 builds the client-update track it never fires, so that condition shows "Not required" (D-002, spec §16.2).
- **Boards:** Incidents, MIncidents, Incident, MIncident, Resolve · **Test plan:** T10
- **Depends on:** S04
- **Done when:**
  1. **T10:** Resolve stays disabled, naming the unmet condition, until OK 2 rounds + client update (or Not required) + root cause; "Unknown — keep investigating" doesn't count (UI test + engine test).
  2. Each incident state renders the exact badge from spec §11 / §14.3 (component test per state).
  3. A note appears on the timeline and as `NOTE · <site> · <name>: …` in the thread; RESOLVED goes to everyone who got the DOWN email, after the 10 s hold.
  4. spec-checker passes the five boards; nav "Incidents" live.
- **Review:** spec-checker, engine-reviewer (resolve gate), message-checker.

### S08 · Escalation L0–L1 & response hours

- **Scope:** FR-09a. `escalation_policies`, `escalation_steps` seeded for Tier 1 DOWN, Tier 2–3 DOWN, PROBLEM. Organisation settings table for response hours (one value for Tier 2–3, spec §14.14) and a company holidays table, seeded (UI in S17). Engine ladder: L0 at confirm, L1 at +15 min to backup + Tao minus anyone already paged; Tier 2–3 timers pause outside response hours and on holidays, resume 09:00; PROBLEM outside hours held until 09:00; reminders every 15 min (DOWN) / 60 min (PROBLEM) in the thread; ack stops L1. Escalation page: policies with L0–L1 editing and the guardrails that apply (§14.7: L0 pinned, ≥ +15 min, ≥ 1 channel).
- **Boards:** Escalation (L0–L1) · **Tables:** escalation_policies, escalation_steps
- **Depends on:** S07
- **Done when:**
  1. Engine tests: INC-0142 → L1 at 10:03:41 (15 min after confirmed 09:48:41); a Tier 2 DOWN confirmed Thu 22:14 (like INC-0139) that stays down → L0 posted at once, L1 at Fri 09:15; the same on a company holiday → L1 on the next working day; ack at 10:07 → no L1.
  2. On staging, an unacknowledged DOWN posts `ESCALATED · L1` mentioning the backup with "Tao FYI" 15 min after confirm.
  3. Saving a step < +15 min or with no channel is refused with the spec's message (UI test).
  4. spec-checker passes Escalation for L0–L1; nav "Escalation policies" live.
- **Review:** engine-reviewer, message-checker, spec-checker, security-reviewer, db-reviewer.

### S09 · Maintenance windows & mute

- **Scope:** FR-10a and FR-14 (pulled forward from P1: the Maintenance dialog's guard offers Mute, so both ship together). One-off windows: schedule, suppress alerts, excluded from uptime, reason required, > 24 h needs Admin approval (Admins approve their own), can't start on a DOWN site or one with an open incident (§14.5). Mute: reason required, max 24 h, auto-expires, stops new alerts only and never counts as an ack (§15.1). End early / edit / cancel from the Overview "Maintenance & mutes" card, all logged.
- **Boards:** Maintenance, MMaintenance · **Tables:** maintenance_windows · **Test plan:** T09
- **Depends on:** S06, S08
- **Done when:**
  1. **T09:** muting a site with an open incident keeps its escalation running (test); the L3 FYI and client-update parts are re-checked in S10 / S11.
  2. Starting a window now on a DOWN site is blocked with the spec text and offers Mute.
  3. Uptime for a site with a 2 h window excludes those minutes from both sides (test).
  4. A Responder's 30 h window waits for Admin approval; a 25 h mute is refused.
  5. spec-checker passes Maintenance and MMaintenance; nav "Maintenance" live.
- **Review:** spec-checker, engine-reviewer, security-reviewer, db-reviewer.

### G1 · MVP gate (PRD §12 Phase 1 exit)

- ข้อมูล 17 เว็บครบ 100% ก่อน go-live (S05 Done-when 1).
- DOWN จำลองแล้ว alert ถึงภายใน 3 นาที — on production, against the test target, for a Tier 1 monitor.
- A second Admin is active with 2-step (PRD §9: "ต้องมี admin คนที่ 2 ก่อน Phase 2"), and Healthchecks alerts go to both Admins. They are added to `.github/CODEOWNERS`, and the GitHub ruleset "main" now requires 1 approving review from a code owner.
- `docs/runbook.md` v1 exists and the second Admin has walked through it once: what each heartbeat / Healthchecks alert means, restarting the VPS agent, checking Vercel Cron and function logs, pausing alerts with maintenance, rotating `CRON_SECRET` / `INGEST_TOKEN` / webhook URLs, and who to call (PRD §13 bus-factor mitigation).
- From here every production deploy happens inside a maintenance window, and the parallel run with the CEO's hourly monitor starts; S19 keeps its log.

## Phase 2 — Team go-live, P1

### S10 · Escalation L2–L3 & on-call

- **Scope:** FR-09b. L2 CEO step tagged "Proposal · pending CEO" and off until approved; voice "Configured · off until approved"; Tier 1 L3 FYI to CEO + AM at +60 min even after ack, never a call; Tier 2–3 L2 reminder to Tao. Full editor guardrails (§14.7, §15.5). `oncall_shifts`, rotation page, swap request / accept, hand over shift with reason, reminder a day before, on-call phone checklist with test alert; Tier 1 nights, weekends and holidays page the on-call person.
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

- **Scope:** FR-20. At Tier 1 DOWN 15 min from the first failed check (D-002) or Tier 2 DOWN 60 min inside response hours: AM mentioned in the thread with a TH / EN draft and a "Client update due" email. Incident card: AM, due time, draft, Mark client updated (who + when), Not needed + reason, Copy draft. Permissions §16.6; locked in the "acknowledge only" state. Feeds the resolve condition and "Client notified".
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
- **Depends on:** S06, S10, S11
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

### S16 · Users, access & 2-step

- **Scope:** Users & roles (invite, change role, deactivate with the "Used in" check and reassignment, §14.9), Security (2-step required date, sessions, confirm dialogs), Profile (notification channels, on-call checklist). Google Workspace 2-Step status through the Admin SDK (Directory API `isEnrolledIn2Sv`, question Q6); people without it can view + acknowledge only (§15.2, §16.7).
- **Boards:** Users, Security, Profile · **Test plan:** T12
- **Depends on:** S10
- **Done when:**
  1. **T12:** a user without 2-step after the required date can acknowledge, and mute / maintenance / resolve / mark client update are locked with the spec text.
  2. Changing Nok's role lists every place Nok is used (escalation levels, AM, owner / backup, shifts) and won't save until each is reassigned.
  3. After "Sign out everywhere", the person's refresh tokens are rejected and their sessions stop working within the JWT lifetime (`jwt_expiry` = 3600 s) (test).
  4. spec-checker passes Users, Security, Profile; nav "Settings" live.
- **Review:** security-reviewer, spec-checker.

### S17 · Alert channels & organisation settings

- **Scope:** Alert channels & routing ("who gets what" with DOWN / PROBLEM rows read-only, delivery log, test alert in its own thread). Organisation: tiers, clients & AMs, response hours for Tier 2–3 (confirm with before / after, "Affects N sites"), company holidays, data retention, cost.
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
| R4 | Alert fatigue during the parallel run | Majority vote, dedupe and flapping (S04, D-004); false-alert review in the S19 log. |

## Open questions for Tao

| # | Question | Blocks |
|---|---|---|
| Q1 | The spec's "2-step required from Mon 5 Oct" is before MVP go-live. Is it a Google Workspace policy date independent of the app, or should the app's lock start at team go-live? | S16 date only |
| Q2 | PDF renderer for monthly reports (server-side React PDF vs headless Chromium on the VPS). | S20 |
| Q3 | Voice call at L2: CEO (current design) or owner / on-call (original intent)? PRD §13. | S10 (off by default either way) |
| Q4 | Healthchecks grace time and recipients for the verifier, VPS watchdog and daily digest (design: 3 min / 30 min, email Tao). PRD §13. | S12, S14 |
| Q5 | Confirm synthetic checks cap at PROBLEM. PRD §13. | S23 |
| Q6 | Google Workspace admin access for the Directory API (2-Step status) — a service account with domain-wide delegation. | S16 |
| Q7 | ~~Timeline: re-baseline, add a developer, or cut scope?~~ **Answered 28 Sep 2026:** measure S02a first, then decide with real numbers. | — |

## Appendix — coverage matrix

Every FR, board, table and go-live test item maps to exactly one slice (`pnpm plan:check`).

### Functional requirements

| FR | Slice |
|---|---|
| FR-01 | S05 |
| FR-02 | S02a |
| FR-03 | S04 |
| FR-04 | S03 |
| FR-05 | S06 |
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
| StatusModel | S04 |
| AddSite | S05 |
| EditMonitors | S05 |
| Main | S06 |
| MOverview | S06 |
| MainDark | S06 |
| SiteDetail | S06 |
| MSite | S06 |
| Incidents | S07 |
| MIncidents | S07 |
| Incident | S07 |
| MIncident | S07 |
| Resolve | S07 |
| Escalation | S08 |
| Maintenance | S09 |
| MMaintenance | S09 |
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

Tables the plan adds beyond PRD §11: organisation settings and company holidays (S08), API keys and webhooks (S24), `private.allowed_email_domains` (done, migration 0002).

### Go-live test plan (PRD §12)

| Test | What | Slice |
|---|---|---|
| T01 | Staging site forced through every status path | S04 |
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
| T12 | No 2-step after the required date → ack only | S16 |
