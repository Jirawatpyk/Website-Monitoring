# Decision log

Decisions that settle a conflict between the PRD and the design spec, or fill a gap in either. Newest first. Code that implements a decision cites its ID.

| ID | Date | Decision | Supersedes |
|---|---|---|---|
| D-002 | 28 Sep 2026 | Client-update track fires when Tier 1 DOWN **reaches** 15 min (`>=`), counted from the first failed check | Spec §16.2 wording "> 15 min" |
| D-001 | 28 Sep 2026 | Blocked + verifier unavailable → **PROBLEM (unverified) at once**, Admin told, retried every round | PRD §5 "keep status, PROBLEM after 10 min" (flowchart, verification spec, test plan) |

## D-002 — Client-update threshold: `>= 15 min` from the first failed check

**Conflict.** Spec §9 and PRD §8 say the track fires when a Tier 1 DOWN is "reaching 15 min" / "ครบ 15 นาที". Spec §16.2 and the Resolve / StatusModel boards say the client update is required when "Tier 1 DOWN > 15 min".

**Decision.** Fire at exactly 15:00 of incident duration (`>= 15`). The duration is counted from the first failed check, like every incident duration (spec §14.3) — not from "Confirmed down", which only drives the escalation clock. Tier 2 stays `>= 60` min inside response hours.

**Why.**
- The worked example is exact: INC-0142 first failed at 09:48:12 and the client update was due and posted at **10:03:12** — Incident timeline, Audit log and Alert-channels delivery log all show 10:03:12. That is 15:00 after the first failure, so the rule is "reaching", measured from the first failure. Escalation L1 fired separately at 10:03:41 (15 min after confirmed 09:48:41).
- §16.2 defines the resolve condition as "required only if the client-update track fired"; its "> 15 min" paraphrases that trigger, it doesn't define a second threshold. Using `>=` keeps one rule everywhere: the condition is required exactly when the track fired.
- The Tier 2 clause in the same sentence already uses `>=`.

**Impact.** `clientUpdateRequired()` in `packages/engine/src/lifecycle.ts`; the engine must pass minutes since the first failed check. No UI copy changes ("Tier 1 DOWN over 15 min" in help text still reads correctly).

## D-001 — Verifier unavailable while a site is blocked: PROBLEM (unverified) immediately

**Conflict.** PRD §5 (flowchart, verification spec, go-live test plan): keep the current status and alert the Admin; only after > 10 min blocked without verification → PROBLEM (unverified). Design spec §6 canonical DOWN rule ("use it verbatim") and the StatusModel board row "Blocked · verifier unavailable": PROBLEM (unverified) at once — "No proof either way… retried every check", notify Owner + Alerts Space, Admin told about the verifier.

**Decision.** Follow the spec: PROBLEM (unverified) with trigger `blocked_unverified` at once, Admin alerted about the verifier, the monitor keeps retrying every round.

**Why.**
- **Precedence.** Spec §0 says it holds "the rules every screen follows — statuses, escalation, lifecycle", and PRD §14 says the spec wins on behaviour; the PRD keeps scope, priority, architecture and budget. Status logic is behaviour. The spec is also the later document (five review rounds, 28 Sep).
- **Honest status.** "Keep status" usually means keeping **OK** on a site we can't currently see. A WAF 503 can also hide a real outage, so for up to 10 min the dashboard would claim a state nobody verified. The product goal is that no client finds an outage first; showing "unverified" is the truthful state.
- **Noise stays low without the 10-min grace.** PROBLEM never pages the CEO, is held until 09:00 outside Tier 2–3 response hours, and a PROBLEM that clears within 5 min without an ack auto-resolves and is hidden (spec §16.1) — so a quick verifier restart (systemd) produces at most one short, hidden PROBLEM.
- **Clients unaffected.** `blocked_unverified` is internal-only on the status page and in client reports (spec §12).

**Impact.** `decideVerification()` in `packages/engine/src/round.ts` (the `blockedForMin` parameter and the 10-min constant are removed). The Claude Doc PRD §5 flowchart node "Keep status + alert Admin / over 10 min: PROBLEM", the verification-spec bullet and the test-plan line ("เว็บที่ blocked คงสถานะ … เกิน 10 นาทีเป็น PROBLEM") should be updated to match; until then this record wins over `docs/prd.md`.
