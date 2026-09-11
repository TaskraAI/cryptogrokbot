# Hosting: why login dies, and what actually stays up

The dashboard at https://cryptogrokbot.com is a **Cloudflare Worker**. It only proxies to whatever Linux box is running `npm run agent` on port 8787.

**This Cloud Agent VM is not 24/7.** When it sleeps or is replaced:

- `:8787` dies
- the localhost.run SSH tunnel dies
- Worker `ORIGIN` points at a dead `*.lhr.life` URL
- `/health` returns `"origin":"down"`
- `/api/login`, `/api/buy`, `/api/sell` return **502**
- Grok Bot **cannot trade** until a live host publishes a new origin

No amount of retry UI fixes that. Agents will miss fills whenever this box is gone.

Do **not** turn `MASTER` on or go LIVE until the desk runs on a machine that stays up.

## What is working (product / safety)

- Login is email + password. Forgot password emails a code from `hello@taskra.ai`.
- Owner cookie cannot place buy/sell. Only Grok Bot Bearer can.
- LIVE buy still needs `chief:APPROVE` (or Home Approve). Scout never live-buys.
- Night loop does not auto-sell or auto-approve. MASTER stays off unless you resume it.
- PAPER scout may paper-enter the watchlist (SQLite only, no chain tx).

## What is fragile (hosting)

The Worker cannot fetch `*.cfargotunnel.com` (1102). trycloudflare `--url` from this VM 530s.

Read `https://origin.cryptogrokbot.com/health` (not the Worker fallback) to see how far the VPS path has gotten:

| What you see | Meaning |
| --- | --- |
| Dashboard JSON, no `"origin":"down"` | **LIVE.** Safe to point Worker `ORIGIN` at `https://origin.cryptogrokbot.com`. |
| HTTP **502** / `error code: 502` | DNS + **cloudflared are up**. Nothing is listening on the VPS at `127.0.0.1:8787`. Copy the app there next. |
| Error **1033** / **530** | DNS CNAME exists, but **no connector** is online (or the public hostname is missing). |
| Error **1016** | The `origin` CNAME is still missing. |

Do **not** point Worker `ORIGIN` at `https://origin.cryptogrokbot.com` until that hostname’s `/health` returns dashboard JSON. A 502/1033 named origin would take the public site down.

The path that works **while this VM is awake**:

```text
browser → cryptogrokbot.com (Worker)
              → https://*.lhr.life (localhost.run SSH)
              → 127.0.0.1:8787 (npm run agent)
```

localhost.run hostnames rotate and sometimes 503. The watcher must not kill a tunnel that is still serving the public site.

## Move the app to the VPS (the remaining 502)

You do **not** need a backup `.env`. Clone GitHub and follow **[`VPS.md`](VPS.md)** (checklist + exact commands).

Tunnel and DNS are already done when `origin.cryptogrokbot.com` returns **502**. The VPS still needs Grok Bot itself.

```bash
git clone https://github.com/TaskraAI/CryptoTrading.git /opt/cryptogrokbot
cd /opt/cryptogrokbot
git checkout cursor/vps-host-check-1f38
bash scripts/prepare-restore.sh
# edit .env — set DASHBOARD_PASSWORD= to the login you already use
bash scripts/install-vps.sh
```

Optional if you already have a secret `.env` on another disk (never commit it):

```bash
bash scripts/pack-vps.sh
# scp the tarball, .env, and data/ — never paste secrets in chat
```

`install-vps.sh` starts `npm run agent` on `127.0.0.1:8787` (systemd when possible). It does **not** start localhost.run. It refuses to run on a Cursor Cloud Agent unless `FORCE_VPS_INSTALL=1`.

When `https://origin.cryptogrokbot.com/health` returns `{"ok":true,"service":"cryptogrokbot-dashboard"}` with **no** `"origin":"down"`:

```bash
# from a disk that has the Cloudflare Workers Edit token
python3 scripts/keep-cf-origin.py --publish-named
bash scripts/desk-status.sh
```

`--publish-named` refuses if the named host is still 502.

Zero Trust public hostname (already implied by a 502):

- Hostname: `origin.cryptogrokbot.com`
- Service: `http://127.0.0.1:8787`

DNS CNAME (already implied by a 502):

- Name: `origin`
- Target: `1a38795c-af25-4f8c-8dd1-7167da5b673c.cfargotunnel.com`
- Proxied: on

Then:

1. Re-invite Grok Bot from Home if `data/dashboard-access.json` is new on the VPS.
2. External monitor: alert if `https://cryptogrokbot.com/health` contains `"origin":"down"` for more than two minutes.
3. Leave `MASTER_ENABLED=false`. Do not invent `WALLET_SECRET_KEY` or `chief:APPROVE`.

Until the named origin `/health` is LIVE and Worker ORIGIN points at it, treat the public desk as **awake-only** (localhost.run on this Cloud Agent). Paper is fine. Live fills are not.

## Commands on whatever host is currently awake

```bash
bash scripts/desk-status.sh
bash scripts/bring-origin-back.sh
```

`desk-status.sh` must say `public LIVE`. A Worker 200 with `"origin":"down"` is **not** live. `named origin TUNNEL UP, APP DOWN` means copy the app to the VPS next.
