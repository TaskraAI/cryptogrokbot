import type { BudgetState, Policy, RuntimeFlags, SourceHit, TokenMetrics } from "@night/shared";
import type { Guardrail } from "./guardrails.ts";
import { matchGuardrail } from "./guardrails.ts";

export {
  loadGuardrails,
  addGuardrail,
  removeGuardrail,
  matchGuardrail,
  parseNeverRule,
  type Guardrail,
} from "./guardrails.ts";
export {
  loadExtraRules,
  saveExtraRules,
  setExtraRuleEnabled,
  addExtraRule,
  evaluateExtraRules,
  consecutiveLosses,
  inHours,
  type ExtraRule,
  type ExtraRuleType,
} from "./extra-rules.ts";

export interface EntryGate {
  ok: boolean;
  reason: string;
}

export function canEnter(opts: {
  policy: Policy;
  budget: BudgetState;
  openPositions: number;
  flags: RuntimeFlags;
  now?: number;
  /** Grok Bot explicit order: live buy allowed while the auto-desk MASTER kill is off. */
  allowExplicitLive?: boolean;
  /** Taskra-named Grok Bot add-on: do not apply the auto-desk daily cap. */
  skipDailyBudget?: boolean;
}): EntryGate {
  const now = opts.now ?? Date.now();
  if (opts.flags.mode === "LIVE" && !opts.flags.masterEnabled && !opts.allowExplicitLive) {
    return { ok: false, reason: "MASTER_ENABLED is off; live buys blocked" };
  }
  if (opts.flags.mode === "LIVE" && !opts.flags.rpcHealthy) {
    return { ok: false, reason: "RPC unhealthy; refusing new buys" };
  }
  if (opts.flags.mode === "LIVE" && !opts.flags.jupiterHealthy) {
    return { ok: false, reason: "Jupiter unhealthy; refusing new buys" };
  }
  const budgetCap = effectiveDailyBudgetSol(opts.policy, opts.budget.extraBudgetSol, Boolean(opts.flags.allowExtraBudget));
  if (!opts.skipDailyBudget && opts.budget.spentSol + opts.policy.maxSolPerTrade > budgetCap.cap + 1e-9) {
    return { ok: false, reason: `daily budget exhausted (${opts.budget.spentSol.toFixed(3)}/${budgetCap.cap} SOL)` };
  }
  if (opts.budget.trades >= opts.policy.maxTradesPerDay) {
    return { ok: false, reason: `max trades per day hit (${opts.budget.trades}/${opts.policy.maxTradesPerDay})` };
  }
  if (opts.openPositions >= opts.policy.maxOpenPositions) {
    return { ok: false, reason: `max open positions (${opts.openPositions}/${opts.policy.maxOpenPositions})` };
  }
  if (opts.budget.realizedLossSol >= opts.policy.dailyLossCapSol) {
    return { ok: false, reason: `daily loss cap hit (${opts.budget.realizedLossSol.toFixed(3)} SOL)` };
  }
  if (opts.budget.lastEntryAt && now - opts.budget.lastEntryAt < opts.policy.cooldownSeconds * 1000) {
    return { ok: false, reason: `cooldown ${opts.policy.cooldownSeconds}s` };
  }
  return { ok: true, reason: "budget and flags allow entry" };
}

export interface ScoreResult {
  score: number;
  passed: boolean;
  blockedReason?: string;
  checks: Record<string, boolean | number | string>;
}

