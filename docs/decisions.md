# Decision log

Decisions that settle a conflict between the PRD and the design spec, a conflict inside the PRD (e.g. a requirement against the budget), or fill a gap in either. Newest first. Code that implements a decision cites its ID.

| ID | Date | Decision | Supersedes |
|---|---|---|---|
| D-018 | 7 Oct 2026 | One page-header rhythm and one phone shell: every page header is AURA `PageHeader` with 4 px between its parts, a breadcrumb sitting in the eyebrow slot; phones get the boards' top bar (brand + avatar) now, the back arrow with S07 and BottomNav with S06 | Board drift: breadcrumb gaps of 12 / 24 px and title → meta gaps of 6 / 10 px; AppShell's menu-only phone bar |
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

## D-018 — Page header spacing and the phone shell

**Conflict.** (1) The boards space the page header differently: a section eyebrow sits 4 px above the title (Main, Incidents, Expiry, Settings …), a breadcrumb 12 px (Synthetic, EditMonitors, AddSite, SiteDetail, Incident) or 24 px (Resolve); the title → meta line gap is 4 px on most boards, 6 px on Synthetic / EditMonitors and 10 px where the second row holds badges (SiteDetail, Incident, Maintenance, PostIncident). The spec gives no numbers, and §13 says "Eyebrow = breadcrumb (chevron style) OR section name in caps … never both". (2) Every phone board (MOverview, MobileAck, MIncidents …) draws a 56 px top bar — brand on the left, avatar on the right, a back arrow on detail pages — and a BottomNav, with no menu drawer. The app shell (S01) used AURA AppShell's default phone bar: the menu button alone. No slice owned the phone shell.

**Decision (7 Oct 2026, with Tao).**
- Every page header is AURA `PageHeader`: 4 px between eyebrow, title and meta line, as on Overview today. A breadcrumb is the eyebrow — it goes in the `eyebrow` slot, so a page with a breadcrumb and one with a section name line up. The other gaps on the boards are drawing drift, not intent.
- Phones get the boards' top bar now: brand (compact tile) + the signed-in person's avatar (`components/app-shell/mobile-bar.tsx`), hidden from lg where the sidebar shows. The menu button stays until BottomNav replaces it in S06; the back arrow comes with S07, when the Incidents list it returns to exists (no dead controls, §14.16).

**Why.** One rhythm means the title doesn't jump between pages, and the breadcrumb row (13 px text, 16 px icons) is the same height as the mono eyebrow, so nothing else changes. Using `PageHeader` as AURA ships it avoids a second wrapper with its own spacing. The phone bar is what every phone board shows, and a person opening an alert link on a phone should see where they are and who is signed in.

**Impact.** `apps/web/src/app/(app)/layout.tsx`, `components/app-shell/{brand,mobile-bar}.tsx`, `app/globals.css` (the from-lg hide is a workaround until AURA request 6, `docs/design/aura.md`); plan S06 and S07 Scope; `apps/web/CLAUDE.md` → Building a screen. spec-checker should treat a header's 4 px gaps as correct where a board draws 6 / 10 / 12 / 24 px.

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
- Another domain (for example a colleague whose primary address is on the group's domain) is allowed by adding a row to `private.allowed_email_domains` and to the proxy (a small code change: `ALLOWED_EMAIL_DOMAIN` and `isAllowedEmail` take one domain today) — the allowlist still decides who gets in.

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
