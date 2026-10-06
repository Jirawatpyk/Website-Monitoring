# Retro log

One line per lesson: what went wrong or slow, and the change that stops it happening again. How and when: [`workflow.md` → Continuous improvement](workflow.md#continuous-improvement). Newest first. Prefer a guard in a tool over a sentence in a document.

| Date | What happened | What changed | Where |
| --- | --- | --- | --- |
| 6 Oct 2026 | Committed DB types went stale after a late migration edit; typecheck passed because no code used the dropped column (slice-verifier) | The CI `db` job regenerates the types and fails on any diff | S01 close-out |
| 6 Oct 2026 | Signed-in e2e flows were skipped in CI (no database in `check`), against "no skipped tests" | The CI `db` job builds the web app and runs `e2e/auth.spec.ts` against its local stack | S01 close-out |
| 6 Oct 2026 | Claude asked Tao to check the PR preview instead of checking it itself | Claude verifies staging / previews in the browser pane; asks only for sign-in or secrets | S01 |
| 6 Oct 2026 | `pnpm db:reset:staging` would have loaded the dev seed (fake users, `example.test` allowlist, 17 fake monitors) onto staging; found by `/code-review` | The script always passes `--no-seed`; test added | S01 |
| 6 Oct 2026 | Sign-up trusted any provider: with a project's Email provider left on, an allowlisted address could be claimed with a password (security-reviewer) | The hook and `handle_new_user` accept Google only (`.test` excepted for local); pgTAP covers it | S01 |
| 6 Oct 2026 | RLS helpers ran once per row (359 ms vs 7.7 ms on 50k rows, db-reviewer) | Policies wrap them as `(select …)`; rule in `supabase/CLAUDE.md` | S01 |
| 6 Oct 2026 | Bash heredocs with `$$` or curly quotes failed on Windows Git Bash several times | Write files with the Write tool (or a script file), not multi-line heredocs | S01 |
| 1 Oct 2026 | Plan S11 still described the "acknowledge only" lock that D-007 removed; the D-007 sweep had searched for "2-step" only | Line fixed to point at D-007; when a decision removes a concept, search for every name of it, not one keyword | PR #15 |
| 29 Sep 2026 | Hard-coded spacing and colours were a written rule only | ESLint `dxt/no-hardcoded-design-values` fails the build | PR #13 |
| 29 Sep 2026 | A downloaded Google OAuth client secret (JSON) landed in the project folder; only luck kept it out of a commit | `.gitignore` covers `client_secret*.json` and service-account keys; Claude Code is denied reading them | PR #13 |
| 28 Sep 2026 | A PR's CI runs the PR's own workflow files, so an edited workflow could read the repository secret before merge | Claude Code asks before editing `.github/workflows/` / `.github/actions/`; `pnpm pr:merge` refuses CI-file changes without `--workflow-changes-reviewed` | PR #10 |
| 28 Sep 2026 | Making the repo private on GitHub Free silently switched off the ruleset, auto-merge and environment secrets | D-008: `pnpm pr:merge`, pre-push hook, deny rules; production DB URL as a repository secret | PR #9 |
| 28 Sep 2026 | pnpm forwards `--` to scripts, so `pnpm db:push:staging -- --dry-run` was refused | Scripts drop a leading `--`; test added; same fix in `pr:merge` | PR #6, #10 |
