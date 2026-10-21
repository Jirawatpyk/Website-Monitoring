# Runbook

What to do when DxT Monitor itself needs attention. Each section starts from the alert or symptom.

**v1 (G1, 14 Oct 2026).** Written for the two Admins. G1 asks the second Admin to walk through it once (see the **Walk-through** at the end).

## Start here

### What you need access to

Check each one before you're on call:

| Where                                              | What for                                           | Who grants it              |
| -------------------------------------------------- | -------------------------------------------------- | -------------------------- |
| DxT Monitor (`monitor.dxtspace.com`), Admin role   | Incidents, maintenance, mute, sites                | Tao (allowlist, D-007)     |
| Vercel team, projects `dxt-monitor` and `-staging` | Deploys, cron jobs, function logs, env values      | Tao (Vercel team)          |
| Supabase production project (Website-Monitoring)   | SQL editor (read first, write only with a reason)  | Tao (Supabase org)         |
| Healthchecks.io projects "DxT Monitor" + staging   | Heartbeat alerts                                   | Tao (Healthchecks project) |
| The Thai VPS (`dxt-monitor-bkk`) over SSH          | The Bangkok probe and the browser verifier         | Tao (SSH key)              |
| GitHub repo                                        | Code, PRs; `pnpm pr:merge` is the only way to main | Tao (repo collaborator)    |
| Google Chat Alerts Space                           | Where alerts post; the Healthchecks alerts too     | Tao (Space member)         |

Secrets live only in Vercel env, `/etc/dxt-agent/<env>.env` on the VPS, and each provider's dashboard. Never paste them in chat, tickets or commits.

### The parts, in one line each

- **Probes:**
  - SIN and TYO are Vercel crons running every minute (`/api/cron/probe-sin`, `/api/cron/probe-tyo`);
  - BKK is the VPS agent (`dxt-agent@production`).
- **The engine** (`/api/cron/engine`, every minute) judges rounds and opens or recovers incidents.
- **The notifier** (`/api/cron/notifier`) posts to Chat and sends email.
- **The browser verifier** (on the VPS) opens blocked sites in Chromium.
- **The crawler** (`/api/cron/crawler`, every 30 min) runs the defacement views.
- **Housekeeping** (daily) deletes old screenshots.

## Heartbeat and system alerts

### Healthchecks (dead man's switch)

Each job pings Healthchecks.io. A missed ping alerts by email and in Google Chat, from outside our system, so it still reaches you when DxT Monitor itself is down. Production and staging are separate Healthchecks projects. Treat a staging alert as low priority.

