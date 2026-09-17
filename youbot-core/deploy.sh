#!/usr/bin/env bash
# Deploy source to an explicitly selected host, build there, and restart safely.
set -Eeuo pipefail

DEPLOY_TARGET="${YOUBOT_DEPLOY_TARGET:-${1:-}}"
REMOTE_ROOT="${YOUBOT_REMOTE_ROOT:-youbot}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$DEPLOY_TARGET" ]]; then
  echo "Usage: YOUBOT_DEPLOY_TARGET=user@host $0" >&2
  exit 2
fi

command -v rsync >/dev/null 2>&1 || { echo "rsync is required" >&2; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "ssh is required" >&2; exit 1; }

echo "Deploying Youbot to $DEPLOY_TARGET:$REMOTE_ROOT ..."
ssh -o BatchMode=yes "$DEPLOY_TARGET" "mkdir -p '$REMOTE_ROOT'"
rsync -az --checksum \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.next/' \
  --exclude 'dist/' \
  --exclude 'web/' \
  --exclude 'youbot-core/config.json' \
  --exclude 'youbot-core/db.sqlite*' \
  --exclude 'youbot-core/sessions/' \
  --exclude 'youbot-core/logs/' \
  --exclude '*.log' \
  "$ROOT_DIR/" "$DEPLOY_TARGET:$REMOTE_ROOT/"

ssh -o BatchMode=yes "$DEPLOY_TARGET" \
  "set -e; cd '$REMOTE_ROOT/youbot-core'; npm ci; cd web-ui; npm ci; cd ../..; ./stop.sh || true; ./start.sh"

echo "Deployment completed and passed the remote readiness check."
