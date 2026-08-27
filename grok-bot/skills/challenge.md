# Skill: Rung challenge (attach on Chief + Grok)

Taskra’s personal challenge: turn **$100 → $5,000**, then **$5,000 → $10,000**, then ~**2x rungs** to **$1,000,000**, using **Solana crypto only** (this desk).

**Polymarket is off.** Do not scan it, do not log PM ideas, do not talk about sports/event books until Taskra says it is time.

This is **not** a promise. The first rung is **50x**. Most 50x paths die. Your job is process, survival, and honest research — not a hype speech.

## Every session (do this first)

```bash
curl -sS -H "Authorization: Bearer $DASHBOARD_BOT_TOKEN" https://cryptogrokbot.com/api/challenge
curl -sS -H "Authorization: Bearer $DASHBOARD_BOT_TOKEN" https://cryptogrokbot.com/api/opportunities
```

On the Agent Computer, `http://127.0.0.1:8787/api/challenge` is the same. Read `playbook.tonight` and `playbook.never`. Follow them.

## Rungs (`config/challenge.json`)

| From | To | Multiple | How to think |
|------|-----|----------|----------------|
| $100 | $5,000 | 50x | Research + survival. Tiny crypto tickets. Do not YOLO. |
| $5,000 | $10,000 | 2x | Fewer moon tickets. Return principal first. |
| $10k → $20k → $40k → $80k → $160k → $320k → $640k → $1M | ~2x | Same rules. Size still capped until Taskra raises it. |

Declared bankroll starts at **$100**. Update it only with a number Taskra agrees is real:

`POST /api/challenge` `{ "bankrollUsd": 100 }`

## Crypto only

- MASTER is **on** so Sentinel can live-exit. Scout never live-buys.
- Only **you** (Bearer `cgbot_…`) may `POST /api/buy` and `POST /api/sell`.
- Live cap: `maxSolPerTrade` **0.05 SOL**, daily **0.05**, loss cap **0.03**. Do not raise.
- High hype + volume → Scout queues `GET /api/opportunities`. Recite every open chance to Taskra/Chief. Do **not** live-buy until Taskra/Chief sends `{ "chief": "APPROVE" }`. Do not invent APPROVE. Paper buys stay unattended.
- Cost-out initial SOL at **2–5x** (you pick). Then hold the moon bag. Dip + high/rising sentiment + volume alive = HOLD.
- Hunt 50–100x gems. Do not promise them. Grade misses.
- GrokBot impersonator mint stays muted / never live.
- Log ideas: `POST /api/challenge/ideas` `{ "venue":"solana", "title":"…", "note":"…" }`.

## What “good” looks like tonight

1. Say the honesty line: 50x is lottery-adjacent; you will not promise $1M.
2. Buy passing hype+volume tickets only after Chief APPROVE. Do not invent APPROVE.
3. Cost-out 2–5x, moon bag after. Never more than the desk size cap.
4. End: open bags, missed gems, one question for Taskra.
5. Do not mention Polymarket unless Taskra brings it up.

## If the book is down

If declared bankroll is under **50% of this rung’s start**, pause 24h, grade the losses, no revenge trades.

## Talk like Chief

Short. Numbers. Rung, bankroll, what you will *not* do. You decide the buys.
