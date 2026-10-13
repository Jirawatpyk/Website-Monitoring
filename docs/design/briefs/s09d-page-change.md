# Brief for Claude Design: page-change detection and "Accept as new baseline" (S09d)

**For:** the DxT Monitor design canvas. Please add new boards, plus one variant on the existing **Incident**, **MIncident** and **SiteDetail** boards.
**Design system:** AURA, as on every other board. Use the existing status badges, card and dialog patterns.
**Decision:** D-041 (S09d), which records Tao's decision of 13 Oct 2026.

## What the feature does

Every 30 minutes, DxT Monitor reads each client's home page and keeps a short **fingerprint**: the parts a defacer changes. It compares the fingerprint with the version the team accepted (the **baseline**). Whole-page diffs are not used, because news, prices and banners change every day.

**What the fingerprint holds.** The list can shrink after the first two weeks, so please design it as a repeating list of rows, not fixed slots:

| Row | Example before → after |
| --- | --- |
| Page title | `Bangkok Airways – Taiwan` → `Bangkok Airways – Taiwan | สล็อตออนไลน์` |
| Meta description | `Fly to Taipei with…` → `แทงบอลออนไลน์ เว็บตรง…` |
| Robots | `index, follow` → `noindex` |
| Canonical URL | `https://bangkokair.com/tw` → `https://casino.example/` |
| Main heading (first h1) | `Welcome to Taiwan` → `บาคาร่า ฝากถอนออโต้` |
| Script / iframe domains | **+ evil-cdn.example** (new), the others unchanged |
| Link domains | **+ 3 new**: casino.example, slotxo.example, … |

**When it raises a PROBLEM (trigger "Page change"):**

- **A new script or iframe domain** raises a PROBLEM on the next fetch. This is the usual sign of injected malware.
- **Other changes** (title, description, h1, canonical, new link domains) raise a PROBLEM only after they hold for 3 fetches, about 1 hour.

**What happens next:**

- Someone checks the change.
  - If it was intended (a redesign, a new tracking tool), an **Admin** presses **Accept as new baseline**.
  - If it was a hack, the client fixes the page. The PROBLEM recovers when the page matches the baseline again.
- **Recording period.** For the first two weeks after this ships, the monitor only records and never alerts. During that time the site page shows a quiet "recording" state, so nobody expects alerts yet.

## Screens to draw

### 1. Incident page: a "Page change" PROBLEM

This applies to desktop (the **Incident** board) and to phone (**MIncident**, 390 px).

**Header:** as for any PROBLEM. Badges: `Problem`, `Unacked`, `Tier 1`, `Trigger: Page change`.

**Cause line:**
- one change: `Page title changed on /`;
- several changes: `3 changes on / · new script domain evil-cdn.example`.

**New card "What changed".** Put it above the Resolve card, in the slot the "Latest round" card has on other incidents:

- **Rows.** One row per fingerprint field that differs: field name, **before** (muted) → **after** (emphasised). Long values wrap; they are not cut with an ellipsis.
- **Domain sets.** Show these as chips:
  - added domains in the danger tone, with "+";
  - removed domains muted, with "−";
  - unchanged domains collapsed into "and 12 unchanged".
- **Footer:**
  - when the change was first seen and how many fetches it has held, e.g. `First seen 14:30 · held 3 checks (1 h)`;
  - the time of the fetch it came from.
- **Not in this slice:** a "View page source as fetched" link. The monitor keeps the fingerprint only, not the client's page content, so please don't draw it.
- **Actions** (Admin only):
  - **Accept as new baseline** (secondary button);
  - the usual Acknowledge / Resolve.
- **Other roles** see the card read-only, with the hint `Only an Admin can accept a new baseline`. No button is shown to them.

**Accept dialog:**

- **Title:** `Accept the current page as the new baseline?`
- **Body:**
  - a short list of what will change (the same rows, after values only);
  - a required **Reason** field, for example `Client redesigned the home page (ticket #…)`.
- **Confirm button:** `Accept as baseline`.
- **After confirming:**
  - the toast `Baseline updated — Test target is OK on the next check`, with **Undo · 10 s**. Undo works the same way as Acknowledge.
  - the timeline gets `Baseline accepted by Tao · "reason"`.
- **Danger.** If a **new script domain** is among the changes, the dialog shows a warning: `A new script domain usually means injected code. Accept only if you know the client added it.` In that case the confirm button uses the danger style.

**Resolve dialog:** for a Page change incident **only**, choosing the category **Client-side change** shows a checkbox, ticked by default: `Also accept the current page as the new baseline`. On other triggers (slow, keyword …) the checkbox doesn't appear.

### 2. Site detail: the fingerprint panel

This goes on the **SiteDetail** board, plus a phone variant.

**New card "Page fingerprint"** on the site page, near the monitors / checks section. It has three states:

1. **Recording.** In the first two weeks, or for a site added recently:
   - info tone: `Recording — alerts start after 2 weeks of clean checks (from <date>)`. The date is per site: the day its baseline was first set + 14 days, so a site added later starts its own two weeks. Please draw it as a computed field.
   - shows the current fingerprint.
2. **Matches baseline.** The normal state:
   - a compact line: `Matches baseline · checked 14:30 · baseline accepted 12 Oct by Tao`;
   - expandable to show the rows.
3. **Differs.** A change is waiting, or the PROBLEM is open:
   - the same "What changed" rows as on the incident;
   - a link to the incident;
   - **Accept as new baseline** for an Admin.

Also show **"No data"** when the last fetches were refused by the site's bot protection: `Couldn't read the page (blocked by bot protection) · last read 13:00`. This uses the existing no-data style.

### 3. Chat and email (no new board needed)

- Please add one row to the **ChatAlert** cause-wording table:
  - Trigger: Page change.
  - Cause: `/ · title "Bangkok Airways – Taiwan" → "… | สล็อตออนไลน์"`, or `/ · new script domain evil-cdn.example`.
- The email reuses the existing PROBLEM email; only the cause text changes.

## States and checks

- Every state at **390 / 820 / 1440**, light and dark.
- Touch targets ≥ 44 px.
- Status is never shown by colour alone: added and removed domains carry "+" and "−".
- **Copy follows spec §13:**
  - English UI;
  - dates like "Fri 25 Sep";
  - durations like "1 h 2 min";
  - no spec codes in the UI (no "S09d", no "D-041", no table names).
- **Empty states:**
  - a site with no fingerprint yet: `No fingerprint yet — the first check runs within 30 min`;
  - a key page: the fingerprint covers the home page only, so the card doesn't show.
- Please draw **Accept as new baseline** in four states: enabled; in flight; Undo toast; disabled for a non-Admin with the hint.

## Settled with Tao (13 Oct 2026)

1. **Only an Admin can accept a baseline.** Other roles see the card read-only, with the hint `Only an Admin can accept a new baseline`.
2. **Resolving with "Client-side change" shows the checkbox above,** ticked by default, on Page change incidents only. The plan's "Expected change" means this existing category; no new category is added.
3. **The tracking-domain allowlist** (Google Analytics, Tag Manager, Meta pixel) **is not shown on these screens.** It stays a list in code until S17 makes settings editable, the same as the shared forbidden list (D-042).

These go into a decision record when S09d starts.

Background, no design impact: the fingerprint comes from a third crawler fetch made with the monitor's own identity, not the Googlebot fetch used for spam checks.
