# DxT Monitor

Website monitoring and incident automation for the 17 sites DxT runs: checks every 1–5 min from Bangkok, Singapore and Tokyo, OK / PROBLEM / DOWN with multi-location confirmation, Google Chat + email alerts, escalation with owners, uptime reports. Goal: no client ever finds an outage before we do.

## Sources of truth — read before building anything

| Doc                                  | Governs                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| `docs/implementation-plan.md`        | What to build next: slices, dependencies, "Done when", status |
| `docs/workflow.md`                   | How a slice moves from branch to Done; Definition of Done     |
| `docs/decisions.md`                  | Settled PRD-vs-spec conflicts (D-001…) — wins over both       |
| `docs/prd.md`                        | Scope, priority (P0/P1/P2), architecture, data model, budget  |
| `docs/dxt-monitor-design-spec.md`    | Screen behaviour, statuses, escalation, UI copy, formats      |
| `docs/design/screens.md`             | Canvas board → route → phase → governing spec sections        |
| `docs/design/canvas/<Board>.dc.html` | Exact layout, copy and states of each of the 44 boards        |
| `docs/design/aura.md`                | How this project uses the AURA design system                  |

**Precedence:** `docs/decisions.md` (settled conflicts, D-xxx) wins over everything. Then: on screen behaviour, status logic, UI copy and formats the design spec wins over the PRD; on scope, priority, architecture and budget the PRD wins. The canvas boards give layout, exact copy and states; where a board and the spec text disagree on behaviour, the spec wins (spec §0: the canvas shows how it looks, the spec says how it behaves). Inside the spec, later sections override earlier ones: §14 → §15 → §16 → §17–18. If two sources still conflict, stop and ask — don't pick one silently; record the answer as a new decision.

Sample data in the spec and on the canvas (owners, INC-0142, uptime figures, "Tao") is for mockups and tests only; never hard-code it into product code. The CEO answered the spec's "Proposal · pending CEO" items on 5 Oct 2026 (D-009): the Tier 1 L2 CEO page is approved and on by default, and the pending tag is not shown; Twilio voice stays built behind config, off.

## Layout

```
apps/web          Next.js 16 App Router on Vercel — UI, route handlers, cron functions (probes sin1/hnd1, engine, notifier), Ingest + Job APIs
apps/vps-agent    Node worker on the Thai VPS — Bangkok probe + Playwright browser verifier; talks only to the Ingest/Job APIs
packages/shared   Domain enums, zod schemas, display formats (dates, durations, percent)
packages/engine   Pure status engine: DOWN rule, rounds, verification, lifecycle, resolve gate, uptime
packages/probe    One HTTP check + pass/fail/blocked classification, shared by every probe location
packages/notifier Google Chat / email message builders
packages/db       Supabase generated types; `@dxt/db/service` = server-only service-role client
supabase/         config.toml, migrations/, tests/ (pgTAP), seed.sql (dev sample data only)
docs/             plan, workflow, decisions, retro log, runbook, PRD, design spec, canvas snapshot, AURA notes, phase0/ captures
scripts/          repo checks (check-plan-coverage.mjs, pr-merge.mjs, db-staging.mjs) and the project ESLint plugin `dxt` (eslint/index.mjs: feature-boundaries, design-tokens)
```

Inside `apps/web/src`: `app/` holds thin routes, `features/<area>/` holds each domain's UI, queries, actions and schemas behind two public entries (`index.ts`, `server.ts`), `components/` and `lib/` are shared layers, `server/` runs background work. Full tree and rules: `apps/web/CLAUDE.md` → Folder structure; ESLint `dxt/feature-boundaries` enforces them.

Workspace packages export TypeScript source (`exports: ./src/index.ts`); Next transpiles them, tsup bundles them into the agent. Put logic where it can be reused and tested: pure rules in `packages/engine`, formatting in `packages/shared`, never inside a React component or route handler.

## Commands (pnpm 12, Node 22)

```bash
pnpm install
pnpm dev                 # web on http://localhost:3500
pnpm dev:agent           # VPS agent (needs apps/vps-agent/.env)
pnpm check               # format + plan coverage + lint + typecheck + test — run before saying work is done
pnpm plan:check          # every FR, board, table and go-live test maps to one slice
pnpm pr:merge <number>   # squash-merge a PR only if CI `check` is green on its head (D-008)
pnpm test                # Vitest in every package that has tests (web: jsdom + Testing Library)
pnpm test:coverage       # the same tests with coverage thresholds (what CI runs)
pnpm test:e2e            # Playwright against the web app, desktop 1440 + mobile 390 (starts `pnpm dev` if needed)
pnpm --filter @dxt/engine test:watch
pnpm build
pnpm db:start | db:stop | db:reset | db:types   # local Supabase (Docker); db:types regenerates packages/db types
pnpm db:push:staging | db:reset:staging          # staging database only (refuses production); asks first
```

## Rules

