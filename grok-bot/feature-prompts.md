# Copy-paste prompts for Grok Bot

Use these in a **one-to-one** Bot chat or the **Night desk** group. Stay in **PAPER**.

## Connect / bring-up

**Chief — first run** (or paste `first-tasks/bring-up-paper.md` in full):

```
Clone https://github.com/TaskraAI/CryptoTrading.git on this Agent Computer.
Checkout cursor/solana-meme-night-agent-1f38. npm install. Keep MODE=PAPER.
Start npm run agent. Open http://127.0.0.1:8787/ here and screenshot the crew board.
Do not set LIVE or MASTER. Do not create a wallet. If clone fails, paste the exact error.
```

**Group kickoff** (or paste `first-tasks/group-desk.md`):

```
@Chief status of the paper agent and crew board.
@Scout is sources.yaml empty?
@Sentinel one-line HOLD rule.
@Grok do we have XAI_API_KEY?
@Scholar how I will grade a paper fill.
Stay PAPER. One npm run agent only.
```

## Features

**Crew board**

```
@Chief screenshot http://127.0.0.1:8787/ and paste curl -s http://127.0.0.1:8787/crew.json
```

**One paper tick**

```
@Chief run MODE=PAPER npm run agent -- --once and paste the last log decisions. No LIVE.
```

**Add sources** (edit handles first)

```
@Scout add this trusted X account to config/sources.yaml and show the diff: @HANDLE
Do not buy.
```

**Tape**

```
@Sentinel if there is a paper position, describe MC, volume, sentiment, pattern.
If none, say none. Restate when we HOLD a dip.
```

**Research** (replace mint; needs XAI_API_KEY)

```
@Grok research mint MINT_HERE. Short thesis. Do not sell through healthy_dip. If no API key, say so.
```

**Rules**

```
@Scholar list rules.yaml on/off. Do not disable freeze-revoked. Propose one tighter rule from empty volume if we have a fail grade.
```

**Grade a fill**

```
@Scholar I grade paper trade ID as meh because NOTE. Save a lesson and suggest a rules.yaml change. Do not loosen loss caps.
```

**Budget**

```
@Chief print MODE, MASTER, and policy caps (daily SOL, max trades, hard stop). Confirm paper.
```

**Stop the loop**

```
@Chief stop npm run agent. Confirm port 8787 is free. Do not delete the repo.
```

**Rung challenge (crypto only)**

```
@Chief GET /api/challenge and follow playbook.tonight.
Crypto only. Do not scan Polymarket. Do not promise $1M. Do not raise size.
Buy hype+volume yourself. Cost-out 2.5–5x then moon bag.
```

**Secrets** (you fill the secret card, not chat)

```
@Chief I will add XAI_API_KEY via the secure secret card. Write it only into /workspace/CryptoTrading/.env.
Do not echo the value. Restart the paper agent after.
```

**Fresh disk / origin:down** (never paste secret values)

```
@Chief secrets are on the card. Write WALLET_SECRET_KEY and the other .env lines into /workspace/.env
(MASTER_ENABLED=false). Write the Cloudflare token into /tmp/cf-api.token (chmod 0600).
Do not echo values. Follow grok-bot/RESTORE.md then bash scripts/bring-origin-back.sh.
```
