# Go-live test plan results

PRD §12 and plan S19 Done-when 3. All 12 items are re-run before G2, and each is ticked with its date and evidence. T01–T05 and T08–T12 are re-run on staging by Claude. T06 is in [`uat.md`](uat.md) and T07 in [`game-day.md`](game-day.md) (D-071). How to drive staging: `.claude/skills/verifier-staging`.

| Test | What                                                                                      | Where              | Date | Evidence | ✓ |
| ---- | ----------------------------------------------------------------------------------------- | ------------------ | ---- | -------- | - |
| T01  | Test target forced through every status path (200 / 500 / timeout / challenge / keyword / cert) | staging        |      |          |   |
| T02  | One probe location off → no false DOWN; Admins get PROBE MISSING                           | staging            |      |          |   |
| T03  | Verifier off → a hard fail still DOWN on time; blocked → PROBLEM (unverified) + Admin email | staging           |      |          |   |
| T04  | Vercel Cron off → Healthchecks alerts and the VPS watchdog posts MONITOR FAULT              | staging            |      |          |   |
| T05  | No ack → L0–L3 on time                                                                     | staging            |      |          |   |
| T06  | UAT twice on a phone (ack, mute, maintenance)                                              | staging (D-071)    |      | [uat.md](uat.md) |   |
| T07  | Game day: MTTD ≤ 3 min, MTTA ≤ 15 min                                                      | staging (D-071)    |      | [game-day.md](game-day.md) |   |
| T08  | Ack → Undo within 10 s → nothing sent                                                      | staging            |      |          |   |
| T09  | Mute with an open incident → escalation, L3 FYI and client update continue                 | staging            |      |          |   |
| T10  | Resolve blocked until the 3 conditions are met ("Unknown" refused)                         | staging            |      |          |   |
| T11  | Engine heartbeat off → Admin email + on-call @mention; one probe off → email only          | staging            |      |          |   |
| T12  | Only allowlisted company accounts get in; 2-step enforced by Workspace (D-007)             | tests + production |      |          |   |

## Healthchecks emails (S19 Done-when 6, D-054)

Each active Admin is an Email integration on the production Healthchecks project, on the checks D-053 has emailing. Each Admin confirms a test notification. Tao does this; record initials and dates only.

| Admin (initials) | Integration added | Checks (`engine`, `crawler`, `notifier`, `browser-verifier`, `vps-watchdog`) | Test email confirmed |
| ---------------- | ----------------- | ----------------------------------------------------------------------------- | -------------------- |
|                  |                   |                                                                               |                      |

## Restore drill (S19 Done-when 5, D-005)

The steps are in `docs/runbook.md` → Backups and the restore drill. Tao runs them.

| Date | Backup used (time) | Live sites | Last incident | Last audit row | Last check | Scratch project deleted |
| ---- | ------------------ | ---------- | ------------- | -------------- | ---------- | ----------------------- |
|      |                    |            |               |                |            |                         |

## Fault drill (S19 Done-when 5, D-071)

The steps are in `docs/runbook.md` → Drill (S19). Claude runs them on staging.

| Date | Engine stopped | MONITOR FAULT posted | Manual incident | Escalate now | Engine back | ✓ |
| ---- | -------------- | -------------------- | --------------- | ------------ | ----------- | - |
|      |                |                      |                 |              |             |   |
