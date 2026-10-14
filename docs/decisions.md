# Decision log

Decisions that settle a conflict between the PRD and the design spec, a conflict inside the PRD (e.g. a requirement against the budget), or fill a gap in either. Newest first. Code that implements a decision cites its ID.

| ID | Date | Decision | Supersedes |
|---|---|---|---|
| D-044 | 14 Oct 2026 | Spec §22.5 "View only on phones" covers the policy and settings editors only (Escalation, Alert channels, Users & roles, Security, Organisation, API & webhooks, Synthetic checks). Add site, Edit site and Edit monitors stay editable on phones, and Site detail's phone ⋯ offers Edit site with no "View only on phones" line | Spec §22.5 list (Edit monitors, Add site, Edit site); §25.2 and the MSite caption; D-043 point 2 |
| D-043 | 14 Oct 2026 | Site detail's ⋯ menu (spec §25): on phones the ⋯ sits at the end of the breadcrumb row above the title, not in the top bar, because the phone top bar is the shared brand + avatar bar (D-018) and doesn't carry the site name; on phones the menu shows Visit site only until Add site, Edit site and Edit monitors are view only on phones (§22.5), then Edit site joins it with "View only on phones" | MSite board: ⋯ in the top bar between the site name and the avatar; §25.2 Edit site on phones |
| D-042 | 13 Oct 2026 | S09c's open rules: crawler views check forbidden words and the redirect allowlist, not `must_contain`; per view the latest usable fetch before the round's end raises a PROBLEM for 65 min, and an open one holds until a clean usable fetch (no data never clears it, for up to a day); a redirect off the site is usable whatever the target answers, a body read that broke off clean is not; the crawler's User-Agent and Referer are fixed and go on every hop, custom headers stay same-site; `DEFACEMENT_ALERTS` (default off) gates shared-list and crawler alerts in the runner, a site's own words always alert; the shared list matches case-insensitively with whitespace collapsed; the page's charset is honoured | — (fills gaps in D-041) |
| D-041 | 13 Oct 2026 | v1 defacement detection = keywords (a missing `must_contain`, a forbidden word) and the redirect allowlist, as built in S04a, plus slice **S09c** before G1 (a shared forbidden-word list on every monitor, and a Googlebot view of each home page every 30 min against cloaked SEO spam) and **S09d** (a fingerprint of title, description, h1, canonical and external script / link domains against an accepted baseline; records 2 weeks before it alerts) | D-025 "no shared spam list until S17" (the list ships in code now; S17 makes it editable) |
| D-040 | 13 Oct 2026 | The probe's SSRF guard runs inside the connection: one DNS lookup per hop, every address checked, and the connection goes to that address (no rebinding gap); `fetch` and `Agent` from `undici@7.30.0`; the process's DNS order kept (IPv4 first on the VPS); `assertPublicTarget` stays for saving a site and the verifier | `target.ts` "pinning the connection to the checked address is a follow-up" |
| D-039 | 12 Oct 2026 | A location that alone is slow on most sites in a minute (compared on the sites another location also timed) is no evidence for slow that minute — the Bangkok VPS slowing down no longer makes a behind-WAF site slow; an open slow PROBLEM holds meanwhile. D-038 amended: a no-data round ends a slow streak, the control check is judged at the round's time and the Akamai control only for Akamai sites, the flapping summary emails the owner who was emailed about the incident | D-022 "slow = p50 over the threshold 3 rounds in a row" (one location's times); D-038 "flapping summary only to whoever was emailed about that drop" |
| D-038 | 12 Oct 2026 | Production hotfix: on a behind-WAF site a round with nobody left to vote is PROBLEM (unverified, control failed) only once the BKK control check has failed in 3 probe minutes in a row (any batch of the minute); before that it is no data and the status holds. A PROBLEM drop after a relapse emails its recovery (RECOVERED, the flapping summary) only to whoever was emailed about that drop, so normally Chat only; the first drop and any DOWN drop still email | D-027 "nothing left and the control down → PROBLEM at once"; S02b "RECOVERED to everyone already emailed" for PROBLEM relapses |
| D-037 | 12 Oct 2026 (amended 12 Oct) | S09b maintenance messages (spec §24; amended to the redrawn boards, §24.12–17 — Admins emailed only while it is a request, the approver on didn’t start, one MUTED reply naming owner and backup, one pending action at a time): no Chat DMs until the Chat app exists — each "direct message" is a reply in the window's own Alerts Space thread that @mentions the person, with the board's DM card; action lines stay without mentions; notifications get a third subject (`maintenance_window_id`, thread `mw-<id>`, one mail thread per window); window Chat rows get no email fallback; every maintenance action except create / mute is held 10 s with Undo (the action applies at once, Undo restores the window from a snapshot and appends a log line); the engine waits out that Undo before a mute's late alert; reminders 12 h (Chat + email) and 1 h (Chat) before a waiting request's start, stamped once each; where the board's kind-word table and its drawn lines differ, the drawn lines win | D-036 "no message announces a pending approval"; plan S09b size S |
| D-036 | 11 Oct 2026 | S09 maintenance and mute: one `maintenance_windows` table for both kinds, written only through RPCs that write their audit row in the same transaction (a signed-in session can no longer write the mute fields directly); a mute starts now, lasts at most 24 h and keeps `sites.muted_until` in step; a window can't start now on a DOWN site or one with an open incident, over 24 h waits for an Admin (an Admin's own is approved) and doesn't start unapproved; inside a window with nothing open no incident opens and the site shows Maintenance, and one opens on the first round after it if still failing; a window that starts while an incident is open hides nothing (not excluded from uptime, the incident keeps alerting); a mute holds back new alerts only — RECOVERED still closes a thread that alerted — and when it ends with a silent incident open, that incident's first alert posts then and its ladder counts from that moment; `/maintenance` from its Claude Design board (spec §23, amended the same day: windows don't start on a DOWN site, decline / withdraw, messages in S09b) | D-012 (Responders write the mute fields directly), D-032 (a muted row's Since "—"), D-033 (Resolve's Uptime box later) |
| D-035 | 10 Oct 2026 | S08 Done-when 2 (an unacknowledged DOWN posts `ESCALATED · L1` @mentioning the backup with "Tao FYI" at +15 min) is proved on staging with two fixture people Tao seeds (`supabase/staging/escalation-people.sql`: an owner without a Chat id, a backup with Tao's own Chat id), since staging has one real person and nobody else can sign up (D-007). Amended the same day: first "on production after the merge" | — |
| D-034 | 10 Oct 2026 | S08 escalation: four policies as the Escalation board (Tier 1 / Tier 2 / Tier 3 DOWN, PROBLEM · all tiers) with role tokens; L0 = the owner at every hour until on-call (S10); L1 = the step's people minus anyone already notified; PROBLEM L0 emails the owner and L1 (+60) is the backup only; the clock starts at Confirmed down, Tier 2–3 count only minutes inside response hours (company holidays skipped); timers run only while Unacked / Escalated; a relapse keeps the clock and fired levels, a PROBLEM raised to DOWN starts the DOWN ladder afresh; open incidents keep the policy they opened with; reminders every 15 / 60 min (Chat only, skipped on a step's minute, "STILL DOWN" / "STILL PROBLEM"); a Tier 2–3 PROBLEM outside hours is held until 09:00 and cancelled if it clears or is acked first; L1 escalation copy returns (no CEO / L2 / L3 / on-call until S10); Thai public holidays seeded; phones get the view-only MEscalation (§22) | Escalation board PROBLEM seed (no L0 email, L1 backup only — kept) vs PRD §8 "Backup + Tao" for PROBLEM L1; D-013 / D-016 / D-032 / D-033 "no escalation copy until S08 / S10" (for L1); D-022 "PROBLEM at any hour" |
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

## D-044 — The site editors stay editable on phones

**Conflict.** Spec §22.5 makes "complex editors" view only on phones, with the line "View only on phones. Admins change policies on a larger screen." Its list includes Edit monitors and Add site, and since 14 Oct Edit site (§25.2). Add site and Edit monitors shipped in S05 on 8 Oct, before §22.5 existed (10 Oct), and work at 390 px: `layout-consistency` measures their 44 px targets and finds no sideways scroll.

**Decision (14 Oct 2026, Tao).** §22.5 covers the policy and settings editors: Escalation, Alert channels & routing, Users & roles, Security, Organisation, API & webhooks and Synthetic checks. Add site, Edit site and Edit monitors stay full editors on every width. Site detail's phone ⋯ offers Edit site to an Admin, like the desktop menu, without the "View only on phones" line. This supersedes D-043 point 2. The §22.5 follow-up carried under S06 is dropped.

**Why.**
- The rule's own sentence is about policies. The site forms are in the list by analogy.
- The phone uses are real: an Admin away from a desk changes an owner or presses Stop monitoring. Their destructive actions already confirm first (§13).
- Mute and maintenance remain the phone's quick way to stop alerts.
- A read-only view of each form would add three screens with no board.

**Impact.**
- `more-menu.tsx`: the phone menu gets Edit site.
- The spec's §22.5 list, §25.2 and the MSite caption still say otherwise. This decision outranks them until Claude Design updates the wording.

## D-043 — Site detail's ⋯ menu on phones: beside the title, Visit site only for now

**Conflict.** Spec §25 and the MSite board put the ⋯ button in the phone top bar, between the site name and the avatar, with Edit site in its menu ("View only on phones", §22.5). The build's phone top bar is the shared bar every page uses: the brand and the avatar, after a back arrow on some pages (D-018). It doesn't show the site name, and Site detail shows the name as its page title. The Edit site page has no view-only mode on phones yet: it shows the full form. Add site and Edit monitors don't follow §22.5 either. They were built in S05 (8 Oct), and §22.5 was added on 10 Oct.

**Decision (14 Oct 2026, Tao).**
- On phones the ⋯ (44 × 44 px, borderless as MSite draws it) sits at the end of the breadcrumb row, right above the title and outside the heading, so the heading stays the site name. It is not in the header actions row, where it would land after Mute, Maintenance and Edit monitors, far from the title.
- On phones the menu has **Visit site** only. Edit site stays out of it until one follow-up makes Add site, Edit site and Edit monitors view only on phones (§22.5). Then Edit site joins the phone menu with the line "View only on phones" (§25.2).
- From md up the board is followed as drawn: ⋯ last in the header actions, Edit site (Admin) and Visit site. Two cases the board doesn't draw: anyone without header actions (a Viewer, AM or CEO, a Responder on a site they don't own or back up, a non-Admin on a Draft), so the breadcrumb row's ⋯ (Visit site) serves every width and no empty actions row is left on phones; a Draft's menu has no Edit site, because its Finish setup button already opens that page.

