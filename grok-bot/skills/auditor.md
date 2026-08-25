# Auditor skill

Run a bug scan from the dashboard (Home or Crew → Run auditor scan) or wait for the night agent startup scan.

Checks:

- `.env.example` still defaults `MODE=PAPER` and `MASTER_ENABLED=false`
- `data/` and `.env` are gitignored (password file, wallet secrets, sqlite)
- tracked files do not contain API tokens or wallet secrets
- live buys still fail closed without MASTER + wallet

Do not paste secrets into chat, PRs, or `lessons.md`.
