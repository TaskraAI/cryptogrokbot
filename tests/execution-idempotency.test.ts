import { describe, expect, it } from "vitest";
import {
  executeApprovedTrade,
  makeIdempotencyKey,
  MemoryOrderRegistry,
  refuseOversizeBuy,
  riskAllowsExecution,
} from "@night/execution";

const decision = {
  id: 1,
  token: "rd_test_token",
  decision: "APPROVE" as const,
  mint: "Mint111111111111111111111111111111111111111",
  side: "buy",
  sizeSol: 0.1,
  expiresAt: Date.now() + 60_000,
};

describe("executeApprovedTrade gate + idempotency", () => {
  it("refuses anything that is not APPROVE / APPROVE_REDUCED_SIZE", async () => {
    expect(riskAllowsExecution("REJECT")).toBe(false);
    expect(riskAllowsExecution("HALT_TRADING")).toBe(false);
    expect(riskAllowsExecution("APPROVE")).toBe(true);
    expect(riskAllowsExecution("APPROVE_REDUCED_SIZE")).toBe(true);
    const r = await executeApprovedTrade({
      decision: { ...decision, decision: "REJECT" },
      presentedToken: decision.token,
      mint: decision.mint,
      side: "buy",
      sizeSol: 0.1,
      clientOrderId: "c1",
      registry: new MemoryOrderRegistry(),
      maxSolPerTrade: 0.1,
      mode: "PAPER",
      submit: async () => ({ paper: true, sol: 0.1, tokens: 1 }),
    });
    expect(r.error).toMatch(/not executable/);
    expect(r.sol).toBe(0);
  });

  it("refuses oversize at the execution boundary and does not clip", async () => {
    expect(refuseOversizeBuy(9.9, 0.1)).toMatch(/maxSolPerTrade/);
    let submits = 0;
    const r = await executeApprovedTrade({
      decision: { ...decision, sizeSol: 9.9, decision: "APPROVE" },
      presentedToken: decision.token,
      mint: decision.mint,
      side: "buy",
      sizeSol: 9.9,
      clientOrderId: "oversize",
      registry: new MemoryOrderRegistry(),
      maxSolPerTrade: 0.1,
      mode: "PAPER",
      submit: async () => {
        submits += 1;
        return { paper: true, sol: 9.9, tokens: 1 };
      },
    });
    expect(submits).toBe(0);
    expect(r.sol).toBe(0);
    expect(r.error).toMatch(/maxSolPerTrade/);
  });

  it("does not send a second tx for the same mint+side+clientOrderId", async () => {
    const registry = new MemoryOrderRegistry();
    let submits = 0;
    const submit = async () => {
      submits += 1;
      return { paper: true, sol: 0.1, tokens: 100, signature: "sig-1" };
    };
    const first = await executeApprovedTrade({
      decision,
      presentedToken: decision.token,
      mint: decision.mint,
      side: "buy",
      sizeSol: 0.1,
      clientOrderId: "same-key",
      registry,
      maxSolPerTrade: 0.1,
      mode: "PAPER",
      submit,
    });
    const second = await executeApprovedTrade({
      decision: { ...decision, consumed: true },
      presentedToken: decision.token,
      mint: decision.mint,
      side: "buy",
      sizeSol: 0.1,
      clientOrderId: "same-key",
      registry,
      maxSolPerTrade: 0.1,
      mode: "PAPER",
      submit,
    });
    expect(first.duplicate).toBeFalsy();
    expect(first.signature).toBe("sig-1");
    expect(second.duplicate).toBe(true);
    expect(second.signature).toBe("sig-1");
    expect(second.sol).toBe(0.1);
    expect(submits).toBe(1);
    expect(makeIdempotencyKey(decision.mint, "buy", "same-key")).toBe(`${decision.mint}:buy:same-key`);
  });

  it("refuses a missing or mismatched Risk token before submit", async () => {
    let submits = 0;
    const r = await executeApprovedTrade({
      decision,
      presentedToken: "wrong",
      mint: decision.mint,
      side: "buy",
      sizeSol: 0.1,
      clientOrderId: "tok",
      registry: new MemoryOrderRegistry(),
      maxSolPerTrade: 0.1,
      mode: "PAPER",
      submit: async () => {
        submits += 1;
        return { paper: true, sol: 0.1, tokens: 1 };
      },
    });
    expect(submits).toBe(0);
    expect(r.error).toMatch(/token mismatch/);
  });
});
