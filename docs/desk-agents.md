# Solana desk agents and the Risk → Execution path

This desk is **Solana-only**. Paper is the default (`MODE` is not `LIVE` unless you set it). `MASTER_ENABLED` stays off unless you opt in. Those defaults are fail-closed and this work does not flip them.

Intended fill flow, once a name is on the book:

**Discovery → Validation → Chief → Risk → Execution**

Grok (the existing crew agent) must **not freelance fills** once Execution is live. After Chief APPROVE, Grok Bot Bearer `POST /api/buy` or `POST /api/sell` still exists, but the host now routes those calls through Risk then the single `executeApprovedTrade` entrypoint. Do not call Jupiter or PumpPortal from a Grok prompt, a VPS one-liner, or a second script.

## Existing host crew (do not remove or rename)

These names stay. New packages complement them; they do not replace Sentinel, Ledger, or Exit.

| Agent | Where it lives today | Job |
| --- | --- | --- |
| **Chief** | `packages/crew`, `grok-bot/profiles/chief.md`, Home chances | Budget, handoffs, **APPROVE** on a chance. Does not submit txs. |
| **Grok** | crew + `grok-bot/profiles/grok.md` | Thesis, runner gray-zone, Bearer orders. **Must route fills through Execution.** |
| **Sentinel** | crew + watchman / patterns | Tape, dip-hold, **exit decisions**. Still decides *when* to flatten; Execution only submits. |
| **Ledger** | `packages/storage` SQLite (`night-agent.db`) | Positions, fills, budget, decisions. Portfolio reads this ledger — no second book. |
| **Exit** | `packages/patterns` `decideExit`, Sentinel | Flatten / return-principal / moon-bag. External to Execution. |
| **Scout** | crew + night loop | X / Pump / DexScreener. **Never live-buys.** Queues chances for Chief. |
| **AltScout** | Intel / hunt desks | Alternate discovery venue. Same rule: no freelance fills. |
| **Scholar** | crew + `packages/learning` | Journal, mistakes, extra rules. |
| **Forensics** | Intel scam radar + Risk `forensics` flags | Honeypot / LP / authority / concentration. Risk REJECT on hard flags. |
| **Sentiment** | Intel desk + `packages/tape` | Hype score. Does not size or send. |
| **Swing** | strategy label on a Risk ticket | Multi-day size via `strategyRiskMultipliers.swing`. |
| **Narrative** | Intel narratives + strategy label | Narrative-driven size via `strategyRiskMultipliers.narrative`. |
| **Auditor** | crew + `apps/agent/src/auditor.ts` | Bug scan, fail-closed paper/live checks. |

Host packages that were already here: `@night/risk` (`canEnter`, `scoreCandidate`, guardrails, extra-rules), `@night/execution` (`jupiterSwap`, `pumpLocalTrade`, `executeBuy` / `executeSell`, `refuseOversizeBuy`, `refuseLiveExecution`), `@night/storage`, `@night/signals`, `@night/patterns`, `@night/tape`.

## New Grok Bot agents (packages + HTTP)

Tunable numbers live in [`config/desk-risk.json`](../config/desk-risk.json). Seeded from [`config/policy.json`](../config/policy.json) where a counterpart exists. Do not bury replacements only in code.

| Key | Meaning | Seeded from |
| --- | --- | --- |
| `maxPositionSizeSol` | Per-ticket SOL cap. Oversize is **REJECT**, not a silent clip. | `maxSolPerTrade` |
| `feeReserveSol` | SOL kept for fees / rent. | new (0.02) |
| `maxPortfolioExposureSol` | Open + reserved SOL. | `dailyBudgetSol` |
| `maxExposurePerTokenSol` | Per-mint exposure. | `sizeAskCeilingSol` / `maxSolPerTrade` |
| `maxExposurePerStrategySol` | Per-strategy exposure. | `dailyBudgetSol` |
| `maxOpenPositions` | Concurrent bags. | `maxOpenPositions` |
| `dailyLossLimitSol` | Realised daily loss → **HALT_TRADING**. | `dailyLossCapSol` |
| `maxDrawdownPct` | Marked drawdown → **HALT_TRADING**. | `abs(hardStopPct)` |
| `maxSlippageBps` | Execution slippage ceiling. | `slippagePctCap * 100` |
| `minLiquidityUsd` | Book floor. | `minLiquidityUsd` |
| `minTokenAgeMinutes` | Age floor. `0` keeps the gem-hunt. | new |
| `maxHolderConcentrationPct` | Top-holder ceiling. | `maxTop10HolderPct` |
| `maxVolatilityHint` | Vol penalty / reduce. | new |
| `strategyRiskMultipliers` | Size haircut per strategy. | new object |
| `launchStricterMultiplier` | Extra haircut for launch / curve names. | new |
| `decisionTtlMs` | How long an APPROVE token is valid. | new |
| `maxSubmitRetries` | Controlled live retries. | new |

