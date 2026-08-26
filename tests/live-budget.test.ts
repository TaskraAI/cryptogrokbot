import { describe, expect, it, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_POLICY, dayKey } from "@night/shared";
import { getBudget, listOpenPositions, openStore, upsertBudget } from "@night/storage";
import { tryEnter } from "../apps/agent/src/entries.ts";
import { quietHit, token } from "./fixtures.ts";

vi.mock("@night/signals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@night/signals")>();
  return { ...actual, simulateSell: vi.fn(async () => true) };
});

vi.mock("@night/execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@night/execution")>();
  return {
    ...actual,
    executeBuy: vi.fn(async (opts: Parameters<typeof actual.executeBuy>[0]) => {
      if (opts.mode === "PAPER") return actual.executeBuy(opts);
      const sizeErr = actual.refuseOversizeBuy(opts.sol, opts.maxSolPerTrade ?? DEFAULT_POLICY.maxSolPerTrade);
      if (sizeErr) return { paper: false, sol: 0, tokens: 0, error: sizeErr };
      const liveErr = actual.refuseLiveExecution({
        mode: opts.mode,
        masterEnabled: opts.masterEnabled,
        hasWallet: true,
      });
      if (liveErr) return { paper: false, sol: 0, tokens: 0, error: liveErr };
      return { paper: false, sol: opts.sol, tokens: opts.sol * 1_000_000, signature: "TestLiveSig111" };
    }),
  };
});

function tmpDb() {
  const dir = join(tmpdir(), `live-budget-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, "t.db");
}

const paperFlags = {
  mode: "PAPER" as const,
  masterEnabled: false,
  rpcHealthy: true,
  jupiterHealthy: true,
  telegramHealthy: false,
};

const liveFlags = {
  mode: "LIVE" as const,
  masterEnabled: true,
  rpcHealthy: true,
  jupiterHealthy: true,
  telegramHealthy: false,
};

describe("paper vs live daily budget", () => {
  it("migrates a mixed day ledger onto PAPER so LIVE starts at 0", () => {
    const path = tmpDb();
    const raw = new DatabaseSync(path);
    raw.exec(`
      CREATE TABLE budget (
        day_key TEXT PRIMARY KEY,
        spent_sol REAL NOT NULL DEFAULT 0,
        trades INTEGER NOT NULL DEFAULT 0,
        realized_loss_sol REAL NOT NULL DEFAULT 0,
        last_entry_at INTEGER NOT NULL DEFAULT 0,
        extra_budget_sol REAL NOT NULL DEFAULT 0
      );
    `);
    raw.prepare("INSERT INTO budget VALUES (?, ?, ?, ?, ?, ?)").run("2026-08-25", 0.5, 5, 0, 1, 0);
    raw.close();
    const store = openStore(path);
    expect(getBudget(store, "2026-08-25", "PAPER").spent_sol).toBeCloseTo(0.5);
    expect(getBudget(store, "2026-08-25", "PAPER").trades).toBe(5);
    expect(getBudget(store, "2026-08-25", "LIVE").spent_sol).toBe(0);
    expect(getBudget(store, "2026-08-25", "LIVE").trades).toBe(0);
  });

  it("does not let paper upserts fill the live ledger", () => {
    const store = openStore(tmpDb());
    const day = dayKey();
    upsertBudget(store, {
      day_key: day,
      mode: "PAPER",
      spent_sol: 0.5,
      trades: 5,
      realized_loss_sol: 0,
      last_entry_at: Date.now(),
      extra_budget_sol: 0,
    });
    expect(getBudget(store, day, "LIVE").spent_sol).toBe(0);
    expect(getBudget(store, day, "PAPER").spent_sol).toBeCloseTo(0.5);
  });

  it("0.5 paper spent still allows a 0.05 live buy under a 0.05 live daily cap", async () => {
    const store = openStore(tmpDb());
    const day = dayKey();
    const paperPolicy = { ...DEFAULT_POLICY, dailyBudgetSol: 0.5, maxSolPerTrade: 0.5 };
    const livePolicy = {
      ...DEFAULT_POLICY,
      dailyBudgetSol: 0.05,
      maxSolPerTrade: 0.05,
      sizeAskCeilingSol: 0.05,
    };
    const paperMsg = await tryEnter({
      store,
      policy: paperPolicy,
      flags: paperFlags,
      token: token({ ticker: "PAPERBAG" }),
      sources: [quietHit()],
      guardrails: [],
      dayKey: day,
      sol: 0.5,
    });
    expect(paperMsg).toMatch(/^bought #/);
    expect(paperMsg).toMatch(/PAPER/);
    expect(getBudget(store, day, "PAPER").spent_sol).toBeCloseTo(0.5);
    expect(getBudget(store, day, "LIVE").spent_sol).toBe(0);

    const liveMsg = await tryEnter({
      store,
      policy: livePolicy,
      flags: liveFlags,
      token: token({
        mint: "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump",
        ticker: "three",
      }),
      sources: [quietHit()],
      guardrails: [],
      dayKey: day,
      sol: 0.05,
      grokBotOrder: true,
      chiefApproved: true,
    });
    expect(liveMsg).not.toMatch(/daily budget exhausted/);
    expect(liveMsg).toMatch(/^bought #/);
    expect(liveMsg).toMatch(/0.05 SOL/);
    expect(liveMsg).not.toMatch(/PAPER/);
    expect(getBudget(store, day, "LIVE").spent_sol).toBeCloseTo(0.05);
    expect(getBudget(store, day, "PAPER").spent_sol).toBeCloseTo(0.5);
    const liveOpen = listOpenPositions(store, "LIVE");
    expect(liveOpen).toHaveLength(1);
    expect(liveOpen[0]!.mode).toBe("LIVE");
    expect(liveOpen[0]!.sol_spent).toBeCloseTo(0.05);
  });
});