**Why.** Putting a page's own button in the shared top bar needs a slot that each page fills. That is a change to the app shell for one button. Right above the title is where the board's spec note puts it ("next to the title"). A phone link to an editor that isn't view only would break §22.5 more than leaving the link out.

## D-042 — S09c's open rules: what a crawler view checks, how long it counts, and the production gate

**Gap.** D-041 and S09c left five things open: whether a crawler view checks `must_contain` ("the same checks"), what an open PROBLEM does when the next crawler fetch is refused, how the crawler's identity survives a redirect (the probe sends extra headers to the monitor's own origin only), how "alerts off on production" works without silencing what already alerts, and how Thai text is read on a page that isn't UTF-8.

**Decision (13 Oct 2026; item 1 Tao's, the rest Claude's recommendation, approved with the S09c plan).**

1. **A crawler view checks forbidden words — the shared list and the site's own `must_not_contain` — and the redirect allowlist. Not `must_contain`.** Googlebot is often served prerendered or AMP markup without the brand text; that is not defacement, and the per-minute probe already checks `must_contain`.
2. **Per view, a round uses the latest *usable* fetch made before the round ended** (the runner reads the two newest per view from the last day, so a round judged late still sees the one before a newer fetch). A hit in a fetch up to 65 min old raises a PROBLEM (two 30-min runs plus slack, `CRAWLER_FRESH_MS`). An older hit raises nothing new, but keeps an open PROBLEM incident that hasn't recovered from recovering — whatever its trigger now (slow or blocked may have taken over), also on a verifier-"loaded" round — until a clean usable fetch of that view replaces it; a DOWN drop still recovers when the home page answers (D-023) — no data is no evidence the page is clean (code review, 13 Oct). Usable = the page answered 2xx / 3xx, passed, and was read to its end or the 3 MB cap (or a hit was already found) — a tail that broke off clean has no say about the tail; or the redirects ended outside the site's allowlist (the engine's `isAllowedHost`: its own host, a subdomain such as `m.`, an allowlisted domain), whatever that host answered (the hop is the evidence: gambling hosts refuse datacenter IPs). Anything else is no data (D-041) and never hides an older usable fetch, so a WAF 403 after a hit keeps the PROBLEM. A dead crawler holds an open PROBLEM for up to a day; its Healthchecks check says so. The browser verifier's "loaded" round still counts the crawler's hits. One fetch is enough; the problem starts at that fetch, or at the round after the last one judged if that is later (a fetch made while the site was down must not start a PROBLEM AGAIN before its recovery).
3. **The crawler's User-Agent and Referer are fixed constants (`CRAWLER_CLIENTS`) and go on every redirect hop** — cloaking often sits behind an apex → www hop. The probe secret and the monitor's custom headers stay on the monitor's own origin, as before; every hop passes the SSRF guard (D-040).
4. **`DEFACEMENT_ALERTS` (`on` | `off`, default `off`) gates the new alerts in the engine runner**, not in `@dxt/engine`. Off: the runner takes a shared-list entry out of a check's found words (unless it is also the site's own word) and leaves the crawler facts out, and logs both in the run summary (`defacementHeld`). A site's own `must_not_contain` words alert either way, as since S04a. Staging is `on`; production stays `off` until S09c's Done-when 3 (the replay and a week without a false positive), then a close-out PR turns it on.
5. **The shared matcher is case-insensitive and treats runs of whitespace (and `&nbsp;`) as one space**, reporting the list's own entry. `must_not_contain` keeps D-022's case-sensitive match on the 256 KB sample; the crawler applies it to the whole body.
6. **The probe decodes a page with its declared charset** (`windows-874` / TIS-620 Thai pages), falling back to UTF-8 for a missing or unknown label. Otherwise no Thai entry could ever match such a page.
7. **Crawler problems belong to the home page (primary monitor).** Their precedence: the round's own keyword, the round's own redirect, then the crawler's forbidden word, then its redirect, then slow and regional. The cause names the view in place of the locations — `Found “บาคาร่า” on / (as Googlebot)`, `/ → casino.example · not in this site’s allowlist (from Google search)` — only when the round itself didn't see it.

**Wording.** The redirect cause keeps today's `/ → host · not in this site’s allowlist` without the board's `302 →` hop: the probe stores only where the redirects ended, not each hop's status, and the host is what the reader acts on (message-checker, 13 Oct; Tao: no change).

**Not in v1.** The list's "injected-link markers" (hidden-link CSS and the like): too generic to keep false alarms out; S09d's fingerprint covers injected scripts and domains.

**Impact.** S09c builds it: `@dxt/shared` forbidden.ts, `@dxt/probe` `client` / `scanWholeBody` / charset, `crawler_checks` + `engine_crawler_checks`, the sin1 crawler cron, `crawlerIssue` in the engine, the runner gate, the notifier wording and four test-target modes.

## D-041 — Defacement detection in v1: shared forbidden words and a crawler view before G1; page-change detection is P2

**Gap.** PRD §2 promises "content-change/defacement detection" in v1. §5 defines it as a missing must-contain keyword, a forbidden keyword ("Database error", "Index of /", gambling or spam words) and a redirect off the site's allowlist. S04a built all three per monitor (D-022), but D-025 moved the shared gambling / spam list to S17, which is after G1. Until then a site defaced with gambling links is caught only if an Admin typed those words into that site's `must_not_contain`. A cloaked SEO-spam hack, which serves spam only to search engines, isn't seen at all: the probe's User-Agent is `DxT-Monitor/1.0`. "Content-change" can also be read as "the page differs from before", which no slice covered.

