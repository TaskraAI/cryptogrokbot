# Agent Computer (inside Grok Bot)

This is the Linux box Grok Bot gives every Bot. It is **not** your Mac. `localhost` here is the cloud computer.

## Bring-up (paper)

```bash
git clone https://github.com/TaskraAI/CryptoTrading.git
cd CryptoTrading
git checkout cursor/solana-meme-night-agent-1f38   # until PR #1 is merged
npm install
test -f .env || cp .env.example .env
# Taskra fills secrets in .env. Never invent keys. Never set LIVE/MASTER.
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
