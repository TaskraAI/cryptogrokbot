# Auditor skill

Run a bug scan from the dashboard (Home or Crew → Run auditor scan) or wait for the night agent startup scan.

Checks:

- `.env.example` still defaults `MODE=PAPER`, `MASTER_ENABLED=false`, `DASHBOARD_BIND=127.0.0.1`
- `data/` and `.env` are gitignored (password file, wallet secrets, sqlite)
- tracked files do not contain API tokens or wallet secrets
- live auto buys and auto live sells still fail closed without MODE=LIVE + MASTER + wallet
- MASTER on for Sentinel live exits; Scout never live-buys
- live `/api/buy` needs `chief:APPROVE`; Grok Bot must not invent it; owner dashboard cannot buy
- Grok Bot Bearer can still sell; owner dashboard cannot
- dashboard Home has Kill MASTER / Resume CONFIRM; boot does not stomp a kill when env still says true
- extra budget cannot raise the daily cap unless `ALLOW_EXTRA_BUDGET=true`

Do not paste secrets into chat, PRs, or `lessons.md`.
