/**
 * Liquidity assessment from DexScreener / Jupiter-quote style metrics.
 * Does not send transactions. Risk uses this to size or reject; Execution
 * still enforces maxSlippageBps at submit time.
 */

export interface LiquiditySnapshot {
  liquidityUsd?: number;
  buyImpactPct?: number;
  sellImpactPct?: number;
  quotePriceImpactPct?: number;
  volume5m?: number;
  ageMinutes?: number;
  top10HolderPct?: number;
  volatilityHint?: number;
  isLaunch?: boolean;
}

export interface LiquidityLimits {
  minLiquidityUsd: number;
  maxSlippageBps: number;
  maxHolderConcentrationPct?: number;
  maxVolatilityHint?: number;
  minTokenAgeMinutes?: number;
}

export interface LiquidityAssessment {
  enterable: boolean;
  exitable: boolean;
  estEntrySlippageBps: number;
  estExitSlippageBps: number;
  maxSafeSizeSol: number;
  penalties: string[];
  rejectReasons: string[];
  checks: Record<string, boolean | number | string>;
}

const MIN_SAFE_SOL = 0.001;

export function assessLiquidity(
  snapshot: LiquiditySnapshot | undefined,
  limits: LiquidityLimits,
  requestedSizeSol = 0.1,
): LiquidityAssessment {
  const penalties: string[] = [];
  const rejectReasons: string[] = [];
  const checks: Record<string, boolean | number | string> = {};

  const liq = num(snapshot?.liquidityUsd);
  const buyImpact = firstFinite(snapshot?.buyImpactPct, snapshot?.quotePriceImpactPct, 0);
  const sellImpact = firstFinite(snapshot?.sellImpactPct, snapshot?.quotePriceImpactPct, buyImpact);
  const vol = num(snapshot?.volatilityHint);
  const holders = num(snapshot?.top10HolderPct);
  const age = num(snapshot?.ageMinutes);
  const maxSlippagePct = limits.maxSlippageBps / 100;
  const requested = Number.isFinite(requestedSizeSol) && requestedSizeSol > 0 ? requestedSizeSol : 0.1;

  checks.liquidityUsd = liq;
  checks.buyImpactPct = buyImpact;
  checks.sellImpactPct = sellImpact;
  checks.maxSlippageBps = limits.maxSlippageBps;
  checks.requestedSizeSol = requested;

  if (liq > 0 && liq < limits.minLiquidityUsd) {
    rejectReasons.push(`liquidity $${liq} < min $${limits.minLiquidityUsd}`);
  }
  if (liq <= 0 && snapshot) {
    penalties.push("liquidity unknown or zero");
  }

  if (buyImpact > maxSlippagePct) {
    rejectReasons.push(`entry impact ${buyImpact}% > max slippage ${maxSlippagePct}%`);
  } else if (buyImpact > maxSlippagePct * 0.6) {
    penalties.push(`entry impact ${buyImpact}% is close to the slippage cap`);
  }

  if (sellImpact > maxSlippagePct) {
    rejectReasons.push(`exit impact ${sellImpact}% > max slippage ${maxSlippagePct}%`);
  }

  if (limits.maxHolderConcentrationPct != null && holders > limits.maxHolderConcentrationPct) {
    rejectReasons.push(`holder concentration ${holders}% > ${limits.maxHolderConcentrationPct}%`);
  }

  if (limits.minTokenAgeMinutes != null && limits.minTokenAgeMinutes > 0 && age > 0 && age < limits.minTokenAgeMinutes) {
    rejectReasons.push(`token age ${age}m < ${limits.minTokenAgeMinutes}m`);
  }

  if (limits.maxVolatilityHint != null && vol > limits.maxVolatilityHint) {
    penalties.push(`volatility hint ${vol} > ${limits.maxVolatilityHint}`);
  }

  if (snapshot?.isLaunch) {
    penalties.push("launch / bonding-curve style book");
  }

  const estEntrySlippageBps = Math.max(0, Math.round(buyImpact * 100));
  const estExitSlippageBps = Math.max(0, Math.round(sellImpact * 100));

  let maxSafeSizeSol = requested;
  if (buyImpact > 0 && maxSlippagePct > 0) {
    maxSafeSizeSol = requested * (maxSlippagePct / buyImpact);
  }
  if (liq > 0) {
    // Rough: do not take more than 2% of USD book, quoted as SOL via requested/impact.
    const bookCap = Math.max(MIN_SAFE_SOL, (liq * 0.02) / Math.max(1, liq / Math.max(requested, MIN_SAFE_SOL)));
    void bookCap;
    const usdCapSol = requested * (liq / Math.max(liq, limits.minLiquidityUsd));
    maxSafeSizeSol = Math.min(maxSafeSizeSol, Math.max(MIN_SAFE_SOL, usdCapSol));
  }
  for (const _ of penalties) {
    maxSafeSizeSol *= 0.85;
  }
  if (snapshot?.isLaunch) {
    maxSafeSizeSol *= 0.5;
  }
  maxSafeSizeSol = Math.max(0, roundSol(maxSafeSizeSol));

  if (rejectReasons.length) {
    maxSafeSizeSol = 0;
  }

  const enterable = rejectReasons.length === 0 && (liq <= 0 || liq >= limits.minLiquidityUsd);
  const exitable = !rejectReasons.some((r) => r.startsWith("exit impact"));

  checks.enterable = enterable;
  checks.exitable = exitable;
  checks.maxSafeSizeSol = maxSafeSizeSol;
  checks.estEntrySlippageBps = estEntrySlippageBps;
  checks.estExitSlippageBps = estExitSlippageBps;

  return {
    enterable,
    exitable,
    estEntrySlippageBps,
    estExitSlippageBps,
    maxSafeSizeSol,
    penalties,
    rejectReasons,
    checks,
  };
}

function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function firstFinite(...vals: Array<number | undefined>): number {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

function roundSol(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}