### Risk (`@night/risk` `decideTrade`)

Input: proposed trade (`mint`, `side` buy/sell/partial, `sizeSol`, `strategy`, `originatingAgent`, optional liquidity snapshot, optional forensics flags).

Output:

```ts
{
  decision: "APPROVE" | "APPROVE_REDUCED_SIZE" | "REJECT" | "HALT_TRADING",
  sizeSol?: number,
  reasons: string[],
  checks: Record<string, boolean | number | string>
}
```

Risk **reuses** `canEnter` (MASTER / RPC / Jupiter / daily budget / open slots / cooldown). It can **reduce** size when book, strategy, or liquidity room is smaller than the ticket. It can **HALT** the desk (daily loss, drawdown, or SQLite `trading_halt=true`). Oversize vs `maxPositionSizeSol` is **REJECT** so Execution's `refuseOversizeBuy` stays honest.

HTTP (dashboard, after login or Bearer):

- `POST /api/risk/decide` — Chief / Grok Bot / owner / invited team
- `GET /api/risk/decision?id=` or `?token=`
- `GET /api/risk/recent`

Persisted on the same SQLite file as positions (`risk_decisions` + `capital_reservations`). The token is what Execution requires.

### Portfolio (`@night/portfolio`)

Reads **only** `night-agent.db`: open qty, avg entry, marks if you pass them, realised / unrealised hooks, exposure by `strategy`, pending reserved capital, fee reserve, available SOL when a wallet balance is supplied.

`GET /api/portfolio`

### Liquidity (`@night/liquidity`)

DexScreener / Jupiter-quote style snapshot in, assessment out: `enterable` / `exitable`, estimated entry/exit slippage bps, `maxSafeSizeSol`, penalties, reject reasons.

`POST /api/liquidity/assess`

### Execution (`@night/execution` `executeApprovedTrade`)

**One** submit path. Requires a prior Risk decision token that is `APPROVE` or `APPROVE_REDUCED_SIZE`, unconsumed, unexpired, matching mint/side, and a size no larger than the approved size.

- Idempotency key: `mint + side + clientOrderId`. A retry with the same key returns the first result (`duplicate: true`) and does not send a second tx.
- `executeBuy` / `executeSell` / Jupiter / PumpPortal remain the inner chain adapters. Do not call them from agents.
- Confirmations and **controlled** retries on retryable RPC errors. Policy refusals (oversize, missing Risk token, MASTER) are not retried.
- Slippage sent to the chain is `min(policy.slippagePctCap, desk-risk maxSlippageBps)`.
- Exit *decisions* stay in Sentinel / Exit. Execution only submits.

Grok Bot APIs kept:

- `POST /api/buy` — still Bearer-only; live still needs `{ "chief": "APPROVE" }`. Now runs Risk then Execution. Optional `clientOrderId` for safe retries.
- `POST /api/sell` — still Bearer-only; Sentinel/Exit decide; submit is Execution.

## How Chief → Risk → Execution uses Portfolio + Liquidity

1. **Discovery** (Scout / AltScout / Sentiment / Narrative) finds a Solana mint. Scout never fills.
2. **Validation** (`scoreCandidate`, extra-rules, Forensics flags, Liquidity assessment).
3. **Chief** APPROVE on the chance (existing Home / `{chief:"APPROVE"}`).
4. **Risk** `decideTrade` loads Portfolio (exposure, reserved SOL, daily loss) + Liquidity. APPROVE, shrink, REJECT, or HALT. Writes a token onto the ledger.
5. **Execution** `executeApprovedTrade` checks that token, idempotency, oversize, MASTER / wallet, then submits. Ledger fill is the same `positions` / `fills` tables Sentinel and Scholar already read.

Paper stays paper. Live stays fail-closed without `MODE=LIVE`, a wallet, and a valid Risk token. Grok Bot explicit orders may still skip the auto-desk MASTER kill — they do **not** skip Risk or Execution.
