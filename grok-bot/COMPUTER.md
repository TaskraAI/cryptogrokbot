# Agent Computer (inside Grok Bot)

This is the Linux box Grok Bot gives every Bot. It is **not** your Mac. `localhost` here is the cloud computer.

## Bring-up (paper)

```bash
git clone https://github.com/TaskraAI/CryptoTrading.git
cd CryptoTrading
git checkout cursor/solana-meme-night-agent-1f38   # until PR #1 is merged
npm install
test -f .env || bash scripts/prepare-restore.sh
# Taskra fills secrets in .env. Never invent keys. Never set LIVE/MASTER.
# Fresh disk (no .env / no /tmp/cf-api.token): see RESTORE.md, then desk-status + bring-origin-back.
MODE=PAPER npm run agent
```

Paper buy/sell of a mint you pick (no night loop):

```bash
npm run trade -- scan
npm run trade -- buy <mint>
npm run trade -- positions
npm run trade -- sell 1
```

Then open `http://127.0.0.1:8787/` in **this** computer’s browser.

## One process

```bash
ss -ltnp | grep 8787 || true
pgrep -af "apps/agent" || true
# if two copies: pkill -f "apps/agent" then start one
```

## What “working” looks like

- Terminal: ticks every ~15s, lines from Scout / Sentinel / Grok / Scholar / Chief
- Browser: five cards with last action timestamps
- JSON: `curl -s http://127.0.0.1:8787/crew.json`

Empty `x_accounts` is fine. Paper auto-entry uses the `watchlist:` mints in `config/sources.yaml`.

## xAI API vs Grok Bot login

Grok Bot sign-in ≠ `XAI_API_KEY`.  
`/research` and LLM theses need a key from https://console.x.ai in `.env` on this computer.

## Fresh disk / origin:down

Git never stores `.env`, `/tmp/cf-api.token`, or `data/`. A new Agent Computer does not inherit the last one.

1. Taskra drops secrets on **this** box (secure secret card or local editor). Never paste them in chat. Guide: [`RESTORE.md`](RESTORE.md).
2. `bash scripts/desk-status.sh` — env present, wallet SET if you need live signs, cf api token present.
3. `bash scripts/bring-origin-back.sh` — public health must be LIVE, not `"origin":"down"`.

Chief must not invent `WALLET_SECRET_KEY`, a Cloudflare token, or `chief:APPROVE`.
