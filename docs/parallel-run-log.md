# Parallel-run log

PRD §12 Phase 2 exit, plan S19 Done-when 4, D-071. Over two weeks, every incident the CEO's hourly monitor saw is set against DxT Monitor. The hourly monitor is switched off at G2, but only if DxT Monitor missed none.

- **Window:** Mon 9 Nov 00:00 – Sun 22 Nov 2026 23:59 Bangkok. The run has gone on since G1. The log covers these two weeks and is closed on Mon 23 Nov (D-071).
- **DxT Monitor side:** production `/incidents`, read-only, filtered to the window. Auto-resolved PROBLEMs sit behind a count there (D-033), so for each hourly-monitor row with no match, the site's own Site detail is checked too. Claude takes no production SQL.
- **Not a miss:**
  - a hit while the site was in a DxT maintenance window (logged with the window);
  - a site that wasn't live in DxT that day (logged as "not live").

  A timeout blip that opened no incident (D-049, D-050) counts as a miss.
- **Hourly monitor side:** the list Tao gives from the CEO's monitor. Each entry has the site, the time, and what it saw.
- **Match:** the same site, with a DxT incident open within the hour the hourly monitor flagged. DxT is expected to be earlier, since it checks every 1–5 min.

## Hourly monitor incidents

| #   | Site | Seen (Bangkok) | What it saw | DxT incident | DxT detected | Match |
| --- | ---- | -------------- | ----------- | ------------ | ------------ | ----- |
|     |      |                |             |              |              |       |

## DxT-only incidents (false-alert review, plan risk R4)

Every DxT incident in the window that the hourly monitor didn't see. Each one is a real short outage, a PROBLEM the hourly check can't see (slow, keyword, SSL), or a false alert. A false alert needs a cause and a fix.

| DxT incident | Site | Trigger | Started (Bangkok) | Duration | Verdict | Cause / fix |
| ------------ | ---- | ------- | ----------------- | -------- | ------- | ----------- |
|              |      |         |                   |          |         |             |

## Result

- Hourly-monitor incidents: — · matched: — · missed by DxT: —
- DxT-only: — (false alerts: —)
