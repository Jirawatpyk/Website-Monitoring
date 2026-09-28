# supabase

Local stack: `pnpm db:start` (Docker). Migrations in `migrations/`, applied in filename order; `pnpm db:reset` rebuilds from scratch and runs `seed.sql`.

- One concern per migration: `pnpm exec supabase migration new <name>`. Never edit a migration that has been pushed; add a new one.
- Every table: `id uuid primary key default gen_random_uuid()`, `created_at`, `updated_at` (trigger), **RLS enabled in the same migration** with policies per role (PRD §3): admin all; responder own sites (+ Tier 1 while on call); stakeholder read + client updates for own clients; viewer read-only.
- Enums mirror `packages/shared/src/domain.ts` — change both together.
- `check_results`: monthly partitions, 90-day retention via pg_cron; `check_rollups` kept 2 years; `audit_log` append-only (no UPDATE/DELETE policies, revoke from `authenticated`).
- Every table's policies get pgTAP tests in `supabase/tests/` (`pnpm exec supabase test db`): allowed and refused access per role.
- After a schema change run `pnpm db:types` and commit `packages/db/src/database.types.ts`.
- `seed.sql` is dev sample data from the design spec; never production data.
- `auto_expose_new_tables = false`: every new table needs explicit `grant … to authenticated` (and RLS) or the API can't see it.
- Sign-up is limited by the `before_user_created` hook (migration 0002). Each environment needs its company domain in `private.allowed_email_domains`; with no row, nobody can sign up.
- "2-step" is Google Workspace 2-Step Verification, not Supabase MFA — reading a user's enrolment needs the Google Admin SDK (Directory API `isEnrolledIn2Sv`). Open implementation question for the Login/Security boards.
- Hosted projects (`docs/workflow.md` → Environments): **staging** only through `pnpm db:push:staging` / `pnpm db:reset:staging` (connection string from `.env.staging.local`, template `scripts/db-staging.env.example`; they refuse the production project). **Production** only through the CI job `migrate-production` on `main`. Never run `supabase link`, and never run `supabase db push` / `db reset` against a hosted project by hand — `.claude/settings.json` denies both.
