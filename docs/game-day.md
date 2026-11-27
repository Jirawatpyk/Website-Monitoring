# Game day (T07)

PRD §2 and §12, plan S19 Done-when 2 and D-071: the staging Test target is taken down once, as a Tier 1 site, and the time to detect and to acknowledge is recorded.

- **MTTD** is first failed check → Confirmed down (`incidents.detected_at − started_at`). This is the same rule the Overview tile uses (`packages/engine/src/metrics.ts`, D-032). It must be ≤ 3 min.
- **MTTA** is Confirmed down → acknowledged, from the confirm of the DOWN drop the ack answered (D-075; for a one-drop incident `acked_at − detected_at`). It must be ≤ 15 min. Claude acknowledges from the Chat alert, so this is Claude's time, not the team's (D-071).
- Recorded beside them:
  - the takedown time, when the mode flipped;
  - the DOWN Chat post's `sent_at`, which is what a person actually sees.

## Steps

1. **Wake staging.** `pnpm staging:resume`. The Test target must be on `ok`, with no open incident (`supabase/staging/reset-test-incident.sql`) and Tier 1.
2. **Take the site down.** Flip the Test target to `error` from a script at a recorded second (`verifier-staging` → Drive). Write the UTC time down.
3. **Wait for the alert.** Wait for the DOWN card in the staging Alerts Space. Then open the incident from the card's link on a 390 px phone view (browser pane) and press **Acknowledge**. Let the 10 s Undo run out.
4. **Bring it back.** Flip the target back to `ok`. Once it shows Needs root cause, resolve it: root cause "Hosting / server", What happened "Game day (S19): Test target set to error".
5. **Read the times** (staging SQL) and fill in the table below. Then `pnpm staging:pause`.

```sql
select i.number, i.started_at, i.detected_at, i.acked_at,
  extract(epoch from i.detected_at - i.started_at)::int as mttd_s,
  extract(epoch from i.acked_at - i.detected_at)::int as mtta_s,
  (select min(n.sent_at) from notifications n
    where n.incident_id = i.id and n.template = 'down' and n.channel = 'google_chat') as down_post
from incidents i join sites s on s.id = i.site_id
where s.name = 'Test target' order by i.created_at desc limit 1;
```

**How it ran (21 Nov).** Claude didn't watch the Chat card. After the flip it polled the staging database on a timer, saw the DOWN and its Chat post, then opened the incident page in the browser pane (it had dropped to 660 px; the 390 emulation was lost) and pressed Acknowledge. So the MTTA below includes that polling delay, and isn't a measure of how fast a person reacts to the card.

## Results

| Date (UTC) | Incident | Taken down | First failed check | Confirmed down | DOWN posted | Acked | MTTD | MTTA | Pass |
| ---------- | -------- | ---------- | ------------------ | -------------- | ----------- | ----- | ---- | ---- | ---- |
| Sat 21 Nov 2026 | INC-0077 | 08:31:00 | 08:31:01 | 08:31:32 | 08:31:37 | 08:33:21 | 32 s | 1 min 49 s | ✓ |
