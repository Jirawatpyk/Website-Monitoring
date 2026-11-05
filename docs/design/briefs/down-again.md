# Design brief — "Down again" on the hand check (D-055 item 7)

For Claude Design. Boards to extend: **MainFault** (desktop 1440) and **MOverview4** (phone 390), plus one line on **Incident** / **MIncident**. Sample data below is test data only.

## What it is

During a monitor fault (spec §30) the Overview's "Hand check · Tier 1" card lists each Tier 1 site with Loads OK and Down — open incident. Today a site whose incident is still open shows only "Open INC-…". D-055 item 7 adds a way to report it down by hand:

| The site's open incident                                          | Button          | What it does                                                               |
| ----------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| Recovered (Monitoring / Needs root cause, or a key-page episode)  | Down again…     | DOWN AGAIN in the incident's Chat thread; the levels already reached stay  |
| A PROBLEM (any state)                                             | Report down…    | Raised to DOWN; the DOWN alert goes now; the DOWN ladder starts if unacked |
| Still DOWN                                                        | none            | It is the alert already                                                    |

Who may press: the same people as Down (owner / backup, the person on call, an Admin). Not on a muted site or one in maintenance.

## States to draw (desktop row, phone row card, dialog)

1. **Before** — MuvMi, INC-0142 in Monitoring (recovered 00:10), fault since 02:17, board time 02:40. Row: Loads OK · Down again… · and the link to INC-0142.
   - The current build puts three controls in the 320 px actions column and "Open INC-0142" wraps to a second line. Proposal: show "Open INC-0142" as the row's line (like "INC-0143 opened · Tao 02:31") and keep the pair Loads OK + Down again…, as the board's other rows.
2. **Dialog, relapse** — title "Report MuvMi down again?"; meta "MuvMi · Tier 1 · owner Arm · statuses are from 02:17"; the note field (as the Down dialog); info line "Posts DOWN AGAIN in INC-0142’s thread now."; CTA "Report down" (danger); "Logged in the audit log as Tao."
   - Suggested by review: say who is @mentioned (the owner while unacked) and that levels already reached are kept.
3. **Dialog, raise** — Fuji Links (Tier 1 for the sample), INC-0150 PROBLEM · Slow. Title "Report Fuji Links down?"; info "Raises INC-0150 to DOWN and posts the alert now."
   - Suggested by review: say the DOWN ladder starts from the press, and on a client site that the client-update clock starts.
4. **After** — row line "INC-0142 reported down · Tao 02:40", status "Down · by hand 02:40", no buttons while it is down; focus lands on that line. Once the incident recovers, the buttons come back.
5. **Refused** — the dialog's error "Not reported · This incident is down already, or closed."

## Incident timeline (Incident / MIncident)

- Relapse: "Down again, reported by Tao from a hand check · “502 again”" / "Reported by hand — no probe round confirms it yet".
- Raise: "Raised to DOWN by Tao from a hand check · “…”" / same detail.
- Engine back (already drawn, §30.8): "Status engine back — automatic escalation running again" / "Levels already sent won’t repeat." The desktop board adds "Next: L2 at 03:01 if still unacked." and MIncident splits the text differently — say which you want.

## Open wording question

The shipped manual-open line reads "Trigger: Manual (hand check) · the status engine was down, so there are no probe results". In a sweep-only fault the probes still run, so that isn't always true. The new lines use "Reported by hand — no probe round confirms it yet". Should the manual-open line match?
