import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, dayKey } from "@night/shared";
import { openStore } from "@night/storage";
import { tryEnter } from "../apps/agent/src/entries.ts";
import { hit, token } from "./fixtures.ts";

describe("paper entries", () => {
  it("records a paper buy when filters pass", async () => {
    const dir = join(tmpdir(), `ent-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const store = openStore(join(dir, "t.db"));
    const msg = await tryEnter({
      store,
      policy: DEFAULT_POLICY,
      flags: {
        mode: "PAPER",
        masterEnabled: false,
        rpcHealthy: true,
        jupiterHealthy: true,
        telegramHealthy: false,
      },
      token: token({ priceUsd: 0.002 }),
      sources: [hit()],
      guardrails: [],
      dayKey: dayKey(),
    });
    expect(msg).toMatch(/^bought #/);
    expect(msg).toMatch(/PAPER/);
  });

  it("does not buy live without master even if the score passes", async () => {
    const dir = join(tmpdir(), `ent2-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const store = openStore(join(dir, "t.db"));
    const msg = await tryEnter({
      store,
      policy: DEFAULT_POLICY,
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
    expect(msg).toMatch(/MASTER_ENABLED/);
  });

  it("refuses a size above maxSolPerTrade instead of clipping", async () => {
    const dir = join(tmpdir(), `ent3-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const store = openStore(join(dir, "t.db"));
    const msg = await tryEnter({
      store,
      policy: DEFAULT_POLICY,
      flags: {
        mode: "PAPER",
        masterEnabled: false,
        rpcHealthy: true,
        jupiterHealthy: true,
        telegramHealthy: false,
      },
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

describe("lessons file", () => {
  it("appends a lesson", async () => {
    const { appendLesson, loadLessons } = await import("@night/learning");
    const path = join(tmpdir(), `les-${Date.now()}.md`);
    writeFileSync(path, "# Lessons\n");
    appendLesson(path, "skip dex boost only");
    expect(loadLessons(path)).toMatch(/skip dex boost only/);
  });
});
