---
name: engine-case
description: Add or extend a status-engine rule in packages/engine test-first, using a worked example from the design spec or PRD. Use for DOWN/PROBLEM rules, rounds, verification, lifecycle, resolve gate, escalation timing, client-update track or uptime.
argument-hint: <rule or scenario, e.g. "Tier 2 DOWN outside response hours">
---

# Engine case: $ARGUMENTS

1. Find the rule in `docs/dxt-monitor-design-spec.md` (later sections win: §16 > §15 > §14 > earlier) and `docs/prd.md` §5/§7/§8. Quote the governing sentence in your reply.
2. Pick concrete numbers from the spec's sample data (§1–§5: INC-0142 MuvMi, INC-0133 VOCA, INC-0139 ORCA, the rotation, snapshot times). Times are UTC in tests; Bangkok = UTC+7.
3. Add table-driven rows to the right `*.test.ts` in `packages/engine/src/` (`it.each`), including the boundary (exactly at the threshold) and the case just past it. Run `pnpm --filter @dxt/engine test` and watch the new rows fail.
4. Implement the smallest pure change: no I/O, `now` passed in, a comment citing the spec section. Export it from `src/index.ts`.
5. `pnpm --filter @dxt/engine test` green, then `pnpm check`.
6. For anything non-trivial, run the `engine-reviewer` agent and address its findings.
