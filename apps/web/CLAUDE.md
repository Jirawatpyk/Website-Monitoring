# apps/web

Next.js 16 App Router (Turbopack) on Vercel Pro. UI + every Vercel function.

- `src/app/(app)/` — signed-in pages inside `AppShell` + `SideNav` (`src/components/app-shell/`); the layout reads `getAccess()` (`src/lib/auth/session.ts`) and sends a session without an active profile to `/auth/refused`. `src/app/(auth)/` — sign-in (`features/auth`); `/auth/sign-in` starts Google OAuth, `/auth/callback` finishes it (D-007, D-011). `/status/[clientSlug]` (Phase 3) is public.
- `src/proxy.ts` (Next 16's renamed middleware) refreshes the Supabase session and redirects signed-out people to `/login?next=…`. It doesn't protect `/api/*` — each route checks its own token.
- `src/app/api/cron/*` — Vercel Cron, every minute (`vercel.json`). Wrap handlers with `cronHandler`. Probe regions are pinned in `vercel.json` `functions` (sin1, hnd1), **not** with `preferredRegion` (deprecated, and it doesn't pin Node functions).
- `src/server/` — the cron work (S02a): `probe/run-probe.ts` (due monitors, check + one recheck in the same run, `check_results` attempt 1 / 2; refuses a wrong `VERCEL_REGION`), `engine/run-engine.ts` (loads facts, `decideSite` from `@dxt/engine` per site, records through the `engine_*` SQL functions), `notifier/dispatch.ts` (claims queued Chat and email messages, renders them with `@dxt/notifier` via `render.ts`, posts in the incident's Chat thread or emails each person through Resend, logs every attempt in `notification_attempts`, retries 30 s / 2 min / 8 min from when the message was due, then marks it failed — a Chat message then queues the fallback emails, D-016). Delivery timing (S02b): a probe whose recheck failed runs the engine and sends at once (`probe-job.ts` → `engine/engine-and-deliver.ts`), so DOWN leaves within 30 s of the confirm (`incidents.detected_at` = the last confirming recheck, PRD §9); the engine cron is the sweep for deadline-judged rounds and recoveries; the ack action sends its incident's held messages right after the 10 s window (`after()`); the notifier cron sweeps retries twice a minute (`runNotifierSweep`). Every dispatch runs Chat and email side by side under a deadline and hands back what it didn't start; one thread leaves in order (`claim_notifications`), and a DOWN that hasn't left by the time the incident moved on is dropped (`superseded`). A delivery failure never fails the engine's or a probe's Healthchecks ping. `notifier/deps.ts` builds the delivery settings from env; email is on only with both `RESEND_API_KEY` and `ALERT_EMAIL_FROM`. Every route wraps its job in `runCronJob` (one JSON log line with the region, Healthchecks ping, summary response). Runners take the db client as a parameter; unit tests use `test/fake-db.ts`, and `*.int.test.ts` run against the local stack with `pnpm --filter @dxt/web test:int` (CI `db` job) — not part of `pnpm check`, so run it after touching `src/server/`.
- `features/incidents` (S02b): `/incidents/[incidentId]` with the MobileAck layout at every width (D-016) — Acknowledge / Undo are Server Actions over the `ack_incident` / `undo_ack` SQL functions, which check who may act and write state, timeline and audit in one transaction; the page only mirrors that rule (`canAcknowledge`) to choose what to show. S07 grows the page into the Incident board.
- `src/app/api/ingest`, `src/app/api/jobs` — for the VPS agent, bearer `INGEST_TOKEN` (S03, `src/server/ingest/`, `src/server/verifier/`). Ingest: `GET` the monitors due for Bangkok (the shared `server/probe/due-monitors.ts`), `POST` a batch stored as BKK (location fixed here, results > 5 min off refused) and beat Bangkok; every batch then runs the engine after the response (`engineAfterReport`) — any Bangkok result can complete a round. Jobs: `GET` beats the verifier (`agent_heartbeats`), expires stale jobs and leases up to 3 for 60 s with a signed upload URL each; `POST` takes a verdict only inside the lease (409 after) and judges the round at once; the engine clears "verifier unavailable" once the verifier works again (≥ 10 min after it opened). The engine (`run-engine.ts` + `verifier-state.ts`) queues a verify job for a blocked round, notes the site, opens PROBLEM (unverified) and the Admin alerts (`system_alerts`, D-019; emails rendered by `renderSystemAlertEmail`). S04a (D-022): probes check every monitor of an active site (key pages too) and store the final URL and keyword result; the engine judges each site with `decideSite` — every monitor's verdict and the site status go to the `engine_*` functions as `p_monitors` / `p_status` (one transaction with the incident change), a PROBLEM opens with its worded cause and short summary (`formatProblemCause` / `formatProblemSummary` from `@dxt/notifier`) and queues the `problem` card + owner email, and fewer than 2 beating locations opens the `probe_locations_low` Admin alert. S04b (D-004, D-024): a new drop on a recovered incident goes through `engine_relapse_incident` (state-guarded, so overlapping runs send one DOWN AGAIN / PROBLEM AGAIN); `site_status.flips` / `flip_ok` feed the flapping rule; a flapping recovery queues `flap_summary` (Chat + owner email) held 15 min instead of RECOVERED; a short unacknowledged PROBLEM auto-resolves; a D-023 partial recovery calls recover then relapse from the same round. The engine reads checks, carries and verify jobs through `engine_checks` (keyset) / `engine_monitor_status` / `engine_verify_jobs` — no monitor ids in a query string; `test/fake-db.ts` keeps those read RPCs out of `rpcCalls` (`readCalls`). `render.ts` words the drops from the timeline (`episodesOf`) and RECOVERED from its own `recoveredAt`. `/api/cron/housekeeping` (daily 20:30 UTC) removes screenshots and job rows older than 30 days through the Storage API.
- Supabase: `src/lib/supabase/server.ts` (Server Components / actions / routes, RLS as the user), `client.ts` (browser, Realtime), service role only via `createServiceClient` from `@dxt/db/service` (server-only) in cron/ingest code.
- Env: server values through `serverEnv()` (`src/lib/env.ts`, validated on first use); add every new variable to `.env.example` too.

## Folder structure

```
src/
  app/                      routes only, kept thin: page, layout, route, loading, error
    (app)/<route>/page.tsx  loads data through a feature and renders its components
    (auth)/  api/  auth/callback/
  features/<area>/          one folder per domain: overview, sites, incidents, escalation, maintenance,
                            oncall, expiry, audit, settings, reports, guide …
    index.ts                public entry, client-safe: components and types other code may use
    server.ts               public entry, server-only (`import 'server-only'`): queries and actions
    components/             the feature's UI — one component tree serves desktop and mobile
    queries.ts              server data loaders (RLS as the signed-in user)
    actions.ts              Server Actions: zod → role check → audit_log → hold messages 10 s
    schemas.ts              zod input schemas
    *.test.ts(x)            tests next to the code
  components/               UI shared by several features (app-shell, status badges, empty states, time)
  lib/                      infrastructure: supabase clients, auth, env, audit helper
  server/                   background work the cron / API routes call: engine runner, notifier dispatch,
                            probe runner (service-role, never imported by UI)
  proxy.ts
```

Rules — enforced by `dxt/feature-boundaries` in ESLint (`scripts/eslint/feature-boundaries.mjs`):

- Another feature is reached only through `@/features/<name>` or `@/features/<name>/server`; never a deep path into its folders.
- Layers point one way: `app` → `features` → `components` / `lib`. `components/` and `lib/` never import `features/` or `app/`; `features/` and `server/` never import `app/`.
- Inside a feature, import its own files relatively or by alias — anything goes.
- Something two features both need moves down to `components/` (UI), `lib/` (infrastructure) or a workspace package (domain rules → `@dxt/engine`, formats → `@dxt/shared`), never sideways.
- Create a feature folder when its first slice needs it; no empty folders or `.gitkeep`.

## Building a screen

1. Find the board in `docs/design/screens.md`; read its `.dc.html` and every spec section listed.
2. Start the page with AURA's `PageHeader` (eyebrow, h1, meta line, actions; also from `/server`). A breadcrumb replaces the eyebrow: pass AURA `Breadcrumb` in `PageHeader`'s `breadcrumb` slot (AURA 5.33; never inside `eyebrow`, which is a `<p>`), and the 4 px gaps hold on every page even where a board draws 6 / 10 / 12 px (D-018). AURA AppShell already pads the page (32 px on desktop, as the boards' `main`); don't add top padding of your own. The route's `page.tsx` (Server Component) calls the feature's `server.ts` for data and renders components from its `index.ts`; interactive parts (anything passing functions: `onClick`, DataTable `render`) are small `'use client'` components in `features/<area>/components/`.
3. AURA components only. Display components and `formatDate` can come from `@jirawatpyk/aura-react/server`.
4. Styling: AURA props first, then Tailwind utilities that map to AURA tokens (`text-fg-secondary`, `bg-bg-surface`, `p-aura-4`). No hard-coded colours, spacing, sizes, radii, shadows or z-index — enforced by `dxt/no-hardcoded-design-values` (`scripts/eslint/design-tokens.mjs`).
5. Empty, loading (Skeleton) and no-access states per the EmptyStates board. No dead controls: a button works or is disabled with its reason (spec §14.16).
6. Check 390 / 820 / 1440 px, light and dark (`pnpm dev`, then the preview browser).
7. When the slice that owns the page is done, flip its item to `live: true` in `src/components/app-shell/nav.tsx` (each item names its slice). Screens are built inside a slice — start with `/slice <ID>`, not on their own.

## Testing

- Unit / component tests: `src/**/*.test.ts(x)` with Vitest + Testing Library in jsdom (`vitest.config.ts`, `test/setup.ts` stubs `matchMedia`, `ResizeObserver` and `server-only`). Run `pnpm --filter @dxt/web test`.
- E2E: `e2e/*.spec.ts` with Playwright, projects `desktop` (1440) and `mobile` (390). `pnpm test:e2e` starts `pnpm dev` on :3500 (or reuses it) with placeholder Supabase values — enough for signed-out flows. Signed-in flows (`e2e/auth.spec.ts`) run against the local stack: `pnpm db:start`, `pnpm db:reset`, then `E2E_LOCAL_SUPABASE=1 pnpm test:e2e` with the dev server pointed at it (launch config `web-local-db`); they're skipped otherwise, including in CI.
- Coverage (`pnpm --filter @dxt/web test:coverage`) measures the logic layers — `lib/`, `features/`, `server/`, `components/` — with thresholds 80 lines / 75 branches / 70 functions. Tests that need Node APIs such as `NextRequest` start with `// @vitest-environment node`; server env comes from `test/env.ts` (`stubServerEnv`).
- `e2e/layout-consistency.spec.ts` (signed in as the seeded Admin, CI `db` job) checks every live nav page at 390 / 820 / 1440: header 4 px rhythm, phone top bar, 44 px tap areas, no sideways scroll (D-018). A page that flips `live` must pass it.
- Signed-in e2e that need an incident (`e2e/ack.spec.ts`) create their own `E2E …` site through `openTestIncident`; `pnpm db:reset` clears them.
- `src/components/app-shell/nav.test.ts` fails if a nav item links to a page that doesn't exist — flip `live` only with the page.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
