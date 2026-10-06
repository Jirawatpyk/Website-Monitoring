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
- Sign-up is limited by the `before_user_created` hook (D-007): the domain must be in `private.allowed_email_domains` **and** the exact lower-cased address in `private.allowed_emails (email, role)`; with no row, nobody can sign up. The first sign-in creates `profiles` with the allowlisted role (`private.handle_new_user`). Admins edit the list per environment with `access/allowlist.template.sql` (placeholders only — real addresses are inserted in each database and never committed). Hosted projects also need Auth → Hooks → `before_user_created` → `public.hook_before_user_created`, and the Google provider on; `config.toml` covers only the local stack.
- RLS helpers: `current_app_role()` (null without an active profile), `is_staff()`, `owns_site(site_id)`, `my_profile_status()`; audit rows through `write_audit(...)`. A Responder may change only the mute fields of own sites (trigger `sites_guard_update`, D-012).
- pgTAP: `pnpm db:test`; each file starts with `begin; \ir _helpers.psql` (`tests.create_user`, `tests.authenticate_as`, `tests.as_anon`) and ends with `rollback`.
- "2-step" is Google Workspace 2-Step Verification, enforced by Workspace (D-007) — not Supabase MFA, and the app never reads or enforces it.
- Hosted projects (`docs/workflow.md` → Environments): **staging** only through `pnpm db:push:staging` / `pnpm db:reset:staging` (connection string from `.env.staging.local`, template `scripts/db-staging.env.example`; they refuse the production project). **Production** only through the CI job `migrate-production` on `main`. Never run `supabase link`, and never run `supabase db push` / `db reset` against a hosted project by hand — `.claude/settings.json` denies both.
