import type { Policy, RuntimeFlags, SourceHit, TokenMetrics } from "@night/shared";
import { applyEntryToBudget, canEnter, effectiveDailyBudgetSol, evaluateExtraRules, scoreCandidate, type ExtraRule, type Guardrail } from "@night/risk";
import { executeBuy } from "@night/execution";
import { simulateSell } from "@night/signals";
import { scoreSentiment } from "@night/tape";
import {
  closeSizeAsksForMint,
  getBudget,
  getSizeAsk,
  insertDecision,
  insertFill,
  insertPosition,
  insertSizeAsk,
  insertSourceHit,
  latestOpenSizeAsk,
  listOpenPositions,
  markSizeAskFilled,
  upsertBudget,
  type SizeAskRow,
  type Store,
} from "@night/storage";
import type { Connection, Keypair } from "@solana/web3.js";
import type { BudgetState } from "@night/shared";

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

export function sizeAskWaitMessage(opts: {
  id: number;
  ticker: string;
  sentiment: number;
  testSol: number;
  ceilingSol: number;
}): string {
  return (
    `ask #${opts.id} ${opts.ticker}: Grok is waiting — sentiment ${opts.sentiment.toFixed(2)} is high. ` +
    `Keep ${opts.testSol} SOL or increase up to ${opts.ceilingSol} before investing.`
  );
}

function clampIncreaseSol(chosen: number, testSol: number, ceilingSol: number): number {
  if (!Number.isFinite(chosen) || chosen <= 0) return ceilingSol;
  return Math.min(ceilingSol, Math.max(testSol, chosen));
}

function ticketFromAsk(ask: SizeAskRow, testSol: number, ceilingSol: number): { sol: number; cap: number } {
  if (ask.status === "increase") {
    const sol = clampIncreaseSol(ask.chosen_sol ?? ceilingSol, testSol, ceilingSol);
    return { sol, cap: Math.max(testSol, sol) };
  }
  const sol = Number.isFinite(ask.chosen_sol) && (ask.chosen_sol ?? 0) > 0 ? Number(ask.chosen_sol) : testSol;
  return { sol: Math.min(sol, testSol), cap: testSol };
}

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
  /** Override size; refused if above policy.maxSolPerTrade (not clipped), unless filling a confirmed size ask. */
  sol?: number;
  /** Skip scoring (PAPER only). LIVE always scores. */
  skipScore?: boolean;
  /** Confirmed keep/increase row; allows one-shot size up to sizeAskCeilingSol. */
  sizeAskId?: number;
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

  const testSol = opts.policy.maxSolPerTrade;
  const ceilingSol = opts.policy.sizeAskCeilingSol;
  const sentiment = scoreSentiment(opts.sources);
  const userPickedSize = opts.sol != null && opts.sizeAskId == null;
  let ask = opts.sizeAskId != null ? getSizeAsk(opts.store, opts.sizeAskId) : latestOpenSizeAsk(opts.store, opts.token.mint);

  if (opts.sizeAskId != null) {
    if (!ask || ask.mint !== opts.token.mint) {
      return `blocked ${opts.token.ticker}: size ask not found`;
    }
    if (ask.status === "pending") {
      return sizeAskWaitMessage({
        id: ask.id,
        ticker: opts.token.ticker,
        sentiment: ask.sentiment,
        testSol,
        ceilingSol,
      });
    }
    if (ask.status !== "keep" && ask.status !== "increase") {
      return `blocked ${opts.token.ticker}: size ask ${ask.status}`;
    }
  }

  if (ask?.status === "pending" && !userPickedSize) {
    insertDecision(opts.store, {
      at: now,
      kind: "ask",
      mint: opts.token.mint,
      allowed: false,
      reason: `waiting on size ask #${ask.id}`,
      score: scored.score,
      payload: { sentiment, askId: ask.id },
    });
    return sizeAskWaitMessage({
      id: ask.id,
      ticker: opts.token.ticker,
      sentiment: ask.sentiment,
      testSol,
      ceilingSol,
    });
  }

  const highSentiment = sentiment >= opts.policy.highSentiment;
  const shouldAsk = !userPickedSize && !opts.skipScore && highSentiment;

  if (shouldAsk && (!ask || ask.status === "pending")) {
    if (!ask) {
      ask = insertSizeAsk(opts.store, {
        mint: opts.token.mint,
        ticker: opts.token.ticker,
        sentiment,
        testSol,
        note: `High sentiment ${sentiment.toFixed(2)}. Ask Taskra in the Grok Bot app before investing: keep ${testSol} SOL or increase up to ${ceilingSol}.`,
      });
    }
    insertDecision(opts.store, {
      at: now,
      kind: "ask",
      mint: opts.token.mint,
      allowed: false,
      reason: `high sentiment ${sentiment.toFixed(2)}; waiting on size ask #${ask.id}`,
      score: scored.score,
      payload: { sentiment, askId: ask.id },
    });
    return sizeAskWaitMessage({
      id: ask.id,
      ticker: opts.token.ticker,
      sentiment,
      testSol,
      ceilingSol,
    });
  }

  let requested: number;
  let cap = testSol;
  let fillAskId: number | undefined;

  if (ask && (ask.status === "keep" || ask.status === "increase") && (shouldAsk || opts.sizeAskId != null)) {
    const ticket = ticketFromAsk(ask, testSol, ceilingSol);
    requested = ticket.sol;
    cap = ticket.cap;
    fillAskId = ask.id;
  } else {
    requested = opts.sol ?? testSol;
    cap = testSol;
  }

  if (!Number.isFinite(requested) || requested <= 0) {
    return `blocked ${opts.token.ticker}: invalid SOL size`;
  }
  if (requested > cap + 1e-12) {
    return `blocked ${opts.token.ticker}: size ${requested} exceeds maxSolPerTrade ${cap}`;
  }

  const daily = effectiveDailyBudgetSol(opts.policy, budget.extraBudgetSol, Boolean(opts.flags.allowExtraBudget));
  if (budget.spentSol + requested > daily.cap + 1e-9) {
    insertDecision(opts.store, {
      at: now,
      kind: "block",
      mint: opts.token.mint,
      allowed: false,
      reason: `daily budget exhausted (${budget.spentSol.toFixed(3)}/${daily.cap} SOL)`,
      score: scored.score,
    });
    return `blocked ${opts.token.ticker}: daily budget exhausted (${budget.spentSol.toFixed(3)}/${daily.cap} SOL)`;
  }

  const result = await executeBuy({
    mode: opts.flags.mode,
    graduated: opts.token.graduated,
    mint: opts.token.mint,
    sol: requested,
    maxSolPerTrade: cap,
    masterEnabled: opts.flags.masterEnabled,
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
  if (fillAskId != null) markSizeAskFilled(opts.store, fillAskId);
  closeSizeAsksForMint(opts.store, opts.token.mint);
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
