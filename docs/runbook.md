# Runbook

What to do when DxT Monitor itself needs attention. Each section starts from the alert or symptom.

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
- **Roll back a bad release:** each instance runs from its own folder (`/opt/dxt-agent/<env>/`), so check out the previous `main` commit and run `release.sh <env>` again.

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

## A site shows PROBLEM

The cause line says which trigger and where (spec §19 cause table, D-022): slow (p50 over the limit 3 rounds in a row), keyword missing / forbidden text found, a key page failing while home is OK, one location failing ≥ 5 min (regional), a redirect off the allowlist, or blocked and not verified. Read the monitor's carry state:

```sql
select m.url, m.is_primary, ms.status, ms.trigger, ms.cause, ms.slow_rounds, ms.failing_since, ms.last_round_at
from monitor_status ms join monitors m on m.id = ms.monitor_id where ms.site_id = '<site id>';
```
