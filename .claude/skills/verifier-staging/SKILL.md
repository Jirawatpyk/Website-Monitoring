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

| Mode                | Expect                                                                                                                                                                                                                                    | When                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `ok`                | OK                                                                                                                                                                                                                                        | next round                  |
| `error` / `timeout` | DOWN (`hard_fail`), Chat + email                                                                                                                                                                                                          | ~1–2 min (check + recheck)  |
| `challenge`         | OK with the note "Automated check blocked by bot protection; verified via browser" (verify job `loaded`)                                                                                                                                  | ~1–2 min                    |
| `challenge-all`     | PROBLEM `blocked_unverified` ("blocked in the browser too", D-020)                                                                                                                                                                        | ~1–2 min                    |
| `keyword-missing`   | PROBLEM `keyword` (the staging monitor has `must_contain = {Test target}`)                                                                                                                                                                | the next round              |
| `slow`              | PROBLEM `slow` on the **3rd** slow round (Tier 1: ~3–4 min)                                                                                                                                                                               |                             |
| `waf-partial`       | with the site flagged Behind WAF: OK with "Verified from BKK; SIN, TYO blocked by bot protection"; `check_results.waf = 'cloudflare'` at SIN / TYO, `control_ok = true` at BKK. Flag off: the verifier path, as `challenge` (S05b, D-027) | next round                  |
| `waf-partial-down`  | with the flag on: DOWN on the Bangkok probe alone (503 + its recheck), Chat + email                                                                                                                                                       | ~1–2 min                    |
| `waf-partial-slow`  | with the flag on: PROBLEM · Slow on the 3rd slow BKK round ("p50 6.x s (BKK)"); back to `waf-partial` → RECOVERED "from 1 location". Staging has one site, so D-039's slow-location rule never applies there                              | Tier 1: ~3–4 min            |
| `defaced`           | PROBLEM · Keyword `Found “สล็อตออนไลน์”, “บาคาร่า” on / (BKK, SIN, TYO)` — the probes' shared list, no view suffix (S09c)                                                                                                                 | next round                  |
| `cloaked-ua`        | PROBLEM · Keyword `… on / (as Googlebot)` once the crawler has run; `crawler_checks` googlebot row `usable`, `forbidden` set                                                                                                              | next crawler run (≤ 30 min) |
| `cloaked-referer`   | PROBLEM · Redirect `/ → example.com · not in this site’s allowlist (from Google search)`                                                                                                                                                  | next crawler run            |
| `deep-spam`         | PROBLEM · Keyword `… (as Googlebot)` from the crawler's whole-body read; the probes' `keyword_forbidden` stays empty (256 KB sample)                                                                                                      | next crawler run            |
| `defaced-title`     | PROBLEM · Page change `/ · title “Test target” → “… \| Lucky Deals”` on the 3rd plain fetch (S09d); the Incident page's What changed shows Was / Now                                                                                      | 3rd crawler run (~1 h)      |
| `injected-script`   | PROBLEM · Page change `/ · new script domain evil-cdn.example` (S09d); Accept as new baseline (Admin) → `audit_log` `page_baseline.accept`, recovers on the next plain fetch                                                              | next crawler run            |

Start clean (`reset-test-incident.sql`): an incident left open by an earlier run swallows the page change as a relapse (S09d — INC-0041 did). It also puts the page baseline back to the newest clean plain fetch, so an Accept from an earlier run (which keeps evil-cdn.example) doesn't mute the next `injected-script` — run it with the target on `ok`. The page-change modes (S09d, D-046) open a PROBLEM only with `PAGE_CHANGE_ALERTS=on` on `dxt-monitor-staging` (a redeploy after setting it) and once the Test target's 14-day recording is over: backdate it with `update page_baselines set first_set_at = now() - interval '15 days' where monitor_id = (select id from monitors where url like '%dxt-test-target%' and is_primary)`. Back on `ok`, the next plain fetch matches and recovers it (after an accept: the fetch after the accept). Read `select view, usable, fingerprint->>'title', fingerprint->'scripts', checked_at from crawler_checks where view = 'plain' order by checked_at desc limit 3`.

The defacement modes (S09c, D-042) open a PROBLEM only with `DEFACEMENT_ALERTS=on` on `dxt-monitor-staging` (a redeploy after setting it); off, the engine summary logs `defacementHeld` instead. The crawler runs at :00 and :30; to skip the wait, press **Run** next to `/api/cron/crawler` on Vercel → `dxt-monitor-staging` → Settings → Cron Jobs (no secret needed; S09c run), or call it as Vercel Cron does — `curl -s -H "Authorization: Bearer $CRON_SECRET" https://monitor-staging.dxtspace.com/api/cron/crawler` (the staging secret, from Tao) — and read `select view, usable, status_code, forbidden, final_url, checked_at from crawler_checks order by checked_at desc limit 4`. Recovery on `ok` needs the next crawler run (a clean usable row replaces the bad one); `waf-partial` gives `usable = false` rows (no data) and no PROBLEM.

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

