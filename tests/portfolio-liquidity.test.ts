import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessLiquidity } from "@night/liquidity";
import { exposureForMint, summarizePortfolio } from "@night/portfolio";
import { insertPosition, openStore, reserveCapital, insertRiskDecision } from "@night/storage";

function mem() {
  const dir = join(tmpdir(), `port-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return openStore(join(dir, "t.db"));
}

describe("portfolio ledger summary", () => {
  it("reads open qty, exposure by strategy, and reserved capital from SQLite", () => {
    const store = mem();
    insertPosition(store, {
      mint: "Aaa1111111111111111111111111111111111111111",
      ticker: "AAA",
      mode: "PAPER",
      openedAt: Date.now(),
      entryPriceUsd: 1,
      principalSol: 0.1,
      tokensHeld: 50_000,
      solSpent: 0.1,
      sourcesJson: "[]",
      entryMetricsJson: "{}",
      strategy: "swing",
    });
    const risk = insertRiskDecision(store, {
      mint: "Bbb1111111111111111111111111111111111111111",
      side: "buy",
      requestedSol: 0.05,
      approvedSol: 0.05,
      strategy: "scout",
      decision: "APPROVE",
      reasons: ["ok"],
      checks: {},
      ttlMs: 60_000,
    });
    reserveCapital(store, { decisionId: risk.id, mint: risk.mint, sol: 0.05, strategy: "scout" });
    const sum = summarizePortfolio({
      store,
      mode: "PAPER",
      walletSol: 1.2,
      feeReserveSol: 0.02,
      marks: { Aaa1111111111111111111111111111111111111111: 1.1 },
    });
    expect(sum.openCount).toBe(1);
    expect(sum.openPositions[0]!.qty).toBe(50_000);
    expect(sum.openPositions[0]!.avgEntryUsd).toBe(1);
    expect(sum.openPositions[0]!.unrealizedSol).toBeCloseTo(0.01);
    expect(sum.exposureByStrategy.swing).toBeCloseTo(0.1);
    expect(sum.pendingReservedSol).toBeCloseTo(0.05);
    expect(sum.availableSol).toBeCloseTo(1.2 - 0.02 - 0.05);
    expect(exposureForMint(sum, "Aaa1111111111111111111111111111111111111111")).toBeCloseTo(0.1);
  });
});

describe("liquidity assessment", () => {
  it("marks a thin book unenterable and reports maxSafeSizeSol", () => {
    const thin = assessLiquidity(
      { liquidityUsd: 800, buyImpactPct: 20, sellImpactPct: 25 },
      { minLiquidityUsd: 5000, maxSlippageBps: 1500 },
      0.1,
    );
    expect(thin.enterable).toBe(false);
    expect(thin.maxSafeSizeSol).toBe(0);
    expect(thin.rejectReasons.join(" ")).toMatch(/liquidity|impact/);

    const ok = assessLiquidity(
      { liquidityUsd: 25_000, buyImpactPct: 3, sellImpactPct: 3 },
      { minLiquidityUsd: 5000, maxSlippageBps: 1500 },
      0.1,
    );
    expect(ok.enterable).toBe(true);
    expect(ok.exitable).toBe(true);
    expect(ok.maxSafeSizeSol).toBeGreaterThan(0);
    expect(ok.estEntrySlippageBps).toBe(300);
  });
});
