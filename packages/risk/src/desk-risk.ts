import { readFileSync } from "node:fs";
import { DEFAULT_POLICY, type Policy } from "@night/shared";

/**
 * Tunable Risk-agent limits. Values live in config/desk-risk.json.
 * Seeded from policy.json where a counterpart exists so the desk does not
 * bury a second set of magic numbers in code.
 */
export interface DeskRiskConfig {
  /** Hard per-ticket SOL cap (policy.maxSolPerTrade). Oversize is REJECT, not a silent clip. */
  maxPositionSizeSol: number;
  /** SOL kept unspent for fees / rent; never allocated to a new buy. */
  feeReserveSol: number;
  /** Sum of open + reserved SOL across the book (policy.dailyBudgetSol). */
  maxPortfolioExposureSol: number;
  /** Open + reserved SOL in one mint (policy.sizeAskCeilingSol / maxSolPerTrade). */
  maxExposurePerTokenSol: number;
  /** Open + reserved SOL attributed to one strategy. */
  maxExposurePerStrategySol: number;
  /** Concurrent open bags (policy.maxOpenPositions). */
  maxOpenPositions: number;
  /** Realised daily loss that HALTs new risk (policy.dailyLossCapSol). */
  dailyLossLimitSol: number;
  /** Unrealised drawdown vs marked exposure that HALTs new risk (abs(policy.hardStopPct)). */
  maxDrawdownPct: number;
  /** Max slippage Execution may send, in basis points (policy.slippagePctCap * 100). */
  maxSlippageBps: number;
  /** Dex / pool USD liquidity floor (policy.minLiquidityUsd). */
  minLiquidityUsd: number;
  /** Reject buys younger than this. 0 keeps the current gem-hunt (young names allowed). */
  minTokenAgeMinutes: number;
  /** Top-holder concentration ceiling (policy.maxTop10HolderPct). */
  maxHolderConcentrationPct: number;
  /** Unitless vol hint; snapshot above this is penalised / reduced. */
  maxVolatilityHint: number;
  /** Per-strategy size multipliers (1 = full size). Unknown strategies use "default". */
  strategyRiskMultipliers: Record<string, number>;
  /** Extra size haircut for launch / sub-age names (stacked on the strategy multiplier). */
  launchStricterMultiplier: number;
  /** How long an APPROVE token stays valid for Execution. */
  decisionTtlMs: number;
  /** Controlled live-submit retries after a failed or unconfirmed tx. */
  maxSubmitRetries: number;
}

export const DEFAULT_STRATEGY_MULTIPLIERS: Record<string, number> = {
  default: 1,
  scout: 1,
  altscout: 0.75,
  swing: 1,
  narrative: 0.85,
  launch: 0.5,
};

export function deskRiskFromPolicy(policy: Policy = DEFAULT_POLICY): DeskRiskConfig {
  return {
    maxPositionSizeSol: policy.maxSolPerTrade,
    feeReserveSol: 0.02,
    maxPortfolioExposureSol: policy.dailyBudgetSol,
    maxExposurePerTokenSol: Math.max(policy.sizeAskCeilingSol || 0, policy.maxSolPerTrade),
    maxExposurePerStrategySol: policy.dailyBudgetSol,
    maxOpenPositions: policy.maxOpenPositions,
    dailyLossLimitSol: policy.dailyLossCapSol,
    maxDrawdownPct: Math.abs(policy.hardStopPct),
    maxSlippageBps: Math.round(policy.slippagePctCap * 100),
    minLiquidityUsd: policy.minLiquidityUsd,
    minTokenAgeMinutes: 0,
    maxHolderConcentrationPct: policy.maxTop10HolderPct,
    maxVolatilityHint: 2,
    strategyRiskMultipliers: { ...DEFAULT_STRATEGY_MULTIPLIERS },
    launchStricterMultiplier: 0.5,
    decisionTtlMs: 300_000,
    maxSubmitRetries: 2,
  };
}

export function mergeDeskRisk(base: DeskRiskConfig, raw: Partial<DeskRiskConfig> | null | undefined): DeskRiskConfig {
  if (!raw) return base;
  const multipliers = {
    ...base.strategyRiskMultipliers,
    ...(raw.strategyRiskMultipliers ?? {}),
  };
  return {
    ...base,
    ...pickFinite(raw, [
      "maxPositionSizeSol",
      "feeReserveSol",
      "maxPortfolioExposureSol",
      "maxExposurePerTokenSol",
      "maxExposurePerStrategySol",
      "maxOpenPositions",
      "dailyLossLimitSol",
      "maxDrawdownPct",
      "maxSlippageBps",
      "minLiquidityUsd",
      "minTokenAgeMinutes",
      "maxHolderConcentrationPct",
      "maxVolatilityHint",
      "launchStricterMultiplier",
      "decisionTtlMs",
      "maxSubmitRetries",
    ]),
    strategyRiskMultipliers: multipliers,
  };
}

export function loadDeskRisk(path: string, policy: Policy = DEFAULT_POLICY): DeskRiskConfig {
  const seeded = deskRiskFromPolicy(policy);
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DeskRiskConfig>;
    return mergeDeskRisk(seeded, raw);
  } catch {
    return seeded;
  }
}

export function strategyMultiplier(cfg: DeskRiskConfig, strategy: string): number {
  const key = (strategy || "default").toLowerCase();
  const n = cfg.strategyRiskMultipliers[key] ?? cfg.strategyRiskMultipliers.default ?? 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function pickFinite<K extends keyof DeskRiskConfig>(
  raw: Partial<DeskRiskConfig>,
  keys: K[],
): Partial<DeskRiskConfig> {
  const out: Partial<DeskRiskConfig> = {};
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}
