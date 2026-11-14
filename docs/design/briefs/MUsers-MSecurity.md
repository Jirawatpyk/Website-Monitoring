# Brief for Claude Design: MUsers and MSecurity (Settings at 390 px)

**Boards to draw:** `MUsers` and `MSecurity`, the phone versions of `Users` and `Security` (390 × 844, light and dark).
**Routes:** `/settings/users` and `/settings/security`, built in S16 (D-062). The desktop boards are built from `Users.dc.html` and `Security.dc.html` with the changes below.

## On a phone these pages are view only

Spec §22.5 and D-044: the Settings editors are view only on phones. Each page starts with one line: "**View only on phones.** Admins change policies on a larger screen." Nothing on the page edits, saves or opens an editor, and there is no "Open on desktop" button. The viewer is an Admin; everyone else gets the shared No access notice.

## What changed on the desktop boards (draw the phone from this, not the old boards)

D-007 and D-011 removed these, so leave them off the phone boards too:

- every 2-step element: the 2-step column and badges, the lock callout, the rollout banner, the 2-step card and "Remind Nok";
- the invite link, its expiry and "Resend invite". An invite is an access-list row: a pending row reads "Not signed in yet · added Thu 24 Sep";
- "Stay signed in for" and "Admin actions ask Google again", and the save bar;
- device location ("Bangkok") and "· Ack link". A device reads "Chrome · macOS · last used today 07:52" with a Phone / Laptop / This device tag.

## MUsers: what the page holds

- **Phone top bar:** "Settings", back arrow to Overview (spec §22.1).
- **Tabs:** Users & roles · Sign-in & security. Only these two ship now. Alert channels and Organisation come with S17.
- **Banner** while there is one active Admin: "1 active Admin — monitor-fault alerts reach only {name}". The name is the real Admin's, not "Tao".
- **Count line:** "7 people · Google Workspace accounts only · role changes are logged".
- **People:** today the desktop table has Name (with email, "· AM", or "Not signed in yet · added …"), Role badge, Alert channels (Chat / Email, or "No Chat id"), Owner · backup ("6 · 1"), On-call ("On call now", "Next: 5 Oct", "Admin backstop") and Last active.
- **"What each role can do":** the role matrix from the desktop board. It has 10 rows and 5 role columns.

## MSecurity: what the page holds

- **"Who can sign in":** the company domains (read only), and "Block personal accounts · Always on".
- **"People and their sign-in":** Person (with "· On call now"), Role, Devices (count), Last sign-in ("Today 07:52", "Signed out · 10:08", "Not signed in yet").
- **"Recent sign-in events":** the newest Access entries from the audit log, e.g. "Refused sign-in · an address @gmail.com", "Tao invited new@dxt", "Tao signed Nok out everywhere", with an "Audit log" link.
- **"If Google sign-in is down":** the card from the desktop board.

## Questions the boards should answer

1. **People rows:** each row is a card (the MMaintenanceList / MAuditLog pattern). Which facts go on the card, and does a tap open a sheet with the rest (Alert channels, Owner · backup, On-call, Last active)?
2. **Role matrix at 358 px:** five columns don't fit. A per-role list ("Responder can: …"), a Select for the role, or a scrolling table?
3. **Sign-in events:** how many show, and how long can one line run?
4. **Tabs:** a two-item segmented control or tabs under the top bar?

## Rules that apply

- Spec §22 items 1–3: one column, 16 px padding, 44 px targets, the bottom nav with nothing selected, no sideways page scroll.
- The phone patterns of MAuditLog (cards, sheet, Show more) and MEscalation (view only line).
- AURA components and tokens only. Sample names are mock data.
