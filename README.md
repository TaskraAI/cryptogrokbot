# CryptoTrading

Personal assistant for **discovering, buying, and selling Solana meme coins** you choose. Paper (dry-run) is the default. Nothing spends real SOL unless you opt in. This is not financial advice. Meme coins rug.

Mobile dashboard (intended host: **cryptogrokbot.com**): login, crew pulses, paper buys with DexScreener, wallets, P&L, **Intel** (eight Grok desks), todos, lessons, Auditor bug scan.

## Run the dashboard (paper)

Node 22+. Secrets live in `.env` (gitignored). Never commit keys, seed phrases, or Cloudflare tokens.

```bash
cp .env.example .env          # MODE=PAPER, MASTER_ENABLED=false
npm install
npm test
npm run agent                 # dashboard + night loop; http://127.0.0.1:8787/
```

Open the URL on your phone or desktop. Log in with **email + password + email verification**.

- Email: `DASHBOARD_EMAIL` (default `hello@taskra.ai` if unset; stored in gitignored `data/.dashboard-email`)
- Password: `DASHBOARD_PASSWORD`, or a one-time generated value in `data/.dashboard-password`
- Email code: after password, a 6-digit code is sent to that inbox (`RESEND_API_KEY` optional). If email sending is not configured, the code is printed in the agent log and shown on the login screen.
- Grok Bot: after you log in, Home → **Invite Grok Bot** gives a URL/token. The bot opens `/invite/<token>` or pastes the token on the login screen. Bearer `Authorization: Bearer cgbot_…` also works for `/api/*`.
- Intel: after login, open **Intel** (or Home → Open Intel). Eight desks — X sentiment, early gems, project eval, whales, entry/exit timing, narratives, portfolio, scam radar. Set `XAI_API_KEY` for live Grok + X search; without it each desk still returns a Dex-grounded framework. Research only — they do not override hard stops or the HOLD rule.

```bash
# CLI still works (same paper ledger)
npm run trade -- scan
npm run trade -- buy DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 --sol 0.05
npm run trade -- positions
npm run trade -- sell 1
```

`--sol` is refused if it exceeds `config/policy.json` `maxSolPerTrade` (also enforced inside `executeBuy`). `--strict` also applies `config/rules.yaml`. `--force` skips scoring (**paper only**).

Starter watchlist (BONK, WIF, POPCAT, TRUMP) is in [`config/sources.yaml`](config/sources.yaml).

## cryptogrokbot.com

The dashboard canonical URL is **https://cryptogrokbot.com/**.

`www`, `dash`, and `app` redirect there (301). Nameservers are on Cloudflare (`kanye.ns.cloudflare.com` / `stella.ns.cloudflare.com`). A Worker (`workers/cryptogrokbot.js`) fronts the origin; `npm run agent` on port **8787** plus a Cloudflare Tunnel must be running or the site returns 502.

This cloud VM is **not** a 24/7 VPS — run the agent + tunnel on a durable host.

On the durable host:

1. Run `npm run agent` and `cloudflared tunnel run` with the named tunnel `cryptogrokbot-dashboard`.
2. Set `DASHBOARD_SECURE_COOKIE=true` behind HTTPS. Set `DASHBOARD_EMAIL` and `DASHBOARD_PASSWORD` in `.env` on that host only.
3. Login uses email verification. Invite Grok Bot from the Home Access card.

`CLOUDFLARE_API_TOKEN` is used to look up the zone / manage the tunnel and Worker. Never commit it. Placeholders are in `.env.example`.

## Night auto-buys (still paper)

`npm run agent -- --once` paper-enters a **watchlist** mint when DexScreener has a live Solana market and scoring + `config/rules.yaml` pass. Extra rules can skip a name on a quiet 5m (e.g. `min-vol-5m`); the next listed name can still fill. Cooldown is 180s between entries.

```bash
MODE=PAPER MASTER_ENABLED=false npm run agent -- --once
npm run agent              # loop + dashboard http://127.0.0.1:8787/
```

Default policy (`config/policy.json`): **0.05 SOL/day**, 5 trades, **0.05 SOL** live size cap (do not raise), −25% hard stop, return principal at 1x, 15% dip + sentiment ≥ 0.4 holds the runner.

