# Brief for Claude Design: monitor fault — hand check, manual incident, Escalate now

**For:** the DxT Monitor design canvas. Please redraw **MainFault** on the current Overview (**Main3**, desktop 1440) and add its phone version on **MOverview4** (390). Please also add one new state to the **Incident** board (and **MIncident**).
**Design system:** AURA, as on every other board. Reuse Main3's banners, Live issues table and tiles, and the Incident page's header and Resolve card.
**Status:** asked 3 Nov 2026 for slice S12b. S12a (detection, alerts, the banner below, the Probes page) is being built now; S12b's code waits for these boards.
**Decision:** D-053 (Tao, 3 Nov 2026). S12 was split. The hand check, the manual incident and Escalate now go to Claude Design. **No "Acknowledge monitor fault" button**: please leave it out.

## Why the old board can't be used

MainFault is drawn on the pre-S06 Overview: the site table, "Who is on it" and "What still works" cards no longer exist on Main3. It also shows "Acknowledge monitor fault", which Tao dropped.

## What a monitor fault is (for the drawing)

- The status engine's minute sweep (Vercel Cron) stopped for more than 3 min.
- Healthchecks.io emails the Admins, and the VPS watchdog posts `MONITOR FAULT · all sites · heartbeat missed since 02:17 · status unknown, hand-check Tier 1` to the Alerts Space, @mentioning the person on call.
- Statuses on the page may be minutes old. Escalations, reminders and recoveries don't fire until the engine is back.

## What S12a already shows (keep it, place it)

At the top of the Overview, above the DOWN banners (desktop and phone), a danger banner:

- **Title:** "Monitoring is degraded — statuses below are 14 min old". When only the sweep stopped and rounds still arrive, the title is "Monitoring is degraded — the status engine's sweep stopped 14 min ago".
- **Cause:** "The status engine's sweep hasn't run since 02:17 — escalations, reminders and recoveries wait until it does. BKK still reports; SIN and TYO have no results."
- **Who was told:** "Engine heartbeat missed > 3 min → Healthchecks.io alerted at 02:20: email to the Admins + an Alerts Space post @mentioning Ploy (on call)."
- **Button:** "Open probes & heartbeat" (secondary).
- **Elsewhere on the page:**
  - The header meta line ends "· statuses as of 02:17" instead of "· live".
  - The probe pill reads "Probes 1/3 | BKK | Heartbeat missed 14 min", with a red dot.

Please draw how the S12b parts sit with this banner.

## What to draw

### 1. Hand check, Tier 1 only (Overview, desktop and phone)

While the fault lasts, the person on call checks each **Tier 1** site by opening it in a browser. Each Tier 1 site needs two actions:

- **Loads OK:** records the check. Show the state after it, e.g. "Checked OK · Tao 02:32". It can be checked again later; the Guide asks for a check every 30 min.
- **Down — open incident:** opens a small confirm dialog:
  - the site;
  - "What did you see?" (optional note, ≤ 500 characters);
  - the line "Posts the DOWN alert to the Alerts Space now and starts the client-update clock";
  - buttons **Open incident** (primary, danger) and **Cancel**.
  - After it: the row shows "INC-0143 opened · Tao 02:32" and links to the incident.

Tier 2–3 sites get no buttons. Please show a quiet "Not needed · Tier 2" line, or leave them out. Your choice; say which.

Where it lives is your call. Suggested: a "Hand check · Tier 1" card right under the fault banner, listing the Tier 1 sites with their last known status, owner and the two buttons. On the phone, the same list as rows under the banner, buttons full width, 44 px touch targets.

Who can press them: an Admin, the person on call, and a Responder on their own sites (the Acknowledge rule). Everyone else sees the list read-only.

### 2. A manual incident (Incident board)

An incident opened from the hand check:

- **Trigger:** "Manual (hand check)" wherever the trigger shows (header chip, timeline).
- **Timeline first line:** "Opened by Tao from a hand check · “what they saw”".
- **No probe evidence:** the "Evidence by location" card says "Opened by hand while the status engine was down — no probe results for this check".

### 3. Escalate now (Incident board, new state)

While the engine is down, nothing escalates on its own. On an open incident, show an **Escalate now** button:

- **Label:** the next step, e.g. "Escalate now · L1 (Arm, backup)". It sends that level's Chat + email at once.
- **After pressing:**
  - the next level becomes the button, e.g. "Escalate now · L2 (CEO + Site AM)";
  - the timeline shows "Escalated to L1 by Tao (engine down)".
- **The client update** (Tier 1–2 client sites): a second action, "Send client-update reminder now". It is the same reminder the engine sends after 15 min DOWN.
- **Engine back:** both actions disappear, and a line says "Automatic escalation is running again — levels already sent won't repeat."
- **A confirm before sending:** your call. Each press messages real people. Suggested: one short confirm naming who gets it.

Who sees it: the people who can acknowledge the incident (Admin, Responder on own sites, the person on call for Tier 1).

## States to draw

| Board | State |
| --- | --- |
| Main3 | Fault, before any hand check |
| Main3 | Fault, after "Loads OK" on one site and an incident opened on another |
| Main3 | The "Open incident" confirm dialog |
| MOverview4 | Fault with the hand-check list (390) |
| Incident / MIncident | Manual incident, engine down: Escalate now at L1, then at L2 |
| Incident / MIncident | Engine back: the "running again" line, no buttons |

## Not in scope

- The Probes & heartbeat page: S12a builds it from the existing Probes board.
- Chat and email text: Claude drafts it, and message-checker reviews it.
- "Acknowledge monitor fault": dropped (D-053).
