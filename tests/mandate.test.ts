import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "@night/shared";
import { insertOpportunity, listOpenOpportunities, openStore } from "@night/storage";
import {
  GROKBOT_IMPERSONATOR,
  classifyChance,
  deputyChief,
  standingIntent,
} from "../apps/agent/src/mandate.ts";

function mem() {
  const dir = join(tmpdir(), `mandate-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return openStore(join(dir, "t.db"));
}

describe("chief deputy mandate", () => {
  it("lets Chief approve a routine queued gem and skips the impersonator", () => {
    const routine = classifyChance({
      mint: "RoutineMint1111111111111111111111111111111",
      policy: DEFAULT_POLICY,
    });
    expect(routine.action).toBe("approve");
    expect(routine.chiefMayApprove).toBe(true);
    expect(routine.needsTaskra).toBe(false);

    const muted = classifyChance({ mint: GROKBOT_IMPERSONATOR, policy: DEFAULT_POLICY });
    expect(muted.action).toBe("skip");
    expect(muted.chiefMayApprove).toBe(false);

    const major = classifyChance({
      mint: "AddMint11111111111111111111111111111111111",
      policy: DEFAULT_POLICY,
      add: true,
      sol: 0.2,
    });
    expect(major.action).toBe("escalate");
    expect(major.needsTaskra).toBe(true);
    expect(standingIntent(DEFAULT_POLICY).escalate.join(" ")).toMatch(/Add-on/);
    expect(standingIntent(DEFAULT_POLICY).pingTaskra).toMatch(/Taskra right away/);
    expect(standingIntent(DEFAULT_POLICY).sizeSol).toBe(0.1);
  });

  it("deputy-approves open routine chances and records approved_by=chief", () => {
    const db = mem();
    insertOpportunity(db, {
      mint: "DeputyMint11111111111111111111111111111111",
      ticker: "DEP",
      sentiment: 0.8,
      score: 70,
      volume5m: 4000,
      priceUsd: 0.001,
      costOutMultiple: 3,
      reason: "hype",
    });
    insertOpportunity(db, {
      mint: GROKBOT_IMPERSONATOR,
      ticker: "FAKE",
      sentiment: 0.9,
      score: 80,
      volume5m: 9000,
      priceUsd: 0.01,
      costOutMultiple: 3,
      reason: "impersonator",
    });
    const logs = deputyChief(db, DEFAULT_POLICY);
    expect(logs.join("\n")).toMatch(/chief-deputy approved #\d+ DEP/);
    expect(logs.join("\n")).toMatch(/chief-deputy skipped #\d+ FAKE/);
    const open = listOpenOpportunities(db);
    expect(open).toHaveLength(1);
    expect(open[0]?.ticker).toBe("DEP");
    expect(open[0]?.chief_approved).toBe(1);
    expect(open[0]?.approved_by).toBe("chief");
  });
});