export function scoreCandidate(opts: {
  token: TokenMetrics;
  sources: SourceHit[];
  guardrails: Guardrail[];
  policy: Policy;
  now?: number;
}): ScoreResult {
  const now = opts.now ?? Date.now();
  const checks: Record<string, boolean | number | string> = {};

  const hit = matchGuardrail(opts.guardrails, {
    mint: opts.token.mint,
    ticker: opts.token.ticker,
    creatorPct: opts.token.creatorPct,
    sources: opts.sources,
    text: opts.sources.map((s) => s.snippet).join(" "),
  });
  if (hit) {
    return {
      score: 0,
      passed: false,
      blockedReason: `guardrail ${hit.id}: ${hit.type}=${hit.value}`,
      checks: { guardrail: hit.id },
    };
  }

  checks.mintAuthorityRevoked = opts.token.mintAuthorityRevoked;
  checks.freezeAuthorityRevoked = opts.token.freezeAuthorityRevoked;
  checks.sellSimOk = opts.token.sellSimOk;
  checks.liquidityUsd = opts.token.liquidityUsd;
  checks.creatorPct = opts.token.creatorPct;
  checks.top10HolderPct = opts.token.top10HolderPct;
  checks.buyImpactPct = opts.token.buyImpactPct;

  if (!opts.token.sellSimOk) {
    return { score: 0, passed: false, blockedReason: "honeypot: sell simulation failed", checks };
  }
  if (!opts.token.freezeAuthorityRevoked) {
    return { score: 5, passed: false, blockedReason: "freeze authority still active", checks };
  }
  if (opts.token.liquidityUsd < opts.policy.minLiquidityUsd && opts.token.graduated) {
    return { score: 10, passed: false, blockedReason: `liquidity ${opts.token.liquidityUsd} < ${opts.policy.minLiquidityUsd}`, checks };
  }
  if (opts.token.creatorPct > opts.policy.maxCreatorPct) {
    return { score: 15, passed: false, blockedReason: `creator ${opts.token.creatorPct}% > ${opts.policy.maxCreatorPct}%`, checks };
  }
  if (opts.token.top10HolderPct > opts.policy.maxTop10HolderPct) {
    return { score: 20, passed: false, blockedReason: `top10 ${opts.token.top10HolderPct}% > ${opts.policy.maxTop10HolderPct}%`, checks };
  }
  if (opts.token.buyImpactPct > opts.policy.maxBuyImpactPct) {
    return { score: 20, passed: false, blockedReason: `buy impact ${opts.token.buyImpactPct}% > ${opts.policy.maxBuyImpactPct}%`, checks };
  }

  const recent = opts.sources.filter((s) => now - s.at < 30 * 60 * 1000);
  const uniqueKeys = new Set(recent.map((s) => `${s.platform}:${s.key.toLowerCase()}`));
  const trusted = recent.filter((s) => s.weight === "trusted");
  checks.uniqueSources = uniqueKeys.size;
  checks.trustedSources = trusted.length;

  if (trusted.length === 0 && uniqueKeys.size < opts.policy.minIndependentSources) {
    return {
      score: 25,
      passed: false,
      blockedReason: `need ${opts.policy.minIndependentSources} sources or one trusted (have ${uniqueKeys.size})`,
      checks,
    };
  }

  let score = 50;
  if (opts.token.mintAuthorityRevoked) score += 8;
  if (opts.token.graduated) score += 5;
  score += Math.min(15, uniqueKeys.size * 5);
  score += Math.min(15, trusted.length * 8);
  if (opts.token.creatorPct < 3) score += 7;
  if (opts.token.liquidityUsd > 20_000) score += 5;
  if (opts.token.ageMinutes > 15 && opts.token.ageMinutes < 24 * 60) score += 4;
  score = Math.min(100, score);
  checks.score = score;

  if (score < opts.policy.minScore) {
    return { score, passed: false, blockedReason: `score ${score} < ${opts.policy.minScore}`, checks };
  }
  return { score, passed: true, checks };
}

/** Fail-closed: extra budget never raises the cap unless an explicit control is on. */
export function effectiveDailyBudgetSol(
  policy: Policy,
  extraBudgetSol: number,
  allowExtraBudget: boolean,
): { cap: number; extraApplied: number } {
  const extra = allowExtraBudget ? Math.max(0, extraBudgetSol) : 0;
  return { cap: policy.dailyBudgetSol + extra, extraApplied: extra };
}

export function applyEntryToBudget(budget: BudgetState, sol: number, now: number): BudgetState {
  return {
    ...budget,
    spentSol: budget.spentSol + sol,
    trades: budget.trades + 1,
    lastEntryAt: now,
  };
}

export function applyRealizedPnl(budget: BudgetState, netSol: number): BudgetState {
  if (netSol >= 0) return budget;
  return { ...budget, realizedLossSol: budget.realizedLossSol + Math.abs(netSol) };
}

export function tokensToRecoverPrincipal(opts: {
  tokensHeld: number;
  markSolPerToken: number;
  principalRemainingSol: number;
}): number {
  if (opts.markSolPerToken <= 0) return 0;
  const needed = opts.principalRemainingSol / opts.markSolPerToken;
  return Math.min(opts.tokensHeld, Math.max(0, needed));
}

export function principalRemaining(principalSol: number, recoveredSol: number): number {
  return Math.max(0, principalSol - recoveredSol);
}

export function canReturnPrincipal(opts: {
  bagValueSol: number;
  principalSol: number;
  recoveredSol: number;
  multiple: number;
}): boolean {
  if (opts.recoveredSol + 1e-9 >= opts.principalSol) return false;
  return opts.bagValueSol + opts.recoveredSol >= opts.principalSol * opts.multiple;
}

/** Grok Bot picks 2x–5x cost-out from hype, volume, score, and book quality. */
export function pickCostOutMultiple(opts: {
  policy: Policy;
  sentiment: number;
  score: number;
  volume5m: number;
  liquidityUsd: number;
  uniqueSources: number;
}): number {
  const min = Math.max(1, Number(opts.policy.costOutMinMultiple) || 2);
  const max = Math.max(min, Number(opts.policy.costOutMaxMultiple) || 5);
  let t = 0;
  if (opts.sentiment >= opts.policy.highSentiment) t += 0.35;
  if (opts.sentiment >= 0.65) t += 0.15;
  if (opts.score >= 80) t += 0.2;
  else if (opts.score >= 70) t += 0.1;
  if (opts.volume5m >= 8000) t += 0.15;
  else if (opts.volume5m >= 3000) t += 0.08;
  if (opts.liquidityUsd >= 25_000) t += 0.1;
  if (opts.uniqueSources >= 3) t += 0.1;
  t = Math.min(1, Math.max(0, t));
  if (t < 0.35) return min;
  if (t < 0.55) return Math.min(max, min + 1);
  if (t < 0.75) return Math.min(max, min + 2);
  return max;
}

export function costOutMultipleForPosition(pos: { costOutMultiple?: number }, policy: Policy): number {
  const n = Number(pos.costOutMultiple);
  if (Number.isFinite(n) && n >= 1) return n;
  return Number(policy.returnPrincipalMultiple) || policy.costOutMinMultiple || 2;
}
