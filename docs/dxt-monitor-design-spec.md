# DxT Monitor — Design spec for developer handoff

Version: 9 Oct 2026 · Owner: Tao (Jirawat Piyakit) · Status: approved, ready for build.
Companion documents: PRD — DxT Website Monitoring Platform (what to build, priority, architecture, budget) · Design canvas "DxT Website Monitoring" (49 screens, open in Play mode to click through flows) · AURA design system (components + tokens).

## 0. How to use this spec
- **What this is:** the rules every screen follows — statuses, escalation, lifecycle, messages, copy and formats. The canvas shows how it looks; this file says how it behaves.
- **Precedence:** on screen behaviour, UI copy and formats this spec wins over the PRD; on scope, priority, architecture and budget the PRD wins. Inside this spec, later sections refine earlier ones: §14 → §15 → §16 → §17–21 override anything above them that conflicts.
- **Sample data:** names of owners, backups, AMs and on-call people, the rotation, incident IDs, times and uptime figures (§1–§5) are realistic sample data used consistently across the mockups — not production values. Real owners and tiers come from the Site Registration Checklist (PRD Phase 0). Items marked "Proposal · pending CEO" are not final until the CEO approves.
- **Build from AURA:** use AURA components and tokens as drawn; don't restyle. Known AURA gaps are listed in the orange note on the canvas.
- **Icons available in AURA (canvas copy):** arrow-down arrow-left arrow-right arrow-up arrow-up-down arrow-up-right ban bell calendar chart-column check chevron-down chevron-left chevron-right chevron-up circle circle-alert circle-check circle-dot-dashed clock cloud-upload columns-3 copy download ellipsis external-link eye eye-off file file-text filter folder house image inbox info layout-dashboard loader-circle lock log-out mail menu minus monitor moon panel-left-close panel-left-open paperclip pencil pin pin-off plus rotate-ccw search settings sun trash-2 trending-down trending-up triangle-alert upload user users x. AURA 5.1+ (use in code) also has server, globe, activity, shield-alert, phone, wrench, and 5.34 adds StatusTile + TileGrid and Sparkline — the canvas still carries an older AURA copy, so boards draw look-alikes of these.
- **Badge / pill variants:** success, warning, danger, accent, neutral; variants: soft (default), solid, outline. StatusPill tones: neutral, progress, ready, warning (AURA 5.1+), blocked. Confirmations use the AURA Dialog (modal).

### Screen index ("board" in this spec = one screen on the canvas)
| Screen (file) | Canvas title | Size | Canvas row |
|---|---|---|---|
| Main3 | Overview — option A (Live issues + All sites tiles) · **S06, build this** | 1440×2555 | Web app — desktop 1440 + mobile 390 |
| MainDark3 | Overview — option A · dark (NOC wall) · **S06** | 1440×2555 | Web app — desktop 1440 + mobile 390 |
| MOverview4 | Mobile — Overview · **S06, build this** | 390×844 | Web app — desktop 1440 + mobile 390 |
| Main | Overview dashboard (pre-S06 reference — superseded by Main3, §21) | 1440×1840 | Web app — desktop 1440 + mobile 390 |
| Sites | Sites list | 1440×2588 | Web app — desktop 1440 + mobile 390 |
| SiteDetail | Site detail — Bangkok Airways – Taiwan | 1440×1680 | Web app — desktop 1440 + mobile 390 |
| Incident | Incident — INC-0142 MuvMi DOWN | 1440×1660 | Web app — desktop 1440 + mobile 390 |
| MOverview | Mobile — Overview (pre-S06 reference — superseded by MOverview4, §21) | 390×844 | Web app — desktop 1440 + mobile 390 |
| MSites | Mobile — Sites | 390×844 | Web app — desktop 1440 + mobile 390 |
| MSite | Mobile — Site detail | 390×844 | Web app — desktop 1440 + mobile 390 |
| MIncident | Mobile — Incident detail | 390×844 | Web app — desktop 1440 + mobile 390 |
| StatusModel | Status model & verification logic | 1440×4680 | Status logic · Mobile ack · Alert channel |
| MobileAck | Mobile — acknowledge from alert | 390×844 | Status logic · Mobile ack · Alert channel |
| ChatAlert | Google Chat alert thread (content spec) | 600×8448 | Status logic · Mobile ack · Alert channel |
| Incidents | Incidents list | 1440×1100 | Core flows · incidents · maintenance · onboarding |
| Maintenance | Maintenance / mute dialog | 1440×1240 | Core flows · incidents · maintenance · onboarding |
| AddSite | Add site + registration checklist | 1440×1680 | Core flows · incidents · maintenance · onboarding |
| Escalation | Escalation policies | 1440×1528 | Operations & governance · web |
| OnCall | On-call rotation | 1440×1464 | Operations & governance · web |
| Probes | Probes & heartbeat | 1440×1496 | Operations & governance · web |
| AuditLog | Audit log | 1440×1913 | Operations & governance · web |
| MIncidents | Mobile — Incidents | 390×844 | Mobile app · 390 |
| MOnCall | Mobile — On-call | 390×844 | Mobile app · 390 |
| MMaintenance | Mobile — Mute / maintenance sheet | 390×844 | Mobile app · 390 |
| Reports | Uptime reports | 1440×1220 | Reports · client-facing · admin |
| ReportPDF | Monthly client report PDF (A4) | 794×1123 | Reports · client-facing · admin |
| StatusPage | Client status page | 1280×1380 | Reports · client-facing · admin |
| MStatusPage | Client status page — mobile | 390×844 | Reports · client-facing · admin |
| Users | Settings — users & roles | 1440×1468 | Reports · client-facing · admin |
| PostIncident | Post-incident review — INC-0133 VOCA | 1440×1732 | Review loop · alert routing · dark mode |
| AlertChannels | Settings — alert channels & routing | 1440×1960 | Review loop · alert routing · dark mode |
| MainDark | Overview dashboard — dark (pre-S06 reference — superseded by MainDark3, §21) | 1440×1840 | Review loop · alert routing · dark mode |
| MobileAckDark | Mobile ack — dark (night on-call) | 390×844 | Review loop · alert routing · dark mode |
| Login | Sign in — Google SSO + Admin 2-step | 1440×900 | Access · monitor config · resolve · when the monitor itself fails |
| MLogin | Mobile — session expired from alert link | 390×844 | Access · monitor config · resolve · when the monitor itself fails |
| EditMonitors | Edit monitors | 1440×1560 | Access · monitor config · resolve · when the monitor itself fails |
| Resolve | Resolve incident + root cause | 1440×1100 | Access · monitor config · resolve · when the monitor itself fails |
| MainFault | Overview — monitoring degraded (heartbeat missed) | 1440×1228 | Access · monitor config · resolve · when the monitor itself fails |
| Expiry | SSL & domain expiry | 1440×1340 | Expiry · summaries · email · account & security · empty states |
| WeeklySummary | Weekly summary — Chat card spec | 600×2397 | Expiry · summaries · email · account & security · empty states |
| EmailAlert | Alert email template | 720×1888 | Expiry · summaries · email · account & security · empty states |
| Profile | My profile & notifications | 1440×1136 | Expiry · summaries · email · account & security · empty states |
| Security | Settings — sign-in & security | 1440×1540 | Expiry · summaries · email · account & security · empty states |
| EmptyStates | Empty, loading & no-access states | 1440×1562 | Expiry · summaries · email · account & security · empty states |
| Organisation | Settings — organisation: tiers, clients, data, cost | 1440×1762 | Organisation · Phase 3: synthetic checks · API & webhooks |
| Synthetic | Synthetic check — search → booking (Phase 3) | 1440×1184 | Organisation · Phase 3: synthetic checks · API & webhooks |
| ApiWebhooks | Settings — API & webhooks (Phase 3) | 1440×1300 | Organisation · Phase 3: synthetic checks · API & webhooks |
| Guide | User guide | 1440×1784 | Help · user guide (desktop + mobile) |
| MGuide | Mobile — User guide | 390×844 | Help · user guide (desktop + mobile) |

