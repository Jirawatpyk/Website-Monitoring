# Brief for Claude Design: company holidays and the shared forbidden words (Settings › Organisation)

**What to draw:** two sections added to the `Organisation` board (1440, light and dark) and their phone view (390, view only), or a separate `OrganisationLists` board if they don't fit.
**Route:** `/settings/organisation` (S17, D-069). The rest of the page is built from `Organisation.dc.html`.

## Why

- **Company holidays** decide when Tier 2–3 timers run and when Tier 1 hands over to the person on call (spec §7; D-034, D-048 item 10). Today an Admin edits them by SQL. The Thai public holidays for Oct 2026 – 2027 are seeded; the Buddhist holidays follow the lunar calendar and are announced each year, and company days off are added by hand.
- **The shared forbidden words** (D-041, D-042) are phrases every site is checked for on top of its own "Must not contain": gambling, slot spam, adult and pharma words in Thai and English. A hit opens PROBLEM · Keyword on that site. Today the list changes by a code change; S17 lets an Admin change it.

## Who uses it

Admins only, on a larger screen. On a phone the page is view only (§22.5): "**View only on phones.** Admins change policies on a larger screen." — no add, edit, delete or Save.

## Company holidays — what the section holds

- The holidays from today on, grouped by year: date ("Mon 7 Dec"), name ("Father's Day (substitute)"), and how many days remain this year.
- Add a holiday: a date and a name (1–100 characters).
- Rename or remove a holiday.
- Every change is logged (the audit log already records `holiday.create` / `.update` / `.delete`). No note is required today; say if the board wants one.
- A day in the past can't be added or changed.

## Shared forbidden words — what the section holds

- The list by group (Gambling · Thai, Gambling · English, Brands, Adult, Pharma), as phrases. About 60 entries today.
- Add a phrase, remove a phrase. Both need a note, like the response hours.
- **Guardrails the screen must show:**
  - Phrases, not single words: "slot" would match "time slot" on a booking page, so a single short word is refused with that reason.
  - Before saving, the phrase is checked against every live site's last clean fetch. If it appears on a site that is fine today, the save is refused: "Found on MuvMi’s home page — this would open a PROBLEM on a healthy site".
  - The confirm says what happens next: "Every site is checked for it from the next round (about 1–5 min); the Googlebot and Google-search views from the next crawler run (within 30 min)".
- The list was never shown in the UI so far (the words are offensive and spammy). Decide: shown in full, or collapsed per group with a count ("Gambling · Thai — 13 phrases · Show")?

## Questions the board should answer

1. Do both sections sit on Organisation below "Clients", or on a separate page?
2. Holidays: a table, or a list per year? Where does "Add holiday" sit?
3. Forbidden words: shown in full, or collapsed per group? Add and remove one at a time with a dialog, or edit a list and save with the sticky bar?
4. What a refused phrase looks like in the dialog (single word; found on a live site).
5. The phone view (390, view only) of both sections.
