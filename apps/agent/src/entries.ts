import type { Policy, RuntimeFlags, SourceHit, TokenMetrics } from "@night/shared";
import { applyEntryToBudget, canEnter, effectiveDailyBudgetSol, evaluateExtraRules, letterGrade, pickCostOutMultiple, scoreCandidate, type ExtraRule, type Guardrail } from "@night/risk";
import { decideDeskTrade, executeDeskTrade, forensicsFromToken, liquidityFromToken } from "./desk-flow.ts";
import { deskRiskFromPolicy, type DeskRiskConfig } from "@night/risk";
import { simulateSell } from "@night/signals";
import { scoreSentiment } from "@night/tape";
import {
  closeSizeAsksForMint,
  getBudget,
  getSizeAsk,
  insertDecision,
  insertFill,
  insertOpportunity,
  insertPosition,
  insertSourceHit,
  latestOpenSizeAsk,
  listOpenPositions,
  markOpportunityFilled,
  markSizeAskFilled,
  updatePosition,
  upsertBudget,
  type SizeAskRow,
  type Store,
} from "@night/storage";
import type { Connection, Keypair } from "@solana/web3.js";
import type { BudgetState } from "@night/shared";

export function parseChiefApprove(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const s = value.trim().toUpperCase();
    return s === "APPROVE" || s === "CHIEF";
  }
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (body.chiefApprove === true) return true;
  const c = String(body.chief ?? "").trim().toUpperCase();
  return c === "APPROVE" || c === "CHIEF";
}

/** Taskra-named add-on: body add/addOn true. Default remains no auto-average-down. */
export function parseAddOn(value: unknown): boolean {
  if (value === true) return true;
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  const flag = body.add ?? body.addOn ?? body.add_on;
  if (flag === true) return true;
  if (typeof flag === "string") return flag.trim().toLowerCase() === "true";
  return false;
}

export function isExplicitGrokBotAdd(opts: {
  add?: boolean;
  grokBotOrder?: boolean;
  chiefApproved?: boolean;
}): boolean {
  return Boolean(opts.add) && Boolean(opts.grokBotOrder) && Boolean(opts.chiefApproved);
}

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

