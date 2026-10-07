---
name: verifier-staging
description: How to drive DxT Monitor on staging for `/verify` — deploy the slice in the right order, flip the test target's mode, read the outcome in the staging database, inbox and incident page, and reset between runs. Use when verifying a slice that changes the probes, engine, notifier, verifier or incident pages.
---

# Verify on staging

Staging = Vercel project `dxt-monitor-staging` (branch `staging`, https://monitor-staging.dxtspace.com), the staging Supabase project (ref `ctxmmrhvrjbkpodpgkqd`), `dxt-agent@staging` on the Thai VPS, and the test target (Vercel project `dxt-test-target`, https://dxt-test-target.vercel.app). Every deploy step below needs Tao's OK first (`docs/workflow.md` step 7). Never touch production.

## 1. Deploy, in this order

1. **Migrations first** — `pnpm db:push:staging --dry-run`, then `pnpm db:push:staging`. Code that calls new or changed `engine_*` parameters fails with "function not found" against the old database.
2. **Web** — `git push --force-with-lease origin HEAD:staging`; wait until the staging deployment is Ready.
3. **Test target** (only if `apps/test-target` changed) — the push above builds a Preview of `dxt-test-target`; promote it: `vercel --scope team_KLEKhF6PuSAbJSmgDpyEXES4 ls dxt-test-target`, then `vercel --scope team_KLEKhF6PuSAbJSmgDpyEXES4 promote <preview url> --yes`.
4. **VPS agent** (only if `apps/vps-agent` or a package it bundles changed) — `pnpm --filter @dxt/vps-agent build`, copy `apps/vps-agent/dist` to the VPS (`ssh -i ~/.ssh/dxt_vps root@38.60.233.62`), `rsync` it into `/opt/dxt-agent/dist/`, then restart **only** `dxt-agent@staging` and read `journalctl -u dxt-agent@staging -n 6`. Both instances share `/opt/dxt-agent` today, so keep agent changes backward-compatible with production's server.

## 2. Drive: the test target's mode

The mode is the `mode` item in the test target's Global Config store (`ecfg_z2zpfqb921nns4zzby1bfaptqzo4`). Flip it with the Vercel CLI and confirm what a probe and a browser get:

```bash
echo '{"items":[{"operation":"upsert","key":"mode","value":"<mode>"}]}' > "$TEMP/mode.json"
vercel api "/v1/edge-config/ecfg_z2zpfqb921nns4zzby1bfaptqzo4/items?teamId=team_KLEKhF6PuSAbJSmgDpyEXES4" --method PATCH --input "$TEMP/mode.json"
curl -s -o /dev/null -w "%{http_code} %header{x-target-mode}\n" -A "DxT-Monitor/1.0" https://dxt-test-target.vercel.app/
```

Modes (`apps/test-target/CLAUDE.md`) and the outcome to expect (StatusModel, D-022):

| Mode                | Expect                                                                                                   | When                       |
| ------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------- |
| `ok`                | OK                                                                                                       | next round                 |
| `error` / `timeout` | DOWN (`hard_fail`), Chat + email                                                                         | ~1–2 min (check + recheck) |
| `challenge`         | OK with the note "Automated check blocked by bot protection; verified via browser" (verify job `loaded`) | ~1–2 min                   |
| `challenge-all`     | PROBLEM `blocked_unverified` ("blocked in the browser too", D-020)                                       | ~1–2 min                   |
| `keyword-missing`   | PROBLEM `keyword` (the staging monitor has `must_contain = {Test target}`)                               | the next round             |
| `slow`              | PROBLEM `slow` on the **3rd** slow round (Tier 1: ~3–4 min)                                              |                            |

A round that straddles the switch can mix outcomes (e.g. part challenged, part 500 → the browser decides).

## 3. Observe

- **Database** — the Supabase SQL editor of the staging project (browser pane, signed in by Tao): https://supabase.com/dashboard/project/ctxmmrhvrjbkpodpgkqd/sql/new. Find the editor with `find "Editor content"`, then select-all, type, `ctrl+Return`, `get_page_text`. Return one JSON value so the result isn't cut off, e.g.:

  ```sql
  select json_build_object(
    'site', (select row_to_json(x) from (select status, note, last_round_at from site_status st join sites s on s.id = st.site_id where s.name = 'Test target') x),
    'inc', (select json_agg(y) from (select number, state, severity, trigger, started_at, detected_at,
      (select json_agg(json_build_object('t', n.template, 'c', n.channel, 's', n.status, 'at', n.sent_at)) from notifications n where n.incident_id = i.id) msgs
      from incidents i join sites s on s.id = i.site_id where s.name = 'Test target' and i.created_at > now() - interval '10 min') y),
    'ms', (select json_agg(z) from (select status, trigger, cause, slow_rounds, last_round_at from monitor_status) z),
    'checks', (select json_agg(c) from (select location, checked_at, outcome, response_ms, keyword_missing from check_results where checked_at > now() - interval '3 min' order by checked_at desc limit 9) c)
  ) j;
  ```

  Delivery per attempt: `notification_attempts` (`ok`, `error`, `provider_message_id`). Verify jobs: `verification_jobs`.

- **Incident page** — https://monitor-staging.dxtspace.com/incidents/<id> in the browser pane (Tao's session): badge, "Detected" (PROBLEM) or "Confirmed down" (DOWN), cause, log.
- **Email** — Tao's inbox through the Gmail tools: `subject:("Test target" INC-00nn)`; one thread per incident.
- **Chat** — the staging Chat space is Tao's; `notification_attempts.provider_message_id` proves the post landed.

## 4. Reset between runs

Until S04b builds relapse, a new problem on an incident that is still open (Monitoring / Needs root cause) opens nothing new. Before the next mode run `supabase/staging/reset-test-incident.sql` in the SQL editor, and leave the target on `ok` at the end.
