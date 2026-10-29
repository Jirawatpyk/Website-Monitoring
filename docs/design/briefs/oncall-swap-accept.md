# Brief for Claude Design: the other side of an on-call swap, and the test-alert landing

**For:** the DxT Monitor design canvas. Please add states to the existing **OnCall** (desktop 1440) and **MOnCall** (phone 390) boards.
**Design system:** AURA, as on every other board. Reuse the swap request card and the rotation rows OnCall already draws.
**Status:** asked 29 Oct 2026 for slice S10 (on-call, PR B). S10's code waits for these states.
**Decision:** D-048 (Tao, 29 Oct 2026). A swap is **accepted by the person asked, then approved by an Admin**, as the OnCall board and the Guide say. Every step is logged. Missing UI goes to Claude Design; Claude drafts the message text.

## The gap

OnCall draws a swap from two sides. The **Admin** (Tao) sees the request card with Approve / Decline. The **requester** (Ploy on MOnCall) sends "Request a swap". Nothing shows the **person asked** (Nok in the board's sample). Nok gets a Chat message and an email ("Nok gets a Chat message and an email"), opens the link, and then:

- has no screen to **accept or decline**;
- after accepting, has no state that says it now waits for an Admin.

The phone checklist has the same kind of gap. MOnCall's "Open test link on this phone" ticks "Test alert received on this phone" by itself, but no board shows what the phone shows **when that link opens**.

## What to draw

### 1. The person asked: an incoming swap request (desktop and phone)

The link in the Chat / email message opens `/oncall?swap=<id>`. Please draw it for **Nok**, at 1440 and 390:

- **Request card**, near the top:
  - "Arm asks you to swap weeks";
  - the two weeks side by side, Arm's week and Nok's week, each with dates (e.g. "You take Mon 5 → 12 Oct · Arm takes Mon 19 → 26 Oct");
  - Arm's reason, if given;
  - the back-to-back warning when it applies (OnCall already words it: "Nok would be on call … two weeks in a row").
- **Actions:** **Accept** (primary) and **Decline** (secondary).
  - **Decline** opens a small dialog with an optional reason. The OnCall decline dialog is the Admin's and its reason is required; Nok's reason is optional.
- **States after acting:**
  - **Accepted:** "Accepted · waiting for an Admin to approve. Nothing changes in the rotation until then." The rows for both weeks show **Swap requested**, as today.
  - **Declined:** "You declined · Arm keeps Mon 5 → 12 Oct." Arm gets a message.
  - **Approved** (by Tao): the weeks have swapped, plus a line "Approved by Tao · Fri 10:08".
  - **No longer open:** the link opened after Arm withdrew it or an Admin declined it. "This request is closed — Declined by Tao · “reason”".
- **Undo:** none needed; Accept and Decline are reversible until the Admin acts (Arm can withdraw, Tao can decline).

### 2. The test-alert link's landing (phone)

The "TEST — no action" Chat message carries a link. Opened on the phone, it lands on **MOnCall** with:

- a success line, "Test alert received on this phone at 10:08";
- the checklist row ticked: "Received on this phone at 10:08";
- the counter at 3/3, and the card's status line "Ploy's phone 3 of 3 ready · test alert received 10:08" (MOnCall already has these words for the done state).

Please also draw the case where the link is opened **by someone else**, for example Tao opening Ploy's test link: "This test was for Ploy — open it on Ploy's phone." Nothing gets ticked.

## Who sees it

| Role | Sees |
| --- | --- |
| The person asked (Nok) | the request card with Accept / Decline |
| The requester (Arm) | the request card read-only, with "Withdraw" |
| An Admin | the request card with Approve / Decline (as drawn) — Approve unlocks once Nok accepts |
| Everyone else | the rotation rows only ("Swap requested") |

## Not in scope

- The 2-step lines on OnCall: D-007 retired them. Please don't redraw them.
- The rotation editor and "Hand over shift": already drawn (OnCall, Users). S10 opens Hand over from the On-call page's live row.
- Message text (Chat / email): Claude drafts it, and message-checker reviews it (D-048).
