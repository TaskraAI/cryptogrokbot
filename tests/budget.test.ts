import { describe, expect, it } from "vitest";
import { applyEntryToBudget, applyRealizedPnl, canEnter, canReturnPrincipal, tokensToRecoverPrincipal } from "@night/risk";
import { policy } from "./fixtures.ts";
import type { BudgetState, RuntimeFlags } from "@night/shared";

const flags = (partial: Partial<RuntimeFlags> = {}): RuntimeFlags => ({
  mode: "PAPER",
  masterEnabled: false,
  rpcHealthy: true,
  jupiterHealthy: true,
  telegramHealthy: true,
  ...partial,
});

const budget = (partial: Partial<BudgetState> = {}): BudgetState => ({
  dayKey: "2026-08-24",
  spentSol: 0,
  trades: 0,
  realizedLossSol: 0,
  lastEntryAt: 0,
  extraBudgetSol: 0,
  ...partial,
});

describe("canEnter", () => {
  it("allows paper entries without master", () => {
    const g = canEnter({ policy, budget: budget(), openPositions: 0, flags: flags() });
    expect(g.ok).toBe(true);
  });

  it("blocks live buys when master is off", () => {
    const g = canEnter({
      policy,
      budget: budget(),
      openPositions: 0,
      flags: flags({ mode: "LIVE", masterEnabled: false }),
    });
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/MASTER_ENABLED/);
  });

  it("blocks when daily budget is exhausted", () => {
    const g = canEnter({
      policy,
      budget: budget({ spentSol: 0.45 }),
      openPositions: 0,
      flags: flags(),
    });
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/budget/);
  });

  it("blocks when max trades per day is hit", () => {
    const g = canEnter({
      policy,
      budget: budget({ trades: 5 }),
      openPositions: 0,
      flags: flags(),
    });
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/max trades/);
  });

  it("blocks when daily loss cap is hit", () => {
    const g = canEnter({
      policy,
      budget: budget({ realizedLossSol: 0.3 }),
      openPositions: 0,
      flags: flags(),
    });
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/loss cap/);
  });

  it("blocks when RPC is down in live mode", () => {
    const g = canEnter({
      policy,
      budget: budget(),
      openPositions: 0,
      flags: flags({ mode: "LIVE", masterEnabled: true, rpcHealthy: false }),
    });
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/RPC/);
  });

  it("still allows after a closed trade when budget remains", () => {
    const g = canEnter({
      policy,
      budget: applyEntryToBudget(budget(), 0.1, Date.now() - 200_000),
      openPositions: 0,
      flags: flags(),
      now: Date.now(),
    });
    expect(g.ok).toBe(true);
  });
});

describe("compound math", () => {
  it("computes tokens needed to recover remaining principal", () => {
    const tokens = tokensToRecoverPrincipal({
      tokensHeld: 100,
      markSolPerToken: 0.002,
      principalRemainingSol: 0.1,
    });
    expect(tokens).toBeCloseTo(50);
  });

  it("canReturnPrincipal is true when bag covers multiple", () => {
    expect(
      canReturnPrincipal({ bagValueSol: 0.12, principalSol: 0.1, recoveredSol: 0, multiple: 1 }),
    ).toBe(true);
    expect(
      canReturnPrincipal({ bagValueSol: 0.05, principalSol: 0.1, recoveredSol: 0, multiple: 1 }),
    ).toBe(false);
    expect(
      canReturnPrincipal({ bagValueSol: 1, principalSol: 0.1, recoveredSol: 0.1, multiple: 1 }),
    ).toBe(false);
  });

  it("counts only losses toward the daily loss cap", () => {
    const up = applyRealizedPnl(budget(), 0.2);
    expect(up.realizedLossSol).toBe(0);
    const down = applyRealizedPnl(budget(), -0.05);
    expect(down.realizedLossSol).toBeCloseTo(0.05);
  });
});
