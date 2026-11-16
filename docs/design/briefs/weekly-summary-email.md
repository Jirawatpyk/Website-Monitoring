# Brief for Claude Design: the weekly summary email to the CEO (a WeeklySummary revision)

**Board to revise:** `WeeklySummary`, the email part. Draw it in light and dark, in a desktop mail client and a phone mail client. The Chat card stays as drawn.
**Built in:** a follow-up to S14 (D-056, D-059), sent by `packages/notifier` (`weeklyEmail`).

## Why

The CEO reads this email every Monday at 09:00. On 16 Nov 2026 the CEO forwarded the 9–15 Nov issue asking for its data to be confirmed. Tao finds it reads like plain text, and he has a point:

- Every row has the same weight.
- Each row packs date, cause, ladder, ack and root cause into one long line.
- The headline figures (uptime, sites with no downtime) are body-size text.

The figures are right. The layout makes them hard to trust at a glance.

## What it must say (unchanged)

- **Content:** the same sections, in the same order, as the Chat card:
  - title and summary lines
  - NEEDS SOMEONE
  - INCIDENTS
  - UPTIME BY SITE
  - MTTA
  - PLANNED & QUIET
  - COMING UP
  - THE MONITOR ITSELF
- **Empty sections:** a section with nothing in it is left out, never shown as "none".
- **Subject:** `DxT Monitor · Weekly summary · 9–15 Nov`.
- **Plain-text part:** kept.
- **Footer:** "You got this because you get the weekly summary as the CEO." plus the standard footer line.
- **Button:** one, "Open incidents".

## What to change

1. **Figures first.** A top row of 3–4 tiles, each with a large number and a short caption:
   - uptime of all sites (99.98%)
   - sites with no downtime (14/17)
   - DOWN incidents (3)
   - PROBLEM incidents (4)

   The tiles must stack on a phone mail client. They count **the week**, not what is failing now, so the
   period must be unmistakable. Large red "3 DOWN" and amber "4 PROBLEM" tiles must not read as sites down
   right now. Use a caption such as "DOWN incidents this week", or keep these two tiles neutral.
2. **Status as a badge.**
   - Each incident row starts with a badge that carries its word: DOWN / PROBLEM while open, "Was down" / "Was problem" once recovered.
   - Colour: red for DOWN, amber for PROBLEM, outline once recovered (spec §11).
   - The word is always there, never colour alone. Violet stays reserved for Maintenance.
3. **Two lines per incident.**
   - Line 1: site · when it started · length (the DOWN minutes, as now).
   - Line 2, smaller: cause, who acted (ack, ladder level, client update) and the root cause, or "no root cause yet".
4. **An incident still open after its DOWN.**
   - This is the case where the home page came back but something still fails (spec §19.7). It now reads Problem, with "home page back, still failing: TLS chain misconfigured".
   - Draw that row, so it is clearly open next to rows that are "Was down".
5. **Uptime by site.**
   - Rows below their target stand out: warning tone, the figure, the target, "30 min down · 26 min allowed".
   - Rows on target can fold under a "N on target" line, as the Chat card already does.
6. **NEEDS SOMEONE** stays the first section after the tiles, with the person's name visible on each row.

## Questions the board should answer

1. Do the tiles replace the summary lines, or sit above them?
2. Is "Last 30 days: 16/17 sites on their uptime target" a fifth tile or a line under the tiles?
3. How much of line 2 shows on a phone before it wraps?
4. In the dark mail-client view, which tones keep the badges readable?

## Note for the build

The board says today that the email body is the Chat card (same sections, plain-text part too). This redesign gives the email a layout of its own. When it is built, record that in a decision (D-xxx), next to D-056.

## Rules that apply

- **Email-safe HTML:** tables and inline styles only; no web fonts, no images needed to read it.
- **Colours:** the existing email tokens (`EMAIL_COLORS` in `packages/notifier/src/email-alerts.ts`, matched to AURA).
- **Spec §13 copy:** dates read "Fri 13 Nov", durations "1 h 2 min", percentages "99.98%". No spec codes, no table names.
- **Sample data:** use made-up sites and numbers on the board, never production data.
