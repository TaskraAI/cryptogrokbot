# CryptoTrading — Solana Meme-Coin Night Agent

Personal agent that watches sources you list, trades a **dedicated hot wallet** under daily caps, returns your initial SOL first, then holds or sells the runner from market-cap / volume / sentiment. Paper mode is the default. This is not financial advice.

## What it does

- **Night watchman** — hard stop, time stop, `/sellall`, trailing stop on the runner
- **Compound** — sell just enough to recover principal, leftover is house-money
- **Tape** — market cap, volume, buy/sell, sentiment; **dip + high sentiment = hold**
- **Sources** — X (official API), Telegram/Discord config, RSS, DexScreener, Pump.fun
- **Paper ledger** before any live buy (`MODE=PAPER`)
- **Live buys** only when `MODE=LIVE` **and** `MASTER_ENABLED=true`
- **Telegram cockpit** — `/status` `/positions` `/tape` `/review` `/grade` `/lesson` `/never` `/kill`
- **Learning** — journal, grades, lessons, `/never` guardrails, nightly pattern stats
- **Grok crew** — Scout, Sentinel, Grok, Scholar run **in parallel**; watch `/crew` or `http://127.0.0.1:8787/`
- **Extra rules** — `config/rules.yaml` (toggle with `/rules` `/rule on|off`)

## Quick start

```bash
cp .env.example .env
npm install
npm test
npm run agent -- --once    # one tick
npm run agent              # loop every 15s
```

Fill in:

1. `config/sources.yaml` — handles, channels, sites, copy/fade wallets, mute list
2. `config/policy.json` — daily budget, trade cap, stops, dip thresholds
3. `.env` — `WALLET_SECRET_KEY` (hot wallet only), `HELIUS_RPC_URL`, Telegram, optional X / OpenAI / PumpPortal

Keep `MODE=PAPER` until you have graded a week of shadow trades.

## Safety

- Dedicated hot wallet. Never point this at your main wallet.
- Live orders need both `MODE=LIVE` and `MASTER_ENABLED=true` (Telegram `/kill` turns master off).
- Hitting `dailyBudgetSol`, `maxTradesPerDay`, or `dailyLossCapSol` **stops buys**, not exits.
- Honeypot sell-sim runs before a live buy. Freeze authority and guardrails are hard denies.
- LLM can advise a runner hold/sell. It cannot disable a hard stop, dump, or rug flatten, and cannot sell through a `healthy_dip`.

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

Set `XAI_API_KEY` and open `http://127.0.0.1:8787/` while `npm run agent` is running to see agents work at the same time.

## Grok Bot app (Mac / iOS)

The **Grok Bot** desktop/iOS app is not this Node process and is not the xAI API key. There is no API to create Bots from this repo — you paste profiles in the app.

Copy-paste pack: [`grok-bot/README.md`](grok-bot/README.md)

1. Create five Bots (Chief, Scout, Sentinel, Grok, Scholar) from `grok-bot/profiles/`
2. Attach skills from `grok-bot/skills/`
3. Connect GitHub so the Agent Computer can clone this private repo
4. Paste `grok-bot/first-tasks/bring-up-paper.md` to Chief — paper only
5. Open a group chat and paste `grok-bot/first-tasks/group-desk.md`

Stay in `MODE=PAPER`. Do not put wallet keys in a Bot profile.

## Extra rules

Add more in [`config/rules.yaml`](config/rules.yaml) without shipping code. Types include age, holders, 5m volume, mcap floor/ceiling, buy/sell ratio, session hours, loss streak, keywords, copy/fade wallets. `/rule off skip-fresh-snipe` disables one immediately.

## Layout

```
apps/agent          loop, watchman, entries
apps/telegram       grammy cockpit
packages/risk       budget, scorer, guardrails
packages/patterns   dip/dump/fade/climax + exits
packages/tape       MC / volume / sentiment snapshot
packages/social     sources.yaml, CA extract, X/RSS
packages/signals    DexScreener, Jupiter, Pump.fun, RPC health
packages/execution  paper + Jupiter swap + PumpPortal local-sign
packages/storage    SQLite journal
packages/learning   review, lessons, nightly pattern stats
config/             policy, sources, guardrails, lessons
grok-bot/           Grok Bot app profiles, skills, first tasks
```

## Default policy

0.5 SOL/day, 5 trades, 0.1 SOL each, −25% hard stop, return principal at 1x, 15% dip + sentiment ≥ 0.4 holds the runner. Edit `config/policy.json`.
