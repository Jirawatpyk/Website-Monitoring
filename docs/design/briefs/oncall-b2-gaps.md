# Brief for Claude Design: the on-call states no board draws yet

**For:** the DxT Monitor design canvas. Please add states to the existing **OnCall** (desktop 1440), **MOnCall** (phone 390) and **Incident / MobileAckDark** boards.
**Design system:** AURA, as on every other board. Reuse what OnCall and MOnCall already draw: the swap side card, the request card, the rotation rows, the hero and the Users board's "Hand over shift" dialog.
**Status:** asked 30 Oct 2026 for slice S10, last PR (B2c, the On-call screens). B2c builds everything already drawn first; these five parts wait for the boards.
**Decisions:** D-048. A swap is accepted by the person asked, then approved by an Admin. Hand over is built in S10 and opened from "Hand over…" on the On-call page's live row. Claude drafts the message text. The 2-step lines are retired (D-007), so please don't draw them.

## What to draw

### 1. The swap side card on a phone (MOnCall)

At 1440 the side card serves two people. The **requester** (Arm) gets Withdraw. The **Admin** (Tao) gets Approve, unlocked once the person asked accepts, and Decline, which needs a reason. MOnCall draws only the person asked (Nok) and Ploy's "Request a swap". On a phone, please draw:

- **Arm, the requester:** the open request as Arm sees it ("Waiting for Nok", then "Waiting for an Admin"), with **Withdraw**. Then Arm's closed states: approved, declined by Nok, declined by Tao, withdrawn, and expired (§4 below).
- **Tao, the Admin:** the same request with **Approve** and **Decline**, and the Decline dialog with its required reason. Approve is disabled until Nok accepts, with the reason "Approve unlocks once Nok accepts".

Spec §22.4 lists "request an on-call swap" among the actions that must work on a phone, so answering one must work on a phone too.

### 2. Hand over on a phone (MOnCall)

On the On-call page's live row, desktop has **"Hand over…"**, which opens the Users board's "Hand over shift" dialog:

- the new person;
- when it takes effect: Now / Tonight 18:00 / the next morning;
- that person's phone checklist and **Send test alert**;
- the summary line;
- a required reason.

Please draw that dialog at 390 (a full-height sheet is fine), opened from the live row card on MOnCall. Who sees it: Admins only.

### 3. States with no one to page

Neither board shows these. Please draw the **hero** and the **rotation** for each, at 1440 and 390:

- **Nobody on call right now.** The rotation is empty, or no week has been made yet. Until a rotation exists, Tier 1 nights page the site owners (routing falls back to the owner). The page should say so and, for an Admin, lead to **Edit rotation**.
- **An empty rotation**, which is the first time on production. The Admin sees Edit rotation as the main action; others see a short line saying an Admin sets it up.
- **A shift that was handed over.** Ploy's live week was handed to Arm from Tonight 18:00. The hero names Arm, with something like "Covering Ploy from 18:00 · ill tonight" (the reason is shown only to the people involved and Admins). Ploy's row shows that it was handed over. The Users board already words "Handed to Arm" / "Covering Ploy".
- **A rotation of one person** (production starts with Tle alone). Swap is disabled with the reason "Nobody else in the rotation to swap with". The hero still works: Tle is on call every week.

### 4. An expired swap request

A request still open when one of its weeks starts **expires**: it can't be approved on a live week (D-048). Please draw it on the request card (Nok), the side card (Arm, Tao) and the rotation row: "Expired — Arm's week started before it was approved", with both weeks unchanged.

### 5. Who was paged on call: the Incident header (Incident, MobileAckDark)

At night a Tier 1 incident pages the person on call, not the owner. Today the Incident header shows "OWNER Arm · Backup Ploy · AM Bua" and nothing about who was actually paged. The Chat card already says "On call · Ploy (Tier 1, outside response hours) — the person who acts" and "Owner · Arm · not paged outside response hours". Please draw how the Incident header (desktop) and MobileAckDark (phone) show **who was paged on call** for an incident opened outside response hours.

## Who sees it

| Role | Sees |
| --- | --- |
| The requester | their request with Withdraw, and its closed states |
| The person asked | the request card (already drawn) |
| An Admin | Approve / Decline, Hand over…, Edit rotation |
| Everyone else | the hero, the rotation and the Incident header, read-only |

## Not in scope

- The 2-step lines (retired, D-007).
- Message text for Chat and email: Claude drafts it, and message-checker reviews it (D-048 item 11).
- The person asked's request card and the test-link landing: already drawn (29 Oct).
