# DxT Monitor

Website monitoring and incident automation for the 17 sites DxT runs: checks every 1–5 min from Bangkok, Singapore and Tokyo, OK / PROBLEM / DOWN with multi-location confirmation, Google Chat + email alerts, escalation with owners, uptime reports. Goal: no client ever finds an outage before we do.

## Sources of truth — read before building anything

| Doc                                  | Governs                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| `docs/decisions.md`                  | Settled PRD-vs-spec conflicts (D-001…) — wins over both      |
| `docs/prd.md`                        | Scope, priority (P0/P1/P2), architecture, data model, budget |
| `docs/dxt-monitor-design-spec.md`    | Screen behaviour, statuses, escalation, UI copy, formats     |
| `docs/design/screens.md`             | Canvas board → route → phase → governing spec sections       |
| `docs/design/canvas/<Board>.dc.html` | Exact layout, copy and states of each of the 44 boards       |
| `docs/design/aura.md`                | How this project uses the AURA design system                 |

**Precedence:** `docs/decisions.md` (settled conflicts, D-xxx) wins over both. Then: on screen behaviour, status logic, UI copy and formats the design spec wins over the PRD; on scope, priority, architecture and budget the PRD wins. Inside the spec, later sections override earlier ones: §14 → §15 → §16 → §17–18. If two sources still conflict, stop and ask — don't pick one silently; record the answer as a new decision.

Sample data in the spec and on the canvas (owners, INC-0142, uptime figures, "Tao") is for mockups and tests only; never hard-code it into product code. Items tagged "Proposal · pending CEO" (L2 CEO page, Twilio voice) are built behind config, off by default.

## Layout

```
apps/web          Next.js 16 App Router on Vercel — UI, route handlers, cron functions (probes sin1/hnd1, engine, notifier), Ingest + Job APIs
apps/vps-agent    Node worker on the Thai VPS — Bangkok probe + Playwright browser verifier; talks only to the Ingest/Job APIs
packages/shared   Domain enums, zod schemas, display formats (dates, durations, percent)
packages/engine   Pure status engine: DOWN rule, rounds, verification, lifecycle, resolve gate, uptime
packages/probe    One HTTP check + pass/fail/blocked classification, shared by every probe location
packages/notifier Google Chat / email message builders
packages/db       Supabase generated types; `@dxt/db/service` = server-only service-role client
supabase/         config.toml, migrations/, seed.sql (dev sample data only)
docs/             PRD, design spec, canvas snapshot, AURA notes
```

Workspace packages export TypeScript source (`exports: ./src/index.ts`); Next transpiles them, tsup bundles them into the agent. Put logic where it can be reused and tested: pure rules in `packages/engine`, formatting in `packages/shared`, never inside a React component or route handler.

## Commands (pnpm 12, Node 22)

```bash
pnpm install
pnpm dev                 # web on http://localhost:3500
pnpm dev:agent           # VPS agent (needs apps/vps-agent/.env)
pnpm check               # lint + typecheck + test — run before saying work is done
pnpm test                # Vitest in every package that has tests
pnpm --filter @dxt/engine test:watch
pnpm build
pnpm db:start | db:stop | db:reset | db:types   # local Supabase (Docker); db:types regenerates packages/db types
```

## Rules

- **TypeScript strict** everywhere, `noUncheckedIndexedAccess` on. No `any`; validate every external input (request bodies, env, webhook payloads) with zod from `@dxt/shared`.
- **AURA only** for UI (`@jirawatpyk/aura-react` ^5.10): components and semantic tokens as drawn; never raw hex or Tailwind palette classes (ESLint fails the build). Icons as components from `@jirawatpyk/aura-react/icons`. See `docs/design/aura.md`.
- **Copy and formats per spec §13**: UI English, no spec codes (FR-xx, P0, table names) in the UI, dates "Fri 25 Sep", durations "1 h 2 min", percent "99.98%". Use the helpers in `@dxt/shared` — don't re-implement them.
- **Time**: store UTC, display Asia/Bangkok (UTC+7).
- **Status badges** follow spec §11 exactly; accent (violet) is reserved for Maintenance among status badges; status never relies on colour alone.
- **Security**: RLS on every table; the service-role key only in server code (`createServiceClient` from `@dxt/db/service`, which is `server-only`; cron and Ingest/Job routes) — never in a Client Component, never on the VPS. Cron routes check `CRON_SECRET`, VPS routes check `INGEST_TOKEN` (constant-time). Secrets live in env only; `.env.example` lists names, never values. `?next=` redirects go through `safeNextPath`, company-domain checks through `isAllowedEmail` (both `@dxt/shared`). New `/api/*` routes need a session unless added to `PUBLIC_PATHS` in `apps/web/src/lib/supabase/proxy.ts` with their own token check. Monitor and webhook URLs must be checked against private/link-local ranges (SSRF) before any probe fetches them.
- **Audit**: every change to config or incident state writes `audit_log` (append-only, before/after).
- **Undo**: ack and resolve hold Chat, email and webhooks for 10 s (`notifications.hold_until`).
- **Tests**: engine rules get table-driven Vitest cases taken from the spec's examples (INC-0142 etc.). A behaviour change without a test is not done.
- **Mobile**: every screen works at 390 px; touch targets ≥ 44 px. Check 390 / 820 / 1440, light and dark.
- **Phase gating**: build P0 (MVP) first; don't start P1/P2 screens unless asked.
- **Git**: branch from `main` (`feat/…`, `fix/…`), Conventional Commits, never commit `.env*` files except `.env.example`.

## Project skills and agents

- `/implement-screen <Board>` — build one canvas board as a route, following screens.md, the spec and AURA.
- `/new-migration <name>` — add a Supabase migration with RLS and regenerate types.
- `/engine-case <rule>` — add a table-driven engine test from a spec example.
- Agents: `spec-checker` (screen vs spec + board), `engine-reviewer` (status/lifecycle logic), `security-reviewer` (RLS, auth, secrets).
