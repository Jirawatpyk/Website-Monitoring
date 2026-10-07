#!/usr/bin/env bash
# Runs ON the VPS as root (release.sh pipes it over ssh): installs the staged build into
# /opt/dxt-agent/<instance>/ and restarts only that instance. Chromium is shared in
# /opt/dxt-agent/browsers; each Playwright version keeps its own revision there.
set -euo pipefail

instance="$1"
stage="$2"
dir="/opt/dxt-agent/$instance"
unit=/etc/systemd/system/dxt-agent@.service

install -d -o root -g root -m 0755 "$dir"
rsync -a --delete "$stage/dist" "$dir/"
cp "$stage/package.json" "$dir/package.json"
cd "$dir"
# deploy/package.json: only the npm dependency the bundle keeps external; exact version, no scripts.
npm install --omit=dev --no-package-lock --ignore-scripts --no-audit --no-fund --loglevel=error
PLAYWRIGHT_BROWSERS_PATH=/opt/dxt-agent/browsers npx playwright install --with-deps chromium >/dev/null
chown -R root:root "$dir"

# The unit is shared by both instances: install a changed one only when both releases exist, or the
# other instance would fail on its next restart.
if ! cmp -s "$stage/dxt-agent@.service" "$unit"; then
  for other in staging production; do
    if [ ! -f "/opt/dxt-agent/$other/dist/index.js" ]; then
      echo "The unit changed but /opt/dxt-agent/$other has no release yet: release it first (install.md)." >&2
      exit 1
    fi
  done
  cp "$stage/dxt-agent@.service" "$unit"
  systemctl daemon-reload
  echo "Installed the new dxt-agent@.service"
fi

systemctl restart "dxt-agent@$instance"
sleep 8
systemctl is-active "dxt-agent@$instance"
journalctl -u "dxt-agent@$instance" -n 8 --no-pager
rm -rf "$stage"
