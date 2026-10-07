# Install the VPS agent

The Thai VPS (`dxt-monitor-bkk`, Ubuntu 24.04) runs two instances (D-019), each from its own release folder (S04b):

| Instance               | Talks to                               | Release                     | Env file                        | Verifier sessions |
| ---------------------- | -------------------------------------- | --------------------------- | ------------------------------- | ----------------- |
| `dxt-agent@staging`    | `https://monitor-staging.dxtspace.com` | `/opt/dxt-agent/staging`    | `/etc/dxt-agent/staging.env`    | 1                 |
| `dxt-agent@production` | `https://monitor.dxtspace.com`         | `/opt/dxt-agent/production` | `/etc/dxt-agent/production.env` | 3                 |

Each instance holds only its environment's `INGEST_TOKEN` and its own Healthchecks URLs. It never holds a database or Storage key (PRD §10). Start production only after the S03 merge and `migrate-production`: the API it calls must exist there first.

## Once per VPS

```bash
# Node 22 and the service user
# NodeSource apt repository with its signing key (no piped install script)
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update && sudo apt-get install -y nodejs chrony
# One user per instance (security review S03): staging's browser can't reach production's token
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin dxt-staging
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin dxt-production
sudo install -d -o root -g root -m 0755 /opt/dxt-agent
sudo install -d -o root -g root -m 0700 /etc/dxt-agent
timedatectl show -p NTPSynchronized   # must be yes: Ingest refuses results more than 5 min off
```

## Releases (from a checkout)

Each instance runs its own release in `/opt/dxt-agent/<instance>/` (`dist/`, `package.json`, `node_modules/`); Chromium is shared in `/opt/dxt-agent/browsers`. A release goes to one instance and restarts only that one, so verifying a slice on staging never changes what production runs:

```bash
apps/vps-agent/deploy/release.sh staging       # step 7 of docs/workflow.md
apps/vps-agent/deploy/release.sh production    # after the merge and migrate-production
```

`release.sh` builds, copies the bundle, `deploy/package.json` and the unit to the VPS, and runs `deploy/install-release.sh` there: `rsync` into the instance's folder, `npm install --omit=dev --no-package-lock --ignore-scripts` (exact Playwright version, no install scripts), `playwright install --with-deps chromium` into the shared browsers folder (a no-op when that revision is there), `chown root`, then restart that instance and print its journal. A changed unit file is installed only once both instances have a release, because it applies to both. `DXT_VPS` / `DXT_VPS_KEY` override the host and key.

### Moving from the shared `/opt/dxt-agent` (S04b, once)

Until S04b both instances ran from `/opt/dxt-agent/dist`. Copy that release into both folders, then release staging (it installs the new unit), check it, then production:

```bash
sudo bash -c 'for i in staging production; do install -d -m 0755 /opt/dxt-agent/$i; cp -a /opt/dxt-agent/dist /opt/dxt-agent/package.json /opt/dxt-agent/node_modules /opt/dxt-agent/$i/; done; chown -R root:root /opt/dxt-agent'
```

Then from the checkout `release.sh staging`, `release.sh production` (or `systemctl restart dxt-agent@production` to keep its current build), and once both run from their folders remove the old `/opt/dxt-agent/{dist,package.json,node_modules}`.

## Env files (Tao writes the values; never paste them in chat)

```bash
sudo install -o root -g root -m 0600 /dev/null /etc/dxt-agent/staging.env
sudo install -o root -g root -m 0600 /dev/null /etc/dxt-agent/production.env
sudoedit /etc/dxt-agent/staging.env      # every name in apps/vps-agent/.env.example
```

Staging: `API_BASE_URL=https://monitor-staging.dxtspace.com`, `VERIFIER_MAX_SESSIONS=1`, the staging `INGEST_TOKEN` and staging Healthchecks URLs. Production: `API_BASE_URL=https://monitor.dxtspace.com`, `VERIFIER_MAX_SESSIONS=3`.

Check the names only (S03 Done-when 6):

```bash
sudo sed 's/=.*//' /etc/dxt-agent/staging.env /etc/dxt-agent/production.env
```

## Service

The first `release.sh <instance>` installs the unit (`/etc/systemd/system/dxt-agent@.service`); enable each instance once:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dxt-agent@staging
journalctl -u dxt-agent@staging -f      # "vps-agent started", then probe_round every minute
# DNS works under the unit's IPAddressDeny (resolved's stub is allowed):
sudo systemd-run --wait --pipe -p 'IPAddressDeny=127.0.0.0/8' -p IPAddressAllow=127.0.0.53/32 getent hosts monitor.dxtspace.com
```

Never `systemctl restart 'dxt-agent@*'` for a release: `release.sh` restarts only the instance it released.

## Healthchecks

Four checks, each "every 1 min, grace 3 min, email Tao" (spec §15.3): `probe-bkk` and `browser-verifier`, once per environment. A stopped agent leaves SIN and TYO deciding status (D-019); a stopped verifier makes blocked sites PROBLEM (unverified) and emails the Admins (D-001).
