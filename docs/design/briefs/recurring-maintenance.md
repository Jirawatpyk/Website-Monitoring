# Design brief — Recurring maintenance (FR-10b, D-057)

**Answered:** spec §32 and the MaintenancePage / Maintenance / MMaintenance / MMaintenanceList / ChatAlert boards (Claude Design, 6 Nov 2026).

For Claude Design. Boards to extend:
- **MaintenancePage** (desktop, from xl)
- **MMaintenanceList** (phone 390)
- **Maintenance** / **MMaintenance**: the Schedule maintenance dialog / sheet
- **ChatAlert**: one or two new rows

Sample data below is test data only. The behaviour is settled in D-057. This brief asks for the layout and the words.

## What it is

Some sites have work every week or month, for example "Tubtong · every Tue 01:00–03:00 · WordPress plugin updates". Today someone has to schedule each window by hand. A **series** fixes that:

- **Occurrences:** each occurrence is an ordinary maintenance window. It starts, ends, "didn't start" when the site is DOWN, posts STARTED / ENDED in its own thread, and is left out of uptime. Occurrences are created 14 days ahead.
- **Approval:** the series is approved once. An Admin's series is approved on create; a Responder's waits for an Admin, and nothing is created until then.
- **Repeats:**
  - weekly, on chosen weekdays;
  - monthly, on day N (a month without that day is skipped) or on the 1st, 2nd, 3rd or 4th weekday (for example "2nd Tuesday").
- **Limits:** each occurrence lasts at most 24 h, and the first one is at least 5 min away (no "start now").
- **Overlap:** an occurrence that would overlap another window on the site is skipped. The series notes it.
- **Cancelling:** cancelling the series cancels the occurrences that haven't started. One that is running finishes.

## States to draw

1. **Schedule dialog, Repeat control**, in desktop and phone. This is the existing dialog for a single window (site, start, length, reason) plus **Repeat**:
   - options: Does not repeat (default) · Weekly · Monthly;
   - Weekly: weekday chips (Mon … Sun), at least one;
   - Monthly: "Day 15" or "2nd Tuesday" (a choice of the two);
   - optional "Ends on" date;
   - a summary line, e.g. "Every Tue 01:00–03:00 · from Tue 10 Nov · next 2: Tue 10 Nov, Tue 17 Nov";
   - the guard line when a Responder asks: "An Admin approves the series once; nothing is scheduled until then."
2. **Maintenance page**:
   - **Desktop table:** how a series shows. Proposal: one row for the series ("Every Tue 01:00–03:00", with a Repeat icon, next occurrence, reason, owner, ⋯), and its occurrences under Scheduled / Recent like any window, each tagged "Part of a series".
   - **Phone list:** the same, as row cards.
   - **Empty:** no series yet.
3. **Series ⋯ menu:** Cancel series… (reason required, confirm text "Cancels the 2 occurrences that haven't started. One that is running finishes.") and, for an Admin on a waiting series, Approve / Decline. Should "Edit series" be in v1, or cancel and recreate?
4. **Waiting series** (asked by a Responder): its state badge, and who must act. Use the same pattern as a request over 24 h.
5. **Skipped occurrence:** a row or note "Skipped Tue 24 Nov — overlaps WeCare Studio maintenance 00:00–04:00".

## Messages (ChatAlert rows; email: say if you want one)

- **Series scheduled** (one line for the whole series), e.g. `MAINTENANCE SCHEDULED · Tubtong · every Tue 01:00–03:00 · from Tue 10 Nov · “WordPress plugin updates” · by Ploy`
- **Series request / approved / declined**, for a Responder's series: as the request-over-24-h rows?
- **Series cancelled:** `MAINTENANCE CANCELLED · Tubtong · series every Tue 01:00–03:00 · 2 occurrences cancelled · by Tao`
- **Each occurrence:** the existing STARTED / ENDED / DIDN’T START rows unchanged. Should they mention "(weekly)"?

## Open questions

- Does the weekly summary's "Coming up" list each occurrence or the series once? Today it lists every window in the next 7 days.
- Thread: should every occurrence post in its own thread, or should a series keep one thread?