function queueScoutOpportunity(opts: {
  store: Store;
  token: TokenMetrics;
  sentiment: number;
  score: number;
  volume5m: number;
  priceUsd: number;
  costOutMultiple: number;
  testSol: number;
  now: number;
  reason: string;
}): string {
  const grade = letterGrade(opts.score, 60);
  const opp = insertOpportunity(opts.store, {
    mint: opts.token.mint,
    ticker: opts.token.ticker,
    sentiment: opts.sentiment,
    score: opts.score,
    volume5m: opts.volume5m,
    priceUsd: opts.priceUsd,
    costOutMultiple: opts.costOutMultiple,
    reason: opts.reason,
    note: `Grade ${grade}. Hype ${opts.sentiment.toFixed(2)} vol5m ${opts.volume5m}. Buy ${opts.testSol} SOL after Chief APPROVE, cost-out ${opts.costOutMultiple}x, moon bag after.`,
  });
  insertDecision(opts.store, {
    at: opts.now,
    kind: "ask",
    mint: opts.token.mint,
    allowed: false,
    reason: `opportunity #${opp.id} queued; needs Chief APPROVE`,
    score: opts.score,
    payload: { sentiment: opts.sentiment, opportunityId: opp.id, costOutMultiple: opts.costOutMultiple, letter: grade },
  });
  return (
    `opportunity #${opp.id} ${opts.token.ticker} grade ${grade}: queued for Chief APPROVE then Grok Bot buy ${opts.testSol} SOL ` +
    `(hype ${opts.sentiment.toFixed(2)}, vol5m ${opts.volume5m}, cost-out ${opts.costOutMultiple}x then moon bag). ` +
    `Scout never live-buys. Scout keeps searching. ${opts.reason}`
  );
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
  /** Explicit Grok Bot order: live buy allowed while auto-desk MASTER is off. */
  grokBotOrder?: boolean;
  /** Live buy: Chief must send chief:"APPROVE". Scout auto-loop never sets this. */
  chiefApproved?: boolean;
  /** Add SOL onto an existing open row. Only honored with grokBotOrder + chiefApproved. */
  add?: boolean;
  /** Idempotency key for Execution. Retries with the same key do not double-submit. */
  clientOrderId?: string;
  strategy?: string;
  originatingAgent?: string;
  deskRisk?: DeskRiskConfig;
  walletSol?: number | null;
}): Promise<string> {
  const now = opts.now ?? Date.now();
  const open = listOpenPositions(opts.store);
  const existingOpen = open.find((p) => p.mint === opts.token.mint);
  const explicitAdd = isExplicitGrokBotAdd(opts) && Boolean(existingOpen);
  if (existingOpen && !explicitAdd) {
    return `already in ${opts.token.ticker}`;
  }

  if (opts.skipScore && opts.flags.mode === "LIVE") {
    return `blocked ${opts.token.ticker}: --force is paper-only`;
  }

  const scored = opts.skipScore
    ? { passed: true as const, score: 0, letter: "F" as const, blockedReason: undefined as string | undefined, checks: { forced: true } }
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

  const sentiment = scoreSentiment(opts.sources);
  const uniqueSources = new Set(opts.sources.map((s) => `${s.platform}:${s.key.toLowerCase()}`)).size;
  const costOutMultiple = pickCostOutMultiple({
    policy: opts.policy,
    sentiment,
    score: scored.score,
    volume5m: opts.token.volume5m,
    liquidityUsd: opts.token.liquidityUsd,
    uniqueSources,
  });
  const testSol = opts.policy.maxSolPerTrade;
  const ceilingSol = opts.policy.sizeAskCeilingSol;
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

  const b = getBudget(opts.store, opts.dayKey, opts.flags.mode);
  const budget: BudgetState = {
    dayKey: b.day_key,
    spentSol: b.spent_sol,
    trades: b.trades,
    realizedLossSol: b.realized_loss_sol,
    lastEntryAt: b.last_entry_at,
    extraBudgetSol: b.extra_budget_sol,
  };
  const modeOpen = listOpenPositions(opts.store, opts.flags.mode);
  const gate = canEnter({
    policy: opts.policy,
    budget,
    // Add-on does not consume a new open slot.
    openPositions: explicitAdd
      ? modeOpen.filter((p) => p.mint !== opts.token.mint).length
      : modeOpen.length,
    flags: opts.flags,
    // Explicit Taskra add is not a spray; skip the auto-desk cooldown.
    now: explicitAdd ? now + opts.policy.cooldownSeconds * 1000 : now,
    allowExplicitLive: Boolean(opts.grokBotOrder),
    skipDailyBudget: explicitAdd,
  });
  if (!gate.ok) {
    // Scout keeps hunting even with empty wallet / exhausted daily budget / cooldown.
    // Only Grok Bot live fills are blocked here — chances still queue for Chief.
    if (!opts.grokBotOrder) {
      return queueScoutOpportunity({
        store: opts.store,
        token: opts.token,
        sentiment,
        score: scored.score,
        volume5m: opts.token.volume5m,
        priceUsd: opts.token.priceUsd,
        costOutMultiple,
        testSol,
        now,
        reason: `${gate.reason}; Scout keeps searching`,
      });
    }
    insertDecision(opts.store, {
      at: now,
      kind: "block",
      mint: opts.token.mint,
      allowed: false,
      reason: gate.reason,
      score: scored.score,
    });
    return `blocked ${opts.token.ticker}: ${gate.reason}`;
  }

  // MASTER on still does not let Scout spray live tickets. Queue for Chief.
  if (opts.flags.mode === "LIVE" && !opts.grokBotOrder) {
    return queueScoutOpportunity({
      store: opts.store,
      token: opts.token,
      sentiment,
      score: scored.score,
      volume5m: opts.token.volume5m,
      priceUsd: opts.token.priceUsd,
      costOutMultiple,
      testSol,
      now,
        reason: "needs Chief APPROVE",
    });
  }
  if (opts.flags.mode === "LIVE" && opts.grokBotOrder && !opts.chiefApproved) {
    insertDecision(opts.store, {
      at: now,
      kind: "block",
      mint: opts.token.mint,
      allowed: false,
      reason: "needs Chief permission (chief: APPROVE)",
      score: scored.score,
    });
    return `blocked ${opts.token.ticker}: needs Chief permission (chief: APPROVE)`;
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

  let requested: number;
  let cap = testSol;
  let fillAskId: number | undefined;

  if (explicitAdd) {
    // Taskra-named size-up: honor the posted SOL, do not clip to maxSolPerTrade.
    requested = opts.sol ?? testSol;
    cap = requested;
  } else if (ask && (ask.status === "keep" || ask.status === "increase") && opts.sizeAskId != null) {
    const ticket = ticketFromAsk(ask, testSol, ceilingSol);
    requested = ticket.sol;
    cap = ticket.cap;
    fillAskId = ask.id;
  } else {
    requested = opts.sol ?? testSol;
    cap = testSol;
    void userPickedSize;
  }

  if (!Number.isFinite(requested) || requested <= 0) {
    return `blocked ${opts.token.ticker}: invalid SOL size`;
  }
  if (!explicitAdd && requested > cap + 1e-12) {
    return `blocked ${opts.token.ticker}: size ${requested} exceeds maxSolPerTrade ${cap}`;
  }

  const daily = effectiveDailyBudgetSol(opts.policy, budget.extraBudgetSol, Boolean(opts.flags.allowExtraBudget));
  if (!explicitAdd && budget.spentSol + requested > daily.cap + 1e-9) {
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

  const deskRisk = opts.deskRisk ?? deskRiskFromPolicy(opts.policy);
  const strategy = opts.strategy || (opts.grokBotOrder ? "grok" : "scout");
  const originatingAgent = opts.originatingAgent || (opts.grokBotOrder ? "grok" : "scout");
  const decided = decideDeskTrade({
    store: opts.store,
    policy: opts.policy,
    flags: opts.flags,
    deskRisk,
    proposed: {
      mint: opts.token.mint,
      side: "buy",
      sizeSol: requested,
      strategy,
      originatingAgent,
      liquidity: liquidityFromToken(opts.token),
      forensics: forensicsFromToken(opts.token),
      ageMinutes: opts.token.ageMinutes,
      top10HolderPct: opts.token.top10HolderPct,
      isLaunch: !opts.token.graduated,
    },
    walletSol: opts.walletSol,
    dayKey: opts.dayKey,
    now,
    allowExplicitLive: Boolean(opts.grokBotOrder),
    skipDailyBudget: explicitAdd,
    skipOpenSlot: explicitAdd,
  });
  if (decided.result.decision === "HALT_TRADING" || decided.result.decision === "REJECT") {
    insertDecision(opts.store, {
      at: now,
      kind: "block",
      mint: opts.token.mint,
      allowed: false,
      reason: `risk ${decided.result.decision}: ${decided.result.reasons.join("; ")}`,
      score: scored.score,
      payload: decided.result.checks,
    });
    return `blocked ${opts.token.ticker}: ${decided.result.reasons.join("; ")}`;
  }
  const execSize = decided.result.sizeSol ?? requested;
  const clientOrderId = opts.clientOrderId?.trim() || `tryEnter:${opts.token.mint}:buy:${now}`;
  const result = await executeDeskTrade({
    store: opts.store,
    policy: opts.policy,
    flags: opts.flags,
    deskRisk,
    riskToken: decided.row.token,
    clientOrderId,
    mint: opts.token.mint,
    side: "buy",
    sizeSol: execSize,
    graduated: opts.token.graduated,
    grokBotOrder: opts.grokBotOrder,
    connection: opts.connection,
    keypair: opts.keypair,
    pumpApiKey: opts.pumpApiKey,
    now,
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

  let id: number;
  if (explicitAdd && existingOpen) {
    id = existingOpen.id;
    updatePosition(opts.store, id, {
      tokens_held: existingOpen.tokens_held + result.tokens,
      tokens_initial: existingOpen.tokens_initial + result.tokens,
      sol_spent: existingOpen.sol_spent + result.sol,
      principal_sol: existingOpen.principal_sol + result.sol,
    });
  } else {
    id = insertPosition(opts.store, {
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
      thesis: `score ${scored.checks.score ?? scored.score}; cost-out ${costOutMultiple}x then moon bag`,
      score: scored.score,
      entryTx: result.signature,
      costOutMultiple,
      strategy,
    });
  }
  insertFill(opts.store, {
    positionId: id,
    at: now,
    side: "buy",
    sol: result.sol,
    tokens: result.tokens,
    priceUsd: opts.token.priceUsd || 1,
    reason: explicitAdd ? "add" : "entry",
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
    mode: opts.flags.mode,
    spent_sol: next.spentSol,
    trades: next.trades,
    realized_loss_sol: next.realizedLossSol,
    last_entry_at: next.lastEntryAt,
    extra_budget_sol: next.extraBudgetSol,
  });
  if (fillAskId != null) markSizeAskFilled(opts.store, fillAskId);
  closeSizeAsksForMint(opts.store, opts.token.mint);
  markOpportunityFilled(opts.store, opts.token.mint);
  insertDecision(opts.store, {
    at: now,
    kind: "entry",
    mint: opts.token.mint,
    allowed: true,
    reason: explicitAdd
      ? `added ${result.paper ? "paper" : "live"} ${result.sol} SOL onto #${id}`
      : `bought ${result.paper ? "paper" : "live"} ${result.sol} SOL cost-out ${costOutMultiple}x`,
    score: scored.score,
    payload: { costOutMultiple, sentiment, add: explicitAdd },
  });
  return `bought #${id} ${opts.token.ticker} ${result.sol} SOL${explicitAdd ? " add" : ""} ${result.paper ? "PAPER" : result.signature}`;
}
