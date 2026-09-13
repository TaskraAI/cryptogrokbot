import type { BudgetState, Policy, RuntimeFlags } from "@night/shared";
import { assessLiquidity, type LiquidityAssessment, type LiquiditySnapshot } from "@night/liquidity";
import { exposureForMint, exposureForStrategy, type PortfolioSummary } from "@night/portfolio";
import { canEnter } from "./can-enter.ts";
import { strategyMultiplier, type DeskRiskConfig } from "./desk-risk.ts";

export const RISK_DECISIONS = ["APPROVE", "APPROVE_REDUCED_SIZE", "REJECT", "HALT_TRADING"] as const;
export type RiskDecision = (typeof RISK_DECISIONS)[number];

export type TradeSide = "buy" | "sell" | "partial";

export interface ForensicsFlags {
  honeypot?: boolean;
  mintAuthorityLive?: boolean;
  freezeAuthorityLive?: boolean;
  bundleDump?: boolean;
  lpPulled?: boolean;
  highConcentration?: boolean;
}

export interface ProposedTrade {
  mint: string;
  side: TradeSide;
  sizeSol: number;
  strategy?: string;
  originatingAgent?: string;
  liquidity?: LiquiditySnapshot;
  forensics?: ForensicsFlags;
  /** Token age when no liquidity snapshot age is present. */
  ageMinutes?: number;
  top10HolderPct?: number;
  isLaunch?: boolean;
}

export interface RiskDecisionResult {
  decision: RiskDecision;
  sizeSol?: number;
  reasons: string[];
  checks: Record<string, boolean | number | string>;
}

export interface DecideTradeContext {
  deskRisk: DeskRiskConfig;
  policy: Policy;
  budget: BudgetState;
  flags: RuntimeFlags;
  portfolio: PortfolioSummary;
  now?: number;
  /** Grok Bot explicit order: live buy allowed while MASTER is off. */
  allowExplicitLive?: boolean;
  /** Taskra-named add-on: skip daily cap / open-slot / cooldown. */
  skipDailyBudget?: boolean;
  skipOpenSlot?: boolean;
  halted?: boolean;
}

export function decideTrade(proposed: ProposedTrade, ctx: DecideTradeContext): RiskDecisionResult {
  const now = ctx.now ?? Date.now();
  const reasons: string[] = [];
  const checks: Record<string, boolean | number | string> = {
    side: proposed.side,
    requestedSol: proposed.sizeSol,
    strategy: proposed.strategy ?? "",
    originatingAgent: proposed.originatingAgent ?? "",
  };

  if (ctx.halted) {
    return halt("trading halt flag is on", checks);
  }
  if (ctx.budget.realizedLossSol >= ctx.deskRisk.dailyLossLimitSol) {
    return halt(
      `daily loss ${ctx.budget.realizedLossSol.toFixed(3)} >= limit ${ctx.deskRisk.dailyLossLimitSol}`,
      checks,
    );
  }
  if (ctx.portfolio.drawdownPct >= ctx.deskRisk.maxDrawdownPct && ctx.portfolio.drawdownPct > 0) {
    return halt(`drawdown ${ctx.portfolio.drawdownPct.toFixed(1)}% >= ${ctx.deskRisk.maxDrawdownPct}%`, checks);
  }

  const liquidity = assessLiquidity(
    {
      ...proposed.liquidity,
      ageMinutes: proposed.liquidity?.ageMinutes ?? proposed.ageMinutes,
      top10HolderPct: proposed.liquidity?.top10HolderPct ?? proposed.top10HolderPct,
      isLaunch: proposed.liquidity?.isLaunch ?? proposed.isLaunch,
    },
    {
      minLiquidityUsd: ctx.deskRisk.minLiquidityUsd,
      maxSlippageBps: ctx.deskRisk.maxSlippageBps,
      maxHolderConcentrationPct: ctx.deskRisk.maxHolderConcentrationPct,
      maxVolatilityHint: ctx.deskRisk.maxVolatilityHint,
      minTokenAgeMinutes: ctx.deskRisk.minTokenAgeMinutes,
    },
    proposed.sizeSol,
  );
  Object.assign(checks, prefixChecks("liq", liquidity.checks));

  const forensic = forensicReject(proposed.forensics);
  if (forensic) {
    return reject(forensic, checks);
  }

  if (proposed.side === "sell" || proposed.side === "partial") {
    return decideExit(proposed, liquidity, checks, reasons);
  }

  return decideBuy(proposed, ctx, liquidity, checks, reasons, now);
}

function decideExit(
  proposed: ProposedTrade,
  liquidity: LiquidityAssessment,
  checks: Record<string, boolean | number | string>,
  reasons: string[],
): RiskDecisionResult {
  if (!liquidity.exitable && liquidity.rejectReasons.length) {
    return reject(liquidity.rejectReasons.join("; "), { ...checks, exitBlocked: true });
  }
  reasons.push("exit path: Risk does not size exits; Execution submits");
  return {
    decision: "APPROVE",
    sizeSol: proposed.sizeSol,
    reasons,
    checks,
  };
}

