---
name: slice
description: Start or continue one slice of docs/implementation-plan.md — check its dependencies, create the branch, load the right sources, plan, and build it through the project workflow. Use when asked to work on a slice ("/slice S02a", "start the thin slice", "continue S05").
argument-hint: <SliceID, e.g. S02a>
---

# Slice $ARGUMENTS

Follow `docs/workflow.md`. Work on this one slice only.

1. **Load the slice.** Read the `### $ARGUMENTS ·` section and its row in the table of `docs/implementation-plan.md`: Scope, Boards, Tables, Test plan, Depends on, Done when, Review.
2. **Check it can start.** Every slice in "Depends on" must be `Done` in the table. If not, stop and report which one blocks and what's left in it. If the status is already `In progress`, continue from the branch and the unchecked Done-when lines. If a Done-when line needs people on staging (a backup, a second Admin, a Chat id), check the staging `profiles` now — staging can't add a person outside the company domain and allowlist (D-007) — and agree with Tao up front how that line is proved (integration test + a production check) instead of finding out at `/slice-review`.
3. **Branch.** From an up-to-date `main`: `git switch -c slice/$ARGUMENTS-<short-kebab-name>` (or switch to the existing slice branch). Never work on `main`.
4. **Load context** (read, don't skim):
   - The FR rows (`docs/prd.md` §6) and the PRD sections the scope names.
   - For each board: its row in `docs/design/screens.md`, `docs/design/canvas/<Board>.dc.html` and the listed spec sections (+ §11, §13, §14.15–17).
   - `docs/decisions.md` entries the scope cites (D-xxx).
   - The CLAUDE.md of each package the slice touches.
5. **Plan.** List the work as small steps in order (schema → engine → API → notifier → UI), each ending in something testable, and map each Done-when line to the step that proves it. For an L slice, present the plan and wait for approval. Set the slice Status to `In progress` in the plan table. When the `advisor` tool is available, call it once the context is loaded and before presenting the plan (docs/workflow.md → Advisor).
6. **Build step by step.** Use `/new-migration` for schema, `/engine-case` for engine rules (test first), `/implement-screen` for boards. Commit after each green step: `feat($ARGUMENTS): …`. Run `pnpm check` often.
7. **Conflicts.** If sources disagree or a rule is missing, stop that step and ask with options + a recommendation; record the answer in `docs/decisions.md` (workflow.md → Decisions).
8. **Finish.** When every Done-when line looks satisfied, run `/slice-review $ARGUMENTS`. Don't mark the slice Done yourself.

Report at each stop: what's done, what's next, any Done-when line at risk.
