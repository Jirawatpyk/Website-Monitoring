# UAT (T06)

PRD §12 and plan S19 Done-when 1: two rounds of ack, mute and maintenance on a phone.

- **Where and who (D-071):** staging, run by Claude in the browser pane at 390 × 844, light and then dark, signed in as Tao (Admin).
- **Other roles:** their limits are proved by the integration and e2e tests named in each slice (Responder own sites, Stakeholder no ack).
- **Between the rounds:** each finding is fixed, each in a `fix/…` PR, or logged here with a reason. Round 2 runs on the fixed build.

## Script

The Test target starts on `ok`, with no open incident. Each step is driven by tapping, never by URL.

| #   | Do                                                                                                               | Expect                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Test target → `error`; open the DOWN card's link                                                                 | The phone incident page; Acknowledge reachable without scrolling; targets ≥ 44 px                               |
| 2   | **Acknowledge**, then **Undo** within 10 s                                                                       | Back to Unacked; no ACKNOWLEDGED in Chat or email (T08)                                                          |
| 3   | **Acknowledge** again, let it post                                                                               | ACKNOWLEDGED in the thread after 10 s                                                                            |
| 4   | Site detail → ⋯ → **Mute** 1 h with a reason                                                                     | Muted line on the site; new alerts for the site stop (the open incident is already acknowledged)                                             |
| 5   | **Maintenance** → **End now** on the mute, with a reason; Undo within 10 s, then End now again                     | The mute comes back on Undo; ends on the second                                                                  |
| 6   | Target → `ok`; resolve the incident (root cause + Resolve, Undo once)                                             | Resolved after the 10 s; the 3 conditions shown                                                                  |
| 7   | **Maintenance** → **Schedule** 1 h from now on the Test target, then cancel with **Undo**, then cancel             | The window comes back on Undo; CANCELLED posts in the window's thread                                            |
| 8   | Bottom nav through Overview, Incidents, Sites, More; open the User guide                                         | Every page fits 390 px, with no horizontal scroll                                                               |

## Round 1

| Date | Theme | Step | Finding | Severity | Fixed in / reason |
| ---- | ----- | ---- | ------- | -------- | ----------------- |
|      |       |      |         |          |                   |

## Round 2

| Date | Theme | Step | Finding | Severity | Fixed in / reason |
| ---- | ----- | ---- | ------- | -------- | ----------------- |
|      |       |      |         |          |                   |
