# CryptoTrading

Personal assistant for **discovering, buying, and selling Solana meme coins** you choose. Paper (dry-run) is the default. Nothing spends real SOL unless you opt in. This is not financial advice. Meme coins rug.

Mobile dashboard (intended host: **cryptogrokbot.com**): login, crew pulses, paper buys with DexScreener, wallets, P&L, **Intel** (eight Grok desks), **Rung challenge** ($100 → $5k → $10k → $1M, crypto only), todos, lessons, Auditor bug scan.

## Run the dashboard (paper)

Node 22+. Secrets live in `.env` (gitignored). Never commit keys, seed phrases, or Cloudflare tokens.

```bash
cp .env.example .env          # MODE=PAPER, MASTER_ENABLED=false
npm install
npm test
npm run agent                 # dashboard + night loop; http://127.0.0.1:8787/
```

Open the URL on your phone or desktop. Log in with **email + password** (no 2FA).

- Email: `DASHBOARD_EMAIL` (default `hello@taskra.ai` if unset; stored in gitignored `data/.dashboard-email`)
- Password: `DASHBOARD_PASSWORD`, or a one-time generated value in `data/.dashboard-password`
- Grok Bot / AI: Home → **Invite Grok Bot** gives a URL/token. The bot opens `/invite/<token>` or pastes the token on the login screen — no email code. Bearer `Authorization: Bearer cgbot_…` also works for `/api/*`.
- Intel: after login, open **Intel** (or Home → Open Intel). Eight desks — X sentiment, early gems, project eval, whales, entry/exit timing, narratives, portfolio, scam radar. Set `XAI_API_KEY` for live Grok + X search; without it each desk still returns a grounded framework. Research only — they do not override hard stops or the HOLD rule.
- Rung challenge: Home card + `GET /api/challenge`. $100 → $5,000 → $10,000 then ~2x to $1,000,000 on **Solana only** (Grok Bot Bearer). Polymarket stays off until enabled. Not a promise. Live size stays at `maxSolPerTrade`.

```bash
# CLI still works (same paper ledger)
npm run trade -- scan
npm run trade -- buy DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 --sol 0.1
npm run trade -- positions
npm run trade -- sell 1
```

`--sol` is refused if it exceeds `config/policy.json` `maxSolPerTrade` (also enforced inside `executeBuy`). `--strict` also applies `config/rules.yaml`. `--force` skips scoring (**paper only**).

Starter watchlist (BONK, WIF, POPCAT, TRUMP) is in [`config/sources.yaml`](config/sources.yaml).

## cryptogrokbot.com

The dashboard canonical URL is **https://cryptogrokbot.com/**.

`www`, `dash`, and `app` redirect there (301). Nameservers are on Cloudflare (`kanye.ns.cloudflare.com` / `stella.ns.cloudflare.com`). A Worker (`workers/cryptogrokbot.js`) fronts the origin; `npm run agent` on port **8787** plus a Cloudflare Tunnel must be running or the site returns 502 / 1016.

The Worker `ORIGIN` binding must be a hostname the Worker can fetch. `*.cfargotunnel.com` is blocked (Error 1102). trycloudflare `--url` hostnames from this VM return **530 Origin DNS error** even when `cloudflared` is connected. The API token here cannot write the named-tunnel DNS CNAME, so `origin.cryptogrokbot.com` 1016s. The working origin is a **localhost.run** reverse tunnel in front of `127.0.0.1:8787`, with the Worker still on apex/www/dash/app. Keep it alive with:

```bash
CLOUDFLARE_API_TOKEN_FILE=/tmp/cf-api.token python3 scripts/keep-cf-origin.py
```

Run **one** watcher. It attaches Worker custom domains, starts the named tunnel `cryptogrokbot-dashboard` as a sidecar, publishes Worker ORIGIN from localhost.run, and health-checks `https://cryptogrokbot.com/health` with a browser User-Agent. A Worker fallback 200 with `"origin":"down"` is **not** healthy — the watcher recycles the tunnel so Grok Bot can still POST fills overnight. If the API token file is missing, the watcher waits for `/tmp/cf-api.token`. `scripts/start-desk.sh` starts `scripts/keep-agent.sh` (restarts `npm run agent` if :8787 dies) plus that watcher. If the public site says `502 Desk is reconnecting` or `/health` has `"origin":"down"`, this host lost the tunnel (or this is a fresh disk with no `.env` / `/tmp/cf-api.token`). How to get those files (Path A backup or Path B dashboards, never paste secrets in chat): [`grok-bot/RESTORE.md`](grok-bot/RESTORE.md). Then `bash scripts/desk-status.sh` and `bash scripts/bring-origin-back.sh`. Do not treat a fallback 200 as live.

This cloud VM is **not** a 24/7 VPS — run the agent + tunnel on a durable host.

On the durable host:

