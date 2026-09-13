import type { BudgetState, Policy, SourceHit, TokenMetrics } from "@night/shared";
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
export { canEnter, effectiveDailyBudgetSol, type EntryGate } from "./can-enter.ts";
export {
  deskRiskFromPolicy,
  loadDeskRisk,
  mergeDeskRisk,
  strategyMultiplier,
  DEFAULT_STRATEGY_MULTIPLIERS,
  type DeskRiskConfig,
} from "./desk-risk.ts";
export {
  decideTrade,
  RISK_DECISIONS,
  type RiskDecision,
  type TradeSide,
  type ForensicsFlags,
  type ProposedTrade,
  type RiskDecisionResult,
  type DecideTradeContext,
} from "./decide.ts";

export type LetterGrade = "A" | "B" | "C" | "D" | "F";

export function letterGrade(score: number, minScore = 60): LetterGrade {
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= minScore) return "C";
  if (score >= Math.max(0, minScore - 15)) return "D";
  return "F";
}

export interface ScoreResult {
  score: number;
  passed: boolean;
  letter: LetterGrade;
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
      letter: "F",
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
    return { score: 0, passed: false, letter: "F", blockedReason: "honeypot: sell simulation failed", checks };
  }
  if (!opts.token.freezeAuthorityRevoked) {
    return { score: 5, passed: false, letter: "F", blockedReason: "freeze authority still active", checks };
  }
  if (opts.token.liquidityUsd < opts.policy.minLiquidityUsd && opts.token.graduated) {
    return { score: 10, passed: false, letter: "F", blockedReason: `liquidity ${opts.token.liquidityUsd} < ${opts.policy.minLiquidityUsd}`, checks };
  }
  if (opts.token.creatorPct > opts.policy.maxCreatorPct) {
    return { score: 15, passed: false, letter: "F", blockedReason: `creator ${opts.token.creatorPct}% > ${opts.policy.maxCreatorPct}%`, checks };
  }
  if (opts.token.top10HolderPct > opts.policy.maxTop10HolderPct) {
    return { score: 20, passed: false, letter: "F", blockedReason: `top10 ${opts.token.top10HolderPct}% > ${opts.policy.maxTop10HolderPct}%`, checks };
  }
  if (opts.token.buyImpactPct > opts.policy.maxBuyImpactPct) {
    return { score: 20, passed: false, letter: "F", blockedReason: `buy impact ${opts.token.buyImpactPct}% > ${opts.policy.maxBuyImpactPct}%`, checks };
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
      letter: "F",
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
  // Hunt gems early — younger coins score higher so we catch them before they reprice.
  if (opts.token.ageMinutes < 15) score += 8;
  else if (opts.token.ageMinutes < 60) score += 5;
  else if (opts.token.ageMinutes < 180) score += 2;
  score = Math.min(100, score);
  const letter = letterGrade(score, opts.policy.minScore);
  checks.score = score;
  checks.letter = letter;
  checks.ageMinutes = opts.token.ageMinutes;

  if (score < opts.policy.minScore) {
    return { score, passed: false, letter, blockedReason: `score ${score} < ${opts.policy.minScore}`, checks };
  }
  return { score, passed: true, letter, checks };
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
  const min = Math.max(2.5, Number(opts.policy.costOutMinMultiple) || 2.5);
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
  return Number(policy.returnPrincipalMultiple) || policy.costOutMinMultiple || 2.5;
}
