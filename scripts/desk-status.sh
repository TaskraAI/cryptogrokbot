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

if [[ -f .env ]]; then say "env           present"; else say "env           MISSING  — drop gitignored .env (MASTER_ENABLED=false, WALLET_SECRET_KEY to sign)"; fi
if [[ -s /tmp/cf-api.token ]]; then say "cf api token  present"; else say "cf api token  MISSING  — write CLOUDFLARE_API_TOKEN to /tmp/cf-api.token (mode 0600)"; fi
if [[ -x /tmp/cloudflared ]] || command -v cloudflared >/dev/null; then say "cloudflared   present"; else say "cloudflared   MISSING"; fi
if [[ -d data ]]; then say "data/         present"; else say "data/         MISSING  — fresh book; old sqlite did not survive this disk"; fi
