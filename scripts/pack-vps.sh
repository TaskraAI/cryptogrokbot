#!/usr/bin/env bash
# Build a tarball of the app for the VPS. Never includes .env, data/, tokens, or node_modules.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-/tmp/cryptogrokbot-app.tgz}"
tar -czf "$OUT" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='data' \
  --exclude='*.db' \
  --exclude='*.sqlite' \
  --exclude='__pycache__' \
  --exclude='.dashboard-password' \
  --exclude='.dashboard-email' \
  --exclude='dashboard-access.json' \
  --exclude='wallet-secrets.json' \
  --exclude='config/pattern-stats.json' \
  --exclude='*.log' \
  .
echo "packed $OUT"
echo "Copy separately (scp, never chat): .env  data/  (book + password + Grok Bot invites)"
echo "On the VPS:"
echo "  sudo mkdir -p /opt/cryptogrokbot && sudo tar -xzf cryptogrokbot-app.tgz -C /opt/cryptogrokbot"
echo "  # then copy .env and data/ into /opt/cryptogrokbot"
echo "  cd /opt/cryptogrokbot && bash scripts/install-vps.sh"
