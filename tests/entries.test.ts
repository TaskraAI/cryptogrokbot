import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, dayKey } from "@night/shared";
import { answerSizeAsk, getSizeAsk, latestOpenSizeAsk, listOpenPositions, listPendingSizeAsks, openStore } from "@night/storage";
import { scoreSentiment } from "@night/tape";
import { tryEnter } from "../apps/agent/src/entries.ts";
import { hit, quietHit, token } from "./fixtures.ts";

const paperFlags = {
  mode: "PAPER" as const,
  masterEnabled: false,
  rpcHealthy: true,
  jupiterHealthy: true,
  telegramHealthy: false,
};

const testPolicy = {
  ...DEFAULT_POLICY,
  maxSolPerTrade: 0.01,
  sizeAskCeilingSol: 0.05,
  dailyBudgetSol: 0.5,
};

function store() {
  const dir = join(tmpdir(), `ent-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return openStore(join(dir, "t.db"));
}

describe("paper entries", () => {
  it("records a paper buy when filters pass and sentiment is not high", async () => {
    const db = store();
    const msg = await tryEnter({
      store: db,
      policy: DEFAULT_POLICY,
      flags: paperFlags,
      token: token({ priceUsd: 0.002 }),
      sources: [quietHit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    expect(msg).toMatch(/^bought #/);
    expect(msg).toMatch(/PAPER/);
  });

  it("does not buy live without master even if the score passes", async () => {
    const db = store();
    const msg = await tryEnter({
      store: db,
      policy: DEFAULT_POLICY,
      flags: {
        mode: "LIVE",
        masterEnabled: false,
        rpcHealthy: true,
        jupiterHealthy: true,
        telegramHealthy: true,
      },
      token: token(),
      sources: [quietHit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    expect(msg).toMatch(/MASTER_ENABLED/);
  });

  it("lets an explicit Grok Bot live order past MASTER until wallet is missing", async () => {
    const db = store();
    const msg = await tryEnter({
      store: db,
      policy: DEFAULT_POLICY,
      flags: {
        mode: "LIVE",
        masterEnabled: false,
        rpcHealthy: true,
        jupiterHealthy: true,
        telegramHealthy: true,
      },
      token: token(),
      sources: [quietHit()],
      guardrails: [],
      dayKey: dayKey(),
      grokBotOrder: true,
    });
    expect(msg).not.toMatch(/MASTER_ENABLED is off/);
    expect(msg).toMatch(/WALLET_SECRET_KEY|wallet or RPC missing|buy failed/);
  });

  it("refuses a size above maxSolPerTrade instead of clipping", async () => {
    const db = store();
    const msg = await tryEnter({
      store: db,
      policy: DEFAULT_POLICY,
      flags: paperFlags,
      token: token(),
      sources: [hit()],
      guardrails: [],
      dayKey: dayKey(),
      sol: 9.9,
    });
    expect(msg).toMatch(/maxSolPerTrade/);
    expect(msg).not.toMatch(/^bought/);
  });
});

describe("high-sentiment size ask", () => {
  it("scores the default bullish fixture above the high-sentiment gate", () => {
    expect(scoreSentiment([hit()])).toBeGreaterThanOrEqual(testPolicy.highSentiment);
    expect(scoreSentiment([quietHit()])).toBeLessThan(testPolicy.highSentiment);
  });

  it("does not invest until Taskra answers the size ask", async () => {
    const db = store();
    const first = await tryEnter({
      store: db,
      policy: testPolicy,
      flags: paperFlags,
      token: token(),
      sources: [hit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    expect(first).toMatch(/^ask #/);
    expect(first).toMatch(/Keep 0.01 SOL or increase up to 0.05/);
    expect(listOpenPositions(db)).toHaveLength(0);
    const pending = listPendingSizeAsks(db);
    expect(pending).toHaveLength(1);
    const second = await tryEnter({
      store: db,
      policy: testPolicy,
      flags: paperFlags,
      token: token(),
      sources: [hit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    expect(second).toMatch(new RegExp(`^ask #${pending[0]!.id}`));
    expect(listPendingSizeAsks(db)).toHaveLength(1);
  });

  it("buys the test ticket after keep", async () => {
    const db = store();
    await tryEnter({
      store: db,
      policy: testPolicy,
      flags: paperFlags,
      token: token(),
      sources: [hit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    const ask = latestOpenSizeAsk(db, token().mint)!;
    answerSizeAsk(db, ask.id, { status: "keep", chosenSol: 0.01 });
    const msg = await tryEnter({
      store: db,
      policy: testPolicy,
      flags: paperFlags,
      token: token(),
      sources: [hit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    expect(msg).toMatch(/^bought #/);
    expect(msg).toMatch(/0.01 SOL/);
    expect(getSizeAsk(db, ask.id)?.status).toBe("filled");
  });

  it("buys a one-shot increase up to the ceiling, never 0.1", async () => {
    const db = store();
    await tryEnter({
      store: db,
      policy: testPolicy,
      flags: paperFlags,
      token: token(),
      sources: [hit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    const ask = latestOpenSizeAsk(db, token().mint)!;
    answerSizeAsk(db, ask.id, { status: "increase", chosenSol: 0.1 });
    const msg = await tryEnter({
      store: db,
      policy: testPolicy,
      flags: paperFlags,
      token: token(),
      sources: [hit()],
      guardrails: [],
      dayKey: dayKey(),
      sizeAskId: ask.id,
    });
    expect(msg).toMatch(/^bought #/);
    expect(msg).toMatch(/0.05 SOL/);
    expect(msg).not.toMatch(/0.1 SOL/);
  });

  it("still auto-enters at test size when sentiment is not high", async () => {
    const db = store();
    const msg = await tryEnter({
      store: db,
      policy: testPolicy,
      flags: paperFlags,
      token: token(),
      sources: [quietHit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    expect(msg).toMatch(/^bought #/);
    expect(msg).toMatch(/0.01 SOL/);
    expect(listPendingSizeAsks(db)).toHaveLength(0);
  });
});

describe("lessons file", () => {
  it("appends a lesson", async () => {
    const { appendLesson, loadLessons } = await import("@night/learning");
    const path = join(tmpdir(), `les-${Date.now()}.md`);
    writeFileSync(path, "# Lessons\n");
    appendLesson(path, "skip dex boost only");
    expect(loadLessons(path)).toMatch(/skip dex boost only/);
  });
});
