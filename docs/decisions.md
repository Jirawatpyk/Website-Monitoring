# Decision log

Decisions that settle a conflict between the PRD and the design spec, a conflict inside the PRD (e.g. a requirement against the budget), or fill a gap in either. Newest first. Code that implements a decision cites its ID.

| ID | Date | Decision | Supersedes |
|---|---|---|---|
| D-033 | 9 Oct 2026 | S07 Incidents: note, root cause and Resolve follow the Acknowledge rule (Admin any site, Responder own sites); the SQL resolve function enforces all three conditions (Needs root cause, client update not required or marked, a real category + what happened); one Resolve dialog on desktop and phone, opened from a Resolve button that names its unmet condition; root-cause fields category / What happened / What fixed it; notes post to Chat at once (no hold, no email); RESOLVED held 10 s to Chat and everyone who got the DOWN email, undoable while held; MTTA a mean (D-032), MTTR a median; "Unacked" until S08 escalates; auto-resolved PROBLEMs hidden with a computed count; timeline order per board; evidence via signed URLs, labelled after recovery; one phone incident page; mixed-incident messages count DOWN minutes only | Incident board always-disabled Resolve; MIncident "Next step"; Incident note dialog "timeline and the audit log" only; Incidents "Escalated, not acked" and "median" MTTA; MobileAck "Full incident"; the S04b `dropsOf` message view |
| D-032 | 9 Oct 2026 | S06b Overview: until S07 "and N more → Incidents" is an anchor to Live issues, the phone Open / Unacked cards are counts (not links), Recent events has no "All incidents" link, "Add root cause" reads "Open INC-…" and BottomNav shows only live sections; no escalation copy until S08 / S10; the header pill shows probes and the verifier, the heartbeat age waits for S12; MTTA / MTTD are means (PRD §2); an AM is a stakeholder who manages a client, any other stakeholder is treated as the CEO; a muted row's Since is "—" until S09; phone layout below md; Realtime refreshes are coalesced; StatusTile keeps AURA's icons | Main3 / MOverview4 links to the Incidents list, "· escalation stopped", "Heartbeat 12 s ago", "Add root cause"; spec §21.6 tile icons (as §21.10 allows); plan S06b "`monitor_status` in Realtime" |
| D-031 | 9 Oct 2026 | S06 is split: **S06 Site detail & check rollups** first, **S06b Overview (option A)** after it (BottomNav moves with S06b); AM / CEO keep D-016 (no Acknowledge, "Open INC-…"); `check_rollups` per monitor and per location with no uptime column; uptime windows start no earlier than monitoring started; 7 d / 30 d / 90 d p50 / p95 come from rollups; the 90-day load test runs on local Supabase | Plan S06 (one slice, Overview first), D-018 "BottomNav with S06", spec §21.8 "AM / CEO: Acknowledge allowed", PRD §11 `check_rollups.uptime_pct`, plan S06 Done-when 1 "90 days on staging" |
| D-030 | 8 Oct 2026 | Sites list (S05c): status is filtered by the chip row only (no Status dropdown beside Tier / Owner / Client); the search and the three filters share a row, Needs attention below, Sort by at the end of the count line; the legend is a card with Status, Locations and Columns (two columns from md with Columns under them, three from xl; none on phones, as MSites), 24 px below the table, and the chip row drops "Muted keeps the real status" (the legend says it); owner names take two lines; phones keep an always-visible search field instead of a top-bar search icon | Sites board: a Status select duplicating the chips, the filter-row order, the inline legend; MSites: the search icon in the top bar |
| D-029 | 8 Oct 2026 | A misconfigured certificate chain (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `UNABLE_TO_GET_ISSUER_CERT(_LOCALLY)`) is a PROBLEM (TLS chain) in one round, never a DOWN and never a hard-fail vote; expired, wrong-host, self-signed and not-yet-valid certificates stay hard fails | Spec §6 counts every TLS failure as a hard fail (→ DOWN) |
| D-028 | 8 Oct 2026 | The BKK probe's control check failing 3 rounds in a row opens an Admin system alert ("BKK probe network check failing") naming the WAF sites it left unverified; it clears once the check passes (≥ 10 min after it opened) | Gap — D-027 rule 2 told the site owner (PROBLEM, unverified) but nobody to fix the VPS |
| D-027 | 8 Oct 2026 | A site marked "Behind WAF" is judged on the locations its WAF does not block: a location with a header-level WAF signature abstains; the Bangkok probe counts only while one of two control URLs answers; every location blocked → the browser verifier as before | D-020 / spec §6 "if locations are blocked, the browser verifier decides" (for WAF sites with an unblocked location) |
| D-026 | 8 Oct 2026 | A `must_contain` keyword is looked for in up to about 3 MB of the body, and the read stops once every keyword is found; `must_not_contain` and classification still read the first 256 KB | D-022 "checked in the first 256 KB of the body" (for `must_contain`) |
| D-025 | 8 Oct 2026 | S05 sites and monitors: a Draft may be saved with empty owners, but an owner who is set needs a Chat id and Start needs two linked owners; EditMonitors edits the HTTP primary + up to 3 key pages (keyword and redirect checks live on each HTTP monitor; SSL / Domain in S13); GET / HEAD only; expected status and redirects are shown as the fixed rule (not editable); Test check runs from SIN + TYO on demand; no shared spam list until S17; AM read-only from the client; Draft / Start / Stop monitoring; one audit row per changed row by trigger; custom headers refuse User-Agent and auth headers | AddSite / EditMonitors: POST, "Comma list or 2xx", Redirects select, locked shared-list tag, per-site AM select, "Proposal · pending CEO", "Nok and Ploy notified", "Tao edited monitors on …" audit line, Keyword / Redirect / SSL / Domain as separate monitors, User-Agent sample header; PRD §3 "Google Chat or email" (D-015 already) |
| D-024 | 7 Oct 2026 | S04b rules: a relapse is one state-guarded SQL function; recovery and the status floor follow the severity of what is failing now (`episode_severity`); a flip is an OK ↔ not-OK change at an incident step and the 3rd in 30 min tags flapping; while flapping RECOVERED (Chat + email) becomes one summary held 15 min, every DOWN AGAIN / PROBLEM AGAIN is still posted (Chat only); a < 5 min unacked PROBLEM auto-resolves on its first OK round and still gets RECOVERED; `notifications.dedupe_key` lets a template repeat | ChatAlert note "Drops after 03:24 aren't re-posted"; PostIncident "RECOVERED 04:04:10"; D-004 reply wording "DOWN · site · down again"; gaps — when a relapse emails, what counts as a status change |
| D-023 | 7 Oct 2026 | A DOWN incident recovers when the primary monitor is OK again, even if a key page still fails; the key page's problem then rejoins the same incident as a PROBLEM relapse (built in S04b). Until S04b, D-022's "recover when every monitor is OK" stays | D-022 recovery rule ("an incident recovers on the first round every monitor is OK") for DOWN incidents |
| D-022 | 7 Oct 2026 | S04 is split into S04a / S04b. Engine rules: one verdict per monitor per round; site status = the worst verdict, never below an unrecovered incident's severity; non-primary problems are `key_page`; keyword and redirect = a majority in one round; slow = p50 over the threshold 3 rounds in a row; regional = one location failing ≥ 5 min; the faulty-location rule needs ≥ 3 monitors in the minute; fewer than 2 locations beating → Admin alert. PROBLEM is sent at any hour until S08. While flapping, states move as normal and only RECOVERED is held. Every new problem on a recovered incident is a D-004 relapse (S04b). PROBLEM message copy comes from the ChatAlert / EmailAlert rows design added (spec §19) | Gaps — PRD §5 / StatusModel name the triggers but not how they are counted; ChatAlert / EmailAlert have one PROBLEM text line only |
| D-021 | 7 Oct 2026 | A DOWN confirmed while the site's open incident is a PROBLEM raises that incident to DOWN (same incident and thread, DOWN alert sent, back to waiting for an ack if it had recovered); a DOWN incident's relapse stays D-004 / S04 | Gap — D-004 covers a site failing again, not a PROBLEM incident turning into an outage |
| D-020 | 7 Oct 2026 | A blocked site that is blocked in the browser verifier too (a WAF or challenge page in plain Chromium) is PROBLEM (unverified), not DOWN; only a page that really fails in the browser (no answer, 4xx/5xx without a WAF signature, keyword missing) is DOWN | StatusModel "Blocked · browser: page fails → DOWN" read literally (PRD §5 "a plain browser blocked → PROBLEM, not hidden") |
| D-019 | 7 Oct 2026 | S03 verifier: the queue is a `verification_jobs` table with leases (not pgmq); PROBLEM (unverified) opens the incident and emails the Admin in S03, its Chat card comes with S04's PROBLEM rows; Admin alerts not tied to an incident live in `system_alerts`; the VPS runs a staging and a production agent from one systemd template | PRD §10 "pgmq", StatusModel "Owner + Alerts Space" for blocked_unverified (until S04), plan S03 Done-when 6 `/etc/dxt-agent/env` |
| D-018 | 7 Oct 2026 | One page-header rhythm and one phone shell: every page header is AURA `PageHeader` with 4 px between its parts, and a breadcrumb takes the eyebrow's place 4 px above it; phones get the boards' top bar (brand + avatar) now, the back arrow with S07 and BottomNav (four main sections) with S06, while the menu drawer stays for every other page | Board drift: breadcrumb gaps of 12 / 24 px and title → meta gaps of 6 / 10 px; AppShell's menu-only phone bar |
| D-017 | 6 Oct 2026 | Alert emails thread on a stable incident id (`<inc-<id>@<sending domain>>` in `References`, plus `In-Reply-To` after a person's first email) instead of the first email's Message-ID | Spec §10 / EmailAlert "In-Reply-To / References set to the first message" |
| D-016 | 6 Oct 2026 | S02b ack, email and fallback: an Admin acks any site and a Responder only sites they own (on-call rule in S10); when Chat fails after its last retry the fallback email goes to the backup and every Admin not already emailed; D-013's no-promise rule covers email and the ack page too (no escalation / client-update rows, no "webhooks" in the Undo line until their slices); `/incidents/[id]` is built in S02b with the MobileAck layout | EmailAlert / MobileAck boards' escalation and client-update copy, §16.8 "webhooks" (until their slices); MLogin "any Responder acks"; PRD §9 fallback audience (gap) |
| D-015 | 6 Oct 2026 | A site's owner and backup must have a Google Chat user id before the site is saved (S05); until the Profile screen (S16) an Admin sets it with a reviewed SQL script. Alerts mention only people with an id | Gap — ChatAlert board assumes every owner can be @mentioned |
| D-014 | 6 Oct 2026 | S02a monitoring schema: `check_results.location` keys to `probe_locations.code`; `probe_locations` / `site_status` keyed by their natural key (no `id`); the `notifications` table with `claim_notifications` (SKIP LOCKED + lease) is the delivery queue instead of pgmq; engine round bookkeeping in `site_status`; enum `site_status` renamed `site_state` | PRD §10 "pgmq queues", §11 `location_id` and "every table has id" |
| D-013 | 6 Oct 2026 | Chat alerts grow with their slices: no escalation promise ("acknowledge by … or it escalates", "Next: L1 at …") until S10; the first card's button reads "Open incident" until ack ships (S02b); incident numbers display as `INC-` + at least 4 digits | ChatAlert board DOWN text line, "Next" row and "Open / acknowledge" button (until their slices) |
| D-012 | 6 Oct 2026 | A Responder may update only `muted_until` / `mute_reason` on sites they own (primary or backup); every other site, monitor and client field is Admin-only | Plan S01 Done-when 3 "responder updates only own sites" (read literally) |
| D-011 | 6 Oct 2026 | Sign-in copy under D-007: "No access yet" asks for an Admin to add you (no invite email, no 7-day link, no names); "Wrong domain" shows the address from a 60 s httpOnly cookie; no "30 days" promise | Login / MLogin boards: invite email + "link works for 7 days", "Ask Tao", "signed in for 30 days" |
| D-010 | 6 Oct 2026 | S00 is closed; the VPS agent env file (S00 Done-when 3, VPS part) moves to S03, which installs the agent | Plan S00 Done-when 3 (VPS part) |
| D-009 | 5 Oct 2026 | CEO answers to the decisions memo: **Tier 1 L2 CEO page on by default** (no "Proposal · pending CEO" tag); Twilio voice off for now; interim Admin = Tao only, on-call = Tle | Spec §8 / Escalation board "Proposal · pending CEO"; CLAUDE.md "off by default" |
| D-008 | 28 Sep 2026 | The repository is **private on GitHub Free**: `main` is guarded by `pnpm pr:merge`, a pre-push hook and Claude Code deny rules; the production DB secret is a repository secret | `docs/workflow.md` ruleset "main" and GitHub environment `production` |
| D-007 | 28 Sep 2026 | Sign-in: **2-Step Verification is enforced by Google Workspace**, not by the app; accounts are created only for addresses on an **email allowlist** (Internal OAuth client + domain + allowlist) | PRD §3, §9, §12 test 12 and spec §15.2, §16.6–7 "2-step required from 5 Oct, otherwise view + acknowledge only"; plan Q1, Q6 |
| D-006 | 28 Sep 2026 | Staging is a **second Vercel project** `dxt-monitor-staging` with production branch `staging`; PR previews are for UI only | `docs/workflow.md` "staging = preview deployment" |
| D-005 | 28 Sep 2026 | **No PITR**: rely on Supabase Pro daily backups (7-day retention) with a quarterly restore drill; staging lives in a separate free Supabase organisation | PRD §9 "Daily DB backup + Point-in-time recovery" |
| D-004 | 28 Sep 2026 | A site that fails again while its incident is still open re-enters **the same incident** (same thread); escalation keeps its original clock | Gap — PRD §7 flapping rule doesn't say which state |
| D-003 | 28 Sep 2026 | PROBLEM incidents pass through Monitoring and Needs root cause like DOWN, and end at Resolved | Spec §15.4 short PROBLEM path (read as "no In review / Closed") |
| D-002 | 28 Sep 2026 | Client-update track fires when Tier 1 DOWN **reaches** 15 min (`>=`), counted from the first failed check | Spec §16.2 wording "> 15 min" |
| D-001 | 28 Sep 2026 | Blocked + verifier unavailable → **PROBLEM (unverified) at once**, Admin told, retried every round | PRD §5 "keep status, PROBLEM after 10 min" (flowchart, verification spec, test plan) |

## D-033 — S07 Incidents: who acts, the resolve gate, notes and the list

**Gap / conflict.**
- PRD §3 lets a Responder resolve and write notes and root causes, but no rule says which sites, and the boards don't say who sees the buttons.
- The Incident board's Resolve button is always disabled and its reason is never shown (§14.16); only the Resolve board opens the dialog. MIncident resolves from its sticky bar with no dialog.
- The root-cause form's third field is "What fixed it" on Incident and Resolve, "Next step" on MIncident.
- The Incident note dialog says the note goes to the timeline and the audit log only; §16.5 and the plan want a NOTE reply in the Chat thread.
- Incidents captions MTTA and MTTR as medians; D-032 made MTTA a mean. "Escalated, not acked" counts something nothing produces until S08.
- MobileAck's "Full incident" and MIncident are two pages; D-016 built one page at the incident URL.
- Carried from S06: `render.ts` `dropsOf` words a mixed incident (D-021 PROBLEM → DOWN, D-023 key-page drops) with the S04b view, where PROBLEM time reads as part of the outage.

**Decision (9 Oct 2026, S07 plan approved by Tao).**
- **Who acts.** Add note, write root cause and Resolve follow Acknowledge (D-016): an Admin on any site, a Responder on sites they own or back up. AMs, the CEO and Viewers read the pages without those buttons. S10 widens it to the on-call person.
- **The gate lives in SQL.** `resolve_incident` resolves only an incident that was OK for 2 rounds since its latest recovery (an `ok_two_rounds` event after `recovered_at` — Needs root cause, or Monitoring when the root cause was written first, §16.4; the engine now writes that event on every settle), whose client update is not required or marked (always "Not required" until S11, D-002), with a root-cause category other than Unknown and "What happened" filled in. `canResolve` mirrors it for the page.
- **One Resolve dialog** (Resolve board) on desktop and phone. The page's Resolve button opens it once recovery and the client update are met, otherwise it is disabled with the unmet condition next to it. Inside, "Resolve incident" waits for a real category and "What happened"; with Unknown it reads "Save, keep open".
- **Root cause:** category (the nine board options), What happened (required), What fixed it (optional). It can be saved as a draft at any time, each save on the timeline; Unknown never meets the condition (§16.3).
- **Resolve** cancels a held flap summary, queues RESOLVED in the thread (no @mention) and an email to everyone already emailed about the incident (the RECOVERED audience; for a DOWN that is everyone who got the DOWN email, PRD §7), both held 10 s with Undo ("Posting to Chat and email in N s", D-016). The RESOLVED reply adds a card with the root cause (ChatAlert draws its text line only), and its "Down for" counts DOWN minutes as below. Undo returns the incident to the state it was resolved from, unless a message left or the site opened a new incident.
- **Notes** post to the Chat thread at once as `NOTE · <site> · <name>: …` (no @mention, no email); the 10 s hold is for ack and resolve only. The desktop note dialog says so, as MIncident does.
- **List:** desktop views Needs action / Resolved & closed / All, phone Open / Unacked / Past; "Unacked" is D-032's (DOWN waiting for an ack). Auto-resolved PROBLEMs are hidden everywhere with a computed "N short PROBLEMs auto-resolved in < 5 min are hidden". Export CSV exports the filtered list.
- **KPIs:** MTTA is the Overview's mean (D-032, caption "mean"); MTTR is the median first failed check → recovered of DOWN incidents, as Incidents and Site detail draw it; the "Escalated, not acked" card reads "Unacked" until S08.
- **Timeline:** every event shows; oldest first on desktop, newest first on phone, as the boards draw them; RECOVERED before PROBLEM AGAIN at the same time (§19.7). "Earlier unverified signal" (D-027 2c) waits until the incident records it.
- **Evidence:** screenshots through short-lived signed URLs made on the server, with the capture time; one taken after recovery says so.
- **Phone:** one incident page — MIncident's layout with MobileAck's ack parts while the viewer can acknowledge; "Full incident" goes; the top bar gets the back arrow (D-018).
- **Mixed incidents in messages:** "down X" totals count DOWN minutes only, as uptime does (§5); flips, span and "stable since" count every drop; one drop reads "Down once"; RECOVERED takes its severity and trigger from the drop that recovered.

**Why.** One rule for acting on an incident; the database refuses a resolve the page shouldn't offer. Every control works or says why not (§14.16), nothing promises S08–S24 behaviour (D-013), and the same numbers mean the same thing on every page.

**Impact.** S07: a migration (`resolve_incident`, `undo_resolve`, `save_root_cause`, `add_incident_note`, `incidents.root_cause_fix` / `resolved_by`), `features/incidents`, the notifier's NOTE / RESOLVED, `render.ts`, the Overview links D-032 held back. S08, S09, S11, S22 and S24 add their parts; spec-checker treats these differences as intended.

## D-032 — S06b Overview: links that wait, KPIs, roles and Realtime

**Gap / conflict.**
- Main3 and MOverview4 link to the Incidents list ("and N more → Incidents", the phone Open / Unacked cards, "All incidents", the BottomNav Incidents tab) and to Resolve ("Add root cause"); both arrive in S07, On-call in S10. Spec §14.16: no dead controls.
- The boards' banners, toast and Recent events carry escalation copy ("L1 (Ploy + Tao) paged", "· escalation stopped"), but nothing escalates until S08 / S10 (D-013).
- The header pill ("Probes 3/3 · BKK · SIN · TYO · Verifier idle · Heartbeat 12 s ago") is drawn but §21 says nothing about it; the heartbeat and fault state belong to MainFault (S12).
- §21.3 names MTTA and MTTD but not how they are computed; §21.8 separates AM and CEO, who share the `stakeholder` role.
- §21.4 wants Since for a muted row, but nothing records when a mute started (mute is S09).
- The engine writes `site_status` and `monitor_status` every round (D-014), so a plain Realtime subscription would refresh the page several times a minute.
- §21.6 draws tiles with the badge icons (ban, calendar); AURA StatusTile uses circle-alert and wrench and has no icon prop (§21.10).

**Decision (9 Oct 2026, S06b plan approved by Tao).**
- **Until S07:** "and N more" links to the Live issues section on the same page (every unacked DOWN has a row with Acknowledge there); the phone Open / Unacked cards are counts, not links; Recent events has no "All incidents" link; "Add root cause" reads "Open INC-…"; BottomNav lists only live sections (Overview, Sites — Incidents joins in S07, On-call in S10). S07 / S10 restore them.
- **Copy for what doesn't run yet:** banners show the cause without an escalation line; the toast reads "Acknowledged INC-…" and the Undo line "Posting to Chat and email in N s — nothing is sent until then" (D-016); Recent events says "acked by <name>" without "— escalation stopped". The Escalated badge is built from the incident state, so it appears once S08 escalates.
- **Header pill:** "Probes N/3" counts active locations that beat in the last 3 min, then their codes and the verifier ("Verifier idle" / "Verifier busy" / "Verifier offline" from its heartbeat and queued jobs). "Heartbeat … ago" and the fault state come with S12.
- **MTTA / MTTD** are means (PRD §2 "Mean Time to …"): MTTA = acknowledged − confirmed down over DOWN incidents whose outage started in the last 30 days, all tiers; MTTD = confirmed down − first failed check of the outage over Tier 1 DOWN incidents, manual ones left out. Both need at least 3 DOWN incidents in the 30 days (§21.3); "vs last 30d" compares with days 31–60 and shows only when both windows qualify. Settled in review (engine-reviewer, S06b): a PROBLEM raised to DOWN (D-021) counts from its `downStartedAt`, not the PROBLEM's start; an incident acknowledged while still a PROBLEM is left out of MTTA (nobody waited on a DOWN ack — counting 0 would flatter it); a DOWN never acknowledged (resolved without an ack, S07) is not in MTTA; a relapse (D-004) keeps the first confirm, so its wait and "N min unacked" include the recovered spell, as escalation does.
- **Unacked** (the KPI caption, the phone card, the header line) counts DOWN incidents waiting for an ack — the ones with banners, as MOverview4 counts them; an unacknowledged PROBLEM waits in Live issues without turning the count red.
- **AM vs CEO:** a stakeholder who is the AM of at least one client gets "Your client" chips and the "Your clients" card; any other stakeholder is treated as the CEO (no chips, "Uptime 30 d"). D-016 / D-031 stand: neither gets Acknowledge.
- **Muted Since** shows "—" until S09 records when a mute starts.
- **Breakpoints:** the phone layout (MOverview4) shows below md, as on Sites and Site detail; from md the desktop grids reflow (KPIs 2 → 3 → 5 columns, tiles 2 → 3, Recent events under the tiles below xl, Live issues drops Owner and Response 24h below xl). BottomNav hides from lg (D-018).
- **Realtime:** `site_status` and `incidents` join `supabase_realtime` (INSERT / UPDATE subscriptions only — a DELETE bypasses RLS); `monitor_status` stays out, since it changes every round for every monitor and the Overview needs nothing from its events (plan S06b listed it; db review M2). The page coalesces change events into at most one refresh per ~1.5 s, which also keeps "last full round" and the p50 current. The round bookkeeping stays in `site_status` (D-014); if the per-round events load Realtime at 200 monitors, move to a trigger that broadcasts only status changes.
- **Tiles** keep StatusTile's own icons (§21.10 "build with AURA as is"). A live site before its first round has no status: its tile shows `ok` with the status word "No data yet" until AURA adds a neutral status (request in `docs/design/aura.md`).
- **Phone BottomNav (Tao, 9 Oct, on staging):** it covered the incident page's Acknowledge bar. The BottomNav slides away while scrolling down and returns on the way up, at the top or when focus reaches it; a page with its own bottom action bar (`data-hides-bottomnav`, the incident page) keeps it away for good, in CSS, so the bar has the bottom edge from the first paint; the menu still reaches every page. The phone top bar stays (Tao: wait for AURA). AURA requests 13 (top bar hides on scroll) and 14 (BottomNav hides on scroll / for a page's own bar) replace the DxT workaround when they ship.
- **Response 24h** points are sent only for Live issues — the only rows that draw the line; tiles show the p50. Both layouts are rendered and CSS picks one (the server can't know the width); at 17 sites that costs nothing measurable, so a client-only switch waits for a measured need.

**Why.** Every control works or isn't drawn (§14.16); no copy promises what the system can't do yet (D-013). The PRD defines the KPIs as means. Treating "stakeholder without clients" as the CEO needs no new role. Coalesced refreshes keep the < 5 s target without a refresh per round.

**Impact.** S06b (`features/overview`, `app/(app)/layout.tsx`, a migration adding `site_status` and `incidents` to the publication and `overview_response_24h`); S07, S08, S09, S10 and S12 add their parts back; spec-checker treats these differences as intended.

## D-031 — S06 split: Site detail first, the Overview in S06b

**Conflict / gap.**
- Plan S06 bundled the Overview (now three boards, spec §21 of 9 Oct), Site detail (two boards), `check_rollups`, Realtime and BottomNav — well past L. Built in that order, every Overview row, tile and "View checks" would link to a Site detail that doesn't exist (no dead controls, §14.16).
- Spec §21.8 lets AMs and the CEO acknowledge ("allowed, not expected"); D-016 and `ack_incident` refuse Stakeholders and Viewers.
- PRD §11 gives `check_rollups` an `uptime_pct`, but spec §5 counts uptime from DOWN minutes (incidents), not from passed checks. The Site detail chart needs response time per location, which a per-monitor rollup can't give.
- Plan S06 Done-when 1 wants 90 days of generated checks on staging: about 3.3 million rows (~1 GB), past the staging project's free-tier 500 MB.

**Decision (Tao, 9 Oct 2026).**
- **Two slices, Site detail first.** S06 = `check_rollups` + pg_cron jobs + Site detail (SiteDetail, MSite) + the Sites list rows opening it for every role with Response 24h / Uptime 30d filled in (FR-08). S06b = the Overview (Main3, MainDark3, MOverview4), Realtime and BottomNav (FR-05). D-018's "BottomNav with S06" now reads S06b; MSite draws BottomNav, and it joins when S06b ships.
- **D-016 stays.** AMs, the CEO and Viewers don't get Acknowledge on the Overview; banners and rows offer "Open INC-…". §21.8's "allowed, not expected" is not built.
- **`check_rollups` shape:** one row per monitor, location (BKK / SIN / TYO, plus an all-locations row with `location` null), bucket (hour / day) and bucket start — `checks`, `hard_fails` (TLS chain errors excluded, D-029), `blocked`, `p50_ms`, `p95_ms` over passing checks. No uptime column. Day buckets start at Bangkok midnight. Hour rows are kept 90 days, day rows 2 years.
- **Uptime window:** a range starts at the later of (now − range) and the site's `monitoring_started_at`, so a site monitored for 3 days isn't credited with 27 unmonitored days. Maintenance minutes are 0 until S09.
- **p50 / p95 per range:** 24 h is exact from raw checks; 7 d uses hour rollups, 30 d and 90 d day rollups — the median of the buckets' p50 / p95 weighted by their checks. Close to the true value for steady sites, and cheap.
- **TLS chain on Incident history:** shows the trigger word ("TLS chain") without a client word ("Outage" / "Degraded"); D-029 leaves that to S21.
- **Load test:** the full 90 days runs on local Supabase (the same Postgres, the same partitions); staging gets 90 days of rollups and 2 days of raw checks for the `/verify` drive, deleted afterwards.

**Why.** Site detail first keeps every link live. Two smaller slices review faster. Uptime from incidents is the rule the reports use (§5); a pass rate would count a blocked or TLS chain check as downtime. Per-location rows are what the chart draws. The Overview reads raw checks only for the last 24 h, so 90 days of raw data on staging would prove nothing the local run doesn't.

**Impact.** `docs/implementation-plan.md` (S06, new S06b, S09 / S12 depend on S06b), `docs/design/screens.md`, `supabase/migrations` (`check_rollups`), `features/sites` (Site detail, Sites list values), D-018 (BottomNav slice).

## D-029 — TLS chain errors are a PROBLEM, not DOWN

**Conflict.** Spec §6 counts every TLS failure as a hard fail (→ DOWN). A misconfigured certificate chain — Cando Asia, 8 Oct 2026: a Sectigo leaf served with a Let's Encrypt E6 intermediate — fails in Node, apps and API clients (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`), but most browsers still open the site because they fetch the missing intermediate themselves. DOWN + escalation overstates it.

**Decision (8 Oct 2026, Tao).**
- Chain errors → PROBLEM, trigger `tls_chain` ("TLS chain"), cause "TLS chain misconfigured (…) · most browsers open it, apps and API clients fail": `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `UNABLE_TO_GET_ISSUER_CERT` (`TLS_CHAIN_ERRORS` in `@dxt/shared`). A key page → `key_page`.
- **One round is enough** (a chain error is steady until someone fixes it, like a missing keyword): a majority of the reporting locations with a chain error opens it.
- A chain error is **never a hard-fail vote** for DOWN. A probe location that sees failures — chain errors included — on most sites is a faulty location (its own trust store lacks an issuer), excluded as spec §15.3 says (engine review M1). At one location while the others pass it still counts for the regional rule (PROBLEM Regional after 5 min, never DOWN — `failsHere`), so a region whose apps can't connect isn't missed (code review).
- A round with a chain error where chain errors and hard fails together are the majority is a TLS chain PROBLEM too (one hard fail can't make DOWN, and a silent blip would hide it). The chain verdict counts as the home page answering, so a DOWN drop recovers when the site comes back with a broken chain, then continues as PROBLEM (TLS chain) in the same round (D-023; engine review H1, M2).
- **The browser decides the home page (Tao, 8 Oct 2026; engine review M3).** The failed handshake hides HTTP, so an origin down behind a front end serving the wrong chain would never show. A chain-majority round on the primary goes to the browser verifier, which fetches the missing intermediate: the page loads → PROBLEM (TLS chain); it fails with an outage (no answer, its page timeout, a 5xx, a connection error) → DOWN, confirmed by the browser; a certificate error, a 4xx (D-022) or a missing keyword in the browser, blocked in the browser, or the verifier unavailable → PROBLEM (TLS chain), the last reported as unverified so the Admin's verifier alert still works. Checked on the VPS's Chromium, 8 Oct 2026: cando-asia.com and incomplete-chain.badssl.com load (200, it fetches the intermediate); expired.badssl.com → ERR_CERT_DATE_INVALID. One failed browser verdict is DOWN, as for a blocked round (D-019). A key page needs no browser (it caps at PROBLEM), nor does a round where the VPS's own checks failed (D-027 rule 2), on any site. Cost: one verify job per round for as long as the chain stays broken, like a blocked site.
- The probes skip the recheck of a chain error (`isHardFailCheck`); an agent not yet redeployed still rechecks, which changes nothing.
- How a `tls_chain` PROBLEM shows on a client's status page is left to S21 with the other PROBLEM triggers (spec §12).
- Rows a probe stores during a deploy's schema lag (`insertCheckResults` drops a fact column the database doesn't have yet, `docs/workflow.md`) lack that fact for those few minutes — e.g. no `waf` on a blocked check, so a site behind a WAF goes to the verifier for those rounds. Accepted. Two real hard fails still make DOWN whatever the third location saw. `isHardFail(check)` in `packages/engine` is the one rule; ESLint refuses `outcome === 'fail'` elsewhere in the engine, so uptime and reports can't count a chain error as downtime later.
- Everything else stays a hard fail → DOWN as before: `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN`, `CERT_NOT_YET_VALID`, handshake failures.
- The probe never fetches missing intermediates itself and never disables verification.
- **Sites list glyphs (S05c, spec §20).** A check with a chain error draws its own glyph, "TLS chain error" (shield, amber), never the Hard fail one. A blocked check draws the lock titled "Blocked by bot protection", not §11's "Blocked, verified OK": the glyph describes one check, and whether the round was verified shows at site level (OK with the browser note, or PROBLEM "Blocked, not verified").
- **Shape (Tao chose the lighter one over the draft's new outcome):** the check stays `outcome: 'fail'` with the code in `check_results.error` — no `check_outcome` change, no Ingest contract change; only `incident_trigger` gains `tls_chain`. The agent's recheck skip ships with the next `release.sh`.

## D-028 — The BKK probe's failing network check is an Admin alert

**Gap.** Under D-027 rule 2 a WAF site whose only counting location is Bangkok goes PROBLEM (unverified, `control_failed`) when the VPS's two control URLs both fail, and its owner is mentioned. The cause is the VPS's own network — the Admin's to fix — and nothing told the Admin: the heartbeat only notices a VPS that can't reach Vercel at all (message-checker, S05b review).

**Decision (8 Oct 2026, Tao).**
- The engine opens the system alert `bkk_control_failing` when the BKK probe's last 3 probe minutes all failed the control check (a minute with any passing batch counts as passed; minutes with no control reported are skipped). Every active Admin gets one email ("DxT Monitor · System · BKK probe network check failing · <since>") listing the sites left unverified, what it affects (only sites behind bot protection) and what to check (the VPS network, the dxt-agent journal).
- It clears once the latest minute passes, no sooner than 10 min after it opened (as the other system alerts); no "back to normal" email.
- The site's PROBLEM card says the Admin is told about the BKK probe's network separately, and the verifier Admin alert is not used for these sites.

## D-027 — Sites behind a WAF are judged on the locations it doesn't block

**Gap.** Bangkok Airways TW / CN sit behind the client's Akamai. On production (8 Oct 2026) Akamai answered SIN and TYO with 403 "Access Denied", and the browser verifier on the Thai VPS got 403 too, while the Bangkok probe (same VPS, `DxT-Monitor/1.0`) got 200. Under spec §6 / D-020 both sites sit in PROBLEM (unverified) for as long as the WAF blocks, which says nothing about whether the site is up. An allowlist from the client would fix it but isn't in our hands.

**Decision (8 Oct 2026, Tao; rules 1–5 from Tao's review of the proposal).**
1. **Abstain, don't vote.** For a site whose `sites.behind_waf` is set (by hand, audited — never auto-detected), a location whose check was blocked with a **header-level WAF signature** abstains for that round: Akamai (a 403 with `Server: AkamaiGHost` and a body with both "Access Denied" and "Reference #" — tightened in the S05b code review, 8 Oct 2026: "Reference #" alone is also on Akamai's 5xx origin-error page, an outage, and "Access denied" alone can be the origin's own page), Cloudflare (`cf-mitigated`), Sucuri (`x-sucuri-block`). The remaining locations decide with the usual rules: a pass with the keyword found → OK with the note "Verified from BKK; SIN, TYO blocked by bot protection" (the locations named as they were); a hard fail confirmed by the immediate recheck → DOWN — with SIN and TYO abstaining that is the Bangkok probe failing twice. When the origin is down, Akamai still blocks SIN / TYO at the edge, so they can't be relied on to see the 5xx.
2. **A control check guards the Bangkok vote.** Every round the VPS fetches two control URLs run by different providers. Only when both fail is the VPS's own network suspect: its results that round are "no data" for WAF sites, and a WAF site left with no counting location is PROBLEM (unverified, reason `control_failed`), never DOWN. One control down is not a failure. The control check counts even when BKK is excluded as a faulty location that minute (a VPS whose network is down fails every site), and it outranks rule 4: with nobody left to vote and the control check down, the round is untrusted — the browser verifier runs on the same VPS, so its verdict isn't asked for (engine-reviewer, S05b). A recheck the control check can't vouch for is the same: PROBLEM (unverified), not a blip.
   - **2b. The Akamai control (Tao, 8 Oct 2026).** The VPS also checks a small public file served by Akamai (default `https://www.ibm.com/robots.txt`, `Server: AkamaiNetStorage`, the same 23.x edge network as the client sites). On a site whose checks carry the Akamai signature, a Bangkok failure while that control also failed says the route from the VPS to Akamai is broken, not the origin: it doesn't vote (PROBLEM, unverified, `control_failed`). The control passing while the site fails is the origin → DOWN as usual. A Bangkok pass always counts — the site answered — and any answer from the Akamai edge to the control, a block included, proves the route; only no answer or a 5xx is a failure. The D-028 alert covers this control too, so a control that breaks never silently turns DOWNs into PROBLEMs. Akamai is a property of the site (a check in the lookback carried the Akamai signature). Accepted cost: if the Akamai edge serving Bangkok itself goes down while SIN / TYO stay blocked, that is a PROBLEM (unverified), not a DOWN. Stored as `check_results.akamai_ok`.
   - **2c. The DOWN starts at proof (Tao, 8 Oct 2026).** The walk back to the first failed check (spec §6) stops at a Bangkok failure the control checks didn't vouch for: those rounds are no data, so neither downtime (uptime) nor the client-update clock (D-002) counts them. A later "Earlier unverified signal" line on the incident timeline is left for the Incident board (S07).
   - **2d. Say who confirmed it.** A DOWN confirmed behind a WAF says so wherever "Confirmed by" shows (Chat, email, incident page): "BKK only, 2 checks — SIN, TYO blocked by bot protection" (`formatConfirmedBy`), so the person on call knows to look before telling the client.
3. **Only a WAF signature abstains.** A 403 without one keeps today's rule (D-022: a home page 4xx is not a trigger; a key page 4xx is a PROBLEM). Whether a plain home-page 403 should be a hard fail is a separate question (plan Q8).
4. **Every location blocked, Bangkok included** → the browser verifier decides, as spec §6 says: loaded → OK with the verified-via-browser note; blocked in the browser too → PROBLEM (unverified) (D-020); through the WAF a 5xx or a timeout in the browser is a failure → DOWN.
5. **Site-level flag.** `behind_waf` is per site (key pages share the host and the WAF), set on Add site / Edit site and written to `audit_log`. Rule 1 still requires the signature on each check, so a site wrongly flagged gains nothing from it.
- The relaxations (one voter decides, the triggers and the regional rule on one location's evidence) apply only to a round where a location really sat out; a flagged site where everyone voted keeps the majority rules.
- Sites without the flag keep spec §6 / D-020 unchanged.
- Cost accepted: while the WAF blocks SIN / TYO, an OK round rests on one location; the VPS heartbeat and the control check cover that location failing.

## D-026 — A brand keyword is looked for past the first 256 KB

**Gap.** D-022 checks keywords in the first 256 KB of the body. Entering the 17 sites (8 Oct) showed that Wix pages inline 70–280 KB of CSS before `<title>`, so VOCA's brand name sits past 256 KB and DxT Solutions' and DxT AI's sit close to the edge; they had to use their domain as the keyword, which says little about the page's content. The browser verifier already searches the whole page.

**Decision (8 Oct 2026, Tao).**
- A `must_contain` keyword is looked for while the body streams, up to about 3 MB (`KEYWORD_SCAN_BYTES`, whole chunks), and the download stops as soon as every keyword has been seen. A page whose keyword is early still reads only what it did.
- `must_not_contain` and the challenge / classification checks keep the first 256 KB sample: the pages they catch (a directory listing, a database error, a challenge) are small, and reading every large page to its end to prove a word absent would cost bandwidth on every round.
- A keyword split across two chunks is still found.
- The response time ends with the 256 KB sample: the deeper scan is not load time and never feeds the slow rule. If the body stalls or drops while the scan is still looking, the keyword is "not checked" for that round (as on a HEAD) — the page already answered, so it is never a hard fail.

## D-025 — S05: sites, monitors and the registration checklist

**Gap.** The AddSite and EditMonitors boards draw more than the schema, the probe and the engine do, and D-015 ("owners need a Chat id before the site is saved") meets a registration flow where the owners may not have signed in yet:
- the probe never reads `expected_status`, follows redirects itself, and knows no "shared spam list";
- the boards offer POST, a status list, a "Don't follow" option, separate Keyword / Redirect / SSL / Domain monitors and a per-site account manager;
- nothing can run a check on demand, and no table holds a credential reference, the WAF state or a draft.

**Decision (8 Oct 2026, Tao answered 1–4; Claude settled the rest).**
1. **Test check** runs on demand from SIN and TYO (two Admin-only routes pinned to sin1 / hnd1, the real `httpCheck`, SSRF guard on, nothing stored). The WAF secret header goes only to a host a saved monitor already points at. BKK says it runs on the first round — the VPS only pulls work.
2. **Expected status and redirects** are shown as the fixed rule, disabled with the reason: any 2xx–3xx after up to 5 redirects; 4xx on a key page → PROBLEM; 5xx → hard fail. They become editable when a site needs it.
3. **No shared spam / gambling list in S05.** The locked tag isn't shown; Must not contain starts with "Index of /, Database error" (PRD §5). The shared list belongs to organisation settings (S17).
4. **The 17 production sites** are entered through the UI as Drafts by Claude with Tao's session; each is started once its owners have signed in and have a Chat id. Clients, AMs and Chat ids load from reviewed SQL scripts (templates with placeholders only).
- **Draft owners and D-015.** A Draft may leave the owner or backup empty (the schema allows it while a site is registered). An owner who is set must have a Chat id — every write refuses one without and names them — and Start (or saving a live site) needs both owners set and linked. The owner lists show people without an id disabled as "Name · no Chat id". S05 Done-when 5 reads accordingly. The AddSite footer says "Owners need a Google Chat id before they can be assigned."
- **Monitors.** EditMonitors edits the HTTP primary and up to 3 key pages (non-primary `http` monitors). The board's Keyword and Redirect rows are the content checks and allowed hosts of each HTTP monitor, not separate monitors; SSL and Domain arrive with S13. Method is GET or HEAD (no POST); HEAD can't have content checks (D-022). Timeout defaults to 30 s. The slow threshold defaults from the tier; "3 rounds in a row" and "PROBLEM (slow)" are fixed (D-022) and shown disabled.
- **Account manager** is read-only from the client (`clients.am_user_id`); an internal client (`clients.is_internal`) needs none; a client site whose client has no AM can't start.
- **Draft, Start, Stop.** Draft = `sites.is_active = false`; Start needs every required checklist item and is re-checked in SQL; an Admin can Stop monitoring (back to Draft, audited) — the way back from a wrong Start. A stopped site without history (check results, incidents) can be deleted; a monitor with history is soft-removed (`removed_at`), its results kept for their 90 days. A monitor with an open incident can't be switched off or removed until the incident is resolved (its disappearing would otherwise "recover" the incident, D-024).
- **Audit.** A trigger on `sites`, `monitors` and `clients` writes one `audit_log` row per inserted, updated or deleted row (before / after, actor = the signed-in user, null for SQL scripts), in the same transaction; a no-op update writes nothing. The EditMonitors success Alert says "Every change is in the audit log." instead of quoting one summary line.
- **Custom headers** (`monitors.headers`, at most 10) go out from BKK, SIN and TYO to the monitor's own origin. The browser verifier doesn't send them: Playwright would carry them across a redirect to another host (security review). Host, Content-Length, Cookie, Authorization, User-Agent (WAF allowlists key on the fixed probe UA), the probe secret header and credential-like names (auth, token, secret, api-key, session, password, cf-access) are refused — in the form and again in `save_monitors` — because every staff role can read monitor settings and they stay in the audit log.
- **Copy dropped:** Tier 1 "(Proposal · pending CEO)" (D-009) and "Nok and Ploy notified ·" in the Started line (D-013 — nothing is sent).
- **`/sites`** shows Status, Site (Draft badge), Tier, Owner, Client and Checked with the Tier / owner / client filters; Locations, Response 24h and Uptime 30d arrive with S06's rollups. Rows open `/sites/[siteId]/edit` (Edit site, the AddSite form) until S06 builds `/sites/[siteId]`. Each row and Edit site have a **Visit site** button that opens the primary URL in a new tab (Tao, 8 Oct 2026).

**Why.** Every control shown works (spec §14.16), the engine keeps one tested rule set, and real sites can be registered before their owners are ready without weakening D-015 where it matters — before monitoring starts.

**Impact.** Migration `sites_registration`; `@dxt/shared` (checklist, form and header schemas); `@dxt/probe` and the VPS agent send headers; `features/sites`, the `/api/monitor-test/*` routes; S05 grows M → L; S13 (SSL / Domain monitors), S17 (shared spam list, clients / AMs UI).

## D-024 — S04b: relapse, flapping and auto-resolve

**Gap.** D-004, D-022, D-023, spec §16.1 and §19.3–19.4 say what should happen, but not:
- how overlapping engine runs avoid a double reply;
- what a "status change" is when the site's shown status lags a round behind a recovery (it shows OK only after the 2nd OK round);
- how a DOWN incident that carries on as a key-page PROBLEM (D-023) recovers;
- which channels the relapse and flapping messages use.

The ChatAlert board also has a note, "Drops after 03:24 aren't re-posted", that contradicts §19.4 ("only the RECOVERED replies are held"). PostIncident shows RECOVERED at 04:04:10, where §19.4 and ChatAlert put the summary at 04:19.

**Decision (7 Oct 2026, with Tao).**
- **Relapse.** A new DOWN or PROBLEM on an incident in Monitoring or Needs root cause joins it. One state-guarded SQL function, `engine_relapse_incident`, does all of it in one transaction:
  - the state goes back to Acknowledged if acked, Escalated if a level had fired, otherwise Unacked;
  - `recovered_at` is cleared;
  - severity only goes up;
  - the `down_again` / `problem_again` Chat reply is queued in the thread.

  If two runs overlap, the second fails the guard and sends nothing. A DOWN on a recovered PROBLEM incident stays D-021 (DOWN card).
- **Episode severity.** `incidents.episode_severity` is the severity of what is failing now. The status floor and recovery follow it:
  - a DOWN episode recovers on the round the primary monitor is OK (D-023);
  - a PROBLEM episode recovers when every monitor is OK.

  With D-023, the same round records RECOVERED and then rejoins as PROBLEM AGAIN (spec §19.7, two guarded calls in one run); the site shows PROBLEM. `severity` keeps `down` for the record.
  - "The home page answers again" means the primary's round passes: OK, or a PROBLEM from a passing round (slow, keyword, redirect, regional). A blocked or failing home page doesn't end the DOWN.
  - If the home page fails again while that PROBLEM drop is still open, it is a new DOWN drop in the same incident: DOWN AGAIN, severity DOWN (engine review H1). It is not a flip, because the site never went back to OK.
- **Flapping is per incident** (PRD §7: flapping merges into one incident). Short PROBLEMs that each auto-resolve are separate incidents, each closed and hidden, and none of them is tagged. Response hours (S08) hold Tier 2–3 PROBLEM cards at night.
- **Flip.** A flip is the site going OK → not-OK (open, relapse, escalate) or not-OK → OK (a recovery where every monitor is OK). It is recorded at that round in `site_status.flips` and `flip_ok`, inside the guarded SQL. A D-023 partial recovery and the PROBLEM relapse after it are not flips. The relapse that makes the 3rd flip in 30 min tags `is_flapping` (VOCA: 03:12, 03:19, 03:24).
- **While flapping.**
  - The states move as normal.
  - The RECOVERED Chat reply and email are not sent. Instead one summary (Chat + an email to the owner) is queued, held until 15 min after the recovery. Any new drop cancels it, so it goes only after 15 min of continuous OK.
  - Every drop still posts DOWN AGAIN / PROBLEM AGAIN (§19.4 wins over the board note; Tao's 7 Oct answer).
- **Channels.** DOWN AGAIN and PROBLEM AGAIN are Chat replies only. The flapping summary also goes by email to the owner. When Chat fails, the D-016 fallback emails an AGAIN reply to the backup, the Admins **and the person it mentions** (whoever acknowledged, else the owner), who has no other copy (message-checker, 7 Oct; Tao: decide).
- **Auto-resolve (§16.1, D-003).** A PROBLEM episode on a PROBLEM incident that was never acked and recovers less than 5 min after it was flagged (`detected_at`, spec §19.6 — not the first failed check) goes from its first OK round straight to Resolved (`auto_resolved = true`, hidden by S07). It still gets RECOVERED in Chat (no @mention) and by email, saying it was resolved automatically and needs no root cause. A DOWN never auto-resolves.
- **Dedupe key (D-014).** `notifications.dedupe_key` joins the once-per-incident index. `recovered`, the AGAIN replies and the summary use the round, so they can repeat.
- **Copy.** It comes from the ChatAlert rows (DOWN AGAIN VOCA, PROBLEM AGAIN INC-0150, flapping summary) and the rows design added on 7 Oct (spec §19.4, §19.6, §19.7): the auto-resolved RECOVERED (INC-0151), the later drop while flapping (VOCA 03:38), the key-page PROBLEM AGAIN (INC-0152) and the summary email.
  - "Outside response hours · timers paused until 09:00" is left out until S08 (D-013).
  - The board text "DOWN AGAIN" replaces D-004's "DOWN · site · down again".

**Why.**
- The state guard and the dedupe key make a reply impossible to double, whatever the cron overlap.
- Recording flips at incident steps ties flapping to what people were told, not to a display that lags.
- The held summary needs no extra engine wake-up: the notifier claim already waits for `hold_until`.

**Impact.**
- Migration `relapse_and_flapping`.
- `@dxt/engine` (`site.ts`, `lifecycle.ts`), `run-engine.ts`.
- `@dxt/notifier` builders (`down_again`, `problem_again`, `flap_summary`, auto-resolved RECOVERED).
- ChatAlert / EmailAlert / PostIncident updates from design.

## D-023 — A DOWN ends when the home page is back; a broken key page carries on as a PROBLEM

**Gap.** D-022 makes site status the worst monitor verdict and lets an incident recover only on a round where every monitor is OK. For a DOWN incident that means: the home page answers again, but a key page still returns 404, so the site stays DOWN and the incident never recovers. Those minutes count as downtime in uptime (spec §5), and from S08 the DOWN escalation keeps paging people while the site is up. Found by engine-reviewer in S04a.

**Decision (7 Oct 2026, Tao).**
- A **DOWN** incident recovers (RECOVERED, Monitoring) on the first round the **primary** monitor is OK, whatever the key pages say. The downtime ends there.
- A key page still failing then counts as a new problem on a recovered incident: a D-004 relapse into the **same** incident and thread, as a PROBLEM ("PROBLEM AGAIN", spec §19). Severity stays as it was for the record; the site shows PROBLEM.
- A **PROBLEM** incident keeps D-022's rule: it recovers when every monitor is OK.
- Built in **S04b**, with the relapse function. Until then S04a keeps D-022's rule (no real sites are on production before S04b).

**Why.** Uptime and escalation follow what visitors see: when the home page loads, the site is up (spec §6: only the primary monitor can make a site DOWN). The key page is still tracked, in the same thread, at the severity it deserves.

**Impact.** S04b: `packages/engine/src/site.ts` recovery for DOWN incidents, the relapse path, engine and integration tests (a DOWN with a key page still 404 → RECOVERED, then PROBLEM AGAIN).

## D-022 — S04 engine rules, the S04a / S04b split and PROBLEM messages

**Gap.** PRD §5 and the StatusModel board name the PROBLEM triggers and say "only the primary monitor can make a site DOWN". They don't say:
- how a trigger is counted across locations and rounds;
- how several monitors make one site status;
- how the faulty-location rule behaves when only a few sites are checked in a minute.

The ChatAlert board has one PROBLEM text line and no PROBLEM card. EmailAlert has no PROBLEM email. Nothing says how flapping and the Monitoring → Needs root cause steps interact. Separately, S04 (sized M) needed probe, agent, schema, engine, notifier and test-target work, well past L.

**Decision (7 Oct 2026, with Tao).**
- **Split.** S04 becomes:
  - S04a: PROBLEM triggers, status rules, PROBLEM messages, M1, the fewer-than-2-locations alert;
  - S04b: relapse, flapping, auto-resolve.

  S07 depends on S04b, and real sites wait for S04b.
- **Monitor verdict.** Each monitor gets one verdict per round: OK, PROBLEM (trigger, cause) or DOWN.
  - Only the primary monitor can give DOWN. Any problem on another monitor (a confirmed hard fail, a 4xx that isn't a WAF block, slow, keyword, redirect) is trigger `key_page`, and its cause says what failed.
  - The carry state between rounds (slow streak, per-location failing-since) lives in `monitor_status`.
- **Site status.** It is the worst monitor verdict. While an open incident hasn't recovered, it is never lower than the incident's severity. An incident recovers on the first round in which every monitor is OK. This makes S03 engine M1 a plain case: a blocked round that can't be verified shows PROBLEM, and the next OK round shows OK.
- **Keyword and redirect.** Both fire on a majority of the locations reporting in one round.
  - Keyword is a `must_contain` entry missing or a `must_not_contain` entry found. It is case-sensitive, like the browser verifier, and checked in the first 256 KB of the body (`must_contain` further since D-026). A HEAD monitor is never keyword-checked.
  - A redirect is fine when its final host is the monitor's base host (without `www.`), an entry in `allowed_redirect_domains`, or a subdomain of either.
- **Slow.** The p50 of the passing locations' response times is over the threshold 3 rounds in a row. The threshold is `monitors.thresholds.slowMs`, or the tier default (Tier 1 3 s, Tier 2–3 5 s).
- **Regional.** One location has failed for ≥ 5 min, counted from its first failure, while the round is an OK majority.
- **Faulty location (spec §15.3).** Worked out per probe minute across every monitor, and only when ≥ 3 monitors reported from that location in that minute. With fewer, one real failure would mark the location faulty and hide a regional problem.
- **Fewer than 2 locations.** When fewer than 2 locations are beating (D-019 heartbeats), every active Admin gets one email: system alert `probe_locations_low`. It clears when ≥ 2 beat again, no sooner than 10 min after it opened. The site keeps its status (PRD §5).
- **Response hours.** Until S08 builds them, a PROBLEM is sent at any hour. S08 then holds a Tier 2–3 PROBLEM outside hours until 09:00.
- **Home page 4xx.** Not a trigger. The PRD's failure list doesn't include it, and a brand keyword catches a wrong page.
- **Flapping (S04b).** While a site is flapping, the incident moves through Monitoring and Needs root cause as normal. Only the RECOVERED reply is held, until 15 min of continuous OK, then one summary goes out.
- **Relapse (S04b).** Every new PROBLEM or DOWN on a recovered incident is a D-004 relapse, the M1 case included.
- **Messages.** Exact copy comes from the ChatAlert / EmailAlert rows design added on 7 Oct 2026, with spec §19 (the same rules as above, written into the spec): the PROBLEM card and email, PROBLEM (unverified), ACKNOWLEDGED / RECOVERED for a PROBLEM, the cause wording per trigger, the Admin system emails (their own subject with the start time), and for S04b "DOWN AGAIN", "PROBLEM AGAIN" and the flapping summary. The board rows that promise S08's ladder ("Next: reminder at …", "reminders stopped", "(not notified yet)", the backup's 60-min email) are left out until S08 (D-013), and the Admin emails' "Open Probes & heartbeat" button until that page exists (S12).

**Why.** Majority and streak rules keep one location's CDN wobble from paging people (PRD §2 noise goal). The worst-of rule keeps an outage from hiding behind a lesser status, and a recovered state from hiding a new problem. The minimum-sample floor keeps the faulty-location rule from swallowing real regional problems when few sites share a probe minute. The split keeps each slice within L, so each PR can be reviewed.

**Impact.**
- `docs/implementation-plan.md`: S04a, S04b and their dependents.
- Migration `problem_triggers`:
  - `check_results.final_url` / `keyword_missing` / `keyword_forbidden`;
  - `monitor_status`;
  - the `p_monitors` / `p_status` arguments on the engine functions;
  - the `probe_locations_low` alert kind.
- `@dxt/probe` (keywords, final URL), `checkResultSchema`, `server/probe/due-monitors.ts` (all monitors), `apps/vps-agent`.
- `@dxt/engine` (`triggers.ts`, `site.ts`), `run-engine.ts`.
- `@dxt/notifier` PROBLEM builders.
- `apps/test-target` modes.

## D-021 — A PROBLEM incident that turns into an outage becomes DOWN

**Gap.** The engine-reviewer found it in S03 (H2). A site whose open incident is a PROBLEM can be confirmed DOWN. S03 makes such incidents common: a site blocked while the verifier is unavailable, or blocked in the browser too (D-001, D-020). D-004 joins a relapse to the open incident, but it is about the same severity, and S02a logs that case without alerting until S04. So the outage would pass silently: no DOWN alert, the site still PROBLEM. The go-live test (PRD §12) asks for the opposite: with the verifier off, a hard-fail site still goes DOWN on time.

**Decision (7 Oct 2026, from the engine review).**
- A confirmed DOWN, whether from hard fails or the browser failing a blocked page, while the open incident is a PROBLEM, raises that incident to DOWN. One SQL function (`engine_escalate_incident`, state-guarded) does all of this in one transaction:
  - severity becomes DOWN;
  - "Confirmed down" (`detected_at`) is set to the DOWN confirm;
  - if the incident had recovered (Monitoring / Needs root cause), it goes back to Acknowledged if acked, else Unacked, as in D-004;
  - the site's status becomes DOWN;
  - the DOWN Chat post and the owner email are queued in the incident's thread.
- A DOWN incident's own relapse is unchanged: D-004, built in S04.

**Why.** An outage must never hide behind a weaker status (spec §11: a site shows its worst status). One incident per site keeps the history and the thread together, and the alert carries the DOWN facts.

**Impact.** Migration `escalate_problem_to_down`, `@dxt/engine` decision `escalate`, `run-engine.ts`. The DOWN Chat post goes out even when the PROBLEM was already acknowledged: acknowledging "blocked, not verified" isn't acknowledging an outage (the notifier doesn't drop an escalated DOWN as superseded). The DOWN's own start, its first failed check, is kept in the alert context and the `escalated_to_down` event (`downStartedAt`): uptime (spec §5) and the client-update track (D-002, S11) count from there, not from the PROBLEM's `started_at`. S08 escalation timing counts from the new "Confirmed down".

## D-020 — Blocked in the browser too: PROBLEM, not DOWN

**Conflict.** The StatusModel row "Blocked · browser: page fails" says DOWN when "the page does not load or the keyword is missing". PRD §5 (browser verification) says the verifier uses plain Chromium with no stealth plugin, and that a plain browser that is blocked should be PROBLEM, not hidden, because real visitors may be blocked too. A WAF that blocks headless Chromium from the VPS (Bangkok Airways' Akamai 403, `docs/phase0/waf-captures.md`) would meet the board's literal reading and page the whole team for a site that is up.

**Decision (7 Oct 2026, with Tao).** The verifier reports three verdicts:
- `loaded`: the page answers below 400 and every keyword is found → OK with the note.
- `blocked`: the browser gets a WAF or challenge page too (403 / 429 / 503 with a challenge signature, after giving a browser challenge the rest of the 20 s) → PROBLEM (unverified). The cause is "Blocked in the browser too". There is no "verifier unavailable" email, because the verifier works.
- `failed`: anything else (no answer, timeout, 4xx / 5xx without a WAF signature, keyword missing) → DOWN, as the board says.

**Why.** Each source keeps its intent. The board's DOWN covers a page that really fails. The PRD's rule covers a browser that is blocked: the problem is shown, but it never claims an outage. The allowlist (S00) stays the permanent fix.

**Impact.** `verification_jobs.result` adds `blocked`; `@dxt/engine` `Verification` / `UnverifiedReason`; the runner's cause text and Admin-alert rule; `apps/vps-agent` `judgeVisit` (uses `hasChallengeSignature` from `@dxt/probe`, like the HTTP probes); test-target mode `challenge-all`.

## D-019 — S03 browser verifier: queue, PROBLEM (unverified), Admin alerts, two agents

**Conflict.** PRD §10 puts the verifier's jobs on pgmq. The StatusModel row "Blocked · verifier unavailable" notifies the owner and the Alerts Space, but the ChatAlert PROBLEM rows belong to S04. The "verifier unavailable" and "queue > 5" Admin alerts aren't about one incident, while `notifications.incident_id` is required. Plan S03 Done-when 6 names one env file, `/etc/dxt-agent/env`, for one agent; there is one VPS and two environments.

**Decision (7 Oct 2026, with Tao).**
- **Queue.** `verification_jobs` is the queue, claimed with `for update skip locked` and a 60 s lease, the same way `notifications` is (D-014). One row holds the job, its result and the screenshot path. A verify job is unique per monitor and round; an evidence job is unique per incident. pgmq stays available.
- **Verifier unavailable** means any of these:
  - no verifier poll (`GET /api/jobs`, every 5 s) for 2 min;
  - the round's job still queued 30 s after it was created, while the verifier had a free session at its last poll (with every session busy it waits its turn, up to 2 min);
  - its lease ran out without a result.

  Each case → PROBLEM (unverified) in that round, within about 30 s of the round being judged (D-001: "at once"). The next blocked round queues a new job, so the check retries every round.
- **PROBLEM (unverified) in S03:**
  - opens a PROBLEM incident (trigger `blocked_unverified`, no Chat or email row);
  - sets `site_status` to `problem` with the note "Blocked, not verified";
  - emails every active Admin about the verifier.

  The owner and Alerts Space card comes with S04's PROBLEM rows (the D-013 rule: alerts grow with their slices). No real site is probed on production before S04 (S02a notes), so nobody misses an alert.
- **Blocked, then the browser fails → DOWN.** This is a normal DOWN incident (trigger `hard_fail`) with the usual Chat and email. It starts at the round's first check that didn't pass, and its screenshot is the verify job's. An evidence job is queued only when that screenshot is missing.
- **Admin alerts.**
  - `system_alerts` (kind, opened_at, cleared_at, context) holds alerts that aren't about one incident: `verifier_unavailable`, `verifier_backlog` (> 5 jobs queued). One open alert per kind, so one outage sends one email per Admin, not one per site or round.
  - `notifications` takes either an `incident_id` or a `system_alert_id`.
  - "Verifier unavailable" clears once the verifier polls again with nothing queued and no blocked site waiting, but no sooner than 10 min after it opened, so a verifier that keeps failing jobs can't open and close it every round. "Queue > 5" clears when the queue drops to ≤ 5. No "back up" email. Amended 8 Oct 2026 (two 6-second alerts on production, `fix/tls-chain-problem`): the backlog counts only jobs still queued 30 s after they were created — stuck, as PRD §5 "ค้าง" says — and clears no sooner than 10 min after it opened, like the other kinds. "Verifier unavailable" clears on the same count, so "nothing queued" there now means nothing stuck — a fresh job the verifier is about to take doesn't hold the alert open.
- **Expected locations.** A round expects the active locations whose probe beat in the last 3 min. A stopped agent drops out of the vote instead of holding every round until the deadline. BKK is active from S03; it votes only while its agent beats.
- **Two agents.** The VPS runs `dxt-agent@staging` and `dxt-agent@production` from one systemd template. Each reads `/etc/dxt-agent/<env>.env`. Verifier sessions: staging 1, production 3. The VPS has 4 GB.
- **Screenshots.**
  - Stored in the private bucket `verifier-screenshots`.
  - The VPS uploads to a signed upload URL issued with the lease, so it never holds a Storage key.
  - A daily cron deletes them through the Storage API after 30 days.

**Why.**
- **Queue.** A table gives the result, the audit trail, the dedupe and the queue count in one place, with the same pattern the notifier already uses. pgmq would still need a results table.
- **Unavailable.** "At once" can't wait for a 2-min heartbeat gap, so a job nobody picks up counts as unavailable too.
- **PROBLEM card in S04.** Building one PROBLEM card in S03 and the rest in S04 would split one board's rows across two reviews.
- **Two agents.** Staging keeps a Bangkok vote and a verifier for the slices that follow.

**Impact.**
- Migrations: verifier and Admin alerts.
- `packages/engine` (`decideMonitor` judges blocked rounds), `apps/web/src/server/engine`, `/api/ingest`, `/api/jobs`, `/api/cron/housekeeping`, `@dxt/notifier` (Admin alert email), `apps/vps-agent`, `apps/test-target` (challenge modes).
- Plan S03 Done-when 6; S04 adds the PROBLEM (unverified) card.

## D-018 — Page header spacing and the phone shell

**Conflict.** (1) The boards space the page header differently: a section eyebrow sits 4 px above the title (Main, Incidents, Expiry, Settings …), a breadcrumb 12 px (Synthetic, EditMonitors, AddSite, SiteDetail, Incident) or 24 px (Resolve); the title → meta line gap is 4 px on most boards, 6 px on Synthetic / EditMonitors and 10 px where the second row holds badges (SiteDetail, Incident, Maintenance, PostIncident). The spec gives no numbers, and §13 says "Eyebrow = breadcrumb (chevron style) OR section name in caps … never both". (2) Every phone board (MOverview, MobileAck, MIncidents …) draws a 56 px top bar — brand on the left, avatar on the right, a back arrow on detail pages — and a BottomNav, with no menu drawer. The app shell (S01) used AURA AppShell's default phone bar: the menu button alone. No slice owned the phone shell.

**Decision (7 Oct 2026, with Tao).**
- Every page header is AURA `PageHeader`: 4 px between eyebrow, title and meta line, as on Overview today. A breadcrumb is the eyebrow: AURA `Breadcrumb` sits 4 px above a `PageHeader` that has no `eyebrow` (one `flex flex-col gap-1` wrapper), so a page with a breadcrumb and one with a section name line up. It can't go inside the `eyebrow` slot — that renders a `<p>`, and a `<nav>` inside a `<p>` is invalid HTML (React hydration error); AURA request 7 asks for a breadcrumb slot. The other gaps on the boards are drawing drift, not intent.
- Phones get the boards' top bar now: brand (compact tile) + the signed-in person's avatar (`components/app-shell/mobile-bar.tsx`), hidden from lg where the sidebar shows. In S06b (D-031) AURA `BottomNav` adds the phone boards' four sections (Overview, Incidents, Sites, On-call) below lg — phones and tablets (820 px) alike. The menu button and drawer stay beside it: the boards draw no other way to reach the rest (Escalation, Maintenance, Reports, Settings …), and no rule makes those pages desktop-only; the back arrow comes with S07, when the Incidents list it returns to exists (no dead controls, §14.16).

**Why.** One rhythm means the title doesn't jump between pages, and the breadcrumb row (13 px text, 16 px icons) is the same height as the mono eyebrow, so nothing else changes. Using `PageHeader` as AURA ships it keeps the title, meta and actions in one component; the breadcrumb wrapper adds only the same 4 px. The phone bar is what every phone board shows, and a person opening an alert link on a phone should see where they are and who is signed in.

**Impact.** `apps/web/src/app/(app)/layout.tsx`, `components/app-shell/{brand,mobile-bar}.tsx` (AURA 5.33 shipped requests 6 and 7: the bar hides from lg with `headerHideFrom="lg"`, and the breadcrumb goes in `PageHeader`'s `breadcrumb` slot instead of the wrapper — the CSS workaround is gone); plan S06 and S07 Scope; `apps/web/CLAUDE.md` → Building a screen. spec-checker should treat a header's 4 px gaps as correct where a board draws 6 / 10 / 12 / 24 px.

## D-017 — Email threads hang on an incident id, not the first Message-ID

**Conflict.** Spec §10 and the EmailAlert board: "The first email’s Message-ID is stored; every later email sets `In-Reply-To` and `References` to it." Resend sends through Amazon SES, which replaces any Message-ID we set (Gmail "Show original" on staging: `…@ap-northeast-1.amazonses.com`). Reading the real one back (`GET /emails/:id`) needs a Full-access API key; the app's keys are send-only, as they should be.

**Decision (6 Oct 2026, with Tao: keep the send-only key).** Every email of an incident carries `References: <inc-<incident id>@<sending domain>>`; every email after a person's first also sets `In-Reply-To` to it. The subject stays the same for every event.

**Why.** Google's rule for notification threading is "same subject, and references headers that consistently refer to the same message ID" (Workspace Updates, March 2019); GitHub threads its notifications the same way. It needs no read access to the provider. Verified on staging: INC-0005 shows as one Gmail conversation of 3 (DOWN, ACKNOWLEDGED, RECOVERED).

**Impact.** `packages/notifier` (`incidentThreadId`), `apps/web/src/server/notifier/dispatch.ts`. The board's intent — one thread per incident — is unchanged.

## D-016 — Ack, email and fallback in S02b

**Gap / conflict.**
- PRD §3 lets a Responder acknowledge only sites they own, or any Tier 1 site while on call. The MLogin board lets a Responder who owns neither site acknowledge.
- PRD §9 says "fall back to email when Chat fails" but not who receives it; the owner already gets the record email of every alert.
- The EmailAlert and MobileAck boards carry escalation, client-update and webhook copy whose features arrive in S08, S10, S11 and S24.
- The ack link needs an incident page, which S07 owns.

**Decision (Tao, 6 Oct 2026).**
- **Who can acknowledge:**
  - an Admin, on any site
  - a Responder, on sites they own as primary or backup (D-012)
  - Stakeholders and Viewers see the incident read-only

  The on-call rule (any Tier 1 site while on shift) comes with on-call in S10. The check lives in the `ack_incident` SQL function, so no client can skip it.
- **Fallback:**
  - when a Chat message is still failing after its last retry (+30 s, +2 min, +8 min), the same alert is emailed to the site's backup and every active Admin who didn't already get that email
  - footer: "You got this because a Google Chat alert for this incident couldn’t be delivered." (the same line on every later email to that person)
  - the fallback DOWN email's lede: "Nobody has acknowledged yet. The Google Chat alert couldn’t be delivered, so this email is the alert."
  - on the owner's RECOVERED email "Open incident" is the primary button, since its board primary "Add root cause" waits for S07
- **D-013 covers email and the ack page.** Until their slices, these are left out:
  - escalation copy: "Next step", "acknowledge by …", "L1–L2 stopped", "L3 FYI"
  - client-update rows
  - buttons to pages that don't exist yet ("Add root cause", "Open draft", "Add note", "Full incident", "Site details")
  - on the Down email, [Open incident] next to [Acknowledge]: both open the same page until S07

  Resulting copy:
  - The Undo line reads "Posting to Chat and email in N s — nothing is sent until then" (§16.8 without "webhooks" until S24).
  - The ack sentence reads "Acknowledged by <name>."
- **Recipients in S02b:**
  - the DOWN email goes to the primary owner only; day/night routing comes in S08
  - the L0 email is locked (PRD §8), so `notify_email` doesn't turn it off
  - ACKNOWLEDGED and RECOVERED emails go to everyone already emailed about the incident
  - ACKNOWLEDGED in Chat is a reply without a mention
- **`/incidents/[incidentId]` is built in S02b** with the MobileAck layout, one column at every width. S07 grows it into the Incident board. `?ack=1` is accepted and changes nothing.

**Why.**
- Who can acknowledge follows the PRD's role table.
- The fallback reaches the people who would have seen the Space, without duplicating the owner's email.
- A Chat or email link sent today must still work after S07, so the page lives at its final URL from the start.

**Impact.** S02b (SQL ack/undo, notifier, the incident page). S08, S10, S11 and S24 add their copy back. S07 extends the page.

## D-015 — Owners need a Google Chat id before go-live

**Gap.** The ChatAlert board @mentions the owner on every DOWN and RECOVERED (L0). A mention needs the person's Google Chat user id (`profiles.google_chat_user_id`); nothing makes anyone fill it in, and a DOWN without a mention wakes nobody (message-checker, S02a).

**Decision (Tao, 6 Oct 2026).** Require it rather than work around it:
- S05: Add site / Edit site accept only owners and backups whose profile has a Google Chat user id; the form says who is missing one.
- Until the Profile screen (S16) an Admin sets ids with a reviewed SQL script, as for clients and AMs.
- The notifier mentions only people with an id (S02a behaviour) — no fallback mention of the Admin.

**Why.** A fallback mention would train the Admin to absorb every alert; a required field fixes it once.

**Impact.** S05 Done-when, S16 Profile; G1 go-live checks that every owner and backup of the 17 sites has an id.

## D-014 — S02a monitoring schema choices

**Conflict.** PRD §11 says every table has `id uuid`, names the check location `location_id`, and PRD §10 puts notifications on pgmq queues. The 0001 enum `site_status` has the name PRD §11 gives the table.

**Decision.**
- `probe_locations` is keyed by its code (BKK / SIN / TYO) and `check_results.location` references it; `site_status` is keyed by `site_id` (one row per site). Both are lookups where a surrogate id adds a join and nothing else.
- The `notifications` table is the queue: the engine inserts rows in the same transaction as the incident change, the notifier claims them with `claim_notifications(channel)` (`for update skip locked`, a lease longer than a run: 2 min in S02a, 90 s from S02b, which also keeps each thread in order), caps attempts (3 in S02a; from S02b 4 = the first send + retries at 30 s / 2 min / 8 min, PRD §11) and posts with a client message id (Chat) or an idempotency key (Resend) so a retry can't duplicate a message. pgmq stays available (extension in 0001) if volume ever needs it.
- The engine keeps `last_round_at` / `ok_rounds` in `site_status`. When S06 adds `site_status` to the Realtime publication, move them to a private table if the per-minute updates make noise.
- The enum becomes `site_state` (values unchanged) so the table can use the PRD name.
- One message per incident / channel / template / person (`notifications_once_per_incident`): S04 (relapse, D-004) and S10 (repeated escalations) add a dedupe key when a template can repeat.

**Why.** One transaction for "incident opened + alert queued" (an incident can't open without its alert), fewer moving parts for 17 sites, and the delivery audit the PRD asks for in the same row.

**Impact.** S02a migration; S02b builds retries and email on the same table; S04 / S06 / S10 as noted.

## D-013 — Chat alerts grow with their slices

**Gap.** The ChatAlert board's DOWN message promises escalation ("acknowledge by 10:03 or it escalates", a "Next: L1 at 10:03 … — Ploy, Tao" row) and its button reads "Open / acknowledge" (MobileAck). S02a posts the first real alerts, but escalation arrives in S10, ack in S02b and the incident page in S07. No rule says how incident numbers like INC-0142 are made — they appear only as sample data.

**Decision.**
- A message never promises something the system can't do yet. Until S10, the DOWN text line has no "acknowledge by … or it escalates" clause and the card has no "Next" row. Until S02b, the button reads "Open incident" and links to `/incidents/<id>`; S02b renames it "Open / acknowledge". The same rule drops the Owner row's "(not notified yet)" and the footer's ack sentence ("Anyone can open it; the ack is recorded …") until their slices; the footer keeps "**Current status is in the latest reply.**". Every other part of the board (STATE · site first, mentions only in the text line, one thread per incident) applies from S02a.
- Incident numbers come from an identity column `incidents.number` and display as `INC-` followed by at least 4 digits, zero-padded (`formatIncidentId` in `@dxt/shared`); the Chat thread key is the incident id.

**Why.** An alert that promises an escalation nobody will send trains people to ignore the promise; the board stays the target and each slice adds its part.

**Impact.** S02a (notifier templates, message-checker uses this entry for the omissions); S02b and S10 add the parts back.

## D-012 — Responder writes on sites: mute fields only

**Conflict.** Plan S01 Done-when 3 says "responder updates only own sites". The Users board's role matrix gives "Edit sites, monitors and escalation" to Admin only, and Responders "Maintenance windows and mute" on their own sites (PRD §3).

**Decision.** A Responder may update a site only when they are its primary or backup owner, and only the mute fields (`muted_until`, `mute_reason`). Every other `sites` column, and all of `monitors` and `clients`, are Admin-only. RLS limits the rows (`owns_site()`); a `BEFORE UPDATE` trigger on `sites` refuses a change to any other column unless `current_app_role() = 'admin'` — column grants can't do it, because they bind to the Postgres role `authenticated`, which Admins share.

**Why.** Matches the role matrix and PRD §3; Done-when 3 meant "only on own sites", not "any field".

**Impact.** S01 migration and pgTAP tests; S09 (mute) builds on it.

## D-011 — Sign-in copy under D-007

**Conflict.** The Login and MLogin boards' "No access yet" state says "Ask Tao to invite you … You'll get an email; the invite link works for 7 days". Under D-007 the allowlist row is the invite — no email or link exists — and product code must not hard-code sample names. "Wrong domain" echoes the address used, but the proxy has already signed that session out. The hint "You stay signed in on this device for 30 days" promises a session timebox nobody configured (the staging project is on the free plan, which can't set one).

**Decision.**
- "No access yet": the address is a company account that isn't on the access list; ask an Admin to add you, then sign in again. No email, no link, no person's name.
- "Wrong domain": the proxy puts the refused address in a 60-second httpOnly cookie before redirecting to `/login?error=domain`; the page reads and shows it, never via the URL. Without the cookie the copy reads "That account isn't a DxT Google account."
- The hint reads "You stay signed in on this device." with no number of days.

**Why.** The copy must describe what the system does; personal data stays out of URLs and logs.

**Impact.** S01 Login / MLogin; spec-checker must not flag these copy differences.

## D-010 — S00 closed; VPS agent env moves to S03

**Gap.** S01 depends on S00 being Done. S00 Done-when 3 still lacks the VPS agent's env file (`/etc/dxt-agent/env`), which can only be written when the agent is installed — S03's job. Every Vercel and Supabase variable is set.

**Decision.** Mark S00 Done. The VPS env file becomes an S03 Done-when line.

**Why.** Everything S01 needs from S00 (Supabase projects, OAuth client, company domain, access list) is in place; keeping S00 open would block the plan on work that belongs to S03.

**Impact.** Plan S00 Status and Notes, S03 Done-when.

## D-009 — CEO answers to the decisions memo (5 Oct 2026)

**Gap.** The spec and the Escalation board tag the Tier 1 L2 CEO page and Twilio voice "Proposal · pending CEO", and `CLAUDE.md` said both are built behind config, off by default, until the CEO decides. The CEO answered the decisions memo on 5 Oct 2026 (recorded in PRD §13).

**Decision.**
- Tier 1 DOWN with no acknowledgement pages the CEO at L2 (+30 min, @mention + email) and sends the L3 FYI (+60 min). The L2 step is **on by default**; the UI drops the "Proposal · pending CEO" tag and shows it as a normal level.
- Twilio voice is **not used for now**: built behind config, off ("Configured · off"); Tier 1 after hours is best effort over Chat and email. Who a call would reach (Q3) is decided only if voice is enabled.
- Interim staffing: Admin = Tao only until a second Admin joins (required before G1); on-call = Tle every week until a rotation of at least three exists (required before G2). Both are changed in the product (Users, On-call) without a new decision.

**Why.** The memo is the CEO's decision record; the spec's tag existed only because the decision was pending.

**Impact.** `CLAUDE.md`, plan S10 scope, `message-checker`; spec-checker must not flag the missing "pending CEO" tag on the Escalation board or in the Tier 1 ladder.

## D-008 — Private repository on GitHub Free: guard `main` ourselves

**Gap.** The repository was made private (28 Sep 2026) because `docs/prd.md` and the design spec name staff, clients and all 17 sites. On GitHub Free a private repository gets no rulesets, no auto-merge and no environments: the ruleset "main" is kept but not enforced, and "any configured protection rules or environment secrets will be ignored" (GitHub docs). So GitHub would accept a direct push to `main`, merge a PR whose CI failed, and hide the `production` environment's secret from `migrate-production`, which would then skip silently.

**Decision.** Stay on GitHub Free and enforce the same rules locally:
- Merge only with `pnpm pr:merge <number>` (`scripts/pr-merge.mjs`): it refuses unless CI `check` (and, since S01, `db`) succeeded on the PR's current head, the PR targets `main`, isn't a draft, has no conflicts and no requested changes, and it merges that exact commit (`--match-head-commit`). `gh pr merge` is denied to Claude Code, so every merge goes through it.
- No pushes to `main`: a `pre-push` hook in `.githooks` (installed by `pnpm install` through `prepare`) and deny rules in `.claude/settings.json`.
- `SUPABASE_PROD_DB_URL` becomes a **repository** secret; `migrate-production` drops `environment: production` and still runs only on pushes to `main`.

**Why.** It costs nothing and covers how this project works today: one maintainer, changes made through Claude Code and PRs. What it can't stop is someone deliberately bypassing the hook (`--no-verify`) or merging in the web UI.

**Also.** A repository secret is readable by any workflow on any branch of this repository, not just `main`. A PR's CI runs the PR's own workflow files, so a workflow edited on a branch could read the secret before anyone merges it. Guards: Claude Code asks before editing `.github/workflows/` or `.github/actions/` (`.claude/settings.json`), and `pnpm pr:merge` refuses a PR that changes those files unless it is re-run with `--workflow-changes-reviewed` after a human has read the change. Only `migrate-production` may reference the secret; never add `pull_request_target` workflows.

**Impact.** `docs/workflow.md` (lifecycle step 9, `main` protection, Environments), plan S00 (secret) and G1 (second Admin reviews every PR), `.github/workflows/ci.yml`, `.claude/settings.json`, `package.json` (`pr:merge`, `prepare`). Revisit when a second maintainer joins (G1) or anyone else gets write access: then GitHub Pro (~$4 / month) restores the ruleset, required reviews and environments.

## D-007 — Sign-in: Workspace-enforced 2-step and an email allowlist

**Found (28 Sep 2026, checked by the project owner).**
- Google Workspace already enforces 2-Step Verification: on the owner's company account the 2-Step Verification page says it is required and can't be turned off, with no control to turn it off. The owner has no Workspace admin rights, so the policy of other organisational units (OUs) wasn't seen.
- The Workspace organisation belongs to the parent group. The company domain is a secondary domain in it and the DxT domain is an alias, so Google SSO returns each person's primary company address — nobody signs in with the DxT domain.
- Google Cloud projects in that organisation can use an **Internal** OAuth consent screen (an existing project of the owner's already does), and the owner can create the OAuth client without IT.

**Conflict.** PRD §3, §9 and §12 (test 12) and spec §15.2, §16.6–7 (with the Login, Users and Security boards) have the app read each person's 2-step status and, from Mon 5 Oct, let people without it only view and acknowledge. Reading that status needs the Admin SDK Directory API (`isEnrolledIn2Sv`) through a service account with domain-wide delegation, which only a Workspace super admin can grant (plan Q6); Q1 asked what the date meant. Separately, "company domain only" admits every employee of the company — and, through an Internal client, anyone in the group's organisation — as a Viewer of client sites and incidents.

**Decision.**
- **2-step:** rely on Workspace enforcement. No Directory API, no service account, no required date, no "view + acknowledge only" state, no 2-step column or lock anywhere in the UI.
- **Self-check instead of a lock:** everyone given a role confirms on their own Google Account → 2-Step Verification page that it is required and can't be turned off — at S00 for the first people, then as a step of every invite. Anyone whose page lets them turn it off gets no role until IT fixes their OU.
- **Three filters on sign-in:**
  1. The Google OAuth client is **Internal** — only accounts of the Workspace organisation reach the consent screen.
  2. The `before_user_created` hook requires the email domain in `private.allowed_email_domains` (first filter, migration 0002) **and** the exact address in a new `private.allowed_emails (email, role)` — the allowlist. An address that isn't on it can't create an account. Addresses are stored lower-case (a `check (email = lower(email))` constraint) and the hook compares `lower()` of the signed-in address, so capitals never lock anyone out.
  3. RLS: a signed-in user without an active profile and role reads nothing.
- **The allowlist row is the invite:** on first sign-in the profile is created with the allowlisted role. Until the Users screen (S16) an Admin maintains the allowlist with SQL per environment. Only a template with placeholders is committed — real addresses live only in each database (the repository is private since D-008, but personal data still stays out of git).
- **Invite the primary address, never an alias.** Google returns each person's primary address, so an allowlist row with a DxT alias would never match and that person couldn't sign in, with no obvious reason. The invite (SQL template now, Users screen later) says "the person's primary Google address — not a DxT alias", and an allowlist row whose domain isn't in `private.allowed_email_domains` is refused (the alias domain is never there). The hook's refusal message tells people they're not on the access list and to ask an Admin, so a wrong address is found fast.
- **The web proxy keeps the domain check only** (`isAllowedEmail`): it runs on every request and must not query the database; the hook and RLS carry the allowlist. Removing someone = delete their allowlist row, ban their auth user and sign them out everywhere (S16 Deactivate; SQL until then).
- Another domain (for example a colleague whose primary address is on the group's domain) is allowed by adding a row to `private.allowed_email_domains` and to `ALLOWED_EMAIL_DOMAIN`, which takes a comma-separated list since 7 Oct 2026 (`eqho.com,omg-group.asia`; with several, Google's account chooser isn't narrowed to one domain) — the allowlist still decides who gets in.

**Why.**
- Workspace enforcement stops an account at Google's front door, which is stronger than a lock inside the app, and it can't drift from what Google actually enforces.
- It needs no super admin, closes Q1 and Q6, and removes the largest part of S16.
- A domain-only check would expose client sites and incidents to the whole company and group. The allowlist keeps access to the people the Admin chose, with their role decided up front.
- Keeping the allowlist out of the proxy keeps every page request free of a database round trip; the hook blocks new accounts and RLS blocks old ones.

**Impact.**
- Plan: S00 (Internal consent screen, initial access list, 2-step self-check — Done-when 9), S01 (allowlist table, hook, profile-from-allowlist, Done-when 1, test T12 moves here), S16 (renamed "Users & access", no 2-step status or lock, L → M), G1 (second Admin's 2-step confirmed by self-check), Q1 and Q6 closed, T12 reworded.
- PRD §3 Login bullet, §9 Security row and §12 test 12 updated in the Claude Doc (rev 148; the §7 Acknowledge note "people without 2-step can always Ack" is removed too) and `docs/prd.md`.
- Spec §13 (the "require 2-step for all" confirm), §15.2, §16.6 ("Locked for anyone in the 2-step acknowledge-only state"), §16.7, the §18 topic "Sign in & 2-step", and the 2-step parts of the Login, MLogin, Users and Security boards ("Off · needed from 5 Oct", required-date control, lock banners) no longer apply. The spec and canvas are left as they are; this decision overrides them and spec-checker must not flag their absence.
- Revisit if Workspace ever stops enforcing 2-step for any OU, or DxT gets its own Workspace.

## D-006 — Staging is a second Vercel project

**Gap.** The workflow used the slice branch's preview deployment as staging, but Vercel Cron only calls a project's **production** deployment. On a preview there are no probes, no engine and no notifier, so every "on staging" Done-when line from S02a on could not be checked.

**Decision.** A second Vercel project, `dxt-monitor-staging`, on the same repository and root `apps/web`, with production branch `staging`. Its env points at the staging Supabase project (D-005), the staging Chat space and its own secrets. A slice is verified by pushing its branch onto `staging`; after the PR merges, `staging` is reset to `main`. Ignored Build Step keeps each project to its own branches. The production project's PR previews stay, for looking at UI.

**Why.** Cron, region pinning and function limits behave exactly as in production, at no extra cost on the Pro team. The every-minute crons also keep the free staging database from pausing.

**Also.** Migrations reach the staging database from the slice branch through `pnpm db:push:staging` (rebuilt with `pnpm db:reset:staging` when it drifts); production only through the CI job `migrate-production` on merged `main`. No one uses `supabase link`: the staging scripts take an explicit connection string and refuse the production project ref, so a forgotten link can't send a push or reset to production. Google sign-in works per environment because the OAuth client lists both Supabase callbacks and each Supabase project allowlists its own app URLs (staging also the PR-preview pattern).

**Impact.** Plan S00 (second project, build filters, OAuth / redirect URLs, Done-when 6–7), S01 Done-when 1 and S02a / S02b Done-when; `docs/workflow.md` lifecycle and Environments. `vercel.json` needs no change — both projects read the same crons and function regions.

## D-005 — Backups without PITR; staging in a free organisation

**Conflict.** PRD §9 (Backup & DR) asks for "Daily DB backup + Point-in-time recovery; restore drill ทุกไตรมาส". PRD §13 caps infrastructure at $60 / month (Supabase ~$10 of it). Supabase's PITR add-on costs about $100 / month for 7 days of recovery (and needs a larger compute size) — on its own it breaks the cap. A staging project in the same Pro organisation adds another ~$10 compute. Re-check both prices on Supabase's pricing page in S00.

**Decision.**
- Drop PITR. Use the daily backups included with Supabase Pro (7-day retention); the quarterly restore drill restores the latest daily backup into a scratch project (S19).
- Put the staging project in a separate **free** Supabase organisation. Free projects pause after a week without activity; the staging crons (D-006) hit it every minute, so it stays awake while staging is deployed.

**Why.** The worst realistic loss is up to a day of monitoring data: some check results, rollups and incident events. Nothing the product exists to protect is lost — client sites keep running, alerts for new failures resume as soon as the database is back, and uptime reports lose at most a day of history. That doesn't justify spending more than the whole infrastructure budget. Config (sites, monitors, escalation, users) changes rarely and is also in the audit log, so a day-old backup restores it almost entirely.

**Impact.** PRD §9 Backup & DR row updated in the Claude Doc and `docs/prd.md`; plan S00 (accounts, budget) and S19 (restore drill) updated. Revisit if the product becomes a paid managed-monitoring service with contractual uptime history.

## D-004 — Relapse inside an open incident

**Gap.** PRD §7 says one incident = one Chat thread, and flapping (≥ 3 status changes in 30 min) is merged into one incident tagged "flapping" with a single recovery summary after 15 min continuously OK. Neither the PRD nor the spec says what state an incident takes when its site fails again while the incident is in Monitoring or Needs root cause (INC-0133 VOCA dropped 4 times in 52 min).

**Decision.**
- While an incident is open (any state before Resolved), a new PROBLEM/DOWN on the same site joins that incident — no new incident, no new thread. A DOWN relapse on a PROBLEM incident raises its severity to DOWN.
- State on relapse: back to **Acknowledged** if someone had acknowledged it, otherwise back to **Unacked** (or **Escalated · Lx** if a level had fired). The relapse is a timeline event and a thread reply (`DOWN · <site> · down again`), mentioning only whoever is currently expected to act.
- Escalation keeps its **original clock** from the first "Confirmed down"; levels that already fired don't fire again, the next pending one keeps its time. The client-update track and incident duration also keep counting from the first failed check.
- The 3rd change within 30 min tags the incident `is_flapping`; from then on RECOVERED replies are suppressed until 15 min continuously OK, then one summary.

**Why.** Matches the PRD's one-thread rule, doesn't reset anyone's escalation because a site flickered, and reproduces the VOCA sample (one incident, "flapped ×4", 41 min down, acked once). Implemented in S04 (PROBLEM triggers, flapping & status rules) of `docs/implementation-plan.md`.

## D-003 — PROBLEM lifecycle passes through recovery states

**Conflict.** Spec §15.4 lists DOWN as Unacked → Escalated → Acknowledged → Monitoring → Needs root cause → Resolved → In review → Closed, and PROBLEM as "Unacked/Escalated → Acknowledged → Resolved (ends there; no Closed)". The same section says "Resolve needs 3 conditions everywhere: OK for 2 rounds, client update, root cause written."

**Decision.** PROBLEM uses the same states up to Resolved — including Monitoring (first OK round) and Needs root cause (after 2 OK rounds with no root cause) — and never enters In review or Closed. The only shortcut is the < 5 min unacknowledged auto-resolve (spec §16.1).

**Why.** "Resolve needs 3 conditions everywhere" can only hold if a PROBLEM also waits for 2 OK rounds and a root cause, which are exactly Monitoring and Needs root cause. The short PROBLEM line exists to say "no review, no Closed". `transition()` in `packages/engine/src/lifecycle.ts` already behaves this way.

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

**Impact.** `decideVerification()` in `packages/engine/src/round.ts` (the `blockedForMin` parameter and the 10-min constant are removed). The Claude Doc PRD was updated on 28 Sep 2026 (rev 142): §5 flowchart node, the browser-verification bullet and the go-live test-plan line now say PROBLEM (unverified) at once; `docs/prd.md` mirrors it.
