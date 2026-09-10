# Restore cryptogrokbot.com after a fresh disk

The public site is only a Cloudflare Worker. It can show a login page while the **origin** (this Linux box on port 8787) is missing. Signing and fills need that origin.

A Cloud Agent disk is not 24/7. Restore secrets here to get login working **now**; for overnight trading follow [`HOSTING.md`](HOSTING.md) on a VPS.

Git never stores `.env`, `/tmp/cf-api.token`, or `data/`. A new Cloud Agent disk does not inherit the last one. Chief must not invent `WALLET_SECRET_KEY`, a Cloudflare token, or `chief:APPROVE`.

```text
Taskra backup or dashboards
        |                      |
        v                      v
   /workspace/.env      /tmp/cf-api.token
        |                      |
        v                      v
  npm run agent :8787    keep-cf-origin.py
        |                      |
        +---- localhost.run ---+
                    |
                    v
            Worker ORIGIN
                    |
                    v
         cryptogrokbot.com
```

## What to put back

### 1. Gitignored `.env` at `/workspace/.env`

Same file as the last Agent Computer when you still have it. Minimum for the public desk + signing:

- `MODE=LIVE` only if you want live fills (paper does not need a wallet)
- `MASTER_ENABLED=false` (keep this off)
- `WALLET_SECRET_KEY=` export of the **dedicated hot wallet** only (public address is already in `config/lessons.md` — never paste the secret in chat)
- `DASHBOARD_BIND=0.0.0.0` and `DASHBOARD_HOST=cryptogrokbot.com`
- `DASHBOARD_EMAIL=hello@taskra.ai` and `DASHBOARD_PASSWORD=` (known password, or leave empty so the agent writes `data/.dashboard-password`)
- Optional: `HELIUS_RPC_URL`, `XAI_API_KEY`, `CLOUDFLARE_API_TOKEN` (the token may live only in `/tmp/cf-api.token` instead)

`bash scripts/prepare-restore.sh` copies `.env.example` and sets the non-secret bind/host/email/MASTER lines. It never writes a wallet key.

### 2. Cloudflare API token at `/tmp/cf-api.token` (mode 0600)

`scripts/keep-cf-origin.py` reads this file and PUTs Worker `ORIGIN` to a new `https://*.lhr.life` URL. Without it the Worker serves `"origin":"down"` and `/api/*` is `502 Desk is reconnecting`.

The token needs **Workers Scripts: Edit** on this account (script name `cryptogrokbot`). Zone DNS write is not required.

If `CLOUDFLARE_API_TOKEN` is set in `.env`, `bring-origin-back.sh` copies it to `/tmp/cf-api.token` and `data/.cf-api.token` (never prints it). The durable copy survives a `/tmp` wipe on the same disk. The named-tunnel sidecar token is re-downloaded from the API; you do not need to find `/tmp/cf-tunnel.token`.

### 3. Optional old `data/`

Copy `data/night-agent.db` and `data/dashboard-access.json` from the last box if you have them. That restores open bags, the password file, and Grok Bot invite hashes. Otherwise the book starts empty — **re-invite Grok Bot** from Home after login. Old `cgbot_…` tokens will not work.

## How to get each secret (never paste them in chat)

**Path A — last Agent Computer or a backup**

Copy `.env` as-is. Copy `/tmp/cf-api.token` if you still have it; otherwise recreate the token (Path B).

On **this** Agent Computer only, write the files with a local editor or Grok Bot’s **secure secret card** (`WALKTHROUGH.md`). Tell Chief only “secrets are on the card / on disk.”

```bash
nano /workspace/.env
# then, if the token is not already in .env:
# write the token file yourself, chmod 0600
```

**Path B — rebuild from dashboards**

| Need | Where you create or copy it | What to write |
| --- | --- | --- |
| Hot wallet secret | Phantom / Solflare → export **that** hot wallet only | `WALLET_SECRET_KEY=` JSON byte array or base58 |
| Cloudflare token | Cloudflare → My Profile → API Tokens → Create Token (Workers Edit). Or reuse a password-manager copy | `/tmp/cf-api.token` one line, `chmod 0600`, or `CLOUDFLARE_API_TOKEN=` in `.env` |
| Dashboard password | The login you already use, or a new `DASHBOARD_PASSWORD=` | `.env` |
| Helius / xAI | helius.dev and console.x.ai | `.env` |

```bash
bash scripts/prepare-restore.sh
# then fill WALLET_SECRET_KEY and the Cloudflare token
```

Leave `MASTER_ENABLED=false`. Do not commit `.env`, `/tmp/cf-api.token`, or `data/`.

## After the two files exist on this disk

```bash
cd /workspace
bash scripts/desk-status.sh
bash scripts/bring-origin-back.sh
bash scripts/desk-status.sh
```

You can sign only when `https://cryptogrokbot.com/health` is `{"ok":true,"service":"cryptogrokbot-dashboard"}` **without** `"origin":"down"`. Then Grok Bot Bearer can `POST /api/buy`. MASTER stays off; the night loop does not auto-trade.

If `desk-status` still says env/token **MISSING** or wallet **empty**, the restore has not landed on **this** disk. A different Cloud Agent or your Mac does not count.
