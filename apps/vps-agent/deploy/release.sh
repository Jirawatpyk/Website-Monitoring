#!/usr/bin/env bash
# Release the VPS agent to ONE instance (S04b): build here, copy to the VPS, install into
# /opt/dxt-agent/<instance>/ and restart only that instance. The other instance keeps running its
# own release, so a staging release never changes what production runs.
#
#   apps/vps-agent/deploy/release.sh staging       # verify a slice
#   apps/vps-agent/deploy/release.sh production    # after the merge and migrate-production
#
# DXT_VPS (default root@38.60.233.62) and DXT_VPS_KEY (default ~/.ssh/dxt_vps) pick the host.
set -euo pipefail

instance="${1:-}"
case "$instance" in
  staging | production) ;;
  *)
    echo "usage: release.sh staging|production" >&2
    exit 2
    ;;
esac

host="${DXT_VPS:-root@38.60.233.62}"
key="${DXT_VPS_KEY:-$HOME/.ssh/dxt_vps}"
repo="$(git rev-parse --show-toplevel)"
deploy="$repo/apps/vps-agent/deploy"
stage="/tmp/dxt-agent-$instance"

pnpm --filter @dxt/vps-agent build

ssh -i "$key" "$host" "rm -rf '$stage' && mkdir -p '$stage'"
scp -q -i "$key" -r "$repo/apps/vps-agent/dist" "$deploy/package.json" "$deploy/dxt-agent@.service" "$host:$stage/"
ssh -i "$key" "$host" bash -s -- "$instance" "$stage" <"$deploy/install-release.sh"