function decideBuy(
  proposed: ProposedTrade,
  ctx: DecideTradeContext,
  liquidity: LiquidityAssessment,
  checks: Record<string, boolean | number | string>,
  reasons: string[],
  now: number,
): RiskDecisionResult {
  const requested = proposed.sizeSol;
  if (!Number.isFinite(requested) || requested <= 0) {
    return reject("invalid SOL size", checks);
  }

  const gate = canEnter({
    policy: ctx.policy,
    budget: ctx.budget,
    openPositions: ctx.skipOpenSlot ? Math.max(0, ctx.portfolio.openCount - 1) : ctx.portfolio.openCount,
    flags: ctx.flags,
    now: ctx.skipDailyBudget ? now + ctx.policy.cooldownSeconds * 1000 : now,
    allowExplicitLive: ctx.allowExplicitLive,
    skipDailyBudget: ctx.skipDailyBudget,
  });
  checks.canEnter = gate.ok;
  if (!gate.ok) {
    return reject(gate.reason, checks);
  }

  if (!ctx.skipDailyBudget && requested > ctx.deskRisk.maxPositionSizeSol + 1e-12) {
    return reject(`size ${requested} SOL exceeds maxPositionSizeSol ${ctx.deskRisk.maxPositionSizeSol}`, checks);
  }

  if (liquidity.rejectReasons.length) {
    return reject(liquidity.rejectReasons.join("; "), checks);
  }
  reasons.push(...liquidity.penalties);

  const strategy = (proposed.strategy || "default").toLowerCase();
  const mult = strategyMultiplier(ctx.deskRisk, strategy);
  const launch = Boolean(proposed.isLaunch || proposed.liquidity?.isLaunch);
  const launchMult = launch ? ctx.deskRisk.launchStricterMultiplier : 1;
  checks.strategyMultiplier = mult;
  checks.launchMultiplier = launchMult;

  const tokenExposure = exposureForMint(ctx.portfolio, proposed.mint);
  const stratExposure = exposureForStrategy(ctx.portfolio, strategy);
  const reserved = ctx.portfolio.pendingReservedSol;
  const roomPortfolio = ctx.deskRisk.maxPortfolioExposureSol - ctx.portfolio.totalExposureSol - reserved;
  const roomToken = ctx.deskRisk.maxExposurePerTokenSol - tokenExposure;
  const roomStrategy = ctx.deskRisk.maxExposurePerStrategySol * mult - stratExposure;
  let allowed = Math.min(
    requested,
    ctx.deskRisk.maxPositionSizeSol * mult * launchMult,
    Math.max(0, roomPortfolio),
    Math.max(0, roomToken),
    Math.max(0, roomStrategy),
    liquidity.maxSafeSizeSol > 0 ? liquidity.maxSafeSizeSol : requested,
  );

  if (ctx.portfolio.availableSol != null) {
    allowed = Math.min(allowed, ctx.portfolio.availableSol);
    checks.availableSol = ctx.portfolio.availableSol;
  }
  checks.tokenExposureSol = tokenExposure;
  checks.strategyExposureSol = stratExposure;
  checks.roomPortfolioSol = roomPortfolio;
  checks.allowedBeforeRound = allowed;

  allowed = Math.round(Math.max(0, allowed) * 1e9) / 1e9;
  checks.allowedSol = allowed;

  if (ctx.skipDailyBudget) {
    allowed = requested;
    checks.allowedSol = allowed;
    reasons.push("Taskra-named add-on: Risk honors posted size");
    return { decision: "APPROVE", sizeSol: allowed, reasons: reasons.length ? reasons : ["add-on approved"], checks };
  }

  if (allowed <= 1e-9) {
    return reject("no remaining risk capacity", checks);
  }
  if (allowed + 1e-12 < requested) {
    reasons.push(`reduced ${requested} → ${allowed} SOL`);
    return { decision: "APPROVE_REDUCED_SIZE", sizeSol: allowed, reasons, checks };
  }
  reasons.push("size and book within desk-risk limits");
  return { decision: "APPROVE", sizeSol: requested, reasons, checks };
}

function halt(reason: string, checks: Record<string, boolean | number | string>): RiskDecisionResult {
  return { decision: "HALT_TRADING", reasons: [reason], checks: { ...checks, halt: true } };
}

function reject(reason: string, checks: Record<string, boolean | number | string>): RiskDecisionResult {
  return { decision: "REJECT", reasons: [reason], checks };
}

function forensicReject(flags: ForensicsFlags | undefined): string | null {
  if (!flags) return null;
  if (flags.honeypot) return "forensics: honeypot";
  if (flags.lpPulled) return "forensics: LP pulled";
  if (flags.bundleDump) return "forensics: bundle dump";
  if (flags.mintAuthorityLive) return "forensics: mint authority live";
  if (flags.freezeAuthorityLive) return "forensics: freeze authority live";
  if (flags.highConcentration) return "forensics: holder concentration";
  return null;
}

function prefixChecks(
  prefix: string,
  checks: Record<string, boolean | number | string>,
): Record<string, boolean | number | string> {
  const out: Record<string, boolean | number | string> = {};
  for (const [k, v] of Object.entries(checks)) out[`${prefix}.${k}`] = v;
  return out;
}
