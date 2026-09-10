#!/usr/bin/env bash
# Keep npm run agent on :8787. If it exits, start it again so queued gems
# can still fill overnight (Grok Bot POST /api/buy — the desk does not auto-trade).
# Never prints secrets. MASTER stays whatever .env says (false unless Taskra resumes).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
echo "watching http://127.0.0.1:8787/health — will restart npm run agent if it dies" >&2
while true; do
  if curl -sf --max-time 2 http://127.0.0.1:8787/health 2>/dev/null | grep -q cryptogrokbot-dashboard; then
    sleep 15
    continue
  fi
  if [[ ! -f .env ]]; then
    echo "waiting for gitignored .env (WALLET_SECRET_KEY) before starting the agent" >&2
    sleep 10
    continue
  fi
  echo "agent :8787 down; starting npm run agent" >&2
  unset MODE MASTER_ENABLED WALLET_SECRET_KEY
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
  npm run agent || true
  echo "agent exited; restart in 3s" >&2
  sleep 3
done