- **TypeScript strict** everywhere, `noUncheckedIndexedAccess` on. No `any`; validate every external input (request bodies, env, webhook payloads) with zod from `@dxt/shared`.
- **AURA only** for UI (`@jirawatpyk/aura-react` ^5.31): components and semantic tokens as drawn; never raw hex or Tailwind palette classes (ESLint fails the build). **No hard-coded design values**: spacing, sizes, radii, shadows, z-index and colours come from AURA tokens (`p-aura-4`, `rounded-aura-md`, `shadow-aura-overlay`, `var(--aura-…)`) or the Tailwind scale (`gap-2`, same 4 px grid) — never `p-[13px]`, `bg-[#fff]`, `z-[99]` or literal lengths/colours in `style={{…}}`. ESLint `dxt/no-hardcoded-design-values` fails the build; a real exception needs `eslint-disable-next-line … -- <reason>`. Icons as components from `@jirawatpyk/aura-react/icons`. See `docs/design/aura.md`.
- **Copy and formats per spec §13**: UI English, no spec codes (FR-xx, P0, table names) in the UI, dates "Fri 25 Sep", durations "1 h 2 min", percent "99.98%". Use the helpers in `@dxt/shared` — don't re-implement them.
- **Time**: store UTC, display Asia/Bangkok (UTC+7).
- **Status badges** follow spec §11 exactly; accent (violet) is reserved for Maintenance among status badges; status never relies on colour alone.
- **Security**: RLS on every table; the service-role key only in server code (`createServiceClient` from `@dxt/db/service`, which is `server-only`; cron and Ingest/Job routes) — never in a Client Component, never on the VPS. Cron routes check `CRON_SECRET`, VPS routes check `INGEST_TOKEN` (constant-time). Secrets live in env only; `.env.example` lists names, never values. `?next=` redirects go through `safeNextPath`, company-domain checks through `isAllowedEmail` (both `@dxt/shared`). Sign-up needs the domain and the exact address on the allowlist (`before_user_created` hook, D-007); 2-step is enforced by Google Workspace, never by the app. The repo is private, but never commit real email addresses. New `/api/*` routes need a session unless added to `PUBLIC_PATHS` in `apps/web/src/lib/supabase/proxy.ts` with their own token check. Monitor and webhook URLs must be checked against private/link-local ranges (SSRF) before any probe fetches them.
- **Audit**: every change to config or incident state writes `audit_log` (append-only, before/after).
- **Undo**: ack and resolve hold Chat, email and webhooks for 10 s (`notifications.hold_until`).
- **Tests**: engine rules get table-driven Vitest cases taken from the spec's examples (INC-0142 etc.). A behaviour change without a test is not done. Coverage thresholds live in each package's `vitest.config.ts` (engine 95 / 90 branches; shared, probe, notifier 90 / 85; vps-agent 70 / 60; web logic layers 80 / 75) and only ever go up — never lower one to make a PR pass.
- **Mobile**: every screen works at 390 px; touch targets ≥ 44 px. Check 390 / 820 / 1440, light and dark.
- **Improve when something goes wrong** (`docs/workflow.md` → Continuous improvement): when you get something wrong or against a rule, a reviewer repeats a finding, CI fails for a preventable reason, or a source is stale, propose the strongest fix — a tool guard (lint, test, CI, hook, deny rule) before a written rule — and add one line to `docs/retro.md`. Reviewer findings: High always fixed; Medium fixed or justified in the PR.
- **Work slice by slice** (`docs/implementation-plan.md`, `docs/workflow.md`): one slice per branch and PR; don't start a slice whose dependencies aren't Done; a slice is Done only when every "Done when" line has evidence. Nav items stay hidden (`live: false`) until their slice ships the page.
- **Git**: branch `slice/<ID>-<name>` from `main` (`fix/…` for hotfixes), Conventional Commits with the slice as scope (`feat(S02a): …`), never commit `.env*` files except `.env.example`. `main` is protected by our own guards (D-008 — private repo on GitHub Free, so GitHub doesn't enforce the ruleset): changes land only by PR, merged with `pnpm pr:merge <number>` once CI `check` is green — never push to `main`, never `gh pr merge` directly. `staging` is a throwaway branch deployed by the `dxt-monitor-staging` Vercel project (D-006): push a slice onto it to verify, reset it to `main` after the merge. Staging database: `pnpm db:push:staging` / `pnpm db:reset:staging` only; production migrations only via the CI job `migrate-production`. Never run `supabase link`. Push branches and open PRs only when asked.

## Project skills and agents

Skills:

- `/slice <ID>` — start or continue a slice: check dependencies, branch, load its sources, plan, build.
- `/slice-review <ID>` — run `/code-review`, the slice's reviewers and `/verify`, collect evidence per "Done when" line, update its status, then a short retro.
- `/implement-screen <Board>` — build one canvas board as a route, following screens.md, the spec and AURA.
- `/new-migration <name>` — add a Supabase migration with RLS and regenerate types.
- `/engine-case <rule>` — add a table-driven engine test from a spec example.

Built-in: `/code-review high` on every slice's diff (general bugs; the agents below check the domain). `/verify` runs the app at the change's surface and captures runtime evidence; `slice-verifier` checks the evidence covers every Done-when line. Both run inside `/slice-review`.

Agents (read-only reviewers; which one runs when is in `docs/workflow.md`):

- `spec-checker` — a screen vs its board and the spec.
- `engine-reviewer` — status, lifecycle, escalation and notification timing.
- `message-checker` — Chat / email / digest / webhook content vs ChatAlert, EmailAlert, WeeklySummary.
- `security-reviewer` — RLS, auth, secrets, API surface, the VPS.
- `db-reviewer` — tables, indexes, partitions, retention, rollups, query plans.
- `slice-verifier` — whether a slice's "Done when" lines are really met.
