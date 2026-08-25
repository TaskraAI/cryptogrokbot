import type { Policy, RuntimeFlags, SourceHit, TokenMetrics } from "@night/shared";

/** Trusted hit so a user-chosen mint can pass the multi-source scorer. */
export function manualSource(mint: string, ticker?: string): SourceHit {
  return {
    platform: "dexscreener",
    key: "manual",
    weight: "trusted",
    snippet: "user-selected mint",
    at: Date.now(),
    mint,
    ticker,
  };
}
import { applyEntryToBudget, canEnter, evaluateExtraRules, scoreCandidate, type ExtraRule, type Guardrail } from "@night/risk";
import { executeBuy } from "@night/execution";
import { simulateSell } from "@night/signals";
import {
  getBudget,
  insertDecision,
  insertFill,
  insertPosition,
  insertSourceHit,
  listOpenPositions,
  upsertBudget,
  type Store,
} from "@night/storage";
import type { Connection, Keypair } from "@solana/web3.js";
import type { BudgetState } from "@night/shared";

export async function tryEnter(opts: {
  store: Store;
  policy: Policy;
  flags: RuntimeFlags;
  token: TokenMetrics;
  sources: SourceHit[];
  guardrails: Guardrail[];
  extraRules?: ExtraRule[];
  copyWallets?: string[];
  fadeWallets?: string[];
  consecutiveLosses?: number;
  buySellRatio?: number;
  dayKey: string;
  connection?: Connection;
  keypair?: Keypair;
  pumpApiKey?: string;
  now?: number;
  /** Override size; still capped at policy.maxSolPerTrade. */
  sol?: number;
  /** Skip scoring (PAPER only). LIVE always scores. */
  skipScore?: boolean;
}): Promise<string> {
  const now = opts.now ?? Date.now();
  const open = listOpenPositions(opts.store);
  if (open.some((p) => p.mint === opts.token.mint)) {
    return `already in ${opts.token.ticker}`;
  }
  const b = getBudget(opts.store, opts.dayKey);
  const budget: BudgetState = {
    dayKey: b.day_key,
    spentSol: b.spent_sol,
    trades: b.trades,
    realizedLossSol: b.realized_loss_sol,
    lastEntryAt: b.last_entry_at,
    extraBudgetSol: b.extra_budget_sol,
  };
  const gate = canEnter({
    policy: opts.policy,
    budget,
    openPositions: open.length,
    flags: opts.flags,
    now,
  });
  if (!gate.ok) {
    insertDecision(opts.store, {
      at: now,
      kind: "block",
      mint: opts.token.mint,
      allowed: false,
      reason: gate.reason,
    });
    return `blocked ${opts.token.ticker}: ${gate.reason}`;
  }

  if (opts.skipScore && opts.flags.mode === "LIVE") {
    return `blocked ${opts.token.ticker}: --force is paper-only`;
  }

  const scored = opts.skipScore
    ? { passed: true as const, score: 0, blockedReason: undefined as string | undefined, checks: { forced: true } }
    : scoreCandidate({
        token: opts.token,
        sources: opts.sources,
        guardrails: opts.guardrails,
        policy: opts.policy,
        now,
      });
  if (!scored.passed) {
    insertDecision(opts.store, {
      at: now,
      kind: "block",
      mint: opts.token.mint,
      allowed: false,
      reason: scored.blockedReason ?? "score failed",
      score: scored.score,
      payload: scored.checks,
    });
    return `blocked ${opts.token.ticker}: ${scored.blockedReason}`;
  }

  if (opts.extraRules?.length) {
    const extra = evaluateExtraRules(opts.extraRules, {
      token: opts.token,
      sources: opts.sources,
      now,
      consecutiveLosses: opts.consecutiveLosses,
      copyWallets: opts.copyWallets,
      fadeWallets: opts.fadeWallets,
      buySellRatio: opts.buySellRatio,
    });
    if (!extra.ok) {
      insertDecision(opts.store, {
        at: now,
        kind: "block",
        mint: opts.token.mint,
        allowed: false,
        reason: extra.reason,
        score: scored.score,
      });
      return `blocked ${opts.token.ticker}: ${extra.reason}`;
    }
  }

  if (opts.flags.mode === "LIVE") {
    const ok = await simulateSell(opts.token.mint, 1_000_000, Math.floor(opts.policy.slippagePctCap * 100));
    if (!ok) {
      insertDecision(opts.store, {
        at: now,
        kind: "block",
        mint: opts.token.mint,
        allowed: false,
        reason: "pre-buy sell simulation failed",
        score: scored.score,
      });
      return `blocked ${opts.token.ticker}: honeypot sim`;
    }
  }

  const sol = Math.min(opts.sol ?? opts.policy.maxSolPerTrade, opts.policy.maxSolPerTrade);
  const result = await executeBuy({
    mode: opts.flags.mode,
    graduated: opts.token.graduated,
    mint: opts.token.mint,
    sol,
    slippagePct: opts.policy.slippagePctCap,
    connection: opts.connection,
    keypair: opts.keypair,
    pumpApiKey: opts.pumpApiKey,
  });
  if (result.error) {
    insertDecision(opts.store, {
      at: now,
      kind: "block",
      mint: opts.token.mint,
      allowed: false,
      reason: `buy failed: ${result.error}`,
      score: scored.score,
    });
    return `buy failed ${opts.token.ticker}: ${result.error}`;
  }

  const id = insertPosition(opts.store, {
    mint: opts.token.mint,
    ticker: opts.token.ticker,
    mode: opts.flags.mode,
    openedAt: now,
    entryPriceUsd: opts.token.priceUsd || 1,
    principalSol: result.sol,
    tokensHeld: result.tokens,
    solSpent: result.sol,
    sourcesJson: JSON.stringify(opts.sources),
    entryMetricsJson: JSON.stringify(opts.token),
    thesis: String(scored.checks.score ?? scored.score),
    score: scored.score,
    entryTx: result.signature,
  });
  insertFill(opts.store, {
    positionId: id,
    at: now,
    side: "buy",
    sol: result.sol,
    tokens: result.tokens,
    priceUsd: opts.token.priceUsd || 1,
    reason: "entry",
    tx: result.signature,
    paper: result.paper,
  });
  for (const hit of opts.sources) {
    insertSourceHit(opts.store, {
      at: hit.at,
      platform: hit.platform,
      key: hit.key,
      weight: hit.weight,
      mint: hit.mint ?? opts.token.mint,
      ticker: hit.ticker ?? opts.token.ticker,
      permalink: hit.permalink,
      snippet: hit.snippet,
    });
  }
  const next = applyEntryToBudget(budget, result.sol, now);
  upsertBudget(opts.store, {
    day_key: next.dayKey,
    spent_sol: next.spentSol,
    trades: next.trades,
    realized_loss_sol: next.realizedLossSol,
    last_entry_at: next.lastEntryAt,
    extra_budget_sol: next.extraBudgetSol,
  });
  insertDecision(opts.store, {
    at: now,
    kind: "entry",
    mint: opts.token.mint,
    allowed: true,
    reason: `bought ${result.paper ? "paper" : "live"} ${result.sol} SOL`,
    score: scored.score,
  });
  return `bought #${id} ${opts.token.ticker} ${result.sol} SOL ${result.paper ? "PAPER" : result.signature}`;
}