Maintenance messages (S09b, D-037, spec §24), as Tao on https://monitor-staging.dxtspace.com/maintenance with the Test target. Tao is an Admin, so his windows are approved on create (the Responder's request → Admins path is proved locally, D-007); with no Chat id on his profile, a mention shows as his plain name:

| Do                                                                                                      | Expect                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schedule maintenance for later (1 h — the dialog offers 1 h, 4 h, 8 h, 24 h, 3 days) on the Test target | a new Space thread: `MAINTENANCE SCHEDULED · Test target · … (1 h) · “reason” · by Tao`; the owner / backup email (subject `Test target · Maintenance · <start>`) unless Tao is the only one (actor skipped)                                                                                               |
| Edit end, then cancel → **Undo** inside 10 s                                                            | toast "Posting to Chat and email in N s" with "Undo · N s"; after Undo the window is back, nothing more posts (the rows end `cancelled`, `error = 'Undone'`), the log says "Undone … — nothing was posted"                                                                                                 |
| Cancel again and wait                                                                                   | `MAINTENANCE CANCELLED · …` replies in the same thread ~12 s later                                                                                                                                                                                                                                         |
| Mute 1 h → mode `error` → DOWN (no card) → End now                                                      | `MUTED · …` line; at End now (after its 10 s) `MUTE ENDED EARLY · … · INC-00nn posted (DOWN since HH:MM)` and the DOWN card with "Held by a mute until HH:MM · escalation starts now"                                                                                                                      |
| Edit end → once the toast counts down, open another row or dialog (§24.12)                              | the toast turns "Posted to Chat and email." — **prove it in the DB, not the toast** (the same words show when the 10 s simply run out): the action's rows have `hold_until` = the moment you opened the dialog, well before created + 10 s, and the window's `undo_until` and last log `posts_at` equal it |

```sql
select json_agg(x) from (select n.template, n.channel, n.status, n.user_id is not null as to_person, n.hold_until, n.context->>'kind' kind, n.context->>'dm' dm, n.sent_at
  from notifications n join maintenance_windows w on w.id = n.maintenance_window_id join sites s on s.id = w.site_id
  where s.name = 'Test target' and n.created_at > now() - interval '1 hour' order by n.created_at) x;
```

Escalation L0–L1 (S08, D-034). The Test target is Tier 1, so its ladder runs 24/7. L1 needs a backup with a Google Chat id: the test site's backup must be a second linked person, re-run `staging/test-target.sql` with one if needed. If Tao owns the site, L1 asks the backup alone, because Tao was already told at L0. Start clean (`reset-test-incident.sql`), drive `error`, and **don't acknowledge**:

| Do                                      | Expect                                                                                                                                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wait for DOWN                           | DOWN text line ends "· acknowledge by HH:MM or it escalates"; card rows "backup … (not notified yet)" and "Next · L1 at HH:MM if not acknowledged — <backup>, Tao"                                                                                  |
| Wait 15 min after "Confirmed down"      | `step_fired` event at +15 min; a Chat reply `<backup> ESCALATED · L1 · Test target DOWN 15 min, not acknowledged · please acknowledge · Tao FYI` (`provider_message_id` set); L1 emails to the backup (asked) and Tao (FYI); badge "Escalated · L1" |
| Wait to +30 min                         | `STILL DOWN · Test target · 30 min, not acknowledged · please acknowledge`, @mentioning the owner and the backup (Chat only)                                                                                                                        |
| Acknowledge                             | `ACKNOWLEDGED · Test target · by Tao HH:MM · L1 stopped`; no more reminders; a reminder still queued is `cancelled` (`Superseded: acknowledged first`)                                                                                              |
| `/escalation` as Tao (1440 / 820 / 390) | the editor from md (Edit L1, the save dialog with a note writes one `escalation.update` audit row); below md "View only on phones."                                                                                                                 |

```sql
select json_build_object(
  'inc', (select row_to_json(x) from (select number, state, escalation_level, detected_at, escalation_plan from incidents i join sites s on s.id = i.site_id where s.name = 'Test target' order by i.created_at desc limit 1) x),
  'steps', (select json_agg(e) from (select type, at, payload from incident_events e join incidents i on i.id = e.incident_id join sites s on s.id = i.site_id where s.name = 'Test target' and e.type = 'step_fired' and e.at > now() - interval '1 hour') e),
  'msgs', (select json_agg(n) from (select template, channel, status, sent_at, context->>'asFyi' as fyi from notifications n join incidents i on i.id = n.incident_id join sites s on s.id = i.site_id where s.name = 'Test target' and n.template in ('step_fired', 'reminder') and n.created_at > now() - interval '1 hour' order by n.created_at) n)
) j;
```

