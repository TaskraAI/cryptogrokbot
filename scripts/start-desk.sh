#!/usr/bin/env bash
# Start the cryptogrokbot.com desk on this host: agent on :8787 + origin watcher.
# Never prints secrets. Put CLOUDFLARE_API_TOKEN in /tmp/cf-api.token (0600) and
# WALLET_SECRET_KEY in gitignored .env so Grok Bot can sign.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
if [[ ! -f .env ]]; then
  echo "NOTE: .env missing — agent will wait. Drop it here to sign (MASTER_ENABLED=false)."
fi
if [[ ! -s /tmp/cf-api.token ]]; then
  echo "NOTE: /tmp/cf-api.token missing — public site stays 502 until the token file exists."
fi
SESSION_AGENT=dashboard-paper
SESSION_ORIGIN=cf-origin-watch
TMUX=(tmux -f /exec-daemon/tmux.portal.conf)
if ! "${TMUX[@]}" has-session -t "=$SESSION_AGENT" 2>/dev/null; then
  "${TMUX[@]}" new-session -d -s "$SESSION_AGENT" -c "$PWD" -- "${SHELL:-bash}" -l
fi
if ! curl -sf --max-time 2 http://127.0.0.1:8787/health >/dev/null; then
  "${TMUX[@]}" send-keys -t "$SESSION_AGENT:0.0" C-c
  sleep 1
  "${TMUX[@]}" send-keys -t "$SESSION_AGENT:0.0" 'bash scripts/keep-agent.sh' C-m
fi
if ! "${TMUX[@]}" has-session -t "=$SESSION_ORIGIN" 2>/dev/null; then
  "${TMUX[@]}" new-session -d -s "$SESSION_ORIGIN" -c "$PWD" -- "${SHELL:-bash}" -l
fi
"${TMUX[@]}" send-keys -t "$SESSION_ORIGIN:0.0" C-c
sleep 1
"${TMUX[@]}" send-keys -t "$SESSION_ORIGIN:0.0" 'CLOUDFLARED=/tmp/cloudflared CLOUDFLARE_API_TOKEN_FILE=/tmp/cf-api.token python3 scripts/keep-cf-origin.py' C-m
echo "agent :8787 + origin watcher started. Public health is https://cryptogrokbot.com/health"
