import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, dayKey } from "@night/shared";
import { listOpenPositions, listPendingSizeAsks, listOpenOpportunities, openStore } from "@night/storage";
import { scoreSentiment } from "@night/tape";
import { parseChiefApprove, tryEnter } from "../apps/agent/src/entries.ts";
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

  it("lets an explicit Grok Bot live order past MASTER when Chief APPROVE is set", async () => {
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
      chiefApproved: true,
    });
    expect(msg).not.toMatch(/MASTER_ENABLED is off/);
    expect(msg).not.toMatch(/needs Chief permission/);
    expect(msg).not.toMatch(/^bought/);
    expect(msg).toMatch(/honeypot|WALLET_SECRET_KEY|wallet or RPC missing|buy failed/);
  });

  it("blocks a Grok Bot live order without Chief APPROVE", async () => {
    const db = store();
    const msg = await tryEnter({
      store: db,
      policy: DEFAULT_POLICY,
      flags: {
        mode: "LIVE",
        masterEnabled: true,
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
    expect(msg).toMatch(/needs Chief permission/);
    expect(listOpenPositions(db)).toHaveLength(0);
  });

  it("does not treat CONFIRM as Chief APPROVE", () => {
    expect(parseChiefApprove("CONFIRM")).toBe(false);
    expect(parseChiefApprove({ chief: "CONFIRM" })).toBe(false);
    expect(parseChiefApprove({ chief: "APPROVE" })).toBe(true);
    expect(parseChiefApprove({ chiefApprove: true })).toBe(true);
    expect(parseChiefApprove("APPROVE")).toBe(true);
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

describe("high-sentiment auto-buy", () => {
  it("scores the default bullish fixture above the high-sentiment gate", () => {
    expect(scoreSentiment([hit()])).toBeGreaterThanOrEqual(testPolicy.highSentiment);
    expect(scoreSentiment([quietHit()])).toBeLessThan(testPolicy.highSentiment);
  });

  it("buys hype+volume immediately instead of asking Taskra", async () => {
    const db = store();
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
    expect(listOpenPositions(db)).toHaveLength(1);
    expect(listOpenPositions(db)[0]?.cost_out_multiple).toBeGreaterThanOrEqual(2);
    expect(listPendingSizeAsks(db)).toHaveLength(0);
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

  it("queues a Grok Bot opportunity when auto live is MASTER-blocked", async () => {
    const db = store();
    const { listOpenOpportunities } = await import("@night/storage");
    const msg = await tryEnter({
      store: db,
      policy: testPolicy,
      flags: {
        mode: "LIVE",
        masterEnabled: false,
        rpcHealthy: true,
        jupiterHealthy: true,
        telegramHealthy: true,
      },
      token: token(),
      sources: [hit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    expect(msg).toMatch(/^opportunity #/);
    expect(msg).toMatch(/Chief APPROVE/);
    expect(listOpenPositions(db)).toHaveLength(0);
    expect(listOpenOpportunities(db)).toHaveLength(1);
    expect(listOpenOpportunities(db)[0]?.ticker).toBe("MEME");
  });

  it("queues a Grok Bot opportunity when MASTER is on but Scout has no Chief APPROVE", async () => {
    const db = store();
    const msg = await tryEnter({
      store: db,
      policy: testPolicy,
      flags: {
        mode: "LIVE",
        masterEnabled: true,
        rpcHealthy: true,
        jupiterHealthy: true,
        telegramHealthy: true,
      },
      token: token(),
      sources: [hit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    expect(msg).toMatch(/^opportunity #/);
    expect(msg).toMatch(/Scout never live-buys/);
    expect(listOpenPositions(db)).toHaveLength(0);
    expect(listOpenOpportunities(db)).toHaveLength(1);
    expect(listOpenOpportunities(db)[0]?.chief_approved).toBe(0);
  });

  it("fills an explicit keep size-ask when Grok Bot passes sizeAskId", async () => {
    const db = store();
    const { insertSizeAsk, answerSizeAsk, getSizeAsk } = await import("@night/storage");
    const ask = insertSizeAsk(db, {
      mint: token().mint,
      ticker: token().ticker,
      sentiment: 0.77,
      testSol: 0.01,
      note: "legacy",
    });
    answerSizeAsk(db, ask.id, { status: "keep", chosenSol: 0.01 });
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
    expect(msg).toMatch(/0.01 SOL/);
    expect(getSizeAsk(db, ask.id)?.status).toBe("filled");
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