## 1. Snapshot times — sample data (the "now" shown on each screen)
- Default: Fri 25 Sep 2026 10:07 (UTC+7). Viewer on desktop = **Tao** (Admin).
- Mobile boards: viewer = **Arm** (owner of MuvMi) unless the board is about on-call, where viewer = **Ploy** (on call this week). Show "Signed in as …" where an action is recorded.
- MainFault: Sat 26 Sep 02:31. WeeklySummary: Mon 28 Sep 09:00. Resolve: 10:08. ChatAlert/EmailAlert thread may run to 10:31. ApiWebhooks: 10:08.

## 2. People — sample data
- Tao = Jirawat Piyakit, Admin. Display **"Tao"** everywhere (sidebar footer: "Tao" / "Jirawat Piyakit · Admin"). Never "Jirawat Piyakit (Tao)" or "Jirawat Piyakit" alone in activity text.
- Responders: Arm, Ploy, Nok. Stakeholders: Thee (AM), Bua (AM), CEO. Viewer: Mint. "Second Admin" = invited, not joined → only 1 active Admin today (show a warning where monitor-fault alerts or admin coverage are described).
- On-call rotation (Tier 1 nights/weekends): Ploy Mon 21 Sep → Mon 28 Sep (current), Nok 28 Sep → 5 Oct, Arm 5 Oct → 12 Oct (swap requested by Arm with Nok, Nok has NOT accepted yet), Ploy 12 → 19 Oct. Tao is not in the rotation (Admin backstop).

## 3. Sites (17) — tier (proposed) · owner · backup · client · AM (owners/backups/AMs are sample data)
Tier 1 (1 min, 24/7): Bangkok Airways – Taiwan · Arm · Ploy · Bangkok Airways · Bua | Bangkok Airways – China · Arm · Ploy · Bangkok Airways · Bua | ENEOS Industrial · Ploy · Arm · ENEOS · Thee | MuvMi · Arm · Ploy · MuvMi · Bua | realme.link · Nok · Arm · realme · Thee
Tier 2 (3 min): Fuji Links · Ploy · Nok · Fuji Links · Thee | WeCare Studio · Nok · Ploy · WeCare · Bua | Tubtong · Ploy · Nok · Tubtong · Bua | Cando Asia · Nok · Ploy · Cando Asia · Bua | ORCA Thailand · Tao · Nok · ORCA · Thee | WeCare Asia · Nok · Ploy · WeCare · Bua | VOCA · Ploy · Tao · internal | EQHO · Tao · Nok · internal | DxT · Tao · Nok · internal
Tier 3 (5 min): DxT Solutions, DxT AI, DxT Games · Tao · Nok · internal
Owner counts: Arm 3, Ploy 4, Nok 4, Tao 6.

## 4. Incident ledger — sample data used across screens
| ID | Site | Sev | Trigger | When | Down/duration | Notes |
|---|---|---|---|---|---|---|
| INC-0142 | MuvMi (T1) | DOWN | hard_fail | Fri 25 Sep 09:48:41 confirmed | 19 min at 10:07; final 43 min (recovered 10:31) | Timeout > 30 s at BKK and TYO, HTTP 504 at SIN. First failure 09:48:12, immediate recheck 09:48:41 confirmed. L1 10:03 (Ploy + Tao). Client update due 10:03 → Bua @mentioned 10:03. L2 would be CEO at 10:18. Acked by Arm 10:07:40 (after the 10:07:12 Overview snapshot). |
| INC-0141 | Fuji Links (T2) | PROBLEM | slow (p50 5.8 s > 5 s, 3 rounds) | Fri 09:52 | 15 min at 10:07; final 22 min | Acked by Ploy 09:58 |
| INC-0139 | ORCA Thailand (T2) | DOWN | hard_fail | Thu 24 Sep 22:14–22:22 | 8 min | Outside response hours → posted, timers paused. Recovered on its own (provider reboot). Needs root cause → resolved by Tao Fri 10:08 in Resolve board. |
| INC-0138 | Tubtong (T2) | PROBLEM | blocked_unverified | Thu 14:02 | 12 min | Verifier restarted |
| INC-0136 | DxT AI (T3) | PROBLEM | ssl (< 14 days) | Wed 23 Sep 09:00 | 1 d 2 h | Cert renewed. Internal only. |
| INC-0133 | VOCA (T2) | DOWN | hard_fail, flapped ×4 | Mon 21 Sep 03:12–04:04 | 41 min down (4 drops) | Outside response hours → timers paused until 09:00. Acked by Ploy 08:04 (before hours). Review in progress, waiting Tao's sign-off. |
| INC-0131 | BA – Taiwan (T1) | PROBLEM | regional (SIN CDN edge) | Mon 14 Sep 21:12 | 6 min | |
| INC-0129 | WeCare Asia (T2) | PROBLEM | keyword | Sat 12 Sep 16:40 | 22 min | Broken deploy, rolled back |
| INC-0126 | MuvMi (T1) | DOWN | hard_fail | Fri 11 Sep 14:05 | 35 min | |
| INC-0124 | Cando Asia (T2) | DOWN | hard_fail | Thu 10 Sep 11:20 | 12 min | |
| INC-0120 | MuvMi (T1) | DOWN | hard_fail | Tue 8 Sep 19:30 | 47 min | |
| INC-0118 | BA – Taiwan (T1) | DOWN | hard_fail | Wed 2 Sep 03:40–03:51 | 11 min | Server fault |
Older (before 26 Aug, outside 30 days): 21 Aug BA – China outage 26 min; 18 Aug BA – Taiwan slowdown; 11 Aug BA – Taiwan SSL early warning (internal only); Tubtong 2 incidents in Aug (30 min DOWN total).
The incident list "Last 30 days" therefore holds 12 incidents (0118–0142 above). IDs not listed (0119, 0121–0123, 0125, 0127, 0128, 0130, 0132, 0134, 0135, 0137, 0140) are PROBLEMs on other sites that were auto-resolved in < 5 min — the list may say "12 shown · 13 short PROBLEMs auto-resolved (hidden)".

