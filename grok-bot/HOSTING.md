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

The Worker cannot fetch `*.cfargotunnel.com` (1102). trycloudflare `--url` from this VM 530s. The API token here **cannot write DNS**, so `origin.cryptogrokbot.com` 1016s.

The path that works **while this VM is awake**:

```text
browser → cryptogrokbot.com (Worker)
              → https://*.lhr.life (localhost.run SSH)
              → 127.0.0.1:8787 (npm run agent)
```

localhost.run hostnames rotate and sometimes 503. The watcher must not kill a tunnel that is still serving the public site.

## What you must do for 24/7 (before live trading)

1. **Rent or use an always-on Linux VPS** (Hetzner, DigitalOcean, a Mac mini at home). Not a Cursor Cloud Agent.
2. Copy this repo, `.env`, `data/` (book + password + Grok Bot invites), and the Cloudflare API token onto that disk.
3. In the Cloudflare dashboard, create a **DNS CNAME** (Zone DNS Edit, or click it yourself):

   - Name: `origin`
   - Target: `1a38795c-af25-4f8c-8dd1-7167da5b673c.cfargotunnel.com`
   - Proxied: on

4. On the VPS, install `cloudflared` and run the named tunnel `cryptogrokbot-dashboard` plus `npm run agent`.
5. Set Worker `ORIGIN` **once** to `https://origin.cryptogrokbot.com` (the watcher will do this if that hostname’s `/health` is live).
6. Install the systemd units in `scripts/systemd/` so a reboot brings the desk back.
7. Re-invite Grok Bot from Home if `data/dashboard-access.json` is new.
8. External monitor: alert if `https://cryptogrokbot.com/health` contains `"origin":"down"` for more than two minutes.

Until steps 1–6 are done, treat the public desk as **awake-only**. Paper is fine. Live fills are not.

## Commands on whatever host is currently awake

```bash
bash scripts/desk-status.sh
bash scripts/bring-origin-back.sh
```

`desk-status.sh` must say `public LIVE`. A Worker 200 with `"origin":"down"` is **not** live.

Leave `MASTER_ENABLED=false`. Do not invent `WALLET_SECRET_KEY` or `chief:APPROVE`.
