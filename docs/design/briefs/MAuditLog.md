# Brief for Claude Design: MAuditLog (Audit log at 390 px)

**Board to draw:** `MAuditLog`, the phone version of `AuditLog` (390 × 844, light and dark).
**Route:** `/audit`, built in S15 (D-061). The desktop board `AuditLog.dc.html` is built and stays as it is.

## What the page holds

The same content as the desktop board. The viewer is an Admin (Tao); everyone else gets No access.

- **Header:** the phone top bar "Audit log" with the back arrow to Overview, spec §22.1. Below it, the meta line: "Who did what, when, with the value before and after. Nobody can edit or delete an entry, Admin included."
- **Export CSV:** full width. When a filter is set it reads "Export 12 rows". After a tap it shows "audit-log.csv · 12 rows downloaded".
- **Filters:**
  - Category (All · Incidents · Monitor · Config · Maintenance & mute · On-call · Access). Seven options don't fit in a 358 px segmented control.
  - Actor: Everyone · System · people.
  - When: Today · Last 7 days · Last 30 days · All time.
- **Count line:** "34 entries · Fri 18 Sep → Fri 25 Sep 10:07 · filtered from 120", plus Clear filters. Over 500 entries it reads "Newest 500 of 1,234 entries · … · Export has them all".
- **Entries:** one card per row, never a sideways table (§22.2). Each entry has:
  - Time: "10:03:41" today, "Thu 22:22" this week, "Fri 18 Sep 16:20" older.
  - Actor: avatar and name, or "System".
  - Action: words ("Acknowledged") with the mono code (`incident.ack`).
  - Entity: "INC-0142 · MuvMi", a site, "Fuji Links · /", "Week Mon 5 → 12 Oct".
  - Before → After: struck Before, then After. Either can be long, e.g. "ends Sat 14 Nov 22:00 · approved yes · “Move to a new hosting provider”".
- **Paging:** 50 entries a page on desktop.
- **Empty:** "No entries match these filters." with Clear filters.
- **Footnote:** "Entries are kept forever and can’t be edited or deleted. “System” rows are written by the status engine and the notifier."

## Questions the board should answer

1. **Category:** what replaces the 7-option segmented control on a phone? A Select like Actor and When, or a horizontally scrolling chip row? Spec §22.3: 44 px targets.
2. **Card layout:** where does the time sit, where does the code sit, and does Before → After stack (Before on one line, After under it)?
3. **Long Before / After:** can a card open a sheet with the full values (like MMaintenanceList), or do they wrap in the card?
4. **Paging:** a "Show more" button or page numbers?

## Rules that apply

- Spec §22 items 1–3: one column, 16 px padding, 44 px targets, and the bottom nav with no item selected. Audit log "works fully at 390" (item 5).
- The phone row-card pattern from MMaintenanceList / MSites.
- AURA components and tokens only. The sample data is mock: the same rows as AuditLog.