| Check | Expected | When it goes down | First look | Section |
| --- | --- | --- | --- | --- |
| `engine` | every minute | **The sweep stops:** no recoveries, no PROBLEMs, no rounds judged at their deadline. A DOWN can still open, because a probe whose recheck fails runs the engine itself, so a DOWN that arrives is real. The most serious alert. | Vercel → `dxt-monitor` → Cron Jobs → `/api/cron/engine` → View Logs | [Vercel crons and logs](#vercel-crons-and-function-logs) |
| `notifier` | every minute | Incidents open but Chat and email don't go out (or go late) | the same, `/api/cron/notifier`; then Resend / the Chat webhook | [Rotate](#rotate-a-secret) if a key was revoked |
| `probe-sin`, `probe-tyo` | every minute | That location stops voting; the other two still decide | the same, `/api/cron/probe-sin` / `-tyo` | [Fewer than 2 probe locations](#fewer-than-2-probe-locations) |
| `probe-bkk` | every minute | Bangkok stops voting; SIN + TYO decide (D-019) | the VPS: `systemctl status dxt-agent@production` | [Restart the VPS agent](#restart-the-vps-agent) |
| `browser-verifier` | every minute | Blocked sites show PROBLEM (unverified); the Admins also get the system email | the VPS, as above | [Browser verifier](#browser-verifier) |
| `crawler` | every 30 min | No defacement views; an open crawler PROBLEM holds | `/api/cron/crawler` logs | [Crawler](#crawler-defacement-views-s09c) |

A check that is **down** but whose job logs show it running usually means the ping URL in the env is wrong or was rotated. Compare the URL in Healthchecks with the env value (names only in chat).

### System emails to the Admins

Subject `DxT Monitor · System · <title> · <start>`. Each clears by itself and sends no "back" email.

| Title | What it means | Section |
| --- | --- | --- |
| Browser verifier unavailable | The verifier hasn't polled for 2 min, or jobs aren't picked up | [Browser verifier](#browser-verifier) |
| Browser verifier falling behind | More than 5 verify jobs are waiting | [Browser verifier](#browser-verifier) |
| Fewer than 2 probe locations | Only one location (or none) beats, so no site can change status | [Fewer than 2 probe locations](#fewer-than-2-probe-locations) |
| BKK probe network check failing | The VPS's own internet check failed 3 rounds in a row. Sites behind a WAF can't be decided from BKK (D-027, D-038) | [BKK network check](#bkk-probe-network-check-failing) |

## Restart the VPS agent

```bash
ssh -i ~/.ssh/dxt_vps root@<vps>
systemctl status dxt-agent@production                 # active (running)?
journalctl -u dxt-agent@production -n 50 --no-pager   # probe_round every minute, verified / *_failed lines
systemctl restart dxt-agent@production
journalctl -u dxt-agent@production -f                 # "vps-agent started", then probe_round within a minute
```

- **Restart one instance only.** Never run `systemctl restart 'dxt-agent@*'`: staging and production are separate instances.
- **The VPS itself is down** (no SSH): Bangkok and the verifier are both out. SIN + TYO keep judging every site, so this is not an outage of DxT Monitor. Reboot it from the VPS provider's console; both instances start on boot.
- **A bad release** (agent crashes after a deploy): roll back with the steps in [Browser verifier → Fix](#browser-verifier).
- **Clock:** `timedatectl show -p NTPSynchronized` must say `yes`. Ingest refuses results more than 5 min off.

## Vercel crons and function logs

- **See that the crons run:** Vercel → `dxt-monitor` → Settings → **Cron Jobs**. Each job has **View Logs**, and **Run** starts it once on demand (no secret needed). If the **Enabled** toggle is ever switched off, every cron stops, probes and engine included. Leave it on.
- **Read a job's summary line:** each run logs one JSON line, e.g. `{"job":"engine","region":"sin1","ok":true,"opened":0,…}`. From a checkout:

  ```bash
  vercel --scope team_KLEKhF6PuSAbJSmgDpyEXES4 logs --project dxt-monitor --environment production --since 1h --query '"job":"engine"'
  vercel --scope team_KLEKhF6PuSAbJSmgDpyEXES4 logs --project dxt-monitor --environment production --since 1h --level error
  ```

  `ok:false` (with `failures`) fails the Healthchecks ping. The text names the site or step that failed.
- **A deploy broke production:** Vercel → Deployments → the last good production deployment → **Promote** (instant rollback). Then fix forward by PR.
- **An env value was changed:** it takes effect only after a redeploy (Deployments → the current one → Redeploy).

## Pause alerts: maintenance and mute

From the app as an Admin: **/maintenance** → **Schedule maintenance or mute**, or the **⋯** menu on a site.

- **Planned work on a client site** (hosting move, deploy): **maintenance** for the window. While it runs nothing opens; if the site is still down at the end, an incident opens from the window's end. Over 24 h needs an Admin's approval (Admins' own windows are approved on create).
- **Something is already wrong and you're on it:** **mute** for up to 24 h. New alerts for that site stop, but an open incident keeps escalating until someone acknowledges it. End it early with **End now**.
- **Our own production deploys after G1:** every production deploy happens inside a maintenance window (G1 rule). Open it before `pnpm pr:merge` and end it once the deploy is live and the next round looks right.
- **There is no global "stop all alerts" switch.** If DxT Monitor itself is sending false alerts for many sites at once, mute the affected sites and fix the cause. Turning off Vercel Cron Jobs stops monitoring entirely, so do it only with the other Admin's agreement.

## Rotate a secret

Always: change it at the source, set the new value in Vercel (and on the VPS where listed), **redeploy**, then check. Do staging first if you're unsure. Write the date in the walk-through log, never the value.

| Secret | Where it's used | Steps | Expect meanwhile |
| --- | --- | --- | --- |
| `CRON_SECRET` | Vercel only: Vercel Cron sends it to every cron route | Vercel env (per project) → new value → redeploy | Nothing; Vercel Cron picks up the new value with the deploy |
| `INGEST_TOKEN` | Vercel + `/etc/dxt-agent/<env>.env` | Vercel env → redeploy → on the VPS `sudoedit /etc/dxt-agent/production.env` → `systemctl restart dxt-agent@production` | 401s in the agent log until both match. Bangkok drops out of the vote for those minutes; SIN + TYO still decide. The token also guards the verifier's `/api/jobs`: do the VPS step straight after the redeploy, or after 2 min "Browser verifier unavailable" emails the Admins (it clears by itself) |
| `PROBE_SECRET_HEADER_VALUE` | Vercel + both VPS env files; **clients' WAF allowlists** | Agree a time with the WAF owners first, then change it in all three places and redeploy / restart | Sites behind a WAF may show blocked / PROBLEM until their allowlist has the new value |
| `GOOGLE_CHAT_ALERTS_WEBHOOK_URL` (and `…REPORTS…`) | Vercel | Chat Space → Apps & integrations → Webhooks → new URL → Vercel env → redeploy → remove the old webhook | Chat posts fail until redeploy; failed Chat alerts fall back to email (D-016) |
| `RESEND_API_KEY` | Vercel | Resend → API keys → new key → Vercel env → redeploy → revoke the old key | Emails fail until redeploy (retried for ~10 min) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server only) | Supabase → Project settings → API keys → new secret key → Vercel env → redeploy → revoke the old one | Crons fail until redeploy. Do it in a quiet hour |
| Healthchecks ping URLs | Vercel + VPS env | Only if a URL leaked: Healthchecks → check → change the ping key → update env → redeploy / restart | That check shows down until updated |

**After any rotation, check:**
- the next cron runs are `ok:true`;
- Healthchecks is green;
- the agent log shows `probe_round` with no 401;
- for Chat and email, the next notification shows `sent`.

## Who to call

| Problem | First | Then |
| --- | --- | --- |
| DxT Monitor down or alerting wrongly | The Admin on duty | The other Admin |
| A client site really down | The site's owner, then its backup (shown on the incident) | Escalation runs by itself (L1 at +15 min) |
| Client hosting / WAF / certificate | The site's owner, who contacts the client's hosting | The client's AM for anything client-facing |
| Vercel platform | vercel.com/status, then Vercel support (team account) | — |
| Supabase platform | status.supabase.com, then Supabase support | — |
| The Thai VPS host | The provider's console / support (account held by Tao) | — |

Names and phone numbers are kept with the Admins, not in the repo (no real contact details in commits).

## BKK probe network check failing

**Alert:** the system email "BKK probe network check failing".

**What it means:** every round, the VPS checks Google and Cloudflare (and an Akamai file) to prove its own internet works. When those fail 3 minutes in a row, Bangkok's results can't decide sites behind a WAF. Those sites show PROBLEM (unverified, "BKK network check failed") instead of a false DOWN (D-027, D-038).

**Check:** on the VPS, `journalctl -u dxt-agent@production -n 50 --no-pager | grep control`, then `curl -sI https://www.google.com/generate_204`.

**Fix:** a VPS network problem is the provider's; a bad control URL is fixed in `CONTROL_URLS` in the env file, followed by a restart. It clears by itself once a round's control check passes.

## Browser verifier

**Alert:** email "DxT Monitor · System · Browser verifier unavailable · <start>" (Admins), or the Healthchecks check `browser-verifier` / `probe-bkk` is down (Tao).

**What it means:** blocked sites (403 / 429 / bot challenge) can't be verified. They show PROBLEM (unverified) and are retried every round. Hard fails still go DOWN on time, decided by the other locations (D-001, D-019). A stopped agent also takes Bangkok out of the vote, and SIN + TYO keep deciding.

**Check, on the VPS** (`ssh -i ~/.ssh/dxt_vps root@<vps>`):

```bash
systemctl status 'dxt-agent@*'
journalctl -u dxt-agent@production -n 100 --no-pager     # probe_round / verified / *_failed lines
free -m                                                  # two instances share 4 GB; MemoryMax 1500M each
timedatectl show -p NTPSynchronized                      # must be yes: Ingest refuses results > 5 min off
```

**Fix:**

- **Crashed or stuck:** `systemctl restart dxt-agent@production`. The alert clears by itself once the verifier polls again with nothing queued and no blocked site waiting, no sooner than 10 min after it opened (D-019). There's no "back" email.
- **401 in the log:** the env file's `INGEST_TOKEN` doesn't match the environment's. Tao updates `/etc/dxt-agent/<env>.env`, then restart. A token changed in Vercel only takes effect after a redeploy (env is read at build time).
- **`healthcheck_ping_failed`:** the VPS has no IPv6 route; the unit starts Node with IPv4 first (`--no-network-family-autoselection --dns-result-order=ipv4first`). Keep those flags if you edit `ExecStart`.
- **Chromium won't start:** release the instance again (`apps/vps-agent/deploy/release.sh production`); it reinstalls that Playwright version's Chromium into `/opt/dxt-agent/browsers`.
- **Roll back a bad release:** each instance runs from its own folder (`/opt/dxt-agent/<env>/`), so either swap back the release kept beside it (`sudo mv /opt/dxt-agent/<env> /opt/dxt-agent/<env>.bad && sudo mv /opt/dxt-agent/<env>.previous /opt/dxt-agent/<env> && sudo systemctl restart dxt-agent@<env>`) or check out the previous `main` commit and run `release.sh <env>` again.

**Email "falling behind" (more than 5 jobs waiting):** many sites are blocked at once. Check the log for slow pages, and consider asking those sites' WAF owners to allowlist the probe User-Agent, the secret header and the VPS IP (the permanent fix, PRD §5). It clears when the queue drops to 5.

**A site shows PROBLEM "Blocked in the browser too":** the verifier works, but the site's WAF also blocks plain Chromium from the VPS (D-020). Ask its WAF owner for the allowlist.

**Read one job** (staging or production SQL editor):

```sql
select kind, round_at, status, result, detail, http_status, screenshot_path, created_at, completed_at
from verification_jobs where site_id = '<site id>' order by created_at desc limit 5;
```

## Fewer than 2 probe locations

**Alert:** email "DxT Monitor · System · Fewer than 2 probe locations · <start>" (Admins, D-022).

**What it means:** a status needs 2 locations to vote (PRD §5). With one (or none) beating, every site keeps its status from its last complete round: no new incidents, no recoveries. The email says which location still reports.

**Check:** BKK — the VPS agent (`systemctl status dxt-agent@production`, section above); SIN / TYO — the Vercel probe crons (`/api/cron/probe-sin`, `/api/cron/probe-tyo` logs, Healthchecks `probe-sin` / `probe-tyo`).

**Fix:** bring a second location back. The alert clears by itself once 2 locations beat again, no sooner than 10 min after it opened; there's no "back" email.

## Crawler (defacement views, S09c)

**Alert:** the Healthchecks check `crawler` is down (Tao), or a PROBLEM · Keyword / Redirect whose cause ends "(as Googlebot)" or "(from Google search)".

**What it means:** every 30 min `/api/cron/crawler` (sin1) fetches each live home page as Googlebot and as a phone arriving from Google search, and looks for the shared forbidden list and the site's own forbidden words in the whole page (D-041, D-042). A cause with "(as Googlebot)" means the hacked content is served only to search engines; "(from Google search)" means visitors from Google are sent to another site. Normal visitors and our per-minute probes see a clean page, so open it the same way: `curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" <url>` or `curl -e https://www.google.com/ -A "<phone UA>" -I <url>`. An open crawler PROBLEM recovers only after a clean usable fetch of that view; while the site refuses the fake Googlebot, or the crawler is dead (the Healthchecks alert), it holds for up to a day.

**Check:** the cron's log line (`job: "crawler"`: `fetched`, `unusable`, `hits`) and `crawler_checks` (`usable = false` = the site refused the fake Googlebot or timed out — no data, never a PROBLEM). With `DEFACEMENT_ALERTS=off` (the default; production is on since 21 Oct 2026) findings appear only in the engine's log line as `defacementHeld`.

**Fix:** a real hit is the site owner's to clean (hosting, CMS plugins). A false hit on the shared list (a normal page using a listed phrase) is fixed by a PR to `packages/shared/src/forbidden.ts` (until S17 makes the list editable).

## A site shows PROBLEM

The cause line says which trigger and where (spec §19 cause table, D-022): slow (p50 over the limit 3 rounds in a row), keyword missing / forbidden text found, a key page failing while home is OK, one location failing ≥ 5 min (regional), a redirect off the allowlist, or blocked and not verified. Read the monitor's carry state:

```sql
select m.url, m.is_primary, ms.status, ms.trigger, ms.cause, ms.slow_rounds, ms.failing_since, ms.last_round_at
from monitor_status ms join monitors m on m.id = ms.monitor_id where ms.site_id = '<site id>';
```

## A site keeps failing and recovering (relapse, flapping)

A site that fails again while its incident is open (Monitoring / Needs root cause) joins the same incident and thread: DOWN AGAIN / PROBLEM AGAIN in Chat, mentioning whoever acknowledged, else the owner (D-004, D-024). The incident goes back to Acknowledged (if acked) or Unacked. The 3rd OK ↔ not-OK change in 30 min tags it flapping: RECOVERED replies and emails stop, and one summary (Chat + an email to the owner) is held until 15 min after the last recovery; any new drop cancels it. Read the flips and the held summary:

```sql
select st.status, st.flips, st.flip_ok, i.state, i.severity, i.episode_severity, i.is_flapping
from site_status st join incidents i on i.site_id = st.site_id and i.state not in ('resolved','in_review','closed')
where st.site_id = '<site id>';
select template, channel, status, hold_until, dedupe_key, error from notifications
where incident_id = '<incident id>' order by created_at;
```

A summary row `queued` with `hold_until` in the future is waiting for 15 min of OK; `cancelled` with "Superseded: down again" means the site dropped again first. A PROBLEM nobody acknowledged that clears within 5 min of being flagged resolves itself (`auto_resolved`) and still posts one RECOVERED without a mention (spec §19.6).

## Add, stop or remove a site (S05)

- **Before adding:** the owner and backup have signed in once and have a Google Chat id (`supabase/access/chat-ids.template.sql`); the client exists with its AM (`supabase/access/clients.template.sql`).
- **Add:** Sites → Add site. Save draft keeps it unmonitored; Start monitoring is enabled once the registration checklist is complete (URL, brand keyword, owners with Chat ids, client + AM, hosting + credential reference). Run Test check first: it checks once from SIN and TYO and stores nothing.
- **A wrong Start, or a site to retire:** Edit site → Stop monitoring. Checks stop at once and nobody is alerted; an open incident stays open (resolve it). For a short pause use maintenance / mute (S09).
- **Delete:** only a stopped site with no check results or incidents. Anything with history stays for the record — stop it instead.
- **Switch off or remove a key page:** resolve its open incident first; the save is refused while one is open.
- **Every change** is one `audit_log` row per site / monitor / client row (`entity` = site, monitor or client).
- **"This address points inside a private network":** the URL resolves to a private, loopback or metadata address — the probes never check those (SSRF guard).

## Walk-through (G1)

The second Admin does each step once, with Tao, on **staging** unless the step says production, and ticks it here by PR. Use dates and initials only; never write a secret value.

| # | Step | Done (date, initials) |
| --- | --- | --- |
| 1 | Open every link in **What you need access to** and confirm the access works | |
| 2 | Healthchecks: find all 7 production checks, read one check's events, and see that the Google Chat integration is on **and your own email is a notification target** on the production project (G1: Healthchecks alerts go to both Admins) | |
| 3 | Vercel: open Cron Jobs, press **Run** on `/api/cron/crawler` (staging), then read its summary line with View Logs and with the `vercel logs` command | |
| 4 | VPS: SSH in, read `systemctl status` and the journal of `dxt-agent@staging`, restart it, and see `probe_round` come back | |
| 5 | App, on staging Test target: mute 1 h → **End now**; then schedule a 1 h maintenance → cancel → **Undo** inside 10 s (the window comes back) → cancel again and let it post (a mute is refused during a site's maintenance, so mute first) | |
| 6 | Rotate one secret on staging end to end (`CRON_SECRET` is the safe one), then do the post-rotation checks | |
| 7 | Read **Who to call** and add the real numbers to the Admins' own contact list (not here) | |
| 8 | Production: find the open incidents and the latest `crawler` / `engine` summary lines, read-only | |

When all eight are ticked, G1's runbook line is met.

