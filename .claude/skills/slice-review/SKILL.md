---
name: slice-review
description: Close a slice of docs/implementation-plan.md — run its reviewers, collect evidence for every "Done when" line, have slice-verifier check it, and update the slice Status. Use when a slice looks finished ("/slice-review S02", "is S05 done?").
argument-hint: <SliceID, e.g. S02>
---

# Review slice $ARGUMENTS

1. Read the `### $ARGUMENTS ·` section of `docs/implementation-plan.md` and the Definition of Done in `docs/workflow.md`.
2. Run `pnpm check` and `pnpm plan:check`. Stop on failure and fix first.
3. Run the agents named in the slice's **Review** line, in parallel where independent (spec-checker once per board). Fix every High / Medium finding, or write down why it doesn't apply.
4. Build an evidence list, one entry per Done-when line: the test name and command, the timestamp / message text / screenshot path, or the SQL test. Evidence that needs staging or a phone and can't be produced here is marked **Needs manual check** with exact steps for Tao.
5. Run the `slice-verifier` agent with the slice ID and the evidence list.
6. Update the plan table:
   - every line verified → Status `In review` (PR open) or `Done` (merged);
   - otherwise keep `In progress` and list the missing lines.
     Also flip the slice's nav items to `live` if its screens are complete, and record any new decision.
7. Write the PR description from `.github/pull_request_template.md` with the Done-when checklist and the evidence. Don't push or open the PR without asking.
8. Report: verdict, evidence table, anything left for manual check.
