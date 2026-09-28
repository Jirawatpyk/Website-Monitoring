## Slice

<!-- e.g. S02a · Thin slice — link its section in docs/implementation-plan.md -->

## What and why

<!-- One or two sentences. Link the board (docs/design/screens.md), FR or decision (docs/decisions.md). -->

## Done when — evidence

<!-- One line per "Done when" item of the slice: test name / command, timestamps, screenshot, or "needs manual check" + steps. -->

| #   | Done when | Evidence |
| --- | --------- | -------- |
| 1   |           |          |

## Checklist

- [ ] `pnpm check` and `pnpm plan:check` pass; slice Status updated in the plan
- [ ] Behaviour follows the design spec (later sections win) and any decision in `docs/decisions.md`
- [ ] Engine / rule changes have table-driven tests from the spec's examples
- [ ] Reviewers from the slice's Review line: no open High / Medium findings
- [ ] New tables: RLS + explicit grants in the same migration, pgTAP tests in `supabase/tests/`, `pnpm db:types` committed
- [ ] Config / incident state changes write `audit_log`; ack / resolve messages held 10 s
- [ ] New env names in `.env.example`; new decisions in `docs/decisions.md`
- [ ] Nav items flipped `live` only for finished screens
- [ ] New `/api/*` route: token check, zod-validated body, listed in `PUBLIC_PATHS` only if it must skip the session
- [ ] UI checked at 390 / 820 / 1440 px, light and dark; no dead controls
- [ ] No secrets, no spec sample data in product code