1. Run `npm run agent` and `cloudflared tunnel run` with the named tunnel `cryptogrokbot-dashboard`.
2. Set `DASHBOARD_SECURE_COOKIE=true` behind HTTPS. Set `DASHBOARD_EMAIL` and `DASHBOARD_PASSWORD` in `.env` on that host only.
3. Login is email + password (no 2FA). Invite Grok Bot from the Home Access card.

`CLOUDFLARE_API_TOKEN` is used to look up the zone / manage the tunnel and Worker. Never commit it. Placeholders are in `.env.example`.

## Night auto-buys (still paper)

`npm run agent -- --once` paper-enters a **watchlist** mint when DexScreener has a live Solana market and scoring + `config/rules.yaml` pass. Extra rules can skip a name on a quiet 5m (e.g. `min-vol-5m`); the next listed name can still fill. Cooldown is 180s between entries.

```bash
MODE=PAPER MASTER_ENABLED=false npm run agent -- --once
npm run agent              # loop + dashboard http://127.0.0.1:8787/
```

Default policy (`config/policy.json`): **0.3 SOL/day**, 5 trades, **0.1 SOL** live size cap, −25% hard stop, cost-out at **2.5–5x** (let a strong rally run to 5x) then moon bag, 15% dip + sentiment ≥ 0.4 holds the runner.

## Paper vs live

| | `MODE=PAPER` (default) | `MODE=LIVE` |
|---|---|---|
| What happens | SQLite ledger only. No transaction is sent. | Jupiter (graduated) or PumpPortal local-sign (curve), then a signed tx |
| Wallet | Not required | `WALLET_SECRET_KEY` **or** a dashboard wallet secret required or the buy **fails closed** |
| Master switch | Ignored for paper fills | Sentinel live **exits** need `MASTER_ENABLED=true`. **Scout never live-buys** even with MASTER on — names queue for Chief APPROVE. Kill from Home or `/kill`. **Grok Bot Bearer** live buy needs `{chief:"APPROVE"}` |
| Dashboard buy/sell | **Grok Bot Bearer only** (owner cookie returns 403) | Same. Owner Home has Kill MASTER. The client cannot force live. Auto live sells still need master + wallet |
| Extra daily budget | Ignored (`ALLOW_EXTRA_BUDGET` default false) | Ignored unless `ALLOW_EXTRA_BUDGET=true` (logged; not settable from an unauthenticated path) |

Live is two flags **and** a dedicated hot-wallet secret (`.env` or `data/wallet-secrets.json`):

```
MODE=LIVE
MASTER_ENABLED=true
WALLET_SECRET_KEY=   # JSON byte array or base58. Hot wallet only. Never the main wallet.
HELIUS_RPC_URL=      # recommended over public RPC
```

Telegram `/kill` or dashboard **Kill MASTER** turns the SQLite `master` flag off (Scout still cannot live-buy; **Sentinel live exits** fail closed; paper sells still run). Boot no longer stomps that flag when `.env` still has `MASTER_ENABLED=true`. `MASTER_ENABLED=false` in env always kills on restart. `/resume CONFIRM` or Home **Resume MASTER** (type CONFIRM) turns master back on. That is a **kill/resume switch only**: it cannot change `MODE`. The DB cannot flip paper to live. Sentinel live exits require `MODE=LIVE` from env **and** master **and** a hot wallet. **Scout never live-buys.** **Only Grok Bot** (`Authorization: Bearer cgbot_…`) can place dashboard buy/sell (paper and live). Live `/api/buy` also needs `{ "chief": "APPROVE" }` (or an owner-approved gem). Owner login cannot buy/sell.

Dashboard bind defaults to `127.0.0.1`. A public bind is optional (`DASHBOARD_BIND=0.0.0.0`); when bind is not loopback, the session cookie is `Secure` unless you set `DASHBOARD_SECURE_COOKIE=false`.

Dashboard wallets: add a **label + public key** and optionally a secret. The secret is written to gitignored `data/wallet-secrets.json` and is **never returned to the browser after save**. The UI shows `connected` (secret present), assigned desk, and a read-only SOL balance via RPC when a public key is set.

## Env vars (`.env.example`)

