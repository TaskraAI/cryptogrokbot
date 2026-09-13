import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, dayKey, type BudgetState, type RuntimeFlags } from "@night/shared";
import { decideTrade, deskRiskFromPolicy, loadDeskRisk, RISK_DECISIONS } from "@night/risk";
import { summarizePortfolio } from "@night/portfolio";
import { insertPosition, openStore } from "@night/storage";
import { token } from "./fixtures.ts";

function mem() {
  const dir = join(tmpdir(), `risk-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return openStore(join(dir, "t.db"));
}

const flags: RuntimeFlags = {
  mode: "PAPER",
  masterEnabled: false,
  rpcHealthy: true,
  jupiterHealthy: true,
  telegramHealthy: false,
};

const emptyBudget: BudgetState = {
  dayKey: dayKey(),
  spentSol: 0,
  trades: 0,
  realizedLossSol: 0,
  lastEntryAt: 0,
  extraBudgetSol: 0,
};

function ctx(store = mem(), extra: Partial<Parameters<typeof decideTrade>[1]> = {}) {
  const deskRisk = deskRiskFromPolicy(DEFAULT_POLICY);
  return {
    store,
    deskRisk,
    policy: DEFAULT_POLICY,
    budget: emptyBudget,
    flags,
    portfolio: summarizePortfolio({ store, mode: "PAPER", feeReserveSol: deskRisk.feeReserveSol }),
    ...extra,
  };
}

describe("Risk decision enum", () => {
  it("exports the four verdicts the desk agents call", () => {
    expect(RISK_DECISIONS).toEqual(["APPROVE", "APPROVE_REDUCED_SIZE", "REJECT", "HALT_TRADING"]);
  });

  it("APPROVE a normal paper buy inside limits", () => {
    const t = token();
    const r = decideTrade(
      {
        mint: t.mint,
        side: "buy",
        sizeSol: 0.1,
        strategy: "scout",
        originatingAgent: "chief",
        liquidity: { liquidityUsd: t.liquidityUsd, buyImpactPct: t.buyImpactPct, ageMinutes: t.ageMinutes },
      },
      ctx(),
    );
    expect(r.decision).toBe("APPROVE");
    expect(r.sizeSol).toBe(0.1);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.checks.requestedSol).toBe(0.1);
  });

  it("APPROVE_REDUCED_SIZE when the book only has room for a smaller ticket", () => {
    const store = mem();
    const t = token({ mint: "ReduceMint111111111111111111111111111111111" });
    insertPosition(store, {
      mint: t.mint,
      ticker: t.ticker,
      mode: "PAPER",
      openedAt: Date.now(),
      entryPriceUsd: 1,
      principalSol: 0.08,
      tokensHeld: 1000,
      solSpent: 0.08,
      sourcesJson: "[]",
      entryMetricsJson: "{}",
    });
    const r = decideTrade(
      {
        mint: t.mint,
        side: "buy",
        sizeSol: 0.1,
        strategy: "scout",
        originatingAgent: "grok",
        liquidity: { liquidityUsd: 25_000, buyImpactPct: 2 },
      },
      ctx(store),
    );
    expect(r.decision).toBe("APPROVE_REDUCED_SIZE");
    expect(r.sizeSol).toBeGreaterThan(0);
    expect(r.sizeSol!).toBeLessThan(0.1);
  });

  it("REJECT oversize vs maxPositionSizeSol (does not clip)", () => {
    const r = decideTrade(
      {
        mint: token().mint,
        side: "buy",
        sizeSol: 9.9,
        originatingAgent: "grok",
        liquidity: { liquidityUsd: 25_000, buyImpactPct: 1 },
      },
      ctx(),
    );
    expect(r.decision).toBe("REJECT");
    expect(r.sizeSol).toBeUndefined();
    expect(r.reasons.join(" ")).toMatch(/maxPositionSizeSol/);
  });

  it("HALT_TRADING when the daily loss limit is hit", () => {
    const r = decideTrade(
      {
        mint: token().mint,
        side: "buy",
        sizeSol: 0.05,
        originatingAgent: "grok",
        liquidity: { liquidityUsd: 25_000, buyImpactPct: 1 },
      },
      ctx(mem(), { budget: { ...emptyBudget, realizedLossSol: DEFAULT_POLICY.dailyLossCapSol } }),
    );
    expect(r.decision).toBe("HALT_TRADING");
    expect(r.reasons.join(" ")).toMatch(/daily loss/);
  });

  it("HALT_TRADING when the halt flag is on", () => {
    const r = decideTrade(
      { mint: token().mint, side: "sell", sizeSol: 0.05, originatingAgent: "sentinel" },
      ctx(mem(), { halted: true }),
    );
    expect(r.decision).toBe("HALT_TRADING");
  });

  it("REJECT buy on forensics honeypot", () => {
    const r = decideTrade(
      {
        mint: token().mint,
        side: "buy",
        sizeSol: 0.05,
        forensics: { honeypot: true },
        liquidity: { liquidityUsd: 25_000 },
      },
      ctx(),
    );
    expect(r.decision).toBe("REJECT");
    expect(r.reasons.join(" ")).toMatch(/honeypot/);
  });

  it("APPROVE a Sentinel exit so Execution can submit", () => {
    const r = decideTrade(
      { mint: token().mint, side: "sell", sizeSol: 0.08, originatingAgent: "sentinel" },
      ctx(),
    );
    expect(r.decision).toBe("APPROVE");
  });
});

describe("desk-risk.json", () => {
  it("loads seeded keys from config without inventing a second policy", () => {
    const cfg = loadDeskRisk("config/desk-risk.json", DEFAULT_POLICY);
    expect(cfg.maxPositionSizeSol).toBe(0.1);
    expect(cfg.maxOpenPositions).toBe(3);
    expect(cfg.minLiquidityUsd).toBe(5000);
    expect(cfg.dailyLossLimitSol).toBe(0.1);
    expect(cfg.maxSlippageBps).toBe(1500);
    expect(cfg.strategyRiskMultipliers.launch).toBe(0.5);
    expect(cfg.launchStricterMultiplier).toBe(0.5);
    expect(cfg.feeReserveSol).toBe(0.02);
  });
});