**Staging has one real person** (Tao, the only Admin) and nobody else can sign up (company domain + allowlist, D-007). For an L1 run Tao runs `supabase/staging/escalation-people.sql` (Claude can't: it inserts `auth.users` rows on a hosted project) — two fixture profiles, "Staging Owner" (no Chat id) and "Staging Backup" (Tao's own Chat id, **digits only**, so the @mention reaches Tao) as the Test target's owner and backup; its Undo puts Tao back. Then the DOWN card reads "acknowledge by HH:MM or it escalates" and "Next · L1 at HH:MM … — Staging Backup, Tao", L1 @mentions the backup with "Tao FYI", and the L1 emails go to Resend's test inbox (asked) and Tao (FYI) (S08 D-035 run, INC-0032). Without the fixtures L1 has nobody new: no "Next" row, `step_fired` with `"notified": []`, nothing posted, the state stays Unacked; STILL DOWN still lands at +30.

In the browser pane, click by `ref` (from `find` / `read_page`), not by screenshot coordinates: the pane resizes (a 1440 emulation falls back to 480 px), and coordinate clicks then miss or land elsewhere (S09b follow-up /verify). Wait until a held action's toast shows "Posting to …" before the next click — clicking while the action is still in flight tests nothing.

In the SQL editor, read the editor's text back before every `ctrl+Return` — `window.monaco.editor.getModels().map(m => m.getValue())` (the visible lines are virtualised): when the tab isn't fronted (`tabs_select` it first) or the pane's width changed, typed keys go nowhere and the **previous** query runs again (S08 run: the reset re-ran instead of a read).

Response hours (Tier 2–3 timers paused, PROBLEM held until 09:00) can't be driven on staging, because the clock can't move. The engine tests (`escalation.test.ts`, `response-hours.test.ts`) and pgTAP (`escalation.test.sql`) cover them.

Maintenance and mute (S09, D-036, spec §23), as Tao on https://monitor-staging.dxtspace.com — start clean (`reset-test-incident.sql`, target `ok`):

| Do                                                                   | Expect                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test target `error` → DOWN; Site detail → Schedule maintenance → Now | the guard "Test target is DOWN now (INC-…)…", Start now disabled; Mute instead → the mute sheet with "Mute stops new alerts only — INC-… keeps escalating until someone acknowledges" |
| Mute for 1 h with a reason                                           | Muted overlay on Sites / Site detail / Overview; Overview card "Test target — muted"; the incident keeps its ladder (L1 at +15, T09)                                                  |
| Back to `ok`, acknowledge / resolve; Mute again; then `error`        | DOWN opens with **no** Chat post (muted); End now on /maintenance → the DOWN card posts at once and L1 counts from then (`incidents.alerted_at`)                                      |
| /maintenance → Schedule maintenance or mute → Test target, Now, 1 h  | site status Maintenance; `error` → no incident; End now (or wait for the end) while still `error` → an incident opens, starting at the window's end                                   |
| Schedule a window 15 min ahead, then drive `error` before it starts  | at its start: Recent "Didn't start — site was DOWN (INC-…)"                                                                                                                           |
| /maintenance at 1440 / 820 / 390                                     | table from lg, row cards + sheet below lg; Admin Approve / Decline on a request (a Responder's request can't be made on one-person staging — the e2e `maintenance.spec.ts` covers it) |

```sql
select json_agg(w) from (select kind, starts_at, ends_at, approved_at, ended_at, cancelled_at, outcome, outcome_detail, log
  from maintenance_windows mw join sites s on s.id = mw.site_id where s.name = 'Test target' order by mw.created_at desc limit 5) w;
```

- **Browser pane under width emulation** (`resize_window` 1440 / 820 / 390): clicks by coordinate can miss and screenshots can be stale or half-size (S06b `/verify`: "Acknowledge did nothing"). Check the control is on top with `document.elementFromPoint`, act with a DOM `.click()`, and read layout with `getBoundingClientRect`; screenshots at those widths come from Playwright locally (e2e helpers) or from the pane without emulation. A hidden (not fronted) tab pauses `requestAnimationFrame` and CSS transitions — front it before timing anything.

## 4. Reset between runs

A new problem on an incident that is still open (Monitoring / Needs root cause) is a relapse into it (S04b), not a new incident. For a clean start — a fresh DOWN or PROBLEM card — run `supabase/staging/reset-test-incident.sql` in the SQL editor first, and leave the target on `ok` at the end.
