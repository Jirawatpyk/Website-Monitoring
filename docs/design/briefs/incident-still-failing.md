# Brief for Claude Design: an incident whose home page came back but something still fails (Incident / MIncident / Incidents)

**Boards to add to:** `Incident` and `MIncident` (light and dark, 1440 and 390), plus one row on `Incidents` / `MIncidents`. Each needs a new STATE: "Home page back · /booking still failing".
**Built in:** PR #204 (fix, 16 Nov 2026). The copy below is live in code, written from spec §19.7 and the ChatAlert INC-0152 example. The board decides whether it stays.

## The state

A DOWN incident's home page answers again, but a key page (or the home page's certificate chain) still fails. This is D-023's partial recovery.

The same incident carries on as a PROBLEM (spec §19.7: "titled by what still fails, e.g. '/booking still failing after the home page came back'"). Its record stays DOWN: "how long it was down" counts only the DOWN minutes (D-033).

**Production example (16 Nov):** Cando Asia, INC-0003. The page said "is down · Still down · 12 min" while the site loaded and only the certificate chain was broken.

## What the page shows now (please confirm or redraw)

| Place | Now in code |
| --- | --- |
| Title | `VOCA — /booking still failing after the home page came back` · certificate chain: `Cando Asia — TLS chain misconfigured, still failing after the home page came back` |
| Badges | **Problem** (warning) · workflow badge · Tier · `Trigger: Hard fail` (the DOWN's trigger, kept) |
| Meta line | `/booking → HTTP 404 (BKK, SIN, TYO) · home page back 13:35` |
| Facts strip | STARTED, CONFIRMED DOWN, MTTD as recorded; DURATION `19 h 24 min`, caption `Down in total · problem since 13:35` (warning tone, not danger) |
| Phone summary line | `Problem since 13:35 · down 19 h 24 min in total · Sun 15 Nov · confirmed down 18:12:08` (warning tone) |
| Resolve card | `Still has a problem · needs 2 OK rounds once it clears` · `Resolve locked · 1 of 3 met — VOCA still has a problem` |
| Incidents list | Problem badge; counted under PROBLEM in the Open KPI, not as an unacked DOWN |

## Questions the board should answer

1. **Title:** is the long §19.7 sentence right for an h1 at 390 px (it wraps to 3 lines), or should it be short, e.g. "/booking still failing", with "home page back 13:35" in the meta line?
2. **DURATION:** is "19 h 24 min · Down in total · problem since 13:35" clear, or should the strip show two facts: DOWN for and PROBLEM since?
3. **Evidence and Latest round** show the home page's checks only, so they read "3/3 pass → OK" under a Problem title. Should they show the failing key page's checks instead, or carry a line such as "Home page OK · /booking still failing"?
4. **The `Trigger: Hard fail` badge:** keep the DOWN's trigger, or show the key page's?
5. **The weekly summary row** for this state now reads `Problem · Cando Asia · Fri 13 Nov 08:00 · … · home page back, still failing: TLS chain misconfigured — 6 min`. Does that fit the WeeklySummary redesign (see `weekly-summary-email.md`)?

## Rules that apply

- Spec §11: Problem uses the warning tone; status never by colour alone. Violet stays Maintenance.
- Spec §13: "Fri 13 Nov", "1 h 2 min", "13:35"; no spec codes.
- Spec §19.7 and D-023 (behaviour), D-033 (the minutes). These stay; the board settles the words and layout.
- Sample data only on the board (made-up sites and times).
