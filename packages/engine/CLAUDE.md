# packages/engine

The status engine as pure functions: no I/O, no clock (`now` is always a parameter), no database. The cron route loads state, calls these, and writes the result.

- `round.ts` — DOWN rule (spec §6): ≥ 2 of 3 locations hard-fail on two checks in a row; blocked → browser verifier; faulty-location exclusion (spec §15.3); regional PROBLEM.
- `lifecycle.ts` — incident states and events (spec §15.4), the 3-condition resolve gate (§16.2–3), client-update track (§9, §16.2), PROBLEM auto-resolve (§16.1).
- `monitor.ts` — one engine step per primary monitor (S02a): rounds are interval buckets (`floor(checkedAt / interval)`), judged oldest first, once each (`roundAt` = bucket start), when every active location reported and every failure was rechecked, or `ROUND_DEADLINE_MS` after the round ends; DOWN needs both checks hard-failing (rechecks only vote in the second) and starts at the first failed check (walking back through consecutive failures); an OK round needs a majority of reporting locations to pass; recover → Monitoring on the first OK round, settle on the second. Staging cron offsets (probe-tyo :02, probe-sin :46, engine :39) are in its tests.
- Blocked rounds (S03, D-001, D-019, D-020): a round with no pass or hard-fail majority and a blocked location asks the runner for a verify job (`verify`), waits while it runs, then — loaded → an OK round with `BLOCKED_NOTE`; failed → DOWN from the first blocked check (`verifyJobId`); blocked in the browser too, or the verifier unavailable (no poll 2 min, not picked up in 30 s, lease ran out) → `unverified` (PROBLEM, note `UNVERIFIED_NOTE`). Hard fails never wait for the verifier. Every judged decision carries the site's `note` (none clears it).
- `uptime.ts` — 1 − DOWN minutes / (window − maintenance), time-weighted across sites (spec §5).

Still to build here, by slice (`docs/implementation-plan.md`): PROBLEM triggers (slow 3 rounds, keyword, key page, redirect), primary-monitor rule, relapse + flapping per D-004, the PROBLEM (unverified) Chat card (D-019) and wiring the existing rules into the cron → **S04**; 60-min PROBLEM reminders with the ladder; escalation ladder timing with response hours and holidays (spec §8, §14.1) → **S08**, L2–L3 + on-call → **S10**; client-update track wiring → **S11**; SSL / domain thresholds → **S13**.

Contract notes for the engine cron route:

- Evaluate the immediate recheck with `evaluateRound({ …, after: <first failing check time> })` so only fresh rechecks vote.
- `siteUptime` expects `downMinutes` already excluding minutes inside maintenance windows.
- `autoResolves` is called at recovery with minutes from first failed check to first OK round.

## Settled decisions (`docs/decisions.md` — don't change without a new decision record)

- **D-001:** blocked + verifier unavailable → PROBLEM (unverified) at once, Admin told, retried every round. No 10-min grace (the PRD says the same since rev 142).
- **D-002:** client-update track fires when Tier 1 DOWN reaches 15 min (`>=`), counted from the first failed check — escalation counts from "Confirmed down" instead.
- **D-003:** PROBLEM passes through Monitoring and Needs root cause like DOWN, and ends at Resolved (never In review / Closed).
- **D-004:** a site failing again while its incident is open re-enters the same incident (back to Acknowledged if acked, else Unacked / Escalated); escalation keeps its original clock; the 3rd change in 30 min tags `is_flapping`.

Round tests use minute-aligned timelines (probe ticks) and include a newer, still-incomplete round and split results, not just one clean round.

Every rule change needs a table-driven test built from the spec's worked examples (INC-0142 MuvMi, INC-0133 VOCA, INC-0139 ORCA). Cite the spec section in a comment. Ask `engine-reviewer` to check non-trivial changes.