## 5. Uptime (DOWN minutes only; PROBLEM counts as up; maintenance excluded; mute counted) — formula is a rule, figures are sample data
30-day uptime at Fri 10:07 (window 43,200 min): MuvMi 99.77% (101 min) · BA – Taiwan 99.97% (11) · Cando Asia 99.97% (12) · ORCA 99.98% (8) · VOCA 99.91% (41) · every other site 100.00%. All sites 30 d = **99.98%** (173 min / 734,400).
At Sat 02:31 (MainFault): MuvMi 99.71% (125 min); all sites 99.97%.
September so far (1 Sep → 25 Sep 10:07): clients only — BA 11 min · MuvMi 101 min (1 ongoing) · Cando 12 min · ORCA 8 min.
Formula to state in StatusModel: site uptime = 1 − DOWN minutes / minutes in window (maintenance removed from both); all-sites = time-weighted across sites.

## 6. DOWN rule (canonical sentence — use it verbatim or a faithful short form)
"DOWN when at least 2 of 3 locations get a hard fail (timeout, 5xx, DNS/TLS error, connection refused) on two checks in a row. The second check is an immediate recheck about 30 s after the first failure. Hard fails don't wait for the browser verifier — it only takes a screenshot afterwards as evidence. If locations are blocked (403, 429, bot challenge), the browser verifier decides: page loads and keyword found → OK with a note; page fails → DOWN; verifier unavailable → PROBLEM (unverified)."
Regional: one location failing ≥ 5 min while the others pass → PROBLEM (regional). Incident duration starts at the first failed check.
Detection targets (unchanged from PRD): Tier 1 ≤ 3 min, Tier 2–3 ≤ 10 min. Typical confirm time: check interval + ~30 s.
Only the primary monitor can make a site DOWN; all other monitors cap at PROBLEM.

## 7. Response hours (one value per tier, edited only in Settings › Organisation)
- Tier 1: 24/7. Mon–Fri 09:00–18:00 the owner responds; outside that the on-call person responds.
- Tier 2 and Tier 3: Mon–Fri 09:00–18:00. DOWN is still posted immediately at any hour, but escalation timers pause outside response hours and resume at 09:00. PROBLEM outside response hours is held until 09:00.
- No "08:00–22:00" anywhere. No "quiet hours 22:00–08:00" anywhere.

## 8. Escalation (final)
Tier 1 DOWN: L0 0 min — owner (day) or on-call (night) @mention + Alerts Space · L1 +15 min — backup + Tao · L2 +30 min — CEO @mention + email (+ voice call if Twilio approved) [tag: "Proposal · pending CEO"] · L3 +60 min — CEO + AM.
Tier 2–3 DOWN (inside response hours): L0 owner + Space · L1 +15 backup + Tao · L2 +30 Tao reminder. No CEO page — the CEO sees it in the digest.
PROBLEM (all tiers): L0 owner + Space · reminder every 60 min · L1 +60 min backup. (Tier 1 PROBLEM at night goes to on-call.)
Acknowledge stops the escalation chain. It does NOT stop the client-update track.
Use role tokens in the Escalation editor: "Owner / on-call", "Backup", "Admin (Tao)", "CEO", "Site AM" — preview resolves them (MuvMi → Arm, Ploy, Tao, CEO, Bua).

## 9. Client-update track (separate from escalation)
- Tier 1 DOWN reaching 15 min → the site's AM is @mentioned in the thread with a draft client message, whatever the ack state. Tier 2 DOWN reaching 60 min inside response hours → AM. Tier 3 → report only.
- Incident page has a "Client update" card: AM, due time, draft, buttons "Mark client updated" (records who + time) and "Copy draft". State: Due 10:03 · Bua notified 10:03 · not marked updated yet.
- A Tier 1 DOWN longer than 15 min cannot be resolved until the client update is marked (or marked "Not needed" with a reason).
- PostIncident "Client notified" comes from this record.

