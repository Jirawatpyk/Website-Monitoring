# Workflow

How work moves from [`implementation-plan.md`](implementation-plan.md) to production. One slice at a time, one branch and one PR per slice, and a slice is `Done` only when every "Done when" line has evidence.

## Slice lifecycle

| Step | What happens | Tool |
|---|---|---|
| 1. Pick | Next `Todo` slice whose "Depends on" are all `Done` | `/slice <ID>` checks this |
| 2. Branch | `slice/<ID>-<short-name>` from an up-to-date `main`, e.g. `slice/S02a-thin-slice` | `/slice` |
| 3. Plan | Read the slice, its boards (`screens.md`), spec sections, FRs and decisions. For an **L** slice, write the plan in Plan mode and agree it before coding. Status → `In progress` | `/slice` |
| 4. Build | Small commits. Engine rules test-first (`/engine-case`), schema through `/new-migration`, screens through `/implement-screen`. Stop and ask on any source conflict (see [Decisions](#decisions)) | skills |
| 5. Check | `pnpm check` green locally (format, plan coverage, lint, types, tests) | — |
| 6. Review | `/code-review high` on the slice's diff, then the reviewers named in the slice's **Review** line (table below); fix every High (no waivers); fix every Medium or give the reason in the PR | agents |
| 7. Verify | Deploy the slice to staging — `git push --force-with-lease origin HEAD:staging` and, if it has migrations, `pnpm db:push:staging` (both ask first) — and collect evidence for each "Done when" line there and locally; `slice-verifier` checks it. Status → `In review` | `/slice-review <ID>` |
| 8. PR | PR template with the Done-when checklist and its evidence; CI `check` green; review conversations resolved; CODEOWNERS are requested automatically | GitHub |
| 9. Merge | `pnpm pr:merge <number>` (squash, only when CI `check` is green on the head commit — D-008) → Vercel production deploy. Status → `Done` in the plan (same PR or a follow-up). Reset `staging` to `main` (`git push --force-with-lease origin origin/main:staging`) | `/slice-review` |
| 10. Improve | Five-minute retro (below): what went wrong or slow, and the change that stops it happening again. One line in [`retro.md`](retro.md); skip when nothing went wrong | `/slice-review` |

`main` is protected by rules we enforce ourselves (D-008 — the repository is private on GitHub Free, so GitHub doesn't enforce its ruleset "main"): every change arrives by pull request and is squash-merged with `pnpm pr:merge <number>`, which refuses unless the CI `check` job succeeded on the PR's current head commit, the PR targets `main`, isn't a draft, has no conflicts and no requested changes. A PR that changes `.github/workflows/` or `.github/actions/` (files that can read repository secrets) also needs `--workflow-changes-reviewed`, passed only after a human has read those changes. Nobody pushes to `main`: the `pre-push` hook in `.githooks` (installed by `pnpm install`) and `.claude/settings.json` both refuse it, and `gh pr merge` is denied to Claude Code so every merge goes through the script. Resolve review conversations before merging; head branches are deleted after merge. When the second Admin joins (G1) they review every PR before it is merged. If the repository moves to GitHub Pro, the ruleset "main" applies again and becomes the enforcement.

`staging` is a throwaway branch that always holds exactly the code under test: one slice at a time is pushed onto it (not merged into it, so unfinished slices never pile up), and it is reset to `main` after each merge. It is not protected and never merged anywhere.

Commits use Conventional Commits with the slice as scope: `feat(S02a): post DOWN to Google Chat`, `fix(S03): …`, `docs(S05): …`.

## Continuous improvement

The workflow, the rules and the tooling improve every time something goes wrong, not on a schedule.

**When.** At the end of every slice (step 10), at every gate (G1–G3), and as soon as one of these happens: Claude Code does something wrong or against a rule, a reviewer raises the same finding twice, CI fails for a preventable reason, a source turns out stale or contradictory, or an incident shows a gap.

**Ask three questions.** What went wrong or slow? Why — unclear rule, missing guard, or a stale document? What change stops it recurring?

**Fix at the strongest level that works**, in this order:

1. Enforce it with a tool — ESLint rule, test, type, CI check, Git hook, a deny rule in `.claude/settings.json`, a guard in a script.
2. Otherwise write it down where it is read at the right moment — `CLAUDE.md` (root or the folder's), a skill, an agent's checklist, the Definition of Done, or a decision in `decisions.md`.
3. Fix the stale source itself (plan, PRD, spec mirror) rather than adding a note that contradicts it.

**At each gate**, read `retro.md` from top to bottom: a lesson that shows up more than once becomes a rule or a guard (step 1 or 2 above) and its rows are marked as promoted.

**Record it** as one line in [`retro.md`](retro.md): date · what happened · what changed · PR. The change ships in the slice's PR or a small follow-up PR. Nothing is recorded when nothing went wrong.

## Who reviews what

| When the change touches… | Run |
|---|---|
| Any code change — correctness bugs, edge cases, simplification | `/code-review high` on the diff (built-in skill; every slice) |
| A screen or board | `spec-checker` (per board) |
| `packages/engine`, the engine cron, escalation or notification timing | `engine-reviewer` |
| Chat cards, text lines, emails, digests, webhooks payloads | `message-checker` |
| `supabase/migrations`, RLS, `apps/web/src/app/api`, auth, env, the VPS | `security-reviewer` |
| Tables, indexes, partitions, rollups, retention, query performance | `db-reviewer` |
| A slice claimed complete | `slice-verifier` (through `/slice-review`) |

`/code-review` finds general code bugs; the agents check the domain (spec, engine rules, RLS, messages, schema) — they complement each other. A slice is verified by `slice-verifier` through `/slice-review`; there is no separate verify skill. Reviewers are read-only and report findings; the slice owner fixes them. Independent reviewers can run in parallel.

## Definition of Done

Every slice, on top of its own "Done when" lines:

- [ ] `pnpm check`, `pnpm plan:check` and CI green; no skipped tests.
- [ ] `/code-review high` and the reviewers from the slice's Review line: no open High findings; every Medium fixed or justified in the PR.
- [ ] Tests: rules and helpers in Vitest; screen behaviour (states, disabled reasons, confirms) in Vitest + Testing Library next to the component; flows that cross pages or depend on auth / redirects in Playwright (`apps/web/e2e/`, desktop 1440 + mobile 390). `pnpm test:e2e` green; `pnpm test:coverage` meets every package's threshold (raise a threshold when coverage rises, never lower it).
- [ ] Screens: spec-checker passed at 390 / 820 / 1440 px, light and dark; touch targets ≥ 44 px; no dead controls — the slice's nav item is flipped `live` in `apps/web/src/components/app-shell/nav.tsx` only now.
- [ ] Data: new tables have RLS + explicit grants in the same migration, pgTAP tests in `supabase/tests/`, and `pnpm db:types` committed.
- [ ] Every config or incident state change writes `audit_log`; ack / resolve messages are held 10 s.
- [ ] No spec sample data in product code; no secrets in the repo; new env names added to `.env.example`.
- [ ] Docs match the code: slice Status in the plan, new decisions in `decisions.md`, CLAUDE.md files if a rule or command changed.

## Decisions

The precedence is in the root `CLAUDE.md`: `decisions.md` → design spec (behaviour, status logic, copy, formats) → PRD (scope, priority, architecture, budget). When two sources still disagree, or a rule is missing:

1. Stop the slice step that depends on it and ask Tao with the options and a recommendation.
2. Record the answer as the next `D-xxx` in `docs/decisions.md` (conflict, decision, why, impact).
3. If it changes the PRD, update the Claude Doc and re-export `docs/prd.md` (keep its header comment and bump the rev).
4. Cite the ID in the code comment and the test name.

## Environments

| Env | Web | Database | Used for |
|---|---|---|---|
| Local | `pnpm dev` on http://localhost:3500 | `pnpm db:start` (Docker) | Building and unit / SQL tests |
| PR preview | Vercel preview deployment of `dxt-monitor` for each PR | Staging Supabase project | Looking at UI changes only — Vercel Cron never runs on preview deployments, so no probes, engine or notifier |
| Staging | Vercel project `dxt-monitor-staging`, production branch `staging` (D-006) — its crons run every minute | Staging Supabase project in a separate free organisation (D-005; the every-minute crons keep it from pausing) | Done-when checks against the test target |
| Production | Vercel production from `main` | Production Supabase project (Pro, daily backups kept 7 days, no PITR — D-005) | Real sites after G1 |

Migrations: **staging** gets them straight from the slice branch while it is being verified — `pnpm db:push:staging` (`pnpm db:push:staging --dry-run` first to see what would be applied; both staging scripts ask first). **Production** gets them only from the CI job `migrate-production`, which runs on `main` after a PR is merged, with the `SUPABASE_PROD_DB_URL` secret of the repository secret `SUPABASE_PROD_DB_URL` (D-008: environment secrets are ignored on a private repo on GitHub Free). The staging database is disposable: when a slice changes a migration that is already on staging, or after `staging` is reset to `main`, rebuild it with `pnpm db:reset:staging`. Nobody runs `supabase link`: the scripts pass the staging connection string explicitly and refuse any URL of the production project, so a forgotten link can never point a push or reset at production. Never edit a migration that production already has; add a new one. During the PRD §12 parallel run, every production deploy happens inside a maintenance window.

## Working with Claude Code

- Start a fresh session per slice and run `/slice <ID>`; it loads the slice and the right context. Use `/slice-review <ID>` to close it.
- Use Plan mode for L slices and for anything touching the engine's state machine.
- Run independent reviewers as parallel subagents; paste their findings into the PR only as a short summary.
- Keep the plan the single tracker: don't open GitHub issues for slice tasks unless the team asks for them.
- If a slice grows past L, split it in the plan (new ID, dependencies, Done-when) before continuing, run `pnpm plan:check`, then start each part with a fresh `/slice <ID>` so its sources and Done-when are loaded again.
