#!/usr/bin/env bash
# Start the cryptogrokbot.com desk on this host: agent on :8787 + origin watcher.
# Never prints secrets. Put CLOUDFLARE_API_TOKEN in /tmp/cf-api.token (0600) and
# WALLET_SECRET_KEY in gitignored .env so Grok Bot can sign.
# Does not kill a healthy watcher or an existing localhost.run tunnel.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
if [[ ! -f .env ]]; then
  echo "NOTE: .env missing — seeding skeleton via prepare-restore.sh (no wallet key written)."
  bash scripts/prepare-restore.sh || true
fi
if [[ ! -s /tmp/cf-api.token ]]; then
  bash scripts/sync-cf-token-from-env.sh || true
fi
if [[ ! -f .env ]]; then
  echo "NOTE: .env missing — agent will wait. See grok-bot/RESTORE.md."
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
agent_loop="$(pgrep -n -f '[b]ash scripts/keep-agent.sh' || true)"
if [[ -z "$agent_loop" ]]; then
  "${TMUX[@]}" send-keys -t "$SESSION_AGENT:0.0" 'bash scripts/keep-agent.sh' C-m
else
  echo "keep-agent already running pid=$agent_loop"
fi
if ! "${TMUX[@]}" has-session -t "=$SESSION_ORIGIN" 2>/dev/null; then
  "${TMUX[@]}" new-session -d -s "$SESSION_ORIGIN" -c "$PWD" -- "${SHELL:-bash}" -l
fi
watch_pid="$(pgrep -n -f '[p]ython3 scripts/keep-cf-origin.py' || true)"
if [[ -n "$watch_pid" ]]; then
  echo "origin watcher already running pid=$watch_pid"
else
  "${TMUX[@]}" send-keys -t "$SESSION_ORIGIN:0.0" 'CLOUDFLARED=/tmp/cloudflared CLOUDFLARE_API_TOKEN_FILE=/tmp/cf-api.token python3 scripts/keep-cf-origin.py' C-m
fi
echo "agent :8787 + origin watcher started. Public health is https://cryptogrokbot.com/health"
echo "This Cloud Agent is not 24/7. See grok-bot/HOSTING.md before live trading."
