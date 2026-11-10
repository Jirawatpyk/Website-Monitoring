# Design brief — Repeating maintenance: three gaps before the build (S14 PR 2c, D-057)

**Answered:** spec §32 items 2–3 (date pickers), 7a (Undo toasts) and 7b (ended series), and the refreshed boards (Claude Design, 10 Nov).

For Claude Design. Spec §32 and the boards of 6 Nov (MaintenancePage, Maintenance, MMaintenance, MMaintenanceList, ChatAlert) cover almost all of PR 2c. Three things were decided afterwards (Tao, 10 Nov) and aren't drawn yet. Sample data is test data only.

## 1. From and Ends on: date pickers, not a list of dates

The boards draw From and Ends on as a Select with a few sample dates (Mon 28 Sep, Sat 31 Oct, Thu 31 Dec). Tao chose a date picker instead:

- **From** is the first day the series may start: from today to one year ahead. **Time** stays a time picker (15-min steps).
- **Ends on** is optional, with **No end date** as the default. When set, it is a date from From to two years after it.

Please draw both in the Schedule dialog:
- desktop (Maintenance, state "Weekly · Admin");
- the phone sheet (MMaintenance).

Show:
- the empty Ends on ("No end date");
- a set Ends on with a way back to No end date;
- an Ends on before From, refused ("The last day is before the first.").

Fields at 44 px on the phone.

## 2. Undo after approve, decline and withdraw

§32.6 draws the 10 s Undo toast for **Cancel series** only ("<site> series cancelled"). Tao chose Undo for all four series actions, as one window's actions have.

Please give the toast title for each:
- approve: e.g. "Bangkok Airways – Taiwan series approved · 4 windows scheduled";
- decline;
- withdraw.

Also give what Undo says when it worked or was too late. One-window actions use "— undone · Nothing was posted." and "Too late to undo — it has been posted".

## 3. A series that ended without running: its row under Recent

§32.6 draws a **cancelled** series under Recent ("Cancelled", one log line). Three more ways a series can end aren't drawn:

| How it ended | Facts for the row |
| --- | --- |
| **Declined** by an Admin | the reason |
| **Withdrawn** by the asker | the reason; nothing was scheduled |
| **Not approved**: nobody answered by its first window (§32.7) | nothing scheduled; "ask again" |

Please draw:
- the status badge and log line for each, on the desktop table (MaintenancePage) and the phone list + sheet (MMaintenanceList);
- whether a skipped-window note still shows on an ended series (Claude's reading: no).

## Not asked

Everything else is built from the boards as drawn.
