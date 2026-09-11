# Get the host working (clone from GitHub — no `.env` backup)

Git **never** stores `.env`, `data/`, wallet keys, or API tokens. You do not need a copy from this Cloud Agent. Clone the repo, build a new `.env` on the VPS, start `:8787`.

**Checkout this branch** (not `main` — `main` is the old initial commit):

```text
https://github.com/TaskraAI/CryptoTrading
branch: cursor/vps-host-check-1f38
PR:     https://github.com/TaskraAI/CryptoTrading/pull/5
```

Right now `https://origin.cryptogrokbot.com` is **HTTP 502**. That means Cloudflare Tunnel + DNS are already up. The only missing piece is `npm run agent` on the VPS at `127.0.0.1:8787`.

## What you must get yourself (never put these in GitHub or chat)

| Item | Required to stop the 502? | Where you get it |
| --- | --- | --- |
| This repo on the VPS (Node 22+) | **Yes** | `git clone` the branch above |
| New `.env` from `.env.example` | **Yes** | `bash scripts/prepare-restore.sh` on the VPS |
| `DASHBOARD_EMAIL` | **Yes** | Use `hello@taskra.ai` |
| `DASHBOARD_PASSWORD` | **Yes** if you want the login you already know | Type the password you use today. If you leave it empty, the agent writes a new one in `data/.dashboard-password` |
| `CLOUDFLARE_API_TOKEN` | **After** origin `/health` is JSON — to point the public site at the VPS | Cloudflare → My Profile → API Tokens → Create Token with **Workers Scripts: Edit** on script `cryptogrokbot`. One line in `.env` or `data/.cf-api.token` mode `0600` |
| `RESEND_API_KEY` | Only for Forgot password email | resend.com (from `hello@taskra.ai`) |
| `XAI_API_KEY` | No — Intel still works without it | console.x.ai |
| `HELIUS_RPC_URL` | No — public Solana RPC is enough for paper | helius.dev |
| `WALLET_SECRET_KEY` | **No. Leave empty.** | Dedicated hot wallet only if you later go LIVE. Never a main wallet. Never invent one. |
| Old `data/` book | No | Fresh book. After login, Home → **Invite Grok Bot** again. Old `cgbot_…` tokens die. |

Leave `MODE=PAPER` and `MASTER_ENABLED=false`. Do not invent `chief:APPROVE`.

Already done on Cloudflare (do not redo unless origin is 1033/1016):

- DNS CNAME `origin` → `1a38795c-af25-4f8c-8dd1-7167da5b673c.cfargotunnel.com` (proxied)
- Tunnel `cryptogrokbot-dashboard` public hostname `origin.cryptogrokbot.com` → `http://127.0.0.1:8787`
- `cloudflared` connector on the VPS (502 proves this)

## On the VPS terminal

```bash
# Node 22+  https://github.com/nodesource/distributions
sudo mkdir -p /opt/cryptogrokbot
sudo chown "$USER:$USER" /opt/cryptogrokbot
git clone https://github.com/TaskraAI/CryptoTrading.git /opt/cryptogrokbot
cd /opt/cryptogrokbot
git checkout cursor/vps-host-check-1f38

bash scripts/prepare-restore.sh
# created .env from .env.example (paper, MASTER off)
nano .env
# set DASHBOARD_PASSWORD= to the login you already use
# optional now: RESEND_API_KEY=  XAI_API_KEY=  CLOUDFLARE_API_TOKEN=
# leave WALLET_SECRET_KEY= empty
chmod 600 .env

bash scripts/install-vps.sh
```

`install-vps.sh` binds `127.0.0.1:8787` and starts systemd `cryptogrokbot-agent`. It will not run on a Cursor Cloud Agent.

Check:

```bash
curl -sS http://127.0.0.1:8787/health
# want: {"ok":true,"service":"cryptogrokbot-dashboard"}

curl -sS https://origin.cryptogrokbot.com/health
# want the same JSON — not "error code: 502"
```

When the named host is JSON, point the public Worker at it (needs the Cloudflare token on that disk):

```bash
python3 scripts/keep-cf-origin.py --publish-named
curl -sS https://cryptogrokbot.com/health
# want dashboard JSON with no "origin":"down"
bash scripts/desk-status.sh
```

`--publish-named` **refuses** if origin is still 502. That protects the public site.

Then log in at https://cryptogrokbot.com (email + password). Invite Grok Bot from Home. Paper only until you choose LIVE later.