| Var | Required | Purpose |
|-----|----------|---------|
| `MODE` | no (default PAPER) | `PAPER` or `LIVE` |
| `MASTER_ENABLED` | no (default false) | Sentinel live exits (kill/resume via dashboard or Telegram when MODE=LIVE). Scout never live-buys. Env `false` kills sqlite on boot; env `true` does not revive a dashboard `/kill` |
| `ALLOW_EXTRA_BUDGET` | no (default false) | if true, `extra_budget_sol` may raise the daily cap (logged) |
| `WALLET_SECRET_KEY` | live only | hot wallet |
| `DASHBOARD_BIND` | no | default `127.0.0.1` |
| `DASHBOARD_SECURE_COOKIE` | no | auto-on when bind is not loopback; set `true` behind HTTPS |
| `DASHBOARD_EMAIL` | no | login email (default `hello@taskra.ai`; persisted to `data/.dashboard-email`) |
| `DASHBOARD_PASSWORD` | no | login; else generated into `data/.dashboard-password` |
| `RESEND_API_KEY` | no | send login codes by email; else code is logged / shown |
| `DASHBOARD_HOST` | no | default `cryptogrokbot.com` |
| `CREW_PORT` | no | dashboard port (default 8787) |
| `WALLET_SECRETS_PATH` | no | gitignored JSON map of wallet secrets |
| `CLOUDFLARE_API_TOKEN` | no | zone lookup only; never commit |
| `CF_R2_ACCESS_KEY_ID` / `CF_R2_SECRET_ACCESS_KEY` / `CF_R2_ENDPOINT` / `CF_R2_BUCKET` | no | optional R2 static assets |
| `HELIUS_RPC_URL` / `FALLBACK_RPC_URL` | live exits/entries | RPC |
| `DATABASE_PATH` | no | SQLite journal (default `./data/night-agent.db`) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | no | phone cockpit |
| `X_BEARER_TOKEN` | no | official X timelines for the night agent |
| `PUMPPORTAL_API_KEY` | live curve buys | PumpPortal `trade-local` |
| `XAI_API_KEY` | no | Grok thesis, `/research`, and Intel desks (X search on sentiment/gems/eval/narratives/scams) |

## Safety

- Dedicated hot wallet. Never point this at your main wallet.
- Hitting `dailyBudgetSol`, `maxTradesPerDay`, or `dailyLossCapSol` **stops fills**, not Scout search — chances still queue. Paper exits keep running. Auto live exits also stop when master is off. **Grok Bot Bearer** explicit orders can still live-trade while MASTER is off. **PAPER and LIVE each have their own daily ledger** — paper fills do not consume the live cap.
- `extra_budget_sol` does **not** raise the daily cap unless `ALLOW_EXTRA_BUDGET=true`.
- Per-trade size is refused inside `executeBuy` if it exceeds `maxSolPerTrade`. High hype+volume **does** auto-buy at the cap (Grok Bot decides). Cost-out at 2.5–5x (delay if the rally is strong), then moon bag. Do not raise past 0.1 SOL unless Taskra says so.
- Live buy runs a Jupiter sell-sim first. Freeze / guardrails / `/never` rules are hard denies.
- LLM cannot disable a hard stop or sell through a `healthy_dip`.
- Unauthenticated mutating API calls return 401. Owner session cannot buy/sell (403). Only Grok Bot Bearer places orders. The old open crew board is behind the same login.
- Dashboard login is email + password (no 2FA). Grok Bot / AI use an invite token or Bearer. Wallet secrets are never returned after save. Default bind is localhost.
- Auditor (6th crew agent) records scans in SQLite: paper default, secrets not in git, live fail-closed (Grok Bot-only orders, dashboard kill, size cap, extra budget off, localhost bind).

## Telegram

| Command | Purpose |
|---|---|
| `/status` `/budget` `/policy` | mode, master, caps |
| `/positions` `/tape <mint\|id>` `/why <mint>` | open bags and tape |
| `/pnl` `/review [today\|7d\|30d\|all]` `/trade <id>` | journal |
| `/grade <id> win\|meh\|fail [note]` | train the journal |
| `/lesson <text>` `/never <rule>` `/guardrails` `/unguard <id>` | lessons + hard denies |
| `/kill` `/resume CONFIRM` `/sellall CONFIRM` | halt auto live txs / resume master (MODE unchanged; dashboard Home has the same kill/resume) / flatten |
| `/crew` | live Grok crew (Scout / Sentinel / Grok / Scholar / Auditor) |
| `/rules` `/rule on\|off <id>` | extra rules in `config/rules.yaml` |
| `/research <mint>` | Grok multi-agent research (needs `XAI_API_KEY`) |

## Grok Bot app (Mac / iOS)

Sign in with the **same Cursor account**. Walkthrough: [`grok-bot/WALKTHROUGH.md`](grok-bot/WALKTHROUGH.md). Stay in `MODE=PAPER`. Do not put wallet keys in a Bot profile.

## Extra rules

[`config/rules.yaml`](config/rules.yaml) — age, holders, 5m volume, mcap, buy/sell, hours, loss streak, keywords, copy/fade wallets. Holder count `0` means *unknown* (DexScreener does not provide it), not zero holders.

## Layout

```
apps/agent          loop, dashboard (auth + APIs), watchman, entries, `npm run trade` CLI
apps/telegram       grammy cockpit
packages/risk       budget, scorer, guardrails
packages/patterns   dip/dump/fade/climax + exits
packages/tape       MC / volume / sentiment snapshot
packages/social     sources.yaml, CA extract, X/RSS
packages/signals    DexScreener, Jupiter, Pump.fun, RPC health
packages/execution  paper + Jupiter swap + PumpPortal local-sign
packages/storage    SQLite journal, wallets, todos, feedback, auditor scans
packages/learning   review, lessons, nightly pattern stats
packages/crew       six parallel desks including Auditor
config/             policy, sources, guardrails, lessons, rules
grok-bot/           Grok Bot app profiles, skills, first tasks
```
