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
| 6. Review | Run the reviewers named in the slice's **Review** line (table below); fix every High / Medium or record why not | agents |
| 7. Verify | Deploy the slice to staging — `git push --force-with-lease origin HEAD:staging` (asks first) — and collect evidence for each "Done when" line there and locally; `slice-verifier` checks it. Status → `In review` | `/slice-review <ID>` |
| 8. PR | PR template with the Done-when checklist and its evidence; CI `check` green; review conversations resolved; CODEOWNERS are requested automatically | GitHub |
| 9. Merge | Squash-merge to `main` → Vercel production deploy. Status → `Done` in the plan (same PR or a follow-up). Reset `staging` to `main` (`git push --force-with-lease origin origin/main:staging`) | `/slice-review` |

`main` is protected by the GitHub ruleset "main": no direct pushes, no force pushes or deletion; every change arrives by pull request with the CI `check` job passing on an up-to-date branch, all review threads resolved, squash merge only (head branches are deleted after merge). Required approvals are **0** while Tao is the only maintainer (GitHub doesn't let authors approve their own PRs); raise it to 1 with code-owner review when the second Admin joins (G1).

`staging` is a throwaway branch that always holds exactly the code under test: one slice at a time is pushed onto it (not merged into it, so unfinished slices never pile up), and it is reset to `main` after each merge. It is not protected and never merged anywhere.

Commits use Conventional Commits with the slice as scope: `feat(S02a): post DOWN to Google Chat`, `fix(S03): …`, `docs(S05): …`.

## Who reviews what

| When the change touches… | Run |
|---|---|
| A screen or board | `spec-checker` (per board) |
| `packages/engine`, the engine cron, escalation or notification timing | `engine-reviewer` |
| Chat cards, text lines, emails, digests, webhooks payloads | `message-checker` |
| `supabase/migrations`, RLS, `apps/web/src/app/api`, auth, env, the VPS | `security-reviewer` |
| Tables, indexes, partitions, rollups, retention, query performance | `db-reviewer` |
| A slice claimed complete | `slice-verifier` (through `/slice-review`) |

Reviewers are read-only and report findings; the slice owner fixes them. Independent reviewers can run in parallel.

## Definition of Done

Every slice, on top of its own "Done when" lines:

- [ ] `pnpm check`, `pnpm plan:check` and CI green; no skipped tests.
- [ ] Reviewers from the slice's Review line report no open High / Medium findings.
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

Migrations reach staging and production only through the reviewed PR (`supabase db push` asks first). During the PRD §12 parallel run, every production deploy happens inside a maintenance window.

## Working with Claude Code

- Start a fresh session per slice and run `/slice <ID>`; it loads the slice and the right context. Use `/slice-review <ID>` to close it.
- Use Plan mode for L slices and for anything touching the engine's state machine.
- Run independent reviewers as parallel subagents; paste their findings into the PR only as a short summary.
- Keep the plan the single tracker: don't open GitHub issues for slice tasks unless the team asks for them.
- If a slice grows past L, split it in the plan (new ID, dependencies, Done-when) before continuing, and run `pnpm plan:check`.
