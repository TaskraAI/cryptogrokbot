# CryptoTrading

Personal assistant for **discovering, buying, and selling Solana meme coins** you choose. Paper (dry-run) is the default. Nothing spends real SOL unless you opt in. This is not financial advice. Meme coins rug.

## Run it (paper)

Node 22+. Secrets live in `.env` (gitignored). Never commit keys.  
Starter watchlist (BONK, WIF, POPCAT, TRUMP) is in [`config/sources.yaml`](config/sources.yaml) — add your own mints there.

```bash
cp .env.example .env          # MODE=PAPER, MASTER_ENABLED=false
npm install
npm test
npm run trade -- scan
npm run trade -- buy DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 --sol 0.05
npm run trade -- positions
npm run trade -- sell 1
```

Those are the commands used to prove the paper loop (BONK mint above). `--sol` is capped by `config/policy.json` `maxSolPerTrade`. `--strict` also applies `config/rules.yaml`. `--force` skips scoring (**paper only**).

## Night auto-buys (still paper)

`npm run agent -- --once` paper-enters a **watchlist** mint when DexScreener has a live Solana market and scoring + `config/rules.yaml` pass. No X API needed for the watchlist. Extra rules can skip a name on a quiet 5m (e.g. `min-vol-5m`); the next listed name can still fill. Cooldown is 180s between entries.

```bash
MODE=PAPER MASTER_ENABLED=false npm run agent -- --once
npm run agent              # loop; crew board http://127.0.0.1:8787/
```

Default policy (`config/policy.json`): 0.5 SOL/day, 5 trades, 0.1 SOL each, −25% hard stop, return principal at 1x, 15% dip + sentiment ≥ 0.4 holds the runner.

## Paper vs live

| | `MODE=PAPER` (default) | `MODE=LIVE` |
|---|---|---|
| What happens | SQLite ledger only. No transaction is sent. | Jupiter (graduated) or PumpPortal local-sign (curve), then a signed tx |
| Wallet | Not required | `WALLET_SECRET_KEY` required or the buy **fails closed** |
| Master switch | Ignored | Must be `MASTER_ENABLED=true` or the buy **fails closed** |

Live is two flags **and** a dedicated hot-wallet secret in `.env`:

```
MODE=LIVE
MASTER_ENABLED=true
WALLET_SECRET_KEY=   # JSON byte array or base58. Hot wallet only. Never the main wallet.
HELIUS_RPC_URL=      # recommended over public RPC
```

Telegram `/kill` turns master off (new buys stop; exits still run). `/resume CONFIRM` turns it back on.

## Env vars (`.env.example`)

| Var | Required | Purpose |
|-----|----------|---------|
| `MODE` | no (default PAPER) | `PAPER` or `LIVE` |
| `MASTER_ENABLED` | no (default false) | live entries |
| `WALLET_SECRET_KEY` | live only | hot wallet |
| `HELIUS_RPC_URL` / `FALLBACK_RPC_URL` | live exits/entries | RPC |
| `DATABASE_PATH` | no | SQLite journal (default `./data/night-agent.db`) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | no | phone cockpit |
| `X_BEARER_TOKEN` | no | official X timelines for the night agent |
| `PUMPPORTAL_API_KEY` | live curve buys | PumpPortal `trade-local` |
| `XAI_API_KEY` | no | Grok thesis / `/research` |

## Safety

- Dedicated hot wallet. Never point this at your main wallet.
- Hitting `dailyBudgetSol`, `maxTradesPerDay`, or `dailyLossCapSol` **stops buys**, not exits.
- Live buy runs a Jupiter sell-sim first. Freeze / guardrails / `/never` rules are hard denies.
- LLM cannot disable a hard stop or sell through a `healthy_dip`.

## Telegram

| Command | Purpose |
|---|---|
| `/status` `/budget` `/policy` | mode, master, caps |
| `/positions` `/tape <mint\|id>` `/why <mint>` | open bags and tape |
| `/pnl` `/review [today\|7d\|30d\|all]` `/trade <id>` | journal |
| `/grade <id> win\|meh\|fail [note]` | train the journal |
| `/lesson <text>` `/never <rule>` `/guardrails` `/unguard <id>` | lessons + hard denies |
| `/kill` `/resume CONFIRM` `/sellall CONFIRM` | halt entries / flatten |
| `/crew` | live Grok crew (Scout / Sentinel / Grok / Scholar) |
| `/rules` `/rule on\|off <id>` | extra rules in `config/rules.yaml` |
| `/research <mint>` | Grok multi-agent research (needs `XAI_API_KEY`) |

## Grok Bot app (Mac / iOS)

Sign in with the **same Cursor account**. Walkthrough: [`grok-bot/WALKTHROUGH.md`](grok-bot/WALKTHROUGH.md). Stay in `MODE=PAPER`. Do not put wallet keys in a Bot profile.

## Extra rules

[`config/rules.yaml`](config/rules.yaml) — age, holders, 5m volume, mcap, buy/sell, hours, loss streak, keywords, copy/fade wallets. Holder count `0` means *unknown* (DexScreener does not provide it), not zero holders.

## Layout

```
apps/agent          loop, watchman, entries, `npm run trade` CLI
apps/telegram       grammy cockpit
packages/risk       budget, scorer, guardrails
packages/patterns   dip/dump/fade/climax + exits
packages/tape       MC / volume / sentiment snapshot
packages/social     sources.yaml, CA extract, X/RSS
packages/signals    DexScreener, Jupiter, Pump.fun, RPC health
packages/execution  paper + Jupiter swap + PumpPortal local-sign
packages/storage    SQLite journal
packages/learning   review, lessons, nightly pattern stats
config/             policy, sources, guardrails, lessons, rules
grok-bot/           Grok Bot app profiles, skills, first tasks
```
