# packages/engine

The status engine as pure functions: no I/O, no clock (`now` is always a parameter), no database. The cron route loads state, calls these, and writes the result.

- `round.ts` — DOWN rule (spec §6): ≥ 2 of 3 locations hard-fail on two checks in a row; blocked → browser verifier; faulty-location exclusion (spec §15.3); regional PROBLEM.
- `lifecycle.ts` — incident states and events (spec §15.4), the 3-condition resolve gate (§16.2–3), client-update track (§9, §16.2), PROBLEM auto-resolve (§16.1).
- `uptime.ts` — 1 − DOWN minutes / (window − maintenance), time-weighted across sites (spec §5).

Still to build here: escalation ladder timing (spec §8, §14.1, §15.5 — response hours pause Tier 2–3 timers), flapping (≥ 3 changes in 30 min — also the transition back from `monitoring` / `needs_root_cause` when a site drops again inside one incident, INC-0133 VOCA ×4), PROBLEM triggers (slow 3 rounds, keyword, key page, SSL/domain, redirect).

Contract notes for the engine cron route:

- Evaluate the immediate recheck with `evaluateRound({ …, after: <first failing check time> })` so only fresh rechecks vote.
- `siteUptime` expects `downMinutes` already excluding minutes inside maintenance windows.
- `autoResolves` is called at recovery with minutes from first failed check to first OK round.

## Settled decisions (`docs/decisions.md` — don't change without a new decision record)

- **D-001:** blocked + verifier unavailable → PROBLEM (unverified) at once, Admin told, retried every round. No 10-min grace (supersedes PRD §5).
- **D-002:** client-update track fires when Tier 1 DOWN reaches 15 min (`>=`), counted from the first failed check — escalation counts from "Confirmed down" instead.

Every rule change needs a table-driven test built from the spec's worked examples (INC-0142 MuvMi, INC-0133 VOCA, INC-0139 ORCA). Cite the spec section in a comment. Ask `engine-reviewer` to check non-trivial changes.
