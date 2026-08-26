import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, dayKey } from "@night/shared";
import { listFills, listOpenPositions, openStore, setFlag, getFlag } from "@night/storage";
import { executeBuy, executeSell, refuseOversizeBuy } from "@night/execution";
import { buyChosenMint, sellChosen, statusReport } from "../apps/agent/src/trade.ts";
import { applyMasterBootPolicy } from "../apps/agent/src/master-flag.ts";
import { loadAppConfig } from "../apps/agent/src/config.ts";
import { AgentRuntime } from "../apps/agent/src/loop.ts";
import { token } from "./fixtures.ts";

function mem() {
  const dir = join(tmpdir(), `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return openStore(join(dir, "t.db"));
}

const paperFlags = {
  mode: "PAPER" as const,
  masterEnabled: false,
  rpcHealthy: true,
  jupiterHealthy: true,
  telegramHealthy: false,
};

describe("paper buy and sell path", () => {
  it("buys a user-chosen mint in paper and sells it closed", async () => {
    const store = mem();
    const t = token({ mint: "UserChosenMint11111111111111111111111111111", ticker: "CHOOSE" });
    const buy = await buyChosenMint({
      store,
      policy: DEFAULT_POLICY,
      flags: paperFlags,
      mint: t.mint,
      token: t,
      sol: 0.05,
      dayKey: dayKey(),
    });
    expect(buy.ok).toBe(true);
    expect(buy.message).toMatch(/PAPER/);
    const open = listOpenPositions(store);
    expect(open).toHaveLength(1);
    expect(open[0]!.sol_spent).toBe(0.05);
    const fills = listFills(store, open[0]!.id);
    expect(fills.some((f) => f.side === "buy" && f.paper === 1)).toBe(true);

    const sell = await sellChosen({
      store,
      policy: DEFAULT_POLICY,
      idOrMint: String(open[0]!.id),
      priceUsd: t.priceUsd,
    });
    expect(sell.ok).toBe(true);
    expect(sell.message).toMatch(/closed/);
    expect(listOpenPositions(store)).toHaveLength(0);
    expect(listFills(store, open[0]!.id).some((f) => f.side === "sell" && f.paper === 1)).toBe(true);
  });

  it("sells by mint as well as by id", async () => {
    const store = mem();
    const t = token({ mint: "SellByMint111111111111111111111111111111111", ticker: "SBM" });
    await buyChosenMint({
      store,
      policy: DEFAULT_POLICY,
      flags: paperFlags,
      mint: t.mint,
      token: t,
      dayKey: dayKey(),
    });
    const sell = await sellChosen({ store, policy: DEFAULT_POLICY, idOrMint: t.mint, priceUsd: t.priceUsd });
    expect(sell.ok).toBe(true);
    expect(listOpenPositions(store)).toHaveLength(0);
  });
});

describe("live fail-closed", () => {
  it("executeBuy LIVE without a wallet does not invent a signature", async () => {
    const r = await executeBuy({
      mode: "LIVE",
      graduated: true,
      mint: token().mint,
      sol: 0.1,
      slippagePct: 15,
      masterEnabled: true,
      maxSolPerTrade: 0.1,
    });
    expect(r.paper).toBe(false);
    expect(r.signature).toBeUndefined();
    expect(r.error).toMatch(/wallet or RPC missing|WALLET_SECRET_KEY/);
  });

  it("executeSell LIVE without a wallet does not invent a signature", async () => {
    const r = await executeSell({
      mode: "LIVE",
      graduated: true,
      mint: token().mint,
      tokens: 1000,
      slippagePct: 15,
      solEstimate: 0.1,
      masterEnabled: true,
    });
    expect(r.signature).toBeUndefined();
    expect(r.error).toMatch(/wallet or RPC missing|WALLET_SECRET_KEY/);
  });

  it("executeBuy refuses oversize even in paper and does not clip", async () => {
    expect(refuseOversizeBuy(9.9, 0.1)).toMatch(/maxSolPerTrade/);
    const r = await executeBuy({
      mode: "PAPER",
      graduated: true,
      mint: token().mint,
      sol: 9.9,
      slippagePct: 15,
      maxSolPerTrade: 0.1,
    });
    expect(r.sol).toBe(0);
    expect(r.tokens).toBe(0);
    expect(r.signature).toBeUndefined();
    expect(r.error).toMatch(/maxSolPerTrade/);
  });

  it("executeBuy LIVE with grokBotOrder skips MASTER but still needs a wallet", async () => {
    const r = await executeBuy({
      mode: "LIVE",
      graduated: true,
      mint: token().mint,
      sol: 0.1,
      slippagePct: 15,
      masterEnabled: false,
      grokBotOrder: true,
      maxSolPerTrade: 0.1,
    });
    expect(r.signature).toBeUndefined();
    expect(r.error).not.toMatch(/MASTER_ENABLED/);
    expect(r.error).toMatch(/WALLET_SECRET_KEY|wallet or RPC missing/);
  });

  it("executeSell LIVE with grokBotOrder skips MASTER but still needs a wallet", async () => {
    const r = await executeSell({
      mode: "LIVE",
      graduated: true,
      mint: token().mint,
      tokens: 1000,
      slippagePct: 15,
      solEstimate: 0.1,
      masterEnabled: false,
      grokBotOrder: true,
    });
    expect(r.signature).toBeUndefined();
    expect(r.error).not.toMatch(/MASTER_ENABLED/);
    expect(r.error).toMatch(/WALLET_SECRET_KEY|wallet or RPC missing/);
  });

  it("executeBuy LIVE without MASTER does not send a tx", async () => {
    const r = await executeBuy({
      mode: "LIVE",
      graduated: true,
      mint: token().mint,
      sol: 0.1,
      slippagePct: 15,
      masterEnabled: false,
      maxSolPerTrade: 0.1,
    });
    expect(r.signature).toBeUndefined();
    expect(r.error).toMatch(/MASTER_ENABLED/);
  });

  it("executeSell LIVE without MASTER does not send a tx", async () => {
    const r = await executeSell({
      mode: "LIVE",
      graduated: true,
      mint: token().mint,
      tokens: 1000,
      slippagePct: 15,
      solEstimate: 0.1,
      masterEnabled: false,
    });
    expect(r.signature).toBeUndefined();
    expect(r.error).toMatch(/MASTER_ENABLED/);
  });

  it("buyChosenMint LIVE without MASTER refuses before spending", async () => {
    const store = mem();
    const t = token();
    const r = await buyChosenMint({
      store,
      policy: DEFAULT_POLICY,
      flags: { ...paperFlags, mode: "LIVE", masterEnabled: false },
      mint: t.mint,
      token: t,
      dayKey: dayKey(),
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/MASTER_ENABLED/);
    expect(listOpenPositions(store)).toHaveLength(0);
  });

  it("buyChosenMint LIVE grokBotOrder skips MASTER then refuses missing wallet", async () => {
    const store = mem();
    const t = token();
    const r = await buyChosenMint({
      store,
      policy: DEFAULT_POLICY,
      flags: { ...paperFlags, mode: "LIVE", masterEnabled: false },
      mint: t.mint,
      token: t,
      dayKey: dayKey(),
      grokBotOrder: true,
    });
    expect(r.ok).toBe(false);
    expect(r.message).not.toMatch(/MASTER_ENABLED/);
    expect(r.message).toMatch(/WALLET_SECRET_KEY/);
    expect(listOpenPositions(store)).toHaveLength(0);
  });

  it("buyChosenMint LIVE with MASTER but no keypair refuses", async () => {
    const store = mem();
    const t = token();
    const r = await buyChosenMint({
      store,
      policy: DEFAULT_POLICY,
      flags: { ...paperFlags, mode: "LIVE", masterEnabled: true },
      mint: t.mint,
      token: t,
      dayKey: dayKey(),
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/WALLET_SECRET_KEY/);
    expect(listOpenPositions(store)).toHaveLength(0);
  });

  it("sellChosen LIVE without MASTER refuses and leaves the paper bag open", async () => {
    const store = mem();
    const t = token({ mint: "LiveSellGate1111111111111111111111111111111", ticker: "LSG" });
    const buy = await buyChosenMint({
      store,
      policy: DEFAULT_POLICY,
      flags: paperFlags,
      mint: t.mint,
      token: t,
      dayKey: dayKey(),
    });
    expect(buy.ok).toBe(true);
    const r = await sellChosen({
      store,
      policy: DEFAULT_POLICY,
      idOrMint: t.mint,
      priceUsd: t.priceUsd,
      flags: { ...paperFlags, mode: "LIVE", masterEnabled: false },
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/MASTER_ENABLED/);
    expect(listOpenPositions(store)).toHaveLength(1);
  });

  it("DB master cannot flip MODE from PAPER to LIVE", () => {
    const store = mem();
    setFlag(store, "master", "true");
    const runtime = new AgentRuntime(
      loadAppConfig({ MODE: "PAPER", MASTER_ENABLED: "false" } as NodeJS.ProcessEnv),
      DEFAULT_POLICY,
      store,
    );
    const f = runtime.currentFlags();
    expect(f.mode).toBe("PAPER");
    expect(f.masterEnabled).toBe(true);
  });

  it("env MASTER false kills sqlite master on boot policy", () => {
    const store = mem();
    setFlag(store, "master", "true");
    applyMasterBootPolicy(store, false);
    expect(getFlag(store, "master")).toBe("false");
  });

  it("env MASTER true does not revive a killed sqlite master", () => {
    const store = mem();
    setFlag(store, "master", "false");
    applyMasterBootPolicy(store, true);
    expect(getFlag(store, "master")).toBe("false");
  });

  it("env MASTER true seeds sqlite when the flag is missing", () => {
    const store = mem();
    applyMasterBootPolicy(store, true);
    expect(getFlag(store, "master")).toBe("true");
  });

  it("status names the live opt-in flags", () => {
    const store = mem();
    const text = statusReport({
      flags: paperFlags,
      policy: DEFAULT_POLICY,
      store,
      tz: "UTC",
    });
    expect(text).toMatch(/MODE=LIVE/);
    expect(text).toMatch(/MASTER_ENABLED=true/);
    expect(text).toMatch(/Grok Bot Bearer/);
  });
});