**Decision (Tao, 13 Oct 2026).**

- **S09c (size M — first S, revised after review — before G1):** a reviewed shared forbidden-word list in `@dxt/shared`. It holds gambling, slot-spam, adult and pharma words in Thai and English, plus injected-link markers, and applies to every monitor on top of its own `must_not_contain`, in the same 256 KB sample. Each live site's home page is also fetched as Googlebot every 30 min from SIN, with the same checks. A hit is PROBLEM · Keyword (D-022), and the cause names the word and "(as Googlebot)" when only that view had it.
- **S17** makes the list Admin-editable. Until then it changes by PR.
- **S09d (size M, Phase 1 · P1, Tao: "include 2 and 3"):** "the page changed from its last version". To avoid false alarms, it checks a fingerprint of what a defacer changes rather than the whole page. The fingerprint holds:
  - title, meta description and robots;
  - the canonical URL;
  - the first h1;
  - the external domains the page links to or loads scripts / iframes from.

  It is compared with an accepted baseline. A new script or iframe domain is PROBLEM `content_change` at once; any other change is PROBLEM after holding 3 rounds. An Admin accepts a new baseline, which is audited.
  - Whole-page diffs stay out: most pages change on their own (news, prices, banners).
  - It records for two weeks before it alerts, so it doesn't block G1.
  - Its rows on the incident and site pages need a board or Tao's OK first.

- **Tao's review, the same day:**
  1. **G1 doesn't wait a week.** G1 depends on S09c's Done-when 1, 2 and 4. The production replay and the week without a false positive are collected after G1, as S05's production line was. Until then the shared list's alerts stay off on production; findings are logged.
  2. **A crawler fetch that isn't a 2xx/3xx answer is no data, never PROBLEM.** Akamai and Cloudflare check that "Googlebot" is real and refuse a fake one from Vercel's IPs (Bangkok Airways sits behind Akamai).
  3. **Phrases, not single words.** "slot online", "สล็อต", "บาคาร่า", "แทงบอล" — never "slot", which matches "time slot" on booking pages. Thai has no spaces, so each Thai entry is checked against normal pages for substring hits. A test covers "time slot".
  4. **A second crawler fetch**, as a mobile browser with `Referer: https://www.google.com/`, with the keyword and redirect checks. Thai gambling hacks redirect visitors who come from Google search rather than looking at the User-Agent.
  5. **Crawler fetches read the whole body** (up to 3 MB, as D-026), and S09d's fingerprint comes from a whole-body fetch in the same 30-min run (the per-minute probe can't read a page's tail without downloading it all, so not "first and last 128 KB"). Injected links and scripts usually sit at the end of `<body>`, past the 256 KB sample.
  6. **S09d states its blind spot:** a script added by JavaScript at runtime isn't in the HTML. Only the browser verifier renders pages, and only for blocked rounds.
  7. **Not in v1 (P2 backlog), by decision:** a changed DNS / NS record, and blacklist status (Google Safe Browsing / Web Risk). Before using Safe Browsing, check its terms: the free API is for non-commercial use, and commercial use goes through Web Risk. Added to PRD §2's non-goals.

**Impact.** Plan: new slices S09c (G1 depends on its Done-when 1, 2, 4) and S09d; S17's scope names the editable list. PRD §2 non-goals name the P2 items. Supersedes D-025 item 3's "no shared list until S17" for the list itself.

## D-040 — The probe connects to the address its SSRF guard checked

**Gap.** The probe's SSRF guard (`assertPublicTarget`) resolved a host and checked every address, then `fetch` resolved it again to connect: DNS could answer differently in between (rebinding — a public address for the check, a private one for the connection), and each hop cost two `getaddrinfo`, which queued on the VPS's thread pool (D-039 root cause). `target.ts` named pinning as the follow-up.

**Decision (Tao, 13 Oct 2026).**

- The guard runs inside the connection: `runHttpCheck` fetches through an undici `Agent` whose connect `lookup` (`publicOnlyLookup`) resolves once, refuses unless every address is public (`TargetNotAllowedError`, the same words as before), and hands that address to the socket. Scheme, port and an IP-literal host are still checked before each hop (`assertPublicUrl`); redirects stay manual, each hop checked. One lookup per hop instead of two. TLS and SNI still use the hostname.
- `fetch` and `Agent` come from the same undici (`undici@7.30.0`, a dependency of `@dxt/probe`): Node 22's built-in fetch is undici 6, and a newer Agent doesn't fit it. The VPS bundle inlines it; Vercel transpiles `@dxt/probe`.
- The lookup keeps the process's DNS order (no `verbatim`): the VPS runs with `--dns-result-order=ipv4first` — it has no IPv6 route — and the connection now goes to the address the lookup returns.
- `assertPublicTarget` (resolve and check, no connection) stays for saving a site and for the browser verifier, whose page requests systemd's `IPAddressDeny` already confines.
- `UV_THREADPOOL_SIZE=16` stays.
- **Reviews (13 Oct).**
  - The connect phase (DNS included) has no timeout of its own (`connect.timeout: 0`). The check's signal bounds it, so a slow lookup ends as 'Timeout' at the monitor's timeout, as before, not at undici's 10 s default.
  - The lookup answers in the family Node asks for, after checking every address.
  - Both guards share one rule (`refused`).
  - The shared Agents are made on first use.
  - A DNS failure now reads as its code (`ENOTFOUND`), which the messages word as "DNS error". Before, it was raw "getaddrinfo ENOTFOUND host" text.
  - An https test pins `pinned.test` to 127.0.0.1 with a test CA and shows the certificate is still checked against the hostname.
  - Security: the agent's ESM bundle inlines undici (CommonJS), which crashed on start without a real `require`. `tsup.config.ts` gives it one (`createRequire` banner), and `apps/vps-agent/src/bundle.test.ts` builds and starts the bundle.
  - `::/96` (IPv4-compatible) and `2002::/16` (6to4) are blocked too, in the guard and the unit's `IPAddressDeny`.

**Impact.** `packages/probe` (`target.ts`, `http-check.ts`, tests); no API, schema or engine change. Both probes (Vercel SIN / TYO, the VPS) and the Add-site Test check.

## D-039 — A location slow on most sites in a minute is no evidence for slow

**Conflict.** Production, 12 Oct 2026, after D-038: Bangkok Airways TW / CN opened 7 slow PROBLEMs in a few hours (INC-0004 … INC-0010), p50 3.1–3.4 s from BKK alone against the Tier 1 limit of 3 s, each auto-resolved 1–2 min later after @mentioning and emailing the owner. Behind the WAF only BKK votes (D-027), so one Bangkok time is the round's p50. At every minute those PROBLEMs counted, BKK was over the limit on most of the 11 live sites (medians 3–18 s; 10 of 10 at 16:15 Bangkok) while SIN's median stayed ~0.6 s: the VPS's own network was slow, not the sites. On a site every location votes on, the median of 3 already hid it. Before D-038 these sites sat in PROBLEM (unverified) half the time, which hid the slow rule too.

**Decision (Tao, 12 Oct 2026 — "fix the rule", not a per-site limit or a held alert).**

