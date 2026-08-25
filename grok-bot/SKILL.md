---
name: night-agent-crew
description: Solana meme-coin night agent. Use when running or inspecting the Grok crew (Scout, Sentinel, Scholar, Grok) in CryptoTrading, adding extra rules, or watching agents work in parallel.
---

# Night Agent Grok crew

**Setting up the Grok Bot Mac/iOS app?** Start at [`WALKTHROUGH.md`](WALKTHROUGH.md) (Cursor sign-in + features). Profiles live in [`README.md`](README.md). This skill is for the Node crew inside the repo.

Five named desks run **at the same time** on one hot wallet:

| Bot | Job |
|---|---|
| Scout | X / RSS / Pump.fun / DexScreener candidates |
| Sentinel | MC / volume / sentiment tape + exits (dip+high sentiment holds) |
| Grok | xAI thesis and `/research` multi-agent |
| Scholar | journal, grades, extra rules, nightly stats |
| Chief | budget, MASTER switch, handoffs |

## See them working

```bash
npm install
cp .env.example .env   # set XAI_API_KEY, TELEGRAM_*, WALLET only if live
npm run agent
```

- Browser: `http://127.0.0.1:8787/` (auto-refresh 2s)
- JSON: `http://127.0.0.1:8787/crew.json`
- Telegram: `/crew`

## Extra rules (add more without code)

Edit `config/rules.yaml` or Telegram:

- `/rules` list
- `/rule on skip-fresh-snipe`
- `/rule off min-vol-5m`

Paste new rows under `rules:` (id, type, value, enabled, when, note).

## Grok

- `XAI_API_KEY` from https://console.x.ai
- Fast JSON: `GROK_MODEL=grok-4-fast`
- Deep dive: `/research <mint>` uses `grok-4.20-multi-agent` + X/web search

Never raise size or disable hard stops from Grok output unless Taskra explicitly raises buy limits (current test ticket: 0.01 SOL in `config/policy.json`). If Taskra tells Grok Bot in the app to change the desk, implement that.
