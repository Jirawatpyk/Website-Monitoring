# Runbook

What to do when DxT Monitor itself needs attention. Each section starts from the alert or symptom.

## Browser verifier

**Alert:** email "DxT Monitor · Browser verifier unavailable" (Admins), or the Healthchecks check `browser-verifier` / `probe-bkk` is down (Tao).

**What it means:** blocked sites (403 / 429 / bot challenge) can't be verified. They show PROBLEM (unverified) and are retried every round. Hard fails still go DOWN on time, decided by the other locations (D-001, D-019). A stopped agent also takes Bangkok out of the vote, and SIN + TYO keep deciding.

**Check, on the VPS** (`ssh -i ~/.ssh/dxt_vps root@<vps>`):

```bash
systemctl status 'dxt-agent@*'
journalctl -u dxt-agent@production -n 100 --no-pager     # probe_round / verified / *_failed lines
free -m                                                  # two instances share 4 GB; MemoryMax 1500M each
timedatectl show -p NTPSynchronized                      # must be yes: Ingest refuses results > 5 min off
```

**Fix:**

- **Crashed or stuck:** `systemctl restart dxt-agent@production`. The alert clears by itself once the verifier completes a job, or polls again after a no-poll outage. There's no "back" email.
- **401 in the log:** the env file's `INGEST_TOKEN` doesn't match the environment's. Tao updates `/etc/dxt-agent/<env>.env`, then restart.
- **Chromium won't start:** reinstall it (`deploy/install.md` → Build and copy).

**Email "falling behind" (more than 5 jobs waiting):** many sites are blocked at once. Check the log for slow pages, and consider asking those sites' WAF owners to allowlist the probe User-Agent, the secret header and the VPS IP (the permanent fix, PRD §5). It clears when the queue drops to 5.

**A site shows PROBLEM "Blocked in the browser too":** the verifier works, but the site's WAF also blocks plain Chromium from the VPS (D-020). Ask its WAF owner for the allowlist.

**Read one job** (staging or production SQL editor):

```sql
select kind, round_at, status, result, detail, http_status, screenshot_path, created_at, completed_at
from verification_jobs where site_id = '<site id>' order by created_at desc limit 5;
```
