# Go-live test plan results

PRD §12 and plan S19 Done-when 3. All 12 items are re-run before G2, and each is ticked with its date and evidence. T01–T05 and T08–T12 are re-run on staging by Claude. T06 is in [`uat.md`](uat.md) and T07 in [`game-day.md`](game-day.md) (D-071). How to drive staging: `.claude/skills/verifier-staging`.

| Test | What                                                                                      | Where              | Date | Evidence | ✓ |
| ---- | ----------------------------------------------------------------------------------------- | ------------------ | ---- | -------- | - |
| T01  | Test target forced through every status path (200 / 500 / timeout / challenge / keyword / cert) | staging        | Sat 21 Nov | `ok` 200 → OK; `error` 500 → INC-0077 DOWN in 32 s; `timeout` → INC-0081 DOWN on the 2nd round (first fail 10:02:01Z, confirmed 10:03:32Z, D-049); `challenge` → OK "Automated check blocked by bot protection; verified via browser" (verify job `loaded`, no incident); `keyword-missing` → INC-0080 PROBLEM · Keyword, back on `ok` auto-resolved (`auto_resolved`, RECOVERED, owner email cancelled); cert: SSL fixture (10 days) → INC-0082 PROBLEM · SSL (response hours set to Mon–Sat for the run, both changes logged; Check now put the real certificate back) | ✓ |
| T02  | One probe location off → no false DOWN; Admins get PROBE MISSING                           | staging            | Sat 21 Nov | `dxt-agent@staging` stopped 10:10:40Z (last BKK beat 10:10:01Z): `probe_location_missing` (BKK) opened 10:13:40Z, one PROBE MISSING email `sent` (Tao, the only active Admin), nothing in Chat; the Test target stayed OK on SIN + TYO, no incident | ✓ |
| T03  | Verifier off → a hard fail still DOWN on time; blocked → PROBLEM (unverified) + Admin email | staging           | Sat 21 Nov | Same stop (verifier off): `error` 10:14:52Z → INC-0083 DOWN in 74 s from SIN + TYO; `challenge` → INC-0084 PROBLEM · blocked_unverified ("Blocked, not verified"), `verifier_unavailable` opened 10:17:47Z, Admin email `sent` 10:17:48Z. Agent started 10:20:12Z | ✓ |
| T04  | Vercel Cron off → Healthchecks alerts and the VPS watchdog posts MONITOR FAULT              | staging            |      |          |   |
| T05  | No ack → L0–L3 on time                                                                     | staging            | Sat 21 Nov | INC-0079 unacked, muted: confirmed 08:52:32Z; L1 09:07:34 (+15:02), L2 09:22:34 (+30:02), STILL DOWN 09:37:36 (+45), L3 FYI 09:52:34 (+60:02); every `step_fired` Chat + email `sent` | ✓ |
| T06  | UAT twice on a phone (ack, mute, maintenance)                                              | staging (D-071)    |      | [uat.md](uat.md) |   |
| T07  | Game day: MTTD ≤ 3 min, MTTA ≤ 15 min                                                      | staging (D-071)    |      | [game-day.md](game-day.md) |   |
| T08  | Ack → Undo within 10 s → nothing sent                                                      | staging            | Sat 21 Nov | INC-0079: Acknowledge 08:53:25Z → Undo 08:53:26Z (`ack_undone`); both `acknowledged` rows `cancelled`, back to Unacked | ✓ |
| T09  | Mute with an open incident → escalation, L3 FYI and client update continue                 | staging            | Sat 21 Nov | INC-0079 muted 08:54:42Z (4 h) with the incident open: CLIENT UPDATE DUE 09:07:03 (Chat + AM email), L1–L3 and the reminder as T05 — all `sent` during the mute | ✓ |
| T10  | Resolve blocked until the 3 conditions are met ("Unknown" refused)                         | staging            | Sat 21 Nov | INC-0077: while down, Resolve disabled "Resolve locked · 1 of 3 met — Test target is still down"; after 2 OK rounds, Unknown → only "Save, keep open" ("Unknown keeps the incident open"); Hosting / server → Resolve incident, RESOLVED sent | ✓ |
| T11  | Engine heartbeat off → Admin email + on-call @mention; one probe off → email only          | staging            |      |          |   |
| T12  | Only allowlisted company accounts get in; 2-step enforced by Workspace (D-007)             | tests + production | Sat 21 Nov | pgTAP `supabase/tests/access.test.sql` (hook refuses an off-allowlist and a non-company address; capitals still match) green in CI run 44873902632 on main `dc6661e`; `packages/shared/src/auth.test.ts` 33 passed; Tao's allowlisted account signed in on staging all day. 2-step is Workspace's (D-007) | ✓ |

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