- Per probe minute, a location is **slow** when it is the **only** location over each site's own slow limit on more than half of the 3+ sites it timed (primary scheduled checks that passed), **and on the 3+ sites another location also timed that minute it was slow on more than half while that location was slow on at most half** (`slowLocationsByMinute`). Comparing the same sites means a site only it can reach (behind a WAF) accuses nobody (engine review M1); two locations slow, or everyone, is left alone — the region or the sites may really be slow (the sole outlier, as spec §15.3's faulty location; engine review M2). Same thresholds: 3 sites, more than half.
- Its response times that minute are no evidence for the slow rule: the round's p50 leaves them out; with nothing left the slow streak holds (`nextSlowRounds` with no evidence) and **an open slow PROBLEM holds too** — no RECOVERED, no auto-resolve (engine review H1).
- Only the slow rule reads it: the page still answered, so keyword, redirect, key-page status, regional and DOWN are judged as before. A minute where BKK failed most sites is already no data (the faulty-location rule).
- Replayed on 12 Oct's production checks (home pages, BKK, with the faulty-location rule): the old rule opens 7 slow PROBLEMs on BA TW / CN, this one none; BKK was a slow location in 27 of 1,048 minutes.
- **Amended 12 Oct 2026 evening (Tao, after INC-0011 / INC-0012):** a location is judged slow at **3 s** on every site (`SLOW_LOCATION_MS`, or a site's own lower limit), not each site's own limit. At 20:06 and 20:09 BKK was 3.1–5.6 s on most sites while SIN was ~0.5 s, but the five Tier 2–3 sites (limit 5 s) didn't count, so the minutes weren't left out and both BA route-network key pages opened slow PROBLEMs that cleared 3 min later. The site's own limit still decides its PROBLEM. Since the deploy at 18:10 BKK was a slow location in 40 of 130 minutes (5 by the old count).
- **Root cause (12 Oct 2026 night, measured on the VPS):** not the network. BKK's slow minutes are the multiples of 3 — Tier 2 rounds, 38–39 checks at once instead of 20 — and all the extra time is TTFB (body ~40 ms). Every check does two `getaddrinfo` (the SSRF guard's and fetch's) on libuv's thread pool, 4 threads by default, and the response time includes them: at 39 checks DNS took 308 ms (35 ms alone) and BA TW's TTFB 1.05–1.7 s; with 16 threads 91 ms and 0.46–0.61 s. The agent's unit now sets `UV_THREADPOOL_SIZE=16`. The slow-location rule stays as the safety net. Follow-up: resolve once in the SSRF guard and connect to that address (half the lookups, no DNS-rebinding gap) — `packages/probe`, its own PR with security review.
- **After #90 (13 Oct 2026):** with `UV_THREADPOOL_SIZE=16`, BKK was a slow location in 0 of the first 39 minutes (83 of 304 before) and BA TW from BKK is 0.47–0.75 s. The rule stays as a safety net for a VPS slowing down for another reason; its minutes are logged with each engine run (`slowLocations` in the summary, the last 3 min — runs overlap, so a minute can repeat).
- **Accepted (engine review, Low):** "Slow since" counts back `slowRounds − 1` intervals, held minutes included; the slow detail still names a left-out location; a location left out for slow has no Admin alert (logged instead, above); timeouts don't count as slow in the tally (a minute with most failing is the faulty-location rule's).
- **D-038 amended (code review of #83, 12 Oct; Tao: apply every finding):**
  - A D-038 no-data round (nobody left to vote, control not yet down) **ends a slow streak**: nobody measured that round, and "3 in a row" means 3 judged rounds. A round whose times are only left out by the slow-location rule holds the streak instead: the site answered, only its time is in doubt.
  - The control check is judged **at the round's own time**: its check and the recheck after it, up to 2 min from the round's start (`CONTROL_ROUND_SPAN_MS`). A round caught up late isn't judged by later minutes.
  - The Akamai control counts **only for a site behind Akamai**; another WAF site reads the generic control alone, as its rounds do.
  - **The flapping summary emails the owner whenever they were emailed about the incident** (migration `flap_summary_owner_email`), not only since the latest relapse. One summary per flapping run, so the owner's email thread doesn't end on the first PROBLEM. RECOVERED after a PROBLEM relapse stays Chat only.
- Copy: "from 1 location" (was "from 1 locations") on RECOVERED cards and emails (`formatLocations`).

**Impact.** `packages/engine` `slowLocationsByMinute` (`triggers.ts`), `SiteSnapshot.slowLocations` read by `judgeMonitor`, `SiteSnapshot.bkkControlDown` as a function of the round; the engine runner passes both; migration `flap_summary_owner_email`; `@dxt/shared` `formatLocations`; notifier RECOVERED copy.

## D-038 — A BKK control hiccup is no data; a PROBLEM relapse recovers in Chat only

**Conflict.** Production, 12 Oct 2026: two behind-WAF sites (Akamai blocks SIN and TYO, D-027) flipped between PROBLEM AGAIN and RECOVERED all day — one incident had ~100 cycles since 8 Oct, ~80 of them "BKK network check failed, not verified". D-027 makes a round with nobody left to vote and the VPS's control check down PROBLEM (unverified) at once, so every one-minute network hiccup on the VPS opened a drop and the next good round closed it. The PROBLEM AGAIN was a Chat reply, but each recovery emailed RECOVERED to everyone ever emailed about the incident (S02b), and the flapping summary went to the owner too: an owner got 26 RECOVERED and 24 summary emails for one incident. D-028 already treats the control check as broken only after 3 failing probe minutes (the Admin alert).

**Decision (Tao, 12 Oct 2026, hotfix).**

- **The control check counts as down only once it failed in 3 probe minutes in a row** (`bkkControlDown`): a minute counts as failing when any of its BKK batches failed the control — the scheduled check or the recheck, since a round is judged untrusted on either, so a passing batch can't hide a control failing every minute in the other (engine review H1, M-B); a minute where every batch passed ends it, even while the Admin alert is still open (H2). The alert decides only when no control was reported, or while it is open and the window holds no passing minute (sparse batches). The Admin alert keeps D-028's rule (a minute with any passing batch counts as passing), so it may stay quiet while sites already show PROBLEM (unverified) — it pages Admins and should not flap. Until then a WAF round with nobody left to vote is no data: the site keeps its status, a recovering incident keeps its OK-round count, nothing opens. After that it is PROBLEM (unverified, `control_failed`) as before. The same 3 minutes as a slow site.
- **A PROBLEM drop after a relapse emails its recovery only to whoever was emailed about that drop** — RECOVERED and the flapping summary; normally nobody (its PROBLEM AGAIN was a Chat reply, or nothing while muted), so Chat only; a fallback email for a failed PROBLEM AGAIN card or an escalation step's email that went out still gets its RECOVERED (review M1). The drop starts when its relapse was recorded (the `incident.relapsed` audit row's time — always written, and after the previous RECOVERED was queued; review M-A). The first drop of an incident and any DOWN drop still email RECOVERED to everyone already emailed.
- **Accepted (engine review):** a PROBLEM (unverified, `control_failed`) starts at the round it opens, not the first failing minute — no downtime is counted for a PROBLEM; a WAF DOWN whose recheck lands in a failing control minute is confirmed a round later (rule 2c still walks its start back); a round that is no data clears the site note until the next judged round; the D-023 key-page PROBLEM left on a DOWN incident recovers in Chat only.

**Impact.** `packages/engine` `bkkControlDown` (`control.ts`), `SiteSnapshot.bkkControlDown` + `judgeMonitor`; the engine runner passes it; `engine_recover_incident` (migration `problem_relapse_recovered_chat_only`). Amends D-027 (untrusted → PROBLEM only after 3 failing control minutes) and S02b's "RECOVERED to everyone already emailed".
**Follow-up (Tao, 12 Oct 2026): flapping runs fold on the incident timeline.** Three or more drops-and-recoveries in a row (each relapse, its recovery, their Chat / email lines and OK rounds, nothing else between) show as one line, "Flapped ×n between 13:15 and 23:46" with "PROBLEM again ×n, DOWN again ×n · each recovered · n events" and a Show / Hide button that opens every line under it (§16.11: nothing is dropped); a drop still open after the run stays its own line. Days are named when the run spans more than one. `timelineOf` / `collapseFlapping` in `features/incidents/model.ts`, `FlapRun`.
## D-037 — S09b maintenance messages

