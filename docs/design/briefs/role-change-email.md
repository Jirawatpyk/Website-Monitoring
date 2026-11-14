# Brief for Claude Design: the role-change email (an EmailAlert addition)

**Board to add to:** `EmailAlert` (light and dark, desktop mail client and phone mail client), as one more template beside the alert and maintenance emails.
**Built in:** S16 (D-062 item 10), sent by `packages/notifier`.

## When it goes

An Admin changes someone's role or deactivates them on Users & roles. The person gets one email. The Users dialog says "{name} gets an email saying what changed". Nothing is sent for an invite, since there is no invite email (D-011).

## What it must say

- **Subject:** e.g. "Your DxT Monitor role is now Stakeholder", or "Your DxT Monitor access was removed".
- **Who and when:** "Tao changed your role from Responder to Stakeholder · Fri 25 Sep 10:08".
- **What you can do now / can no longer do:** the GAINS and LOSES lists from the Users dialog. These are taken from the role matrix, e.g. "You can no longer acknowledge incidents on your sites".
- **What moved to someone else:** the reassignments the Admin picked, e.g. "Fuji Links — owner is now Ploy", "Your on-call shift from tonight — Arm", "You left the on-call rotation".
- **Deactivated:** "You can no longer sign in. Your past acknowledgements and notes stay in the audit log. Ask an Admin if this is a mistake."
- **Footer:** the same footer as the other DxT Monitor emails, with an "Open DxT Monitor" button.

## Questions the board should answer

1. Is the reassignment list a table (Place · Now with) or plain lines?
2. Is a promotion to Admin worded differently, e.g. "You now get monitor-fault emails"?
3. Is the deactivated email its own layout or the same one with a different heading?

## Rules that apply

- Spec §10, §14.11 and §13 copy rules: dates read "Fri 25 Sep", with no spec codes and no table names.
- Same type, colours and spacing as the existing EmailAlert templates; AURA tokens.
