#!/usr/bin/env bash
# Print whether cryptogrokbot.com can sign. Never prints secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
UA='Mozilla/5.0 (compatible; CryptoGrokBotOriginWatch/1.0; +https://cryptogrokbot.com/health)'

say() { printf '%s\n' "$*"; }

local_body="$(curl -sS --max-time 3 http://127.0.0.1:8787/health 2>/dev/null || true)"
if printf '%s' "$local_body" | grep -q cryptogrokbot-dashboard; then
  say "local :8787  UP"
else
  say "local :8787  DOWN  — npm run agent is not running"
fi

pub_body="$(curl -sS --max-time 12 -A "$UA" https://cryptogrokbot.com/health 2>/dev/null || true)"
if printf '%s' "$pub_body" | grep -q '"origin":"down"'; then
  say "public        PAGE UP, ORIGIN DOWN  — login/API 502, cannot sign"
elif printf '%s' "$pub_body" | grep -q cryptogrokbot-dashboard; then
  say "public        LIVE  — Grok Bot can POST /api/buy"
else
  say "public        UNREACHABLE"
fi
say "public body   ${pub_body:-"(empty)"}"

named_code="$(curl -sS --max-time 12 -A "$UA" -o /tmp/named-origin.health -w '%{http_code}' https://origin.cryptogrokbot.com/health 2>/dev/null || echo 000)"
named_body="$(cat /tmp/named-origin.health 2>/dev/null || true)"
if printf '%s' "$named_body" | grep -q cryptogrokbot-dashboard && ! printf '%s' "$named_body" | grep -q '"origin":"down"'; then
  say "named origin  LIVE  https://origin.cryptogrokbot.com"
elif [[ "$named_code" == "502" ]] || printf '%s' "$named_body" | grep -qE 'error code: 502'; then
  say "named origin  TUNNEL UP, APP DOWN  HTTP 502 — cloudflared is connected, but nothing is listening on the VPS at 127.0.0.1:8787. Copy the repo + .env + data/ there and run bash scripts/install-vps.sh. See grok-bot/HOSTING.md"
elif printf '%s' "$named_body" | grep -qE '1033|530|1016'; then
  say "named origin  DOWN  HTTP $named_code — DNS may exist, but cloudflared is not connected (1033/530). See grok-bot/HOSTING.md"
else
  say "named origin  DOWN  HTTP $named_code ${named_body:-(empty)}"
fi

if [[ -f .env ]]; then
  say "env           present"
  MODE_LINE=$(grep -E '^MODE=' .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)
  MASTER_LINE=$(grep -E '^MASTER_ENABLED=' .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)
  BIND_LINE=$(grep -E '^DASHBOARD_BIND=' .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)
  HOST_LINE=$(grep -E '^DASHBOARD_HOST=' .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)
  EMAIL_LINE=$(grep -E '^DASHBOARD_EMAIL=' .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)
  if grep -qE '^WALLET_SECRET_KEY=.+' .env 2>/dev/null; then
    WALLET_LINE=SET
  else
    WALLET_LINE=EMPTY
  fi
  say "  MODE        ${MODE_LINE:-unset}"
  say "  MASTER      ${MASTER_LINE:-unset}  (must stay false)"
  say "  wallet      $WALLET_LINE  (never printed)"
  say "  bind/host   ${BIND_LINE:-unset} / ${HOST_LINE:-unset}"
  say "  email       ${EMAIL_LINE:-unset}"
else
  say "env           MISSING  — see grok-bot/RESTORE.md (Path A or B)"
fi
if [[ -s /tmp/cf-api.token || -s data/.cf-api.token ]]; then
  say "cf api token  present"
else
  say "cf api token  MISSING  — see grok-bot/RESTORE.md (Workers Edit token, mode 0600)"
fi
if [[ -x /tmp/cloudflared ]] || command -v cloudflared >/dev/null; then say "cloudflared   present"; else say "cloudflared   MISSING"; fi
if [[ -d data ]]; then
  if [[ -f data/night-agent.db || -f data/dashboard-access.json || -f data/.dashboard-password ]]; then
    say "data/         present (book or password file on this disk)"
  else
    say "data/         empty  — fresh book; re-invite Grok Bot after login"
  fi
else
  say "data/         MISSING  — fresh book; old sqlite did not survive this disk"
fi
say "restore guide grok-bot/RESTORE.md"