**Conflict.** Spec §24 (rev 4, 11 Oct) and the new ChatAlert / EmailAlert states draw direct messages (the request to every Admin, reminders, the asker's answer, STILL WAITING, NOT APPROVED, the MUTED line to the owner and backup), but an incoming webhook can only post into a Space and there is no Chat app (PRD: the Chat API is P2); §24.10 offers Space lines that @mention the person instead. §24.4 says the window's Space lines carry no @mentions. The notifications table knows only incidents and system alerts. §24.8 adds a 10 s Undo to every maintenance action, which the S09 RPCs don't have, and a person-ended mute can post its silenced incident's first alert before that Undo runs out. The kind-word table on ChatAlert has no REQUEST CHANGED row and shortens the MUTED and DIDN'T START lines the same board draws in full.

**Decision (S09b plan, approved by Tao 12 Oct 2026).**

- **"DMs" are Space replies with a mention.** Each DM text and card goes as a reply in the window's own thread in the Alerts Space, @mentioning the person (one line per person). Action lines in that thread stay plain (no mention, no card). When the DxT Monitor Chat app ships, the DM lines move to real DMs and the thread keeps only the action lines.
- **A third notification subject.** `notifications.maintenance_window_id` beside `incident_id` and `system_alert_id` (exactly one set); one Chat thread per window (`mw-<id>`) and one mail thread per window (`References <mw-<id>@…>`; subject `DxT Monitor · Maintenance request · <site> · <start>` for a window that began as a request, otherwise `<site> · Maintenance · <start>`). A failed window Chat line has no email fallback: the owner and backup already get the email.
- **Undo for approve, decline, end now, change end, cancel and withdraw** (maintenance and mute): the action applies at once and its messages are held 10 s, like Acknowledge; Undo restores the window from the snapshot the action saved, cancels the held messages, adds an "Undone" log line and writes `maintenance.undo` — the log and the audit trail are never rewritten. An Undo that would now overlap another window is refused. A mute ended by a person posts its silenced incident's first alert only once that Undo has run out.
- **Reminders** go 12 h (Chat + email) and 1 h (Chat only) before a waiting request's start, at most once each; a request made under 12 h before gets only the 1 h one, under 1 h none; an answer or a withdrawal stops them, an edit moves them.
- **Board copy:** where the kind-word table and the drawn lines differ, the drawn lines win (spec §0); the email board's two thread keys ('Maintenance · approval', 'Maintenance · owner & backup') stand for the spec table's "Thread › Maintenance".
- **Taken while building (12 Oct):** the Admins' request-thread copies of an answer, a change or a withdrawal (APPROVED · … by Tao 10:07, REQUEST CHANGED, REQUEST WITHDRAWN, NOT APPROVED · … Arm told) aren't posted again as mention replies — with no DMs they would repeat the action line just above them in the same thread; the request email thread still carries them. The request card and email leave out "the client status page shows Planned maintenance" until the status page exists (D-013). A mute that maintenance ended gets no line of its own (MAINTENANCE STARTED says it). DIDN'T START @mentions the approver in its thread line instead of a separate DM to them (§24.6), for the same reason. "Request sent to …" and "… gets a request now" name every active Admin. An undone action's log line shows no posting time and an "Undone … — nothing was posted" line follows it.
- **Reviews (security, db, 12 Oct):** an Undo must pass today's rules, not just the ones the action passed — a Responder's live maintenance stays within 24 h back to back with its neighbours, a maintenance running again needs a site that isn't DOWN, a mute running again can't sit inside maintenance; the engine leaves a window alone while an action's Undo is open; the held rows are locked before Undo checks and cancels them; a window with messages can't be deleted (`on delete restrict`, as incidents and system alerts).
- **Reviews round 2 (code, engine, message, spec-check, 12 Oct):** a late alert counts as sent once the card of the drop in progress went (a DOWN incident whose drop is a PROBLEM now, D-023), and one incident that can't post never holds back another; windows and mutes are for live sites only (a Draft stays deletable); DIDN'T START on an acknowledged incident says it stays open, and a PROBLEM is worded as one; MUTE ENDED says when a PROBLEM held for response hours posts; the held line carries the mute's day; Undo hands focus back to the row's section. **Accepted:** End mute's "L1 at …" counts from the mute's end, while the ladder counts from the alert (D-036), which the next engine run posts up to a minute later — so L1 can come up to a minute after the time shown.

**Impact.** S09b: a migration (the subject column, window reminder and Undo columns, message queueing in the S09 RPCs and `engine_log_windows`, `engine_window_reminders`, `undo_window_action`, Realtime for `maintenance_windows`), `packages/notifier` maintenance builders and the after-mute line, the notifier dispatch and facts, the engine runner, the maintenance UI's Undo and §24.9 copy. Supersedes D-036's "no message announces a pending approval".
**Amended 12 Oct 2026 (Tao approved "S09b follow-up · match the redrawn maintenance boards"; spec §24.12–17, the six redrawn boards).**

- **Recipients:** a window's emails reach the Admins only while it is a request (requested, request changed, withdrawn, not approved; and the 12 h reminder); approved / declined / started / ended / changed / cancelled go to the owner and backup only. A window that didn't start also emails whoever approved it ("You got this because you approved this window."). Someone else muting a site posts one reply @mentioning the owner and the backup together (`context.mention`), not one each.
- **Emails as drawn:** per action a label, headline, preheader, "What changed" row and a lede per reader (the asker "Your request …", owner, backup, Admin, approver); approved green, didn't start red, the rest grey; Review request only for an Admin on a request or its change; Open incident + Open Maintenance & mutes on didn't start. A window inside one day reads in times ("until 03:00"), a longer one with the day. The first DOWN / PROBLEM email after a mute gets a first row "Held by a mute — until 15:00 — escalation starts now", the held preheader, a late lede and Acknowledge + Open incident.
- **Kept from the build (not the board):** the client status page clause stays out of Effect rows and the approve dialog until the status page exists (D-013; subscriber emails are Phase 3, spec §23.10); the held PROBLEM card keeps the normal PROBLEM card ("Detected 14:32", Trigger row) with only the held line added; a resume time more than a day away keeps the day ("Mon 28 Sep 09:00", `formatResume` / `whenText`), the board's "Mon 09:00" being shorthand; the board's CANCELLED and CHANGED lines name the actor and the board's own sample people, which the build takes from the action.
- **Undo (§24.12):** one pending action at a time — starting another action, opening a row or a dialog posts the pending one at once (`post_window_action_now`: the actor only, while held; the rows' `hold_until` moves to now and the log line gets the real posting time); the undone toast adds "Nothing was posted."; "Posted to …" stays until dismissed; × only hides the toast. Not built: × appearing on phones only once it posted — the AURA toast has no option for it (AURA request).
- **Dialogs:** a Responder's window over 24 h offers only Later ("Over 24 h needs an Admin’s approval first, so it can’t start now — pick a date below"), success "Request sent to Tao · <site>"; End / Approve / Decline / Cancel / Withdraw name who is emailed (the owner and backup minus the person acting) and the Alerts Space line; the withdraw step names "the Admins’ request thread" (the page doesn't load Admin names). End mute with a held incident puts that line first, by tier and response hours; the held mute row says "INC-… held by this mute since 14:20". Log lines: "End changed 10:07 by Tao · 14:00 → 16:00 · “reason”", no posting time while an action waits, an undone answer keeps "· Arm told in Chat".
- **Reviews (follow-up, 12 Oct):** the reader is found by id — the asker reads "Your request …", and an Admin reviews a request (Review request, the Admin lede) even when they also own or back up the site, the why line keeping the closest tie; an auto-approved window's creator isn't emailed as "the approver"; End mute words a Tier 2–3 PROBLEM held for response hours as posting at the opening ("… posts its first alert Mon 28 Sep 09:00.") and its toast says Chat only; cancel / withdraw land focus on Recent; the held incident's "since" is its detection and the drop in progress, as the Chat line, with the day when it isn't today; `post_window_action_now` refuses once the 10 s are over (22023, so a repeated call can't make the app dispatch again) and stamps the held action's own log line. **Board gaps kept as built:** the forced-Later start days still include today; the phone sheet keeps the desktop's button and dialog words (one component at every width, D-018); toasts stay visible over an open dialog (AURA has no option); §24.12's "End now and Change end: Posting to Chat" is wrong for maintenance — the owner and backup are emailed, so the toast says "Chat and email" as the board draws.

## D-036 — S09 maintenance windows and mute

**Conflict.** The spec and PRD say what a window and a mute do (§5, §11, §14.5, §15.1, FR-10a, FR-14) but not: how a mute is stored next to the windows, what the engine does inside a window, what happens when a scheduled window comes due on a site with an open incident, what happens when a mute ends while an incident it silenced is still open, or what happens to an unapproved window over 24 h. D-012 lets an owner write `sites.muted_until` directly, which leaves no window row or reason in the audit log. The `/maintenance` route has no board (screens.md: "`/maintenance` + dialog"; the boards draw only the dialog and the old Main card).

**Decision (Tao, 11 Oct 2026, the four product questions; the rest in the S09 plan).**

- **One table, both kinds.** `maintenance_windows (site_id, kind maintenance | mute, starts_at, ends_at, reason, created_by, approved_by/at, ended_at/by, end_reason, cancelled_at, rrule null until S14)`. State is derived: waiting for approval, scheduled, active, ended, cancelled, not approved. A mute also keeps `sites.muted_until` / `mute_reason` / new `muted_at` in step in the same transaction, so every reader and the engine keep reading the site row.
- **Writes only through RPCs** (`create_maintenance`, `mute_site`, `end_window_early`, `edit_window_end`, `cancel_window`, `approve_maintenance`), each with its audit row in the same transaction (the S01 deferral). Admin: any site; Responder: sites they own or back up; approving: Admin only; a reason every time. The D-012 trigger now refuses a direct write of the mute fields from every signed-in session, Admins too: a session's own statement runs as `authenticated`, the definer RPCs as their owner, so only the RPCs pass (revoking `update` on `sites` would also break `update_site`, which is security invoker). The row-change audit trigger skips a mute-only change, so a mute logs once (`site.mute`).
- **Guardrails.** A mute starts now (the desktop board's Start control applies to maintenance only, as on MMaintenance) and lasts at most 24 h. A window can't start now, or overlap now, on a site that is DOWN or has an open incident (any state before Resolved): refused with the §14.5 text and Mute instead. Over 24 h it waits for an Admin; an Admin's own is approved on create. Windows on one site don't overlap.
- **Inside a window** with no open incident the engine records each round but opens nothing (no DOWN, PROBLEM or D-021 raise) and the site's status is Maintenance; monitors keep their real state. On the first round after the window that still fails, the incident opens ("an incident opens immediately", StatusModel), its start clamped to the window's end.
- **A window that comes due while an incident is open starts on time but hides nothing** (Tao): the incident keeps its ladder and replies, new problems are held back, and that window is not excluded from uptime at all (excluding the window but counting the incident's DOWN inside it could push uptime below the truth).
- **An unapproved window over 24 h doesn't start** (Tao): it shows "Not approved — didn't start" and alerts carry on. No message announces a pending approval (no design); Admins see it on `/maintenance` and the Overview card.
- **Mute holds back new alerts only** (§15.1): new incidents, DOWN AGAIN / PROBLEM AGAIN and the D-021 DOWN card. A thread that already alerted keeps its ladder, ACK, NOTE, RESOLVED — and RECOVERED / the flap summary, which close it (before S09 a mute dropped them).
- **A mute that ends while an incident it silenced is still open** (Tao): that incident's first alert (the card for its current severity + the owner email) posts at once, and its escalation clock starts then (`incidents.alerted_at`); "Confirmed down" and "Down for" stay counted from detection.
- **Uptime:** window minutes leave both sides (§5); mute is counted. Site detail, Sites, Overview and the Resolve dialog's Uptime box use the same helper.
- **Muted Since** = when the mute started (`muted_at`); Recent events gets the mute and maintenance lines.
- **`/maintenance`** is built from a board Tao gets from Claude Design (brief in the S09 plan); until then the nav item stays hidden.

**Amended the same day (spec §23 and the MaintenancePage / MMaintenanceList boards, Tao).** Spec §23 wins where it differs from the bullets above:

- **A window whose start comes while the site is DOWN or has an incident that hasn't recovered doesn't start** (§23.10, Tao chose it over "starts but hides nothing"): Recent "Didn't start — site was DOWN (INC-…)".
- **"Open incident" in both guards means one that hasn't recovered** (Unacked, Escalated, Acknowledged; Tao, 11 Oct): an incident in Monitoring or Needs root cause — the site is back, only the write-up is missing — doesn't block maintenance now (§14.5) or a scheduled start (§23.10), so a night window doesn't fail for a missing root cause. The incident still isn't hidden: a drop during the window is its DOWN AGAIN as usual. With nothing failing at a window's start, its minutes leave uptime like any other window's.
- **Actions by state** (§23.5): a running window or mute — End now, Edit end (no Cancel); scheduled — Edit / cancel; waiting — Admin Approve (confirm) / Decline (reason), the asker or the site's owner / backup Edit / withdraw; Admins don't edit a request. Editing never undoes an approval and a request edited down to 24 h still waits; a Responder can't stretch an approved window past 24 h (it needs an Admin — refused rather than silently un-approved). Every action adds a log line under the row; lines are never replaced.
- **Rules** (§23.10): one maintenance window per site at a time (the overlap is named); a mute can't start during the site's maintenance; maintenance that starts during a mute ends the mute; a new end is at least 5 min away; the mute's 24 h is from its start.
- **Audit actions** (§23.11): maintenance.request / create / approve / decline / withdraw / edit / cancel / start / end / end_early, site.mute / mute_end.
- **The Overview card** (§23.8) has no buttons: active rows, "N waiting for approval" (Admin) and "N scheduled · next …", each opening `/maintenance`; it sits in a band between Live issues and All sites (full width until the On-call card, S10); a muted Live-issues row's next step is "Manage mute" / "View mute"; the header "Maintenance" button is Admin only; the phone gets one "Maintenance & mutes" row.
- **Review round 2** (security, engine, spec-check, 11 Oct): the 24 h chain is followed link by link (a short bridge can't hide length); a Responder's window over 24 h can't start now (it would lapse before an Admin could look — pick a later start); a Responder may shorten an approved long window (only lengthening past 24 h needs an Admin); the Admin approves the request they saw (a request changed meanwhile is refused); a mute set before S09 gets its window row in the migration, so it isn't dropped at deploy. A "silent" incident is one with no alert of its worst severity, so a PROBLEM AGAIN held back by a mute never re-starts a ladder that already ran.
- **Review round 3** (code review + engine, 11 Oct): an incident that recovered (Monitoring / Needs root cause) doesn't stop a window, so inside the window a new drop on it is hidden like a new incident — no DOWN AGAIN, PROBLEM AGAIN or D-021 DOWN card, the round recorded as Maintenance, a settle keeps the site on Maintenance; still failing when the window ends, the drop starts at the window's end (event, card and outage minutes). Uptime decides "started while still failing" from each drop of the timeline, not `recovered_at` (a relapse clears it). Engine and uptime count a window only once `engine_log_windows` checked its start (`start_logged`): if that call fails, or another engine run reads mid-commit, the window's first round alerts rather than hiding something that should have been "didn't start" — failing open is the safer side. **Accepted:** the Resolve gate looks at the `ok_two_rounds` already earned, so a recovered incident can be resolved while the site is down inside a window — the work is planned and hidden by design, and if the site is still down when the window ends a new incident opens from the window's end.
- **Spec-check round 3** (11 Oct, after Tao's `/verify`): every maintenance dialog keeps AURA's focus on open (the boards' auto-focus off is a demo setting, as D-034); the reason dialogs don't close on a stray scrim click. Board gaps taken as drawn by the code, not the board: the success line stays inside the dialog at every width with Done / Open Maintenance & mutes (one dialog component); phones keep Start Now / Later and the desktop words and guard text (§22.4 and §14.5 win over MMaintenance); the Site select hides when the dialog opens for one site; Start date offers 7 days (recurring windows, S14, revisit); the Reason column shares width with Site (AURA DataTable has no ratio); /maintenance's phone eyebrow is the Bangkok time as on the Overview. Links that leave for /maintenance drop the "…" ("End or edit mute"). **Deferred:** other people's edits reach an open /maintenance on the next round (`site_status`), not at once — `maintenance_windows` joins the Realtime publication with S09b's migration; End mute doesn't yet say a silenced incident posts its first alert now (S09b, with the messages); full-width phone header actions use a selector into AURA's PageHeader until AURA adds a prop (request in `docs/design/aura.md`).
- **Phones** (MMaintenanceList): the sheet's actions open the same dialogs as desktop, and their Back / Keep it returns to the sheet (§23.9's "reasons typed inside the sheet" — one dialog component at every width instead). `/maintenance` shows row cards below xl, where the table's fixed columns would crowd or scroll. The phone top bar has the back arrow to Overview (§22.1).
- **"Manage mute"** on a muted Live-issues row for whoever can change it — an Admin, or the site's owner or backup — and "View mute" for everyone else (§23.8 named only the Admin; the owner can manage it on `/maintenance` too).
- **Messages move to S09b** (Tao): the request to the Admin, the 12 h / 1 h reminders, the Alerts Space line and owner / backup messages, approve / decline to the asker — none has a ChatAlert / EmailAlert design yet. Until S09b the dialog and pages don't promise a message ("Tao gets a request now", "Arm gets a Chat message" are left out); status-page emails go with the status page.

**Impact.** S09: a migration (table, RPCs, `sites.muted_at`, `incidents.alerted_at`, `engine_post_late_alert`, grants), `packages/engine` (`maintenance.ts`, `uptime.ts`, the ladder clock), the engine runner, `features/maintenance`, Sites / Site detail / Overview / Resolve wiring, pgTAP that wrote the mute fields directly. S14 lists windows in the digest and adds recurring ones; S15 shows the audit rows.

## D-035 — S08 L1 proved on staging with fixture people

**Conflict.** Plan S08 Done-when 2 asks for the L1 message on staging. Staging has one profile (Tao: owner and the only Admin, no backup, no Chat id), and a second account can't sign up — only company addresses on the allowlist can (D-007). With nobody new, L1 rightly posts nothing (D-034).

**Decision (Tao, 10 Oct 2026).** First: prove it on production after the merge. Amended the same evening: prove it on staging instead, with two fixture profiles Tao seeds through `supabase/staging/escalation-people.sql` (rows in `auth.users` with no password or Google identity, so nobody can sign in as them; Claude doesn't run it — it creates accounts on a hosted project). "Staging Owner" owns the Test target without a Chat id; "Staging Backup" is its backup with Tao's own Chat id, so the L1 @mention reaches Tao; Tao, the Admin, is told FYI. The file's Undo puts Tao back as owner and deactivates both.

**Evidence (INC-0032, 10 Oct).** Confirmed down 23:40:32; DOWN card "acknowledge by 23:55 or it escalates", "Next · L1 at 23:55 if not acknowledged — Staging Backup, Jirawat (Tao) Piyakit"; `step_fired` 23:55:33.5 (due 23:55:32.6), state Escalated, level 1; Chat `@Jirawat (Tao) Piyakit ESCALATED · L1 · Test target DOWN 15 min, not acknowledged · please acknowledge · Jirawat (Tao) Piyakit FYI` (`spaces/AAQAHf7BSxE/messages/CN_GP_rUCMA.npE2NyLXZds`); L1 emails to the backup (asked) and Tao (FYI), both sent. INC-0031 the same hour: STILL DOWN at +30 @mentioning the backup, the Overview ack toast "Acknowledged INC-0031 · escalation stopped". The run's first L1 posted `<users/users/…>` because the fixture's Chat id carried its `users/` prefix — fixed in the data, and `profiles_google_chat_user_id_digits` now refuses it.

## D-034 — S08 escalation: policies, the clock, reminders and the PROBLEM hold

**Gap / conflict.**
- The Escalation board draws four policies (Tier 1, Tier 2 and Tier 3 DOWN, PROBLEM · all tiers); the plan said three.
- PROBLEM routing disagrees: the board seeds L0 with Chat + Space only and L1 (+60) with the backup; spec §19.2, PRD §7, ChatAlert and EmailAlert email the owner at L0; PRD §8 gives L1 to "Backup + Tao", spec §8 to the backup.
- No source says how D-021 (a PROBLEM raised to DOWN, `detected_at` reset) and D-004 (a relapse keeps the clock) meet the ladder, whether timers run while an unacked incident has recovered, or whether a saved policy changes open incidents (the board: "open incidents keep their current timers").
- PRD §7 and the board's "DOWN reminder" field want a reminder every 15 min, but no board has its copy.
- A Tier 2–3 PROBLEM outside response hours is "held until 09:00" (§7, §19.2) and "posts nothing" if it clears first (§19.6); the queue has no such hold.
- D-013, D-016, D-032 and D-033 held back every piece of escalation copy "until S08 / S10".
- The company holiday list doesn't exist anywhere; the Escalation board has no phone version.

**Decision (10 Oct 2026, S08 plan approved by Tao).**
- **Policies:** the board's four. Each step has a delay (minutes after Confirmed down), role tokens (`owner`, `backup`, `admins` — every active Admin, shown "Admin (Tao)" — `site_am`, and `ceo`, locked until S10) and channels. Seeds: DOWN L0 +0 owner · Chat @mention + Alerts Space + email, L1 +15 backup + Admin · Chat + email; PROBLEM L0 +0 owner · Chat + Space + email, L1 +60 backup · Chat + email. Reminder intervals (DOWN 15, PROBLEM 60) and response hours (Mon–Fri 09:00–18:00, one value for Tier 2–3, §14.14) live in organisation settings.
- **Who:** Tier 1 L0 is the owner at every hour until S10 builds on-call. L1 is the step's tokens resolved for the site minus anyone already notified at an earlier level (PRD §8, the "L1 · night" rule): by day the backup is @mentioned and the Admin is plain text ("Tao FYI"); when the backup was already paged the Admin is @mentioned.
- **PROBLEM routing by precedence:** L0 emails the owner (spec §19.2 and both message boards beat the board's seed); L1 at +60 is the backup alone (spec §8 beats PRD §8), posted as ChatAlert's "STILL PROBLEM · … · <backup> (backup) please take it" with the backup's first email.
- **The clock** starts at Confirmed down (`detected_at`; a PROBLEM's flag time). Tier 1 runs 24/7; Tier 2–3 count only minutes inside response hours, skipping company holidays (INC-0139 Thu 22:14 → L1 Fri 09:15). Timers run only while the incident is Unacked or Escalated: an ack stops the ladder and the reminders, and so does recovery. A relapse (D-004) keeps the clock and the levels already fired, so a level that came due while the site was up fires on the relapse — for Tier 2–3 at the next opening if the relapse comes outside response hours: a paused clock fires nothing, not even an overdue level (engine review round 2). "Escalated" means a step of this severity really paged someone. While a DOWN incident's home page is back and only a key page fails (D-023), the DOWN ladder waits; the PROBLEM AGAIN reply told whoever acts now. A PROBLEM raised to DOWN (D-021) starts the DOWN policy from L0; if nobody had acked, its level returns to 0 and its state to Unacked. Mute never stops an open incident's ladder (§15.1). The ESCALATED / STILL … messages say how long it has gone unacknowledged on the wall clock since the owner was told — a DOWN from Confirmed down (INC-0139's L1 at Fri 09:15: "11 h"), a Tier 2–3 PROBLEM held overnight from the opening ("60 min" at 10:00); a PROBLEM flagged at 17:50 inside hours really waited the weekend and says so (message-check round 2 proposed response-hours minutes; the wall clock was kept because L0 had already gone out).
- **Open incidents keep their policy:** the steps and reminder interval are copied onto the incident when it opens (and when D-021 raises it); a save changes new incidents only. Response hours are read live. Incidents opened before S08 have no plan and never escalate (an old incident would otherwise page its backup the minute S08 ships). The ladder starts only once the thread has its first alert: never for an incident opened while muted (§15.1), and not while a PROBLEM card waits for response hours.
- **Reminders** fall due every interval from Confirmed down (response-hours minutes for Tier 2–3), skipped on a minute where a step fires. They are Chat replies only, @mentioning everyone asked to act so far (not FYI people): `STILL DOWN · <site> · 30 min, not acknowledged · please acknowledge` (Tao, 10 Oct; no board copy) and `STILL PROBLEM · <site> · 2 h, not acknowledged`.
- **PROBLEM outside hours (Tier 2–3):** the card, the owner email and any PROBLEM AGAIN are held until the next opening; the held card doesn't block the thread (a note written meanwhile posts first); a recovery (auto-resolved or not — §19.6 "clears before 09:00 posts nothing"; the incident still waits in Needs root cause on the Overview and Incidents), an ack or a DOWN before then cancels them and posts nothing, and RECOVERED goes only when an alert went. An ack or a recovery also sets aside a step or reminder that hasn't gone (Undo restores them); a reminder is never emailed as a Chat fallback.
- **Copy that returns** (L1 only; CEO, L2, L3, voice and on-call stay out until S10): "acknowledge by HH:MM or it escalates" (Tier 2–3 outside hours: "outside response hours · timers paused until 09:00"), the card's Next row and "(not notified yet)", ESCALATED · L1 without "· CEO at …", the two L1 emails, ACKNOWLEDGED "· L1 stopped" / "· reminders stopped", the DOWN AGAIN and flap-summary outside-hours parts, the Down email's "acknowledge by" and Next step, the Escalated badge, the Incidents KPI "Escalated, not acked", "Escalated to L1" on the incident timeline and in Recent events, and "· escalation stopped" on the ack toast and Recent events. The incident page's escalation card and the Overview banner's "L1 (Ploy + Tao) paged · CEO step at …" line come with S10: both boards draw the whole L0–L3 ladder, and S08 shows L1 on the timeline (10 Oct, slice size).
- **Editor:** L0 and L1 rows (L0 pinned: the owner by Chat @mention, Alerts Space and email — what the first alert sends, so L1's "minus anyone already told" is true; no pencil on L0 until S10 adds on-call), "Add step" only while a policy has no L1 (L2+ is S10), the reminder fields, a save dialog with a diff, the open incidents that keep their timers and a required note; one Admin-only SQL function saves everything, re-checks every guardrail and writes one audit row with the note. "Change history" waits for the Audit log page (S15).
- **Holidays:** the Thai public holidays for 2026–27 are seeded (Tao, 10 Oct); an SQL template corrects them until S17's UI.
- **Phone (MEscalation, spec §22, added 10 Oct 2026):** below md the page is view only — "View only on phones. Admins change policies on a larger screen.", the policy switch (Tier 1 DOWN · Tier 2–3 DOWN · PROBLEM; "Tier 2–3 DOWN" shows the policy of the picked site's tier, since Tier 2 and 3 are stored apart), "Show names for" a site, one vertical ladder, "Example · nobody acknowledges" and "Always true", no edit controls. Its L2 / L3 rows, the on-call line and the client-update example come with S10 / S11 (D-013); the MProfile and incident-card entry points come with S16 and S10 (the incident card), and the board's top bar with a back arrow comes with them — until then the page keeps the shared phone shell (D-018). Everyone who isn't an Admin gets the same read-only view at every width, under "View only. Only an Admin can change escalation policies." (spec-check, 10 Oct). Spec-check board gaps settled the same day: the unsaved bar is AURA ActionBar (above the BottomNav, its status announced) instead of the board's pill; L0 hides its arrows, pencil and delete (the Pinned badge says why) and L1 has no arrows until S10 brings L2; the CEO tag stays disabled with the policy's reason; the Preview lists only the tokens the policy's steps use (Site AM returns with S11); no "Users" or "Edit in Organisation" links until S16 / S17. Round 2 (10 Oct): the Tier 1 "If Arm acknowledges at 10:07 → … stopped" box comes with S10 (its content is the L3 FYI; with L1 alone it reads as a sample) — the meta line and "Always true" already say an ack stops the chain; the desktop "Client-update track" card and the meta line's "— not the client-update track" come with S11, like the phone example; the Preview shows the first reminder by D-034's skip rule (PROBLEM at +120, not the board's +60) and, for Tier 2–3, the closing and opening the timeline runs across; the step dialog keeps AURA's focus on the first field (the board sets auto-focus off).

**Why.** The board is the editor's target and its four policies cost nothing extra; behaviour follows the spec over the board and the PRD as `CLAUDE.md` sets out. A clock that only runs while someone should be acting pages nobody for a site that is up, and a relapse never resets anyone's timer (D-004). Copying the policy onto the incident makes the board's promise true without re-planning live timers.

**Impact.** S08: migration `escalation_policies` (tables, seeds, `incidents.escalation_plan`, `engine_fire_step`, `engine_remind`, the PROBLEM hold, `save_escalation_policies`), `@dxt/engine` (`response-hours.ts`, `escalation.ts`), the runner's ladder tick, the notifier (`step_fired`, `reminder`, the returning copy), `features/escalation`, Incidents and Overview copy. S10 adds L2 / L3, the CEO, on-call and "L1–L2 stopped"; S17 the Organisation and holidays UI; spec-checker treats these differences as intended.

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
- **One Resolve dialog** (Resolve board) on desktop and phone. The page's Resolve button opens it once recovery and the client update are met, otherwise it is disabled with the unmet condition next to it. Inside, "Resolve incident" waits for a real category and "What happened"; with Unknown it reads "Save, keep open". Its Uptime box (the maintenance checkbox and the month's uptime it changes) comes with S09, which owns maintenance.
- **Root cause:** category (the nine board options), What happened (required), What fixed it (optional). It can be saved as a draft at any time, each save on the timeline; Unknown never meets the condition (§16.3).
- **Resolve** cancels a held flap summary, queues RESOLVED in the thread (no @mention) and an email to everyone already emailed about the incident (the RECOVERED audience; for a DOWN that is everyone who got the DOWN email, PRD §7), both held 10 s with Undo ("Posting to Chat and email in N s", D-016). The RESOLVED reply adds a card with the root cause (ChatAlert draws its text line only), and its "Down for" counts DOWN minutes as below. Undo returns the incident to the state it was resolved from, unless a message left or the site opened a new incident.
- **Notes** post to the Chat thread at once as `NOTE · <site> · <name>: …` (no @mention, no email); the 10 s hold is for ack and resolve only. The desktop note dialog says so, as MIncident does.
- **List:** desktop views Needs action / Resolved & closed / All, phone Open / Unacked / Past; "Unacked" is D-032's (DOWN waiting for an ack). Auto-resolved PROBLEMs are hidden everywhere with a computed "N short PROBLEMs auto-resolved in < 5 min are hidden". Export CSV exports the filtered list and sits on the count line (it follows the filters there). To fit md the owner reads under the site name and the next step under the state badge (one "State · next" column); the danger row tint waits for AURA DataTable row tones; escalated DOWN incidents sort first, then the longest wait (§21.4); 50 rows a page. The list and the incident page refresh through Realtime (PRD §9).
- **How long it was down** (amended 9 Oct 2026 by Tao after the S07 spec-check found four rules): one number on every page and message — the sum of the incident's drops, DOWN drops only for an incident that was ever DOWN (§5, as uptime), each in whole clock minutes (19:37–19:42 = 5 min, at least 1), the drop in progress counted to now. `clockMinutes` (`@dxt/shared`) and `outageMinutes` (`@dxt/engine`) are the rule; the Incidents list, the incident page, Site detail, MTTR, the Resolve dialog and the Chat / email wording all use them. A relapsed incident (03:12–03:19 · 03:24–03:35) reads 18 min, not the 23 min span. The Overview banner counts the drop in progress the same way.
- **KPIs:** MTTA is the Overview's mean (D-032, caption "mean"); MTTR is the median of the recovered DOWN incidents' outage minutes (above), as Incidents and Site detail draw it; the "Escalated, not acked" card reads "Unacked" until S08.
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
