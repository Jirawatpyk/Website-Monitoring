# Brief for Claude Design: Management on the Tier 1 DOWN ladder (D-078)

**Boards to update:** `Users` / `MUsers` / `MUsersDark`, `Escalation` / `MEscalation` (+ the step dialog), `ChatAlert`, `EmailAlert`.
**Decision:** D-078 (`docs/decisions.md`). Part (1), the fuller L3 FYI, shipped in PR #244. This brief is for parts (2)–(3).

## What changes

Bua's pre-approval review (item 3) asked for a management step before the CEO. The Tier 1 DOWN ladder becomes:

| Level | When | Who | What they do |
| --- | --- | --- | --- |
| L0 | at once | Owner / on-call | acknowledge and fix |
| L1 | +15 min, not acknowledged | Backup + Admins (minus Management) | acknowledge and fix |
| L2 | +30 min, not acknowledged | **Management** (new) | step in: find someone to take it |
| L3 | +60 min, still down even if acknowledged | CEO + Site AM | FYI only (unchanged) |

- **Management is a tag on Admins, not a new role.** Today that means Bua and Viraphong. Permissions don't change, because they are already Admins.
- **The CEO is no longer paged at L2.** The CEO gets only the L3 FYI. Voice stays "Configured · off" but no step carries it any more.
- **Tier 2–3 and the PROBLEM policy are unchanged.**
- **What Management does at L2:**
  - Call the owner or backup, reassign, or acknowledge themselves.
  - Make sure the client has been updated.
  - Afterwards, check that the root cause and preventive action are written.

## 1. Users / MUsers / MUsersDark (Settings › Users & roles)

- **Badge:** a "Management" badge beside the role badge, in the desktop row and the phone card. Neutral, not a status colour. It appears on Admins only.
- **Row ⋯ menu:**
  - "Set as Management…", or "Remove from Management…" when the person is already Management.
  - On roles other than Admin the item is disabled, with the reason "Only Admins can be Management".
- **Confirm dialog:**
  - Title: "Set Bua as Management?" / "Remove Bua from Management?"
  - Body lines: "Gets the L2 step on Tier 1 DOWN (+30 min, @mentioned in Chat + email)." and "No longer told at L1 as an Admin."
  - A required **Note**, as on other audited changes.
  - Buttons: Cancel / Set as Management (or Remove from Management).
- **Refusals:**
  - Removing the last Management person while a policy uses Management: "Can't remove: Tier 1 DOWN L2 goes to Management and Bua is the last one. Change the L2 step on Escalation first, or set someone else as Management."
  - A person with no Google Chat id: "Add a Google Chat id first — Management is @mentioned."
- **Detail sheet:** add the fact "Management · gets the L2 step on Tier 1 DOWN".
- **Change role dialog:** when a Management Admin is moved to another role, add the line "Bua will also leave Management."
- **Phone:** view only, as today. The badge shows; there are no actions.

## 2. Escalation / MEscalation (+ the step dialog)

- **New target:** "Management" joins the step dialog's choices (Owner / on-call, Backup, Admin, Site AM, CEO). It shows the names it resolves to: "Management (Bua, Viraphong)".
- **Locks on the Management choice** (each shows its reason, as the CEO lock does):
  - Tier 1 DOWN only: "Management is used only on Tier 1 DOWN".
  - From L2: "Management can be told only from L2".
  - No voice on a Management step.
  - Nobody tagged yet: "Nobody is Management yet — set someone on Users & roles".
- **Tier 1 DOWN ladder as drawn:**
  - L0 Owner / on-call (Chat + Alerts Space + email)
  - L1 +15 Backup + Admin (Chat + email)
  - L2 +30 Management (Chat + email)
  - L3 +60 CEO + Site AM · FYI, also after an ack (Chat + email)
- **Note on the L1 row:** "Admins who are Management are left out here — they get L2."
- **Preview ("If nobody acknowledges"):** "10:18 · L2 · Management — Bua, Viraphong" replaces the CEO page.
- **Phone (MEscalation):** view only, with the same rows.

## 3. ChatAlert / EmailAlert rows

- **New: Chat · L2 Management.**
  - Text line: `<@Bua> <@Viraphong> ESCALATED · L2 · MuvMi DOWN 30 min, not acknowledged · please step in — find someone to take it · Arm, Ploy, Tao informed`
  - Card: "Nobody has acknowledged. Arm (owner), Ploy (backup) and Tao were asked. Call them, reassign, or acknowledge yourself — and ask for a status note: CEO + Bua get an FYI at 10:48 if it's still down."
  - Button: Open / acknowledge.
- **New: Email · L2 Management.**
  - The same ask as the Chat card.
  - Facts: Down for · Cause · Already told · Next step "L3 FYI (CEO + Bua, no call) at 10:48".
  - Buttons: Acknowledge · Open incident.
- **Update the L3 FYI rows to match what shipped in #244:**
  - Card and email facts: Cause · Down for "1 h (confirmed down 09:48)" · Acknowledged · **Status** "Arm 10:30 — restarting Redis" (or "No status note yet") · Client update · **Next update** "Email when it’s back · no more escalation".
  - The text line is unchanged.
- **Update ACKNOWLEDGED:** "…If MuvMi is still down at 10:48, CEO + Bua get an FYI (no call). Add a status note — they see it in the FYI." The AM's own email leaves the last sentence out.
- **New reader on the flapping summary.** The CEO / Site AM who got the FYI now get the summary too.
  - Lede: "MuvMi flapped 3 times and has been stable for 15 min. Nothing needed from you. Arm adds the root cause."
  - Footer: "You got this because you were emailed about this incident."
- **Remove:** the "ESCALATED · L2 (CEO)" Chat and email rows from the Tier 1 default. Add a note that incidents opened before the change keep their old plan and still use them.

## Questions the boards should answer

1. Where does the Management badge sit on the phone card: beside the role, or on its own line?
2. Is "Set as Management" a menu item, or a switch in the person's sheet?
3. Does the Escalation L2 card list the Management names, or only "Management"?

## Rules that apply

- Spec §13 copy: UI in English, no spec codes, dates "Fri 25 Sep", durations "1 h 2 min".
- AURA components and tokens only. Status badges follow spec §11; Management is not a status.
- Sample names (Arm, Ploy, Tao, Bua, MuvMi) are mockup data only.
