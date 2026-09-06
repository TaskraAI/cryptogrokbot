#!/usr/bin/env bash
# Restore :8787 + the public tunnel. Safe to rerun. Never prints secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data

if [[ ! -d node_modules ]]; then
  echo "installing npm dependencies"
  npm install
fi

if [[ ! -x /tmp/cloudflared ]]; then
  echo "downloading cloudflared to /tmp/cloudflared"
  curl -fsSL -o /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x /tmp/cloudflared
fi

if [[ ! -f .env ]]; then
  echo "no .env — running prepare-restore.sh (skeleton only; never writes a wallet key)"
  bash scripts/prepare-restore.sh || true
fi
if [[ ! -s /tmp/cf-api.token ]]; then
  echo "no /tmp/cf-api.token — trying CLOUDFLARE_API_TOKEN from env/.env"
  bash scripts/sync-cf-token-from-env.sh || true
fi
if [[ ! -f .env ]]; then
  echo "BLOCKED: .env is missing. See grok-bot/RESTORE.md (Path A or B). Do not paste secrets in chat."
  echo "Watcher can still start and wait for /tmp/cf-api.token."
fi
if [[ ! -s /tmp/cf-api.token ]]; then
  echo "BLOCKED: /tmp/cf-api.token is missing. Without it the Worker ORIGIN stays dead and the site 502s."
  echo "See grok-bot/RESTORE.md"
fi
if [[ -f .env ]] && ! grep -qE '^WALLET_SECRET_KEY=.+' .env; then
  echo "NOTE: WALLET_SECRET_KEY is empty — paper desk only until Taskra drops the hot-wallet export."
fi

bash scripts/start-desk.sh
echo "waiting for a LIVE public origin (not origin:down)"
for i in $(seq 1 40); do
  body="$(curl -sS --max-time 12 -A 'Mozilla/5.0' https://cryptogrokbot.com/health 2>/dev/null || true)"
  if printf '%s' "$body" | grep -q cryptogrokbot-dashboard && ! printf '%s' "$body" | grep -q '"origin":"down"'; then
    echo "cryptogrokbot.com origin is LIVE"
    bash scripts/desk-status.sh
    exit 0
  fi
  echo "still reconnecting ($i/40) ${body:-no-body}"
  sleep 5
done
echo "origin not live yet. Re-run: bash scripts/desk-status.sh"
bash scripts/desk-status.sh
exit 1
