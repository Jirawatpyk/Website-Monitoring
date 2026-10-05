# Retro log

One line per lesson: what went wrong or slow, and the change that stops it happening again. How and when: [`workflow.md` → Continuous improvement](workflow.md#continuous-improvement). Newest first. Prefer a guard in a tool over a sentence in a document.

| Date | What happened | What changed | Where |
| --- | --- | --- | --- |
| 1 Oct 2026 | Plan S11 still described the "acknowledge only" lock that D-007 removed; the D-007 sweep had searched for "2-step" only | Line fixed to point at D-007; when a decision removes a concept, search for every name of it, not one keyword | PR #15 |
| 29 Sep 2026 | Hard-coded spacing and colours were a written rule only | ESLint `dxt/no-hardcoded-design-values` fails the build | PR #13 |
| 29 Sep 2026 | A downloaded Google OAuth client secret (JSON) landed in the project folder; only luck kept it out of a commit | `.gitignore` covers `client_secret*.json` and service-account keys; Claude Code is denied reading them | PR #13 |
| 28 Sep 2026 | A PR's CI runs the PR's own workflow files, so an edited workflow could read the repository secret before merge | Claude Code asks before editing `.github/workflows/` / `.github/actions/`; `pnpm pr:merge` refuses CI-file changes without `--workflow-changes-reviewed` | PR #10 |
| 28 Sep 2026 | Making the repo private on GitHub Free silently switched off the ruleset, auto-merge and environment secrets | D-008: `pnpm pr:merge`, pre-push hook, deny rules; production DB URL as a repository secret | PR #9 |
| 28 Sep 2026 | pnpm forwards `--` to scripts, so `pnpm db:push:staging -- --dry-run` was refused | Scripts drop a leading `--`; test added; same fix in `pr:merge` | PR #6, #10 |
