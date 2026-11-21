# UAT (T06)

PRD §12 and plan S19 Done-when 1: two rounds of ack, mute and maintenance on a phone.

- **Where and who (D-071):** staging, run by Claude in the browser pane at 390 × 844, light and then dark, signed in as Tao (Admin).
- **Other roles:** their limits are proved by the integration and e2e tests named in each slice (Responder own sites, Stakeholder no ack).
- **Between the rounds:** each finding is fixed, each in a `fix/…` PR, or logged here with a reason. Round 2 runs on the fixed build.

## Script

The Test target starts on `ok`, with no open incident. Each step is driven by tapping, never by URL. Undo is pressed inside its 10 s: in the browser pane the press goes in the same batch as the action (a slower driver misses the window — round 1).

| #   | Do                                                                                                               | Expect                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Test target → `error`; open the DOWN card's link                                                                 | The phone incident page; Acknowledge reachable without scrolling; targets ≥ 44 px                               |
| 2   | **Acknowledge**, then **Undo** within 10 s                                                                       | Back to Unacked; no ACKNOWLEDGED in Chat or email (T08)                                                          |
| 3   | **Acknowledge** again, let it post                                                                               | ACKNOWLEDGED in the thread after 10 s                                                                            |
| 4   | Site detail → **Mute** 1 h with a reason                                                                         | Muted line on the site; new alerts for the site stop (the open incident is already acknowledged)                                             |
| 5   | **Maintenance** → **End now** on the mute, with a reason; Undo within 10 s, then End now again                     | The mute comes back on Undo; ends on the second                                                                  |
| 6   | Target → `ok`; resolve the incident (root cause + Resolve, Undo once)                                             | Resolved after the 10 s; the 3 conditions shown                                                                  |
| 7   | **Maintenance** → **Schedule** 1 h from now on the Test target, then cancel with **Undo**, then cancel             | The window comes back on Undo; CANCELLED posts in the window's thread                                            |
| 8   | Bottom nav through Overview, Incidents, Sites, More; open the User guide                                         | Every page fits 390 px, with no horizontal scroll                                                               |

## Round 1

Sat 21 Nov 2026, staging (build `7cfebbd`, S18), 390 × 844 light, as Tao. Incidents INC-0078 (steps 1, 3–6) and INC-0079 (step 2); step 3's ACKNOWLEDGED posted on INC-0078.

| Step | Result | Evidence |
| ---- | ------ | -------- |
| 1 | ✓ | Acknowledge in the sticky bar at 724–768 px of 844, 44 px high; Visit site 44 px |
| 2 | ✓ | INC-0079: Acknowledge → Undo → back to Unacked, focus on Acknowledge; both `acknowledged` rows `cancelled` (T08) |
| 3 | ✓ | INC-0078: ACKNOWLEDGED Chat `sent` 08:40:30Z, email `sent` |
| 4 | ✓ | "Muted · until 16:42" on the site; toast "INC-0078 stays open" |
| 5 | ✓ with F1 | Undo → "— undone · Nothing was posted.", the mute back; End now again → MUTE ENDED EARLY posted |
| 6 | ✓ (Undo not driven) | Resolved 08:47:35Z with False alarm; RESOLVED Chat + email `sent`. The resolve's Undo was pressed too late by the driver; Undo on Acknowledge and maintenance covers the same `UndoLine` |
| 7 | ✓ | Scheduled 17:00–18:00; Cancel → Undo → back, rows `cancelled` "Undone"; Cancel → CANCELLED in thread `mw-eae98614…` (Chat 08:50:30Z, owner + backup emails) |
| 8 | ✓ | /, /incidents, /sites, /oncall, /guide: scroll width 390, no tap target under 44 px |

| Date | Theme | Step | Finding | Severity | Fixed in / reason |
| ---- | ----- | ---- | ------- | -------- | ----------------- |
| 21 Nov | light | 5 | F1 · An Undo pressed in the last second: the server undid it (rows "Undone", mute back), but the toast said "Posted to Chat." and the list dropped the mute until a reload | Medium | `fix/undo-line-in-flight`: `UndoLine` shows "Undoing…" until the answer |
| 21 Nov | light | 7 | A typed start time looked unused ("Ends" kept 22:00) | — | Not a bug: the driver's triple-click opened the list; typing + Tab re-checked, "Ends" follows |
| 21 Nov | light | 1 | No link from the phone incident page to Site detail | — | As drawn (MIncident has none); Back → Sites |

## Round 2

Sat 21 Nov 2026, staging on the fixed build (`edc197f`, `fix/undo-line-in-flight`, PR #222), 390 × 844 dark, as Tao. Incident INC-0086.

| Step | Result | Evidence |
| ---- | ------ | -------- |
| 1 | ✓ | Dark theme (body rgb(8, 8, 10)); Acknowledge in the bar at 724 px, 44 px high |
| 2 | ✓ | Acknowledge → Undo → Unacked, focus on Acknowledge; both `acknowledged` rows `cancelled` |
| 3 | ✓ | Acknowledge again → ACKNOWLEDGED Chat `sent` 11:27:59Z |
| 4 | ✓ | "Muted · until 19:28" |
| 5 | ✓ | End now → Undo → "— undone · Nothing was posted.", mute back; End now again → MUTE ENDED EARLY `sent` 11:29:14Z |
| 6 | ✓ | Resolve → Undo (`resolve_undone`, both `resolved` rows `cancelled`, focus back on Resolve, the dialog kept the root cause); Resolve again → RESOLVED Chat + email `sent` 11:34:28Z |
| 7 | ✓ | Scheduled 21:00–22:00 (time typed); Cancel → Undo → back ("Undone"); Cancel → CANCELLED `sent` 11:30:31Z |
| 8 | ✓ | /, /incidents, /sites, /oncall, /guide, /maintenance: scroll width 390, no tap target under 44 px |

No new findings. F1's last-second race isn't reachable by hand in the pane (the Undo landed at 5 s left); `undo-line.test.tsx` and `use-ack-toast.test.tsx` hold it.
