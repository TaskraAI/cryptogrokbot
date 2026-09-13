import type { BudgetState, Policy, RuntimeFlags } from "@night/shared";

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

/** Fail-closed: extra budget never raises the cap unless an explicit control is on. */
export function effectiveDailyBudgetSol(
  policy: Policy,
  extraBudgetSol: number,
  allowExtraBudget: boolean,
): { cap: number; extraApplied: number } {
  const extra = allowExtraBudget ? Math.max(0, extraBudgetSol) : 0;
  return { cap: policy.dailyBudgetSol + extra, extraApplied: extra };
}
