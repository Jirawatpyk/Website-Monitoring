# DxT Monitor

Website monitoring and incident automation for DxT's 17 client and internal sites: multi-location checks (Bangkok, Singapore, Tokyo), OK / PROBLEM / DOWN with confirmation, Google Chat + email alerts, escalation with owners and on-call, uptime reports.

- **Implementation plan (slices, Done when, status):** [`docs/implementation-plan.md`](docs/implementation-plan.md) · **Workflow:** [`docs/workflow.md`](docs/workflow.md) · **Decisions:** [`docs/decisions.md`](docs/decisions.md)
- **PRD:** [`docs/prd.md`](docs/prd.md) ([Claude Doc](https://claude.ai/artifact/Mz596TqTLewVQ3EjRBqudL))
- **Design spec:** [`docs/dxt-monitor-design-spec.md`](docs/dxt-monitor-design-spec.md)
- **Design canvas (44 boards):** [claude.ai/artifact/Sqa6gYe5eGqTQtBFmjbyMW](https://claude.ai/artifact/Sqa6gYe5eGqTQtBFmjbyMW) · local snapshot and screen map in [`docs/design/`](docs/design/README.md)
- **AURA design system:** [claude.ai/artifact/X85Noq8acCgW1oryP1vwZq](https://claude.ai/artifact/X85Noq8acCgW1oryP1vwZq) · [`docs/design/aura.md`](docs/design/aura.md)

## Stack

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + AURA on Vercel Pro · Supabase (Postgres, Auth with Google SSO, RLS, Realtime, pgmq, pg_cron) · Thai VPS for the Bangkok probe and Playwright verifier · Google Chat webhooks, Resend, Healthchecks.io.

## Getting started

Requirements: Node 22.18+, pnpm 12 (`corepack enable`), Docker (for local Supabase).

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local     # fill in values
pnpm db:start                                   # local Supabase; prints URL + keys
pnpm dev                                        # http://localhost:3500
```

`pnpm dev` needs `apps/web/.env.local` with at least the two `NEXT_PUBLIC_SUPABASE_*` values — without them the auth proxy fails on every page. Set `ALLOWED_EMAIL_DOMAIN` and add the same domain to `private.allowed_email_domains` (see `supabase/CLAUDE.md`), or every sign-in is rejected — both checks fail closed. Port 3500 is used because 3000 is in a Windows reserved port range on some machines.

| Command              | What it does                                                            |
| -------------------- | ----------------------------------------------------------------------- |
| `pnpm check`         | format + plan coverage + lint + typecheck + tests (run before every PR) |
| `pnpm plan:check`    | checks every FR, board, table and go-live test maps to one slice        |
| `pnpm test`          | Vitest in every package that has tests                                  |
| `pnpm test:coverage` | unit + integration tests with coverage thresholds (CI)                  |
| `pnpm test:e2e`      | Playwright e2e for the web app (desktop 1440 + mobile 390)              |
| `pnpm build`         | builds the web app and the VPS agent                                    |
| `pnpm db:reset`      | rebuilds the local database from migrations + seed                      |
| `pnpm db:types`      | regenerates `packages/db/src/database.types.ts`                         |

## Repository layout

```
apps/web          Next.js app + Vercel functions (cron probes, engine, notifier, Ingest/Job APIs)
apps/vps-agent    Bangkok probe + browser verifier (systemd on the Thai VPS)
packages/shared   domain enums, zod schemas, display formats
packages/engine   pure status engine (DOWN rule, lifecycle, resolve gate, uptime)
packages/probe    HTTP check + pass/fail/blocked classification
packages/notifier Google Chat / email message builders
packages/db       Supabase types + server-only service client (`@dxt/db/service`)
supabase/         config, migrations, dev seed
docs/             plan, workflow, decisions, PRD, design spec, canvas snapshot, AURA notes
scripts/          repo checks
```

## Working with Claude Code

`CLAUDE.md` (root and per package) holds the project rules; `docs/workflow.md` holds the slice lifecycle. Start a slice with `/slice <ID>` and close it with `/slice-review <ID>`. Other skills: `/implement-screen <Board>`, `/new-migration <name>`, `/engine-case <rule>`. Review agents: `spec-checker`, `engine-reviewer`, `message-checker`, `security-reviewer`, `db-reviewer`, `slice-verifier`. A PostToolUse hook formats every file Claude writes with Prettier. The Supabase MCP server in `.mcp.json` is read-only; sign in when Claude Code first asks.