## Paper vs live

| | `MODE=PAPER` (default) | `MODE=LIVE` |
|---|---|---|
| What happens | SQLite ledger only. No transaction is sent. | Jupiter (graduated) or PumpPortal local-sign (curve), then a signed tx |
| Wallet | Not required | `WALLET_SECRET_KEY` **or** a dashboard wallet secret required or the buy **fails closed** |
| Master switch | Ignored for paper fills | Must be `MASTER_ENABLED=true` **or** `/resume CONFIRM` after a `/kill` or the live tx **fails closed** |
| Dashboard buy/sell | Paper unless the process is `MODE=LIVE` | Same fail-closed rules; the client cannot force live. Live sells also need master + wallet |
| Extra daily budget | Ignored (`ALLOW_EXTRA_BUDGET` default false) | Ignored unless `ALLOW_EXTRA_BUDGET=true` (logged; not settable from an unauthenticated path) |

Live is two flags **and** a dedicated hot-wallet secret (`.env` or `data/wallet-secrets.json`):

```
MODE=LIVE
MASTER_ENABLED=true
WALLET_SECRET_KEY=   # JSON byte array or base58. Hot wallet only. Never the main wallet.
HELIUS_RPC_URL=      # recommended over public RPC
```

Telegram `/kill` turns the SQLite `master` flag off (live buys **and** live sells fail closed; paper sells still run). `/resume CONFIRM` turns master back on. That is a **kill/resume switch only**: it cannot change `MODE`. The DB cannot flip paper to live. Live still requires `MODE=LIVE` from env **and** master **and** a hot wallet.

Dashboard bind defaults to `127.0.0.1`. A public bind is optional (`DASHBOARD_BIND=0.0.0.0`); when bind is not loopback, the session cookie is `Secure` unless you set `DASHBOARD_SECURE_COOKIE=false`.

Dashboard wallets: add a **label + public key** and optionally a secret. The secret is written to gitignored `data/wallet-secrets.json` and is **never returned to the browser after save**. The UI shows `connected` (secret present), assigned desk, and a read-only SOL balance via RPC when a public key is set.

## Env vars (`.env.example`)

| Var | Required | Purpose |
|-----|----------|---------|
| `MODE` | no (default PAPER) | `PAPER` or `LIVE` |
| `MASTER_ENABLED` | no (default false) | live entries and live exits (kill/resume via Telegram when MODE=LIVE) |
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
- Hitting `dailyBudgetSol`, `maxTradesPerDay`, or `dailyLossCapSol` **stops buys**, not paper exits. Live exits also stop when master is off. **PAPER and LIVE each have their own daily ledger** — paper fills do not consume the live cap.
- `extra_budget_sol` does **not** raise the daily cap unless `ALLOW_EXTRA_BUDGET=true`.
- Per-trade size is refused inside `executeBuy` if it exceeds `maxSolPerTrade`. High sentiment does **not** auto-raise size: Grok Bot asks first (keep 0.01 or a one-shot increase up to `sizeAskCeilingSol`, currently 0.05).
- Live buy runs a Jupiter sell-sim first. Freeze / guardrails / `/never` rules are hard denies.
- LLM cannot disable a hard stop or sell through a `healthy_dip`.
- Unauthenticated mutating API calls return 401. The old open crew board is behind the same login.
- Dashboard login is email + password + TOTP 2FA. Wallet secrets are never returned after save. Default bind is localhost.
- Auditor (6th crew agent) records scans in SQLite: paper default, secrets not in git, live fail-closed (sell gate, size cap, extra budget off, localhost bind).

## Telegram

| Command | Purpose |
|---|---|
| `/status` `/budget` `/policy` | mode, master, caps |
| `/positions` `/tape <mint\|id>` `/why <mint>` | open bags and tape |
| `/pnl` `/review [today\|7d\|30d\|all]` `/trade <id>` | journal |
| `/grade <id> win\|meh\|fail [note]` | train the journal |
| `/lesson <text>` `/never <rule>` `/guardrails` `/unguard <id>` | lessons + hard denies |
| `/kill` `/resume CONFIRM` `/sellall CONFIRM` | halt live txs / resume master (MODE unchanged) / flatten |
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
