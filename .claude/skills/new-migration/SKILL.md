---
name: new-migration
description: Add a Supabase migration for DxT Monitor with RLS policies, indexes and regenerated types. Use when a table, column, enum, policy, function or index needs to change.
argument-hint: <short_snake_case_name>
---

# New migration: $ARGUMENTS

1. Read `supabase/CLAUDE.md`, the PRD §11 row(s) for the tables involved, PRD §3 (roles) and the existing files in `supabase/migrations/` so names and enums stay consistent.
2. Create the file: `pnpm exec supabase migration new $ARGUMENTS` (never edit an already-applied migration).
3. Write the SQL:
   - `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, `updated_at` + trigger.
   - `alter table … enable row level security;` in the same file, then policies for each role (select / insert / update / delete, `using` and `with check`). Default deny.
   - Foreign keys with explicit `on delete`; indexes from PRD §11 "Indexing & retention"; `security definer` functions pin `set search_path = ''`.
   - Enum changes mirror `packages/shared/src/domain.ts` — update both.
   - `audit_log`: no UPDATE/DELETE policies; revoke those privileges.
4. Add pgTAP tests in `supabase/tests/` for each role's allowed and refused access; run `pnpm exec supabase test db`.
5. Apply and regenerate: `pnpm db:reset` (asks first — it wipes local data), then `pnpm db:types`.
6. `pnpm typecheck` to catch code that no longer matches the schema.
7. Ask the `security-reviewer` agent to review the policies and grants, and `db-reviewer` to review tables, indexes, partitions and jobs (in parallel).
8. Report the tables/policies added and anything left for a follow-up migration.
