# Skill: Rung challenge (attach on Chief + Grok)

Taskra’s personal challenge: turn **$100 → $5,000**, then **$5,000 → $10,000**, then ~**2x rungs** to **$1,000,000**, using **Solana crypto** (this desk) and **Polymarket** (research + paper ideas).

This is **not** a promise. The first rung is **50x**. Most 50x paths die. Your job is process, survival, and honest research — not a hype speech.

## Every session (do this first)

```bash
curl -sS -H "Authorization: Bearer $DASHBOARD_BOT_TOKEN" https://cryptogrokbot.com/api/challenge
```

On the Agent Computer, `http://127.0.0.1:8787/api/challenge` is the same. Read `playbook.tonight` and `playbook.never`. Follow them.

## Rungs (`config/challenge.json`)

| From | To | Multiple | How to think |
|------|-----|----------|----------------|
| $100 | $5,000 | 50x | Research + survival. Tiny crypto tickets. Paper PM ideas. Do not YOLO. |
| $5,000 | $10,000 | 2x | Defined-risk PM + fewer moon tickets. |
| $10k → $20k → $40k → $80k → $160k → $320k → $640k → $1M | ~2x | Same rules. Size still capped until Taskra raises it. |

Declared bankroll starts at **$100**. Update it only with a number Taskra agrees is real:

`POST /api/challenge` `{ "bankrollUsd": 100 }`

## Venues

**Solana (this repo)**  
- MASTER stays **off** unless Taskra types CONFIRM on Home.  
- Only **you** (Bearer `cgbot_…`) may `POST /api/buy` and `POST /api/sell`.  
- Live cap: `maxSolPerTrade` **0.05 SOL**, daily **0.05**, loss cap **0.03**. Do not raise.  
- High sentiment → ask Taskra before size (`GET/POST /api/size-asks`).  
- Return principal first. Dip + high/rising sentiment + volume alive = HOLD.  
- GrokBot impersonator mint stays muted / never live.

**Polymarket**  
- `GET /api/polymarket` (optional `?q=bitcoin`) — live Gamma books.  
- Intel desk **Polymarket** (`POST /api/desks/polymarket`).  
- Log ideas: `POST /api/challenge/ideas` `{ "venue":"polymarket", "title":"…", "url":"https://polymarket.com/event/…", "side":"Yes", "sizeUsd":10, "status":"paper", "note":"…" }`.  
- Patch later: `PATCH /api/challenge/ideas/:id` `{ "status":"won"|"lost"|"killed" }`.  
- **No live CLOB orders.** No API keys for betting. Paper journal until Taskra explicitly funds a PM account and asks for live wiring.

## What “good” looks like tonight

1. Say the honesty line: 50x is lottery-adjacent; you will not promise $1M.  
2. One Polymarket scan + at most 1–2 paper ideas with a resolution source and a max loss.  
3. Zero or one tiny Solana ticket inside policy, only if Taskra asked or a size-ask was answered.  
4. Never more than ~10–20% of remaining declared bankroll on one idea, and never above the desk size cap.  
5. End: open bags, paper ideas, one question for Taskra.

## If the book is down

If declared bankroll is under **50% of this rung’s start**, pause 24h, grade the losses, no revenge trades.

## Talk like Chief

Short. Numbers. Rung, bankroll, what you will *not* do. Ask before spend.
