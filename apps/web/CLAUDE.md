# apps/web

Next.js 16 App Router (Turbopack) on Vercel Pro. UI + every Vercel function.

- `src/app/(app)/` — signed-in pages inside `AppShell` + `SideNav` (`src/components/app-shell/`). `src/app/(auth)/` — sign-in. `/status/[clientSlug]` (Phase 3) is public.
- `src/proxy.ts` (Next 16's renamed middleware) refreshes the Supabase session and redirects signed-out people to `/login?next=…`. It doesn't protect `/api/*` — each route checks its own token.
- `src/app/api/cron/*` — Vercel Cron, every minute (`vercel.json`). Wrap handlers with `cronHandler`. Probe regions are pinned in `vercel.json` `functions` (sin1, hnd1), **not** with `preferredRegion` (deprecated, and it doesn't pin Node functions).
- `src/app/api/ingest`, `src/app/api/jobs` — for the VPS agent, bearer `INGEST_TOKEN`.
- Supabase: `src/lib/supabase/server.ts` (Server Components / actions / routes, RLS as the user), `client.ts` (browser, Realtime), service role only via `createServiceClient` from `@dxt/db/service` (server-only) in cron/ingest code.
- Env: server values through `serverEnv()` (`src/lib/env.ts`, validated on first use); add every new variable to `.env.example` too.

## Building a screen

1. Find the board in `docs/design/screens.md`; read its `.dc.html` and every spec section listed.
2. Server Component page loads data; interactive parts (anything passing functions: `onClick`, DataTable `render`) go in a small `'use client'` component next to it.
3. AURA components only. Display components and `formatDate` can come from `@jirawatpyk/aura-react/server`.
4. Styling: AURA props first, then Tailwind utilities that map to AURA tokens (`text-fg-secondary`, `bg-bg-surface`). No inline hex.
5. Empty, loading (Skeleton) and no-access states per the EmptyStates board. No dead controls: a button works or is disabled with its reason (spec §14.16).
6. Check 390 / 820 / 1440 px, light and dark (`pnpm dev`, then the preview browser).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
