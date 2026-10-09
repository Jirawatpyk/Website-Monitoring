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
4. **VPS agent** (only if `apps/vps-agent` or a package it bundles changed) — `apps/vps-agent/deploy/release.sh staging`: it builds, installs into `/opt/dxt-agent/staging/` and restarts **only** `dxt-agent@staging`, then prints its journal. Production keeps its own release in `/opt/dxt-agent/production/` until `release.sh production` after the merge.

## 2. Drive: the test target's mode

The mode is the `mode` item in the test target's Global Config store (`ecfg_z2zpfqb921nns4zzby1bfaptqzo4`). Flip it with the Vercel CLI and confirm what a probe and a browser get:

```bash
echo '{"items":[{"operation":"upsert","key":"mode","value":"<mode>"}]}' > "$TEMP/mode.json"
vercel api "/v1/edge-config/ecfg_z2zpfqb921nns4zzby1bfaptqzo4/items?teamId=team_KLEKhF6PuSAbJSmgDpyEXES4" --method PATCH --input "$TEMP/mode.json"
curl -s -o /dev/null -w "%{http_code} %header{x-target-mode}\n" -A "DxT-Monitor/1.0" https://dxt-test-target.vercel.app/
```

Modes (`apps/test-target/CLAUDE.md`) and the outcome to expect (StatusModel, D-022):

| Mode                | Expect                                                                                                                                                                                                                                    | When                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `ok`                | OK                                                                                                                                                                                                                                        | next round                 |
| `error` / `timeout` | DOWN (`hard_fail`), Chat + email                                                                                                                                                                                                          | ~1–2 min (check + recheck) |
| `challenge`         | OK with the note "Automated check blocked by bot protection; verified via browser" (verify job `loaded`)                                                                                                                                  | ~1–2 min                   |
| `challenge-all`     | PROBLEM `blocked_unverified` ("blocked in the browser too", D-020)                                                                                                                                                                        | ~1–2 min                   |
| `keyword-missing`   | PROBLEM `keyword` (the staging monitor has `must_contain = {Test target}`)                                                                                                                                                                | the next round             |
| `slow`              | PROBLEM `slow` on the **3rd** slow round (Tier 1: ~3–4 min)                                                                                                                                                                               |                            |
| `waf-partial`       | with the site flagged Behind WAF: OK with "Verified from BKK; SIN, TYO blocked by bot protection"; `check_results.waf = 'cloudflare'` at SIN / TYO, `control_ok = true` at BKK. Flag off: the verifier path, as `challenge` (S05b, D-027) | next round                 |
| `waf-partial-down`  | with the flag on: DOWN on the Bangkok probe alone (503 + its recheck), Chat + email                                                                                                                                                       | ~1–2 min                   |

Relapse, flapping and auto-resolve (S04b, D-024), on one incident without a reset in between:

| Sequence                                              | Expect                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `error` → `ok` (2 rounds) → `error`                   | DOWN, RECOVERED, then DOWN AGAIN in the same thread (`down_again`), incident back to Unacked                 |
| `error` / `ok` once more after that                   | the 3rd change in 30 min: `is_flapping`; the next recovery queues `flap_summary` (held 15 min), no RECOVERED |
| leave it `ok` 15 min                                  | one RECOVERED summary in Chat + one owner email ("flapped ×n, down … in total")                              |
| fresh incident: `keyword-missing` → `ok` within 5 min | PROBLEM, then RECOVERED without a mention, "resolved automatically"; `incidents.auto_resolved`               |

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

Sites screens (S05, D-025), as Tao in the browser pane on https://monitor-staging.dxtspace.com/sites:

| Do                                                                        | Expect                                                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Add site with a private URL (`http://10.0.0.5/`) → Save draft             | refused, "This address points inside a private network…", nothing saved                 |
| Add site → Test check on the test target                                  | SIN + TYO rows from the real probe code; BKK "Runs from BKK on the first round"         |
| Save draft with empty owners, then owners + credential → Start monitoring | Draft, then live; probes pick it up on the next round; one `audit_log` row per change   |
| Edit monitors → add a key page / a header → Save changes                  | "Saved — takes effect on the next round"; the next `check_results` include the key page |
| Edit site → Stop monitoring                                               | back to Draft; no new `check_results` for it                                            |

Staging has one person (Tao) and no Google Chat id on that profile, so Start monitoring and Stop on a new site can't be driven there (Start needs two different owners with Chat ids, D-015): the local e2e `e2e/sites.spec.ts` covers them. For the same reason the live Test target can't be saved from Edit site until it has a backup owner with a Chat id — re-run `staging/test-target.sql` with a second linked person if a run needs it. On the production build, set form fields by typing (click the field first), not by `form_input`, which doesn't reach React state.

Incidents, notes and Resolve (S07, D-033), as Tao on https://monitor-staging.dxtspace.com/incidents — drive the Test target `error` → wait for DOWN → `ok` and wait two rounds (Needs root cause):

| Do                                                                          | Expect                                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open the incident while still down                                          | Resolve card "Resolve locked · 1 of 3 met — Test target is still down"; Resolve… disabled                                                               |
| Add note                                                                    | "Note by Tao" on the timeline at once; `notifications` row `template = 'note'`, Chat only, `hold_until` null; Chat thread `NOTE · Test target · Tao: …` |
| After two OK rounds: Resolve… → Unknown                                     | "Save, keep open"; incident stays Needs root cause                                                                                                      |
| Resolve… → a category + What happened → Resolve incident → Undo inside 10 s | "Posting to Chat and email in N s"; Undo → back to Needs root cause; every `resolved` row `cancelled`                                                   |
| Resolve again and wait                                                      | after 10 s `RESOLVED · Test target · by Tao HH:MM` in the thread, the RESOLVED email in the incident's email thread (`resolved` rows `sent`)            |
| `/incidents` (list) and the Overview                                        | the incident moves to Resolved & closed; the Overview's Next step "Add root cause" opened the Resolve dialog (`#resolve`) before it was resolved        |

```sql
select json_agg(x) from (select template, channel, status, hold_until, sent_at from notifications n join incidents i on i.id = n.incident_id join sites s on s.id = i.site_id where s.name = 'Test target' and n.created_at > now() - interval '30 min' order by n.created_at) x;
```

- **Browser pane under width emulation** (`resize_window` 1440 / 820 / 390): clicks by coordinate can miss and screenshots can be stale or half-size (S06b `/verify`: "Acknowledge did nothing"). Check the control is on top with `document.elementFromPoint`, act with a DOM `.click()`, and read layout with `getBoundingClientRect`; screenshots at those widths come from Playwright locally (e2e helpers) or from the pane without emulation. A hidden (not fronted) tab pauses `requestAnimationFrame` and CSS transitions — front it before timing anything.

## 4. Reset between runs

A new problem on an incident that is still open (Monitoring / Needs root cause) is a relapse into it (S04b), not a new incident. For a clean start — a fresh DOWN or PROBLEM card — run `supabase/staging/reset-test-incident.sql` in the SQL editor first, and leave the target on `ok` at the end.
