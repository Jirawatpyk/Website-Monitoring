# Brief for Claude Design: MReports (Uptime reports at 390 px)

**Board to draw:** `MReports`, the phone version of `Reports` (390 × 844, light and dark).
**Route:** `/reports`, built in S20 (D-072, D-073). The desktop board `Reports.dc.html` is built from xl (1280 px).
**Until this board arrives:** below xl, each client is a card (one column on a phone, two from 768 px). That's a stop-gap, not a design: start from the `Reports` board, not from it.

## What the page holds

The same content as the desktop board, minus what S20b adds later (marked **S20b**). Every staff role sees the page (Admin, Responder, Stakeholder, Viewer); the client role gets No access.

- **Header:**
  - The phone top bar "Uptime reports", with the back arrow to Overview (spec §22.1).
  - Meta: "Figures as of Sun 22 Nov 13:03 (UTC+7)" and "Monthly PDF per client in DxT branding, drafted on the 1st at 06:00 and refreshed when its figures change."
- **Month switch:** two options, the last complete month and the running one ("Oct 2026 · Nov 2026").
  - The running month is a live preview: the section heading adds "Preview draft · generated on demand".
- **Stats:** three today.
  - "Uptime · Oct 2026" (or "Uptime · Nov so far"), e.g. 99.98%, with the caption "11 client sites · maintenance excluded".
  - "Downtime": 1 h 58 min, "Outages only, across all clients".
  - "Incidents clients see": 10, "8 outages · 2 degraded" (+ "· 2 still open" while running).
  - **S20b** adds a fourth, "Reports sent" (3 / 9).
- **Section heading:** "Client reports · October 2026".
- **The rule note:** "Tier 1 clients first. Incidents = what the client sees: Outage (a DOWN) and Degraded (a slow, key-page, regional or intermittent PROBLEM). SSL, domain, keyword and blocked-check PROBLEMs stay internal and aren't counted. A report can't go out while one of its incidents has no root cause." Too long to show in full on a phone.
- **One item per client** (up to ~10 clients, Tier 1 first). Each item has:
  - The client name, and a "Tier 1" badge when any of its sites is Tier 1.
  - Uptime (99.71%), Downtime (1 h 41 min), and Incidents with its words ("3 · 3 outages, 1 open", or "0").
  - Sites (1–2) and the AM's name.
  - Report status, a pill: "Draft ready" · "Not drafted yet" · "Month running" · "Draft from an older version".
    - Plus the "Needs root cause" warning badge (pencil icon) when an incident in it has no root cause.
    - **S20b** adds "Sent automatically 1 Sep", "Sends automatically 1 Oct" and "Draft, AM sends".
  - "Preview" (or "Preview draft" while running): opens the client's A4 PDF in a new tab. The app's security headers forbid showing it inside the page.
  - "Send": disabled today. Its reason is "Sending reports to clients isn't available yet — download the PDF and send it yourself". **S20b:** Send / Resend opens a confirm with Client, Report, Uptime · incidents, To, From and "Emails can't be recalled · logged in the audit log".
- **Empty:** "No client sites were watched this month" — "A client gets a report once one of its sites is being monitored."
- **S20b:** the Daily digest, Weekly summary and Monthly client report cards with their switches. Not built yet.

## Provisional copy

These words are S20's stop-gap, not the board's. Please settle them:

- the status pills "Draft ready", "Not drafted yet" and "Draft from an older version" (the board has "Draft, AM sends" and "Month running");
- the Send-off reason.

## Questions the board should answer

1. **Stats on 390:** three stacked (as now), 2 + 1 (as MExpiry), or a smaller strip? What about the fourth one S20b adds?
2. **The rule note:** a "More / Less" line, as MExpiry's "How it alerts"? A sheet? Or shortened?
3. **The client item:** which figures stay on the card, and does it open a sheet with the rest, as MMaintenanceList does?
4. **Preview on a phone:** a PDF in a new tab is fine on desktop. Is a phone better served by "Download PDF"?
5. **Disabled Send:** a tooltip doesn't show on touch. Where does its reason go — one line under the list, as now, or on each item?
6. **S20b:** please draw Send / Resend's confirm as a phone sheet, and where the three switches sit, so S20b has a board too.
7. **Provisional copy:** the words above, on the phone and the desktop board alike.
8. **Tablet (768–1279):** two cards per row today. Keep that, or should the board show 820 too?

## Rules that apply

- Spec §22 items 1–3:
  - one column with 16 px padding;
  - 44 px targets;
  - the bottom nav with no item selected (Uptime reports isn't a bottom-nav tab);
  - no sideways scroll (D-018).
- Status never by colour alone: each pill and badge keeps its icon and words (spec §11).
- The phone row-card pattern from MExpiry / MMaintenanceList / MSites.
- AURA components and tokens only.
- The sample data is mock: the Reports board's own rows (Bangkok Airways, ENEOS, MuvMi, realme, Fuji Links, Tubtong, Cando Asia, ORCA Thailand, WeCare; Aug and Sep figures).
- Copy per spec §13: "Fri 25 Sep", "1 h 41 min", "99.71%". No spec codes on screen.