## 10. Chat & email mechanics
- Chat: every alert and thread reply has a plain `text` line before the card; @mentions live there as `<users/{id}>` (card body mentions don't notify). Example: `<users/ARM> DOWN · MuvMi (Tier 1) · acknowledge by 10:03 or it escalates`. The first card can't be edited by a webhook — each reply starts with the current state in words ("ACKNOWLEDGED · MuvMi · by Arm 10:07"). The first card's button reads "Open / acknowledge".
- L0 mentions only the person expected to act (owner by day, on-call at night); backup appears as plain text. L1: "@Ploy please acknowledge · Tao FYI".
- Digests and the weekly summary go to a separate Space "DxT Website Reports" (no @mentions except named follow-ups). Test alerts post in their own "TEST — no action" thread and mention only the tester.
- On-call checklist: "Alerts Space: notify for @mentions only" + "Space allowed through Do Not Disturb" + "Test alert received on this phone".
- Email: one subject per incident, e.g. "MuvMi · Tier 1 · INC-0142"; status goes first in the body and preheader ("DOWN — …"); In-Reply-To/References set to the first message. Each recipient's footer says why they got it.
- Cause wording template (everywhere): "Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)"; short form "Timeout ×2 · 504 ×1". Timestamp label: "Confirmed down 09:48:41".

## 11. Status and badge semantics
- Site status (severity): Down = Badge danger **solid** ban · Problem = Badge warning soft triangle-alert · OK = Badge success soft circle-check · Maintenance = Badge accent soft calendar. **Purple/accent is reserved for Maintenance.**
- Mute is an overlay, not a status: keep the real status badge and add Badge neutral outline eye-off "Muted · until 18:00". Mute: alerts suppressed, still counted in uptime, max 24 h, Responders on their own sites.
- Incident workflow state (never solid red, never ban icon): Unacked = Badge danger outline clock · Escalated L1/L2 = Badge warning outline arrow-up-right ("Escalated · L1") · Acknowledged = Badge neutral outline check · Monitoring (recovered, waiting) = Badge neutral outline eye · Needs root cause = Badge warning outline pencil · Resolved = Badge success outline circle-check · In review = Badge neutral outline file-text · Closed = Badge neutral soft.
- Recovered incidents show severity as outline ("Was down" = Badge danger outline ban) in lists of past/needs-action items.
- Phase tags: Badge neutral outline "Phase 3" (never accent). "Primary" monitor tag: neutral outline.
- Ownership chips ("Yours", "Backup", "Your client" — §21): Badge neutral outline with the user / users icon. Never accent: they sit next to status badges, and accent there means Maintenance.
- Location glyphs (BKK SIN TYO): circle-check pass (positive) · ban hard fail (danger) · lock "Blocked by bot protection" — blocked but verified OK (fg-secondary, NOT amber) · shield-alert "TLS chain error" (warning; a location warning, the site status is unchanged) · clock slow (warning) · circle-dot-dashed no data (tertiary) · circle paused/maintenance (tertiary). Show a one-line legend near the column.

## 12. Client-facing mapping (status page + client report)
DOWN → "Outage" (red), counted in uptime, listed. PROBLEM slow / key page / regional → "Degraded" (amber), listed, not counted. PROBLEM SSL/domain, keyword, redirect, blocked_unverified and OK+note → internal only: not listed, not coloured. Maintenance → "Planned maintenance" (grey), not counted. Monitor fault / stale data (> 5 min) → neutral "Live status temporarily unavailable · last confirmed Sat 26 Sep 02:17" and no green banner. "Last checked" always includes the date.

## 13. Copy and format rules (product UI)
- No spec codes in the product UI: remove "FR-xx", "PRD §", "NFR", "P0/P1/P2", DB table names (oncall_shifts, escalation_policies, audit_log, RLS…) from eyebrows, titles, captions and buttons. Eyebrow = breadcrumb (chevron style) OR section name in caps ("SETTINGS", "OPERATIONS", "REPORTS"), never both. Spec boards (StatusModel, EmptyStates, ChatAlert, EmailAlert, WeeklySummary) may keep references only inside a dashed "spec note" box.
- Triggers shown to people as words: hard_fail → "Hard fail", blocked_unverified → "Blocked, not verified", slow → "Slow", ssl → "SSL expiring", keyword → "Keyword", regional → "Regional".
- Dates: "25 Sep", with weekday "Fri 25 Sep", "Today 10:07", "Yesterday 16:40"; never "Sept", never zero-padded "02 Sep". Durations: "43 min", "1 h 2 min", "1 d 2 h", "26 min". Percent: "99.97%". Tier: "Tier 1" in prose/pills; "T1" only inside dense table cells.
- One primary (black) button per view. While an incident banner is showing, the banner CTA is the primary; page actions like "Add site" become secondary.
- Destructive or wide-reach actions (revoke, remove, sign out all, change role, save escalation, untick DOWN routing, require 2-step for all) need a confirm step that names what will happen and to whom; show at least one such confirm as an openable state on the board that owns the action.
- Settings save model: page-level "Save changes" only appears as a sticky bar "N unsaved changes · Discard · Save" when something changed; instant actions say "Takes effect now". Pages with nothing editable have no Save button.

## 14. Rules added in review round 3 (override §1–§13 where they conflict)
1. **L3 after acknowledge (amends §8):** Acknowledge stops L1 and L2. For **Tier 1 DOWN only**, if the site is still DOWN at +60 min, L3 still sends an **FYI** to CEO + Site AM (@mention in the text line + email, never a voice call). Canonical post-ack sentence: "Acknowledged by Arm → L1–L2 stopped. If MuvMi is still down at 10:48, CEO + Bua get an FYI (no call)." Ladder after ack: L2 "Cancelled · acked"; L3 "FYI at 10:48 if still down". Tier 2–3 have no L3.
2. **Purple (amends §11):** Violet is AURA's brand accent — links, selected nav item, info alerts, progress bars and charts may stay violet. The badge rule stays: among status/workflow BADGES only Maintenance uses accent. Maintenance is identified by the calendar icon + the word "Maintenance", not by colour alone.
3. **Incident state precedence:** Unacked (Badge danger outline clock) until L1 fires; from then "Escalated · L1/L2" (warning outline arrow-up-right) replaces it and the wait shows as text ("18 min unacked"). Wait time is counted from "Confirmed down" (INC-0142: 09:48:41 → 18 min at 10:07:12). Incident duration is counted from the first failed check (19 min). Undo of an ack: a 10 s toast on every board; Chat/email posts for the ack are HELD until the undo window closes ("Posting to Chat in 10 s").
4. **Monitor-fault rule (one version everywhere):** Healthchecks.io heartbeat missed > 3 min → email to Tao (the only active Admin) + a post in the Alerts Space that @mentions the on-call person. MainFault timeline: last complete round 02:17, heartbeat missed → alert at 02:20 (email Tao, Chat mention Ploy). "What still works" lists "DxT Monitor alerts · paused" and "Healthchecks.io → Chat + email · working".
5. **Maintenance guard:** a maintenance window can't start (Now or overlapping now) on a site that is DOWN or has an open incident. Show a blocking alert ("MuvMi is DOWN now (INC-0142). A window started now won't hide this incident — it stays open and keeps counting.") and offer Mute instead. Admins approve their own > 24 h windows ("You're an Admin — no approval needed"). Same on mobile.
6. **Manual incident during a monitor fault:** the hand check has two outcomes: "Loads OK" and "Down — open incident". The second opens INC with Trigger "Manual (hand check)", posts L0 in the Alerts Space and starts the client-update track. MainFault Open incidents at Sat 02:31 = 1 (INC-0142 MuvMi · needs root cause); sidebar Incidents count 1; MTTA/uptime cards say "as of 02:17".
7. **Escalation editor guardrails:** L0 is pinned on every DOWN policy (can't delete or move; always Owner/on-call + Alerts Space). Steps after L0 must be ≥ +15 min and later than the previous step. A step tagged "Proposal" can't move above L2. The save dialog lists blocking validation errors. The pencil opens an edit state: delay (validated), role-token picker, channel checkboxes, voice call locked "until approved".
8. **Channel ownership:** channels per level are owned by Escalation. AlertChannels "Who gets what" shows the DOWN row read-only ("Set per step in Escalation"); its confirm for other rows names every affected person including CEO and AMs.
9. **Role change / deactivate "Used in" check:** before changing role or deactivating, list where the person is used (escalation levels, Site AM of N clients, owner/backup of N sites, on-call shifts) and require reassignment. Deactivate reuses the same dialog.
10. **Chat text lines** always start with STATE · site (e.g. `<users/PLOY> ESCALATED · L1 · MuvMi DOWN 15 min, not acknowledged · please acknowledge · Tao FYI · CEO at 10:18`). The ChatAlert board shows a compact table "event → text line → who is @mentioned" covering: Tier 1 DOWN day, Tier 1 DOWN night, Tier 2 DOWN outside hours ("timers paused until 09:00", no "acknowledge by"), L1, L2 (CEO), L3 FYI, client update due, acknowledged, recovered, PROBLEM, PROBLEM 60-min reminder, test alert, monitor fault. The daily digest moves to the WeeklySummary board (both are "DxT Website Reports"). First-card footer: "Anyone can open it; the ack is recorded under their own Google account, so nobody can acknowledge as someone else."
11. **Client update ledger:** INC-0142 client update marked by Bua Fri 10:12 ("Called MuvMi ops, ETA shared"). Incident card also has "Not needed…" (dialog with required reason). EmailAlert gets a "Client update due" email to Bua at 10:03 (primary button "Open draft").
12. **Data fixes:** BA – Taiwan 18 Aug = Degraded 14 min "booking page slow" (INC-0097) on SiteDetail, StatusPage, MStatusPage, ReportPDF. Week grid on OnCall: Mon 21 Sep 00:00–09:00 = Arm. Backup counts: Arm 2, Ploy 6, Nok 8. Reports September headline counts client-visible incidents only (DOWN + Degraded) and matches the table. Login "Admin, no 2-step" state is "Second Admin". Expiry: auto-renew SSL listed only < 30 d → "Due within 60 days: 2 items" (Cando domain 41 d, WeCare Studio domain 50 d), days-left in amber not red. AlertChannels SSL line: "SSL < 14 d · domain < 30 d". EmptyStates panel 2: "recovered 10:31". Stat percentages render as "99.98%" (pass the % inside value, no separate unit).
13. **Primary button in the incident banner = Acknowledge** (Main, MainDark); "Open INC-0142" secondary.
14. **Tier 2 and Tier 3 share one response-hours setting** in Organisation ("Tier 2–3"), saved via a confirm with before/after, "Affects N sites", required note; times are pickers validated From < To.
15. **Eyebrows:** the timestamp is a meta line under the title, not the eyebrow. Top-level pages use a section eyebrow: OVERVIEW, INCIDENTS, SITES, OPERATIONS, REPORTS, SYSTEM, SETTINGS, ACCOUNT (Profile).
16. **No dead controls:** every visible button either works (opens a state/dialog/link) or is disabled with a reason/tooltip text next to it.
17. Tap targets on mobile ≥ 44 px for every interactive element (use padding if the visual is smaller).

## 15. Rules added in review round 4 (override anything above where they conflict)
1. **Mute on a site with an open incident:** Mute stops NEW alerts only. An open incident keeps its escalation ladder, the L3 FYI and the client-update track. Mute never counts as an acknowledgement. Say this on every mute sheet when the site has an open incident ("Mute stops new alerts only — INC-0142 keeps escalating until someone acknowledges"). Mutes and maintenance windows can be ended early / edited / cancelled from the Main "Maintenance & mutes" card (confirm, logged). Reason is required before submit on every mute/maintenance sheet.
2. **2-step after Mon 5 Oct:** a person without 2-step can still sign in to ACKNOWLEDGE only (view + ack); everything else is locked until they turn it on — same pattern as the Admin case. Users shows "Off · needed from 5 Oct" for Nok, Thee, Mint and the subtitle "2-step required for everyone from Mon 5 Oct". Login has a state "2-step required — you can acknowledge only". Nok's risk is standing (his own shift ends Mon 5 Oct 09:00; he owns 4 sites and backs up 8), not only "if the swap is accepted".
3. **Heartbeats:** engine (status engine / Vercel Cron) heartbeat missed > 3 min → email Tao + Alerts Space post @mentioning on-call. A single probe (BKK, SIN or TYO) missing > 3 min → email Tao only, no page (the other two locations still decide status). Probes' heartbeat table shows the grace and who is alerted per row. Today's SIN gap 03:12–03:16 therefore produced one email to Tao at 03:15 — show it in Probes and AuditLog. Drop the undocumented "held" rule unless it is written into StatusModel as: "if one location fails > 50% of sites in a round, that location is treated as no data for that round".
4. **Incident lifecycle (replaces 'first match wins'):** DOWN: Unacked → Escalated · Lx → Acknowledged → Monitoring (recovered) → Needs root cause → Resolved → In review (review draft submitted for sign-off) → Closed (review signed off). PROBLEM: Unacked/Escalated → Acknowledged → Resolved (ends there; no Closed). Resolve needs 3 conditions everywhere: OK for 2 rounds, client update marked (or not required / not needed), root cause written. Resolve/ack posts to Chat are held 10 s like the ack (§14.3). Webhooks are held the same way (incident.acknowledged at 10:07:50).
5. **Escalation invariants:** every step needs ≥ 1 channel (blocking error, preview says "notifies nobody"); L0 Chat @mention and Alerts Space are both locked on; the "continues after ack as FYI, no call" rule is a property of the Tier 1 CEO + AM step — that step can't be removed from Tier 1 DOWN and can't carry voice; the CEO token is allowed only on Tier 1 DOWN steps from L2 onward and is auto-tagged "Proposal · pending CEO"; each DOWN policy needs ≥ 1 step after L0 (PROBLEM: warning only). Voice on L2 shows "Configured · off until approved" (checked + locked). PROBLEM channels are owned by Escalation too (AlertChannels PROBLEM row read-only like DOWN).
6. **Mobile incident screens** scroll vertically with bottom padding above the sticky action bar; after ack the full log stays and gains "10:07 Acknowledged by Arm (posted 10:07:50)". Mobile undo copy = desktop copy ("Posting to Chat + email in N s — nothing is sent until then"); the inline card is allowed on mobile instead of a toast. All mobile inputs/selects ≥ 44 px, dialog close buttons 44 × 44.
7. **Messages:** add EmailAlert events "L2 (CEO) — Proposal" and "L3 FYI (CEO + Bua)"; tag the L2 row in the ChatAlert table "Proposal · pending CEO"; add an "L1 · night" row (Tao @mentioned when the backup is already the paged on-call person) with the rule line "L1 = backup + Tao, minus anyone already paged"; the recovered email to Bua uses "Open incident" (no second 'mark updated'); the night card button links to MobileAckDark; weekly Tier 2 MTTA shows "— (no DOWN inside response hours)".
8. **Data corrections:** SSL/domain days-left computed from Fri 25 Sep (BA 73 / 211, Tubtong 75, VOCA 77, Fuji 80, MuvMi 82, ENEOS 84, realme 85, EQHO 86, DxT AI 87 / 220, ORCA 87, WeCare Asia / DxT / DxT Solutions / DxT Games 88; Cando SSL 55 → 55 is 19 Nov: correct is 55; recompute every date the same way); DxT AI cert renewed Thu (matches AuditLog). AlertChannels delivery log: client-update Chat post 10:03:12, add Email · Bua · client update due 10:03 and Email · Arm · L0 09:48 (or label the log as filtered). OnCall shows Ploy's phone "2 of 3 ready · test alert not received on current phone" (matches MOnCall). EmptyStates panel 2 → "No open incidents" + "2 waiting for root cause or sign-off →". Rotation badges: Scheduled = neutral outline clock; Swap requested = neutral outline arrow-up-down.

## 16. Closing rules, review round 5 (override anything above where they conflict)
1. **Resolve trigger:** Resolve is always a MANUAL action once the 3 conditions are met. DOWN never auto-resolves. Only exception: a PROBLEM that recovers within 5 min and was never acknowledged auto-resolves (no root cause needed) and is hidden from Incidents by default ("N short PROBLEMs auto-resolved in < 5 min are hidden").
2. **Client update condition (one rule everywhere):** required only if the client-update track fired — Tier 1 DOWN > 15 min, or Tier 2 DOWN ≥ 60 min inside response hours. Otherwise the condition shows "Not required" (met). When required, it is met by "Mark client updated" or "Not needed" + reason.
3. **Root cause condition:** root cause category "Unknown — keep investigating" does NOT meet the gate (Incident and Resolve both say "Unknown keeps the incident open").
4. **RECOVERED timing:** the RECOVERED Chat reply / email is sent on the first OK round (state → Monitoring). After 2 OK rounds → Needs root cause (unless already written). Recovered copy: "Needs a root cause before it can be resolved." (never "stays in Monitoring until …").
5. **Extra Chat events** (ChatAlert coverage table + EmailAlert where noted):
   - RESOLVED reply: `RESOLVED · <site> · by <name> <time>` — no @mention; email in the same thread to everyone who got a DOWN email for that incident.
   - Tier 2–3 L2 reminder: `<users/TAO> REMINDER · L2 · <site> DOWN 30 min, not acknowledged` + email to Tao.
   - NOTE reply: `NOTE · <site> · <name>: <text>` — no @mention, no email.
6. **Permission — Mark client update / Not needed:** Admin ✓ · Responder: own sites · Stakeholder (AM): own clients · Viewer —. Locked for anyone in the 2-step "acknowledge only" state.
7. **2-step wording (all boards):** "From Mon 5 Oct <name> can still sign in to acknowledge; everything else is locked until 2-step is on." Never "stalls at the Google prompt" / "can't continue". Admin without 2-step = same (view + acknowledge only).
8. **Undo copy (one string everywhere, desktop + mobile):** "Posting to Chat, email and webhooks in N s — nothing is sent until then" (Resolve uses the same string). Undo button "Undo · N s".
9. **"Proposal · pending CEO"** badge = warning · outline · clock icon everywhere it appears (Escalation, ChatAlert, Incident, Main banner, AddSite Tier 1 text).
10. **Monitor fault + manual incident:** while the engine heartbeat is missing, timers don't run automatically; a manual incident posts L0 through the fallback sender, and L1+ / client-update reminders are sent by hand ("Escalate now"); automatic timers resume when the engine is back. Single-probe emails are suppressed while an engine fault is open.
11. **Event logs only grow:** rows in Recent events never disappear when a later event is added.
12. **Client report AM note:** the "Note from your account manager" block appears only on manually-sent reports when the AM wrote one; automatic reports omit it (sample = omitted, show a dashed spec note instead of placeholder text).

## 17. Mobile detail screens are templates
- Every incident on mobile opens Mobile Incident detail (MIncident) for that incident; every site opens Mobile Site detail (MSite) for that site. The sample screens show INC-0142 (MuvMi) and Bangkok Airways – Taiwan. "Open on desktop — not on mobile yet" is not used anywhere.
- Entry points: MOverview4 (§21) banners → MIncident; Live issues rows with an open incident → MIncident, other rows → MSite; "All N sites" → MSites; MIncidents cards → MIncident (INC-0142 "Acknowledge" row → MobileAck); MSite incident rows → MIncident; MobileAck after ack → MIncident; MobileAckDark "Open incident" → MIncident.

## 18. User guide — topics by role
Role chips (single select): All · Responder · On-call · Stakeholder · Viewer · Admin. "Stakeholder" covers AMs and the CEO; "On-call" is a duty, not an RBAC role. The chip opens pre-selected to the viewer's own role — the On-call chip when they are on call this week (desktop Tao → Admin; mobile Arm → Responder) — with "All" one tap away. Same mapping on desktop (Guide) and mobile (MGuide; the Admin topic is split in two on mobile).
| Topic | Responder | On-call | Stakeholder (AM, CEO) | Viewer | Admin |
|---|---|---|---|---|---|
| Sign in & 2-step | ✓ | ✓ | ✓ | ✓ | ✓ |
| Set up your phone for on-call | ✓ | ✓ | — | — | ✓ |
| Statuses & badges | ✓ | ✓ | ✓ | ✓ | ✓ |
| When an alert arrives | ✓ | ✓ | ✓ | — | ✓ |
| Client updates | ✓ | — | ✓ | — | ✓ |
| Recover, root cause & resolve | ✓ | ✓ | — | — | ✓ |
| Mute vs maintenance | ✓ | ✓ | — | — | ✓ |
| On-call rotation | ✓ | ✓ | — | — | ✓ |
| When the monitor itself fails | — | ✓ | — | — | ✓ |
| Reports & client status page | — | — | ✓ | — | ✓ |
| Escalation rules, users & roles | — | — | — | — | ✓ |
"When an alert arrives" carries a callout for Stakeholders: "Got an FYI (L3) or a client-update mention? You don't need to acknowledge — AMs act on the client update; the CEO needs no action on an FYI."

## 19. PROBLEM messages, re-joins, flapping and Admin system emails (decided — overrides anything above that conflicts)
1. **PROBLEM lifecycle includes Monitoring** (amends §15.4): Unacked/Escalated → Acknowledged → Monitoring (first OK round — RECOVERED is posted then) → Needs root cause (second OK round, unless a root cause is already written) → Resolved, by hand. A PROBLEM never goes to In review or Closed.
2. **PROBLEM thread** (ChatAlert, EmailAlert): first card + ACKNOWLEDGED + RECOVERED replies, amber, same one-thread / one-subject rules as DOWN. L0 = owner @mention (Tier 1 at night: the on-call person) + Alerts Space + email to the owner; the backup is plain text. A Tier 2–3 PROBLEM outside response hours is held until 09:00. Cause wording per trigger: see the ChatAlert table.
3. **Fails again while the incident is open:** open = any state before Resolved (Unacked, Escalated, Acknowledged, Monitoring, Needs root cause). There is no time window. A site that fails again while its incident is open joins that incident and its thread (DOWN AGAIN / PROBLEM AGAIN). The incident goes back to Acknowledged if someone had acknowledged it, otherwise to Unacked. The reply mentions only the person expected to act now (whoever acknowledged; otherwise the L0 person).
4. **Flapping** (≥ 3 status changes in 30 min): the incident still moves through its states as normal; only the RECOVERED replies are held. One RECOVERED summary is sent after 15 min of continuous OK (VOCA: drops 03:12–03:19 · 03:24–03:35 · 03:38–03:52 · 03:55–04:04, summary 04:19). A drop that lasts is simply a DOWN that hasn't recovered, so nothing more is posted until it recovers. Every drop still posts DOWN AGAIN in Chat (mentioning whoever acts now). In email, the held RECOVERED emails are replaced by one summary email in the incident thread at the same time; DOWN AGAIN / PROBLEM AGAIN are Chat only — no email.
5. **Admin system emails** (browser verifier unavailable; fewer than 2 probe locations reporting): sent to every active Admin and nobody else. One email per outage, subject includes the start time, no "back up" email, footer "You got this because you're an Admin." The verifier email is sent when a blocked check finds no verifier answering.
6. **Auto-resolved PROBLEM** (amends §16.1): a PROBLEM that is never acknowledged and recovers within 5 min of being flagged (the 5 min counts from when the PROBLEM opens, not from the first failed check) auto-resolves on its first OK round — manual Resolve still needs 2 OK rounds. It gets one RECOVERED reply + one RECOVERED email, no @mention, saying it was resolved automatically and needs no root cause. A Tier 2–3 PROBLEM held outside response hours that clears before 09:00 posts nothing.
7. **Partial recovery:** if the home page recovers but a key page still fails, RECOVERED and PROBLEM AGAIN (Key page) are posted together from the same round, and the same incident continues as a PROBLEM — titled by what still fails, e.g. "/booking still failing after the home page came back".

## 20. Sites list (/sites) — added 8 Oct 2026
- The sidebar "Sites" item, every "Sites" breadcrumb and the mobile bottom-nav "Sites" tab open the Sites list (boards Sites, MSites) — not a site's detail. Overview shows what needs attention now (§21); Sites is the management list.
- Header meta exactly "N sites · N monitored · N drafts". "Add site" (and the empty state's "Add first site") is shown to Admins only. The sidebar "Sites" count = monitored sites (drafts excluded).
- One row per site; a row (or "Open") opens Site detail for that site (/sites/[id]). A **draft** (saved from Add site before the checklist is complete) shows Status "Not monitored" (neutral outline), a "Draft · not monitored" badge under the name, "—" in every live column, action "Finish setup" → Add site for Admins; non-Admins still see draft rows but can't open them — the action area reads "Only an Admin can finish setup"; drafts count in "N sites" but not in "monitored" or any uptime figure, and sort last.
- Columns: Status (§11 badge; Muted is an extra overlay, never replaces status; open incident ID links to the incident) · Site (name, client · AM, URL) · Tier · Owner · backup · Locations (BKK/SIN/TYO glyphs, §11 legend) · Response 24h (p50 of the primary monitor; "—" while down or in maintenance) · Uptime 30d (§5 rule) · Expiry (sooner of SSL and domain in days; amber within 60 d, auto-renew certificates 30 d) · Checked (time of the last complete round, HH:MM:SS) · "Visit site" (opens the site's URL in a new tab) · ⋯ menu (Open, Edit site, Mute…, Schedule maintenance). On a site that is DOWN or has an open incident, Schedule maintenance shows "Can't start maintenance now … Mute instead" (§14.5); the Mute hint follows §15.1/§19 ("keeps escalating until someone acknowledges" while unacked/escalated, otherwise "stays open").
- Filters (AND): search (name, URL, client), status chips/filter (All, Down, Problem, Maintenance, OK, Muted, Drafts), Tier (All / 1 / 2 / 3), Owner (a person or "Mine" = owner or backup), Client (incl. "Internal"), toggle "Needs attention" = open incident · draft · SSL or domain due within 60 d · no backup owner. Default sort: Down → Problem → Maintenance → OK → Not monitored, then Tier 1 → 3, then name; other sorts (labels exactly): "Name A–Z", "Uptime 30d lowest first", "Expiry soonest first". "Clear" resets filters, keeps the sort.
- Empty state (no sites yet) = Empty states panel 1 "Add first site" (non-Admins see "Only an Admin can add sites" instead of the button).
- Mobile: search, status chips (All · Down · Problem · Maintenance · Muted · Drafts · Mine), rows grouped by status, each row → that site's mobile Site detail (§17); drafts → Add site.
- Changes from the current build: the separate Client column moves into the Site cell's second line (client · AM, Client stays a filter); Owner becomes "Owner · backup". Sample values on the boards ([site URL], counts, names) are mock data — compute them. Search matches name, client and URL.
- Build order is the team's call: Locations, Response 24h and Uptime 30d need rollup data; until /sites/[id] exists a row may open Edit site.

## 21. Overview (/) — slice S06, added 8 Oct 2026 (overrides earlier Overview rules)
Boards: **Main3** (desktop), **MainDark3** (NOC wall, same rules), **MOverview4** (mobile). Main / MainDark / MOverview are pre-S06 references only. Use the boards' STATE control (2 banners + more · 1 banner · None · All OK) and VIEW AS control to see each case.

**Job of the page.** Overview answers "what is happening now and what do I do next". Sites (§20) is the list you manage — search, owner/client filters, sort, drafts, row menu and expiry live there, not here. The only management control on Overview is the Admin-only "Add site".

1. **Incident banners.** One banner per DOWN incident that is not yet acknowledged (escalated or not). Acknowledging stops escalation, so an acked incident never keeps a banner — it stays in Live issues. Order: escalated first, then Tier 1 → 3, then longest down. At most 2 banners; if more qualify, a line "and N more → Incidents" (N = the rest). A PROBLEM never gets a banner. Acknowledge removes the banner at once with the 10 s undo (§16.8) and the next one moves up. Banner: "<site> is DOWN — 19 min", Escalated badge when escalated, "18 min unacked", the cause and escalation line, "Open INC-…" (secondary) and "Acknowledge" (primary, §14.13). No "Proposal · pending CEO" badge (approved, D-009) and no client-update line on the banner (the client-update track comes with a later slice). Mobile banners are tappable cards → that incident (MIncident).
2. **Counts are computed, never typed.** "x/y OK" and the "Sites OK" KPI count monitored sites only — drafts are left out. OK = status OK; a muted site counts by its real status. Sidebar "Sites" = monitored count (§20). "Open" = incidents in any state before Resolved. "3 unacked (1 escalated)" — escalated is a subset of unacked.
3. **KPIs (desktop):** Sites OK · Open incidents · MTTA · 30d (DOWN incidents, all tiers) · MTTD · 30d (DOWN incidents, Tier 1 only) · Uptime · 30d (§5). MTTA and MTTD show "—" with the caption "Not enough incidents yet" until there are at least 3 DOWN incidents in the last 30 days (open or closed); the "vs last 30d" change is hidden until then. KPIs are organisation-wide for every role.
4. **Live issues** (replaces the full sites table). A monitored site is listed when any of these is true: status Down, Problem or Maintenance · an open incident (any state before Resolved) · muted · a location warning (TLS chain error). "Blocked by bot protection, verified OK" is not an issue. This is a different rule from the "Needs attention" switch on Sites (setup: drafts, expiry, missing backup) — don't share the predicate.
   - Sort: Down first — escalated, then unacked, then acked — then Problem, Maintenance, OK; inside each group Tier 1 → 3, then longest "Since", then name.
   - Columns (desktop): Status (same cell as Sites: badge, Muted overlay, incident link) · Site · why (name, tier, one reason line) · Since · Owner · BKK SIN TYO (§11 glyphs) · Response 24h (sparkline + p50) · Next step. The ⓘ button on the section header opens the legend (STATUS + LOCATIONS); phones show no legend.
   - **One reason per row**, picked in this order: Down › Problem › Maintenance › incident waiting for root cause › location warning › muted. **Since** = the start of that same reason, shown as duration over "since HH:MM".
   - **Next step:** unacked DOWN → Acknowledge (same action and undo as the banner) · acked DOWN or PROBLEM → "Open INC-…" · waiting for root cause → "Add root cause" (Resolve) · location warning → "View checks" (Site detail) · muted → "View site" (End mute arrives with maintenance & mutes). The whole row opens Site detail.
   - Nothing listed → one line "All N monitored sites OK" with the time of the last full round.
5. **Response 24h sparkline:** 96 points = p50 per 15-minute bucket over the last 24 h. A bucket where checks failed has no point, so the line breaks — no extra marker, the row already says Down. The line gains a point when a bucket closes; no animation in between. The p50 next to it = last completed round; "—" while down.
6. **All sites tiles (desktop only).** One tile per monitored site, 3 columns, for a glance on the NOC wall — not a management list. Tile: status icon + name (wraps to 2 lines, never cut to "…") + p50, or the DOWN duration in red · second line: tier and a short state (ack state for DOWN, "Slow · 15 min" for Problem) · markers: shield-alert = TLS chain error, bell = open incident, eye-off = muted. Down tiles are red, Problem tiles amber; the icon always carries the status. The Tier control filters the tiles only. Tile opens Site detail. One link to Sites: "Manage on Sites →". Recent events sits beside the tiles.
7. **Mobile (MOverview4)** answers three things in order: anything to do now (banners), what is wrong and is it mine (Live issues: status badge + one reason + Since, ownership chip), is the rest fine ("x/y OK" in the header and one row "All N sites · N OK ›" → Sites). Counts: Open · Unacked · third card by role (item 8). Not on phones: site tiles, MTTA / MTTD, Recent events (Incidents tab), legend, sparklines.
8. **By role (VIEW AS on the boards).** Same page for everyone; only these change:

| | Ownership chip in Live issues | Mobile third card | Acknowledge | Add root cause | Add site |
|---|---|---|---|---|---|
| Admin / Responder | "Yours" (owner) · "Backup" — user icon | Yours | ✓ | ✓ (Responder: own sites) | Admin only |
| AM (Stakeholder) | "Your client" on sites of clients they manage — users icon | Your clients | allowed, not expected (§18) | — (→ Open INC-…) | — |
| CEO (Stakeholder) | none | Uptime 30 d | allowed, not expected | — | — |
| Viewer | none | Uptime 30 d | — (banners and rows open the incident read-only) | — | — |

   Chips are Badge neutral outline (§11), never accent.
9. **Not in S06** (draw the page without them): On-call card — comes back with on-call; Maintenance & mutes card and the header "Maintenance" button — come back with maintenance; the User guide icon in the phone top bar — comes back with the guide.
10. **AURA components (5.34):** tiles = `Aura.TileGrid` (`columns` 3 on desktop) + `Aura.StatusTile` (`status`, `title`, `value` = p50 or the DOWN duration, `meta` = tier + short state, `markers` = shield-alert / bell / eye-off with labels, `href`); Response 24h = `Aura.Sparkline` (`failures="none"`, `failed` from the checks, `label` summarising range). TLS glyph = `Aura.Icon name="shield-alert"`. **Open:** StatusTile draws down with circle-alert and maintenance with wrench, while status badges (§11) use ban and calendar, and it has no prop to change the icon — accept the difference on tiles or ask AURA for an icon override; until decided, build with AURA as is.
11. Sample data on these boards (names, times, incident IDs INC-0140…0144, counts, viewer Tao / Arm / Bua / Mint) is mock data — compute it; never copy.
