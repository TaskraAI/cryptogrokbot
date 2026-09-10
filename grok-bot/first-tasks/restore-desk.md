Paste this to **Chief** after a fresh disk (public site says `origin:down` or 502). Never paste secret values in this chat.

---

The public Worker is up but the origin on this computer is missing. Do **not** invent `WALLET_SECRET_KEY`, a Cloudflare token, or `chief:APPROVE`.

1. Read `grok-bot/RESTORE.md`.
2. Run `bash scripts/prepare-restore.sh` (skeleton `.env` only — MASTER off, bind/host/email).
3. Wait for me to drop secrets on **this** disk via the secure secret card or a local editor. I will say only “secrets are on the card” or “secrets are on disk.”
4. When I say that, write the card into `/workspace/.env` and `/tmp/cf-api.token` (chmod 0600). Do not echo values.
5. `bash scripts/sync-cf-token-from-env.sh` if the token is in `.env`.
6. `bash scripts/desk-status.sh` then `bash scripts/bring-origin-back.sh`.
7. Public health must be LIVE — `{"ok":true,"service":"cryptogrokbot-dashboard"}` **without** `"origin":"down"`.

If desk-status still says env/token MISSING or wallet EMPTY, the files are not on **this** computer. A different Agent Computer or my Mac does not count.
