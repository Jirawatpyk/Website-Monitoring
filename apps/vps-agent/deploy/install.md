# Install the VPS agent

The Thai VPS (`dxt-monitor-bkk`, Ubuntu 24.04) runs two instances of one build (D-019):

| Instance               | Talks to                               | Env file                        | Verifier sessions |
| ---------------------- | -------------------------------------- | ------------------------------- | ----------------- |
| `dxt-agent@staging`    | `https://monitor-staging.dxtspace.com` | `/etc/dxt-agent/staging.env`    | 1                 |
| `dxt-agent@production` | `https://monitor.dxtspace.com`         | `/etc/dxt-agent/production.env` | 3                 |

Each instance holds only its environment's `INGEST_TOKEN` and its own Healthchecks URLs. It never holds a database or Storage key (PRD §10). Start production only after the S03 merge and `migrate-production`: the API it calls must exist there first.

## Once per VPS

```bash
# Node 22 and the service user
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs chrony
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin dxt
sudo install -d -o root -g root -m 0755 /opt/dxt-agent
sudo install -d -o root -g dxt -m 0750 /etc/dxt-agent
timedatectl show -p NTPSynchronized   # must be yes: Ingest refuses results more than 5 min off
```

## Build and copy (from a checkout, each release)

```bash
pnpm --filter @dxt/vps-agent build
scp -i ~/.ssh/dxt_vps -r apps/vps-agent/dist apps/vps-agent/deploy/package.json apps/vps-agent/deploy/dxt-agent@.service root@<vps>:/tmp/dxt-agent/
```

On the VPS:

```bash
sudo rsync -a --delete --exclude browsers --exclude node_modules --exclude 'dxt-agent@.service' /tmp/dxt-agent/ /opt/dxt-agent/
cd /opt/dxt-agent
# deploy/package.json: only the npm dependency the bundle keeps external (workspace packages are bundled in).
sudo npm install --omit=dev --no-package-lock
sudo PLAYWRIGHT_BROWSERS_PATH=/opt/dxt-agent/browsers npx playwright install --with-deps chromium
sudo chown -R root:root /opt/dxt-agent
```

## Env files (Tao writes the values; never paste them in chat)

```bash
sudo install -o root -g dxt -m 0640 /dev/null /etc/dxt-agent/staging.env
sudo install -o root -g dxt -m 0640 /dev/null /etc/dxt-agent/production.env
sudoedit /etc/dxt-agent/staging.env      # every name in apps/vps-agent/.env.example
```

Staging: `API_BASE_URL=https://monitor-staging.dxtspace.com`, `VERIFIER_MAX_SESSIONS=1`, the staging `INGEST_TOKEN` and staging Healthchecks URLs. Production: `API_BASE_URL=https://monitor.dxtspace.com`, `VERIFIER_MAX_SESSIONS=3`.

Check the names only (S03 Done-when 6):

```bash
sudo sed 's/=.*//' /etc/dxt-agent/staging.env /etc/dxt-agent/production.env
```

## Service

```bash
sudo cp /tmp/dxt-agent/dxt-agent@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dxt-agent@staging
journalctl -u dxt-agent@staging -f      # "vps-agent started", then probe_round every minute
```

After a release: copy, install as above, then `sudo systemctl restart 'dxt-agent@*'`.

## Healthchecks

Four checks, each "every 1 min, grace 3 min, email Tao" (spec §15.3): `probe-bkk` and `browser-verifier`, once per environment. A stopped agent leaves SIN and TYO deciding status (D-019); a stopped verifier makes blocked sites PROBLEM (unverified) and emails the Admins (D-001).
