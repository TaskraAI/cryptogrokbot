import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "@night/shared";
import { insertOpportunity, markOpportunitySkipped, openStore } from "@night/storage";
import {
  chancesPayload,
  chiefChanceNotice,
  chiefChancePulse,
  missedGemLesson,
} from "../apps/agent/src/chances.ts";

function mem() {
  const dir = join(tmpdir(), `chances-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return openStore(join(dir, "t.db"));
}

describe("chief chances", () => {
  it("tells Grok to wait for Chief instead of skipping Taskra", () => {
    const text = chiefChanceNotice("opportunity #9 FONE: queued for Chief APPROVE then Grok Bot buy 0.05 SOL");
    expect(text).toMatch(/stay on the same page/);
    expect(text).toMatch(/cryptogrokbot\.com/);
    expect(text).toMatch(/wait for Chief APPROVE/);
    expect(text).not.toMatch(/Do not wait for Taskra/);
    expect(chiefChanceNotice("opportunity #9 FONE grade A: queued", { grade: "A" })).toMatch(
      /URGENT Grade A — Chief, tell Taskra right away/i,
    );
    expect(missedGemLesson({ ticker: "FONE", sentiment: 0.8, volume5m: 9000, multiple: 2.4 })).toMatch(
      /do not skip Taskra/i,
    );
  });

  it("puts open and recent chances on the same payload Chief and Grok read", () => {
    const db = mem();
    const open = insertOpportunity(db, {
      mint: "OpenMint11111111111111111111111111111111111",
      ticker: "OPEN",
      sentiment: 0.7,
      score: 60,
      volume5m: 2000,
      priceUsd: 0.001,
      costOutMultiple: 3,
      reason: "hype",
    });
    const skipped = insertOpportunity(db, {
      mint: "SkipMint11111111111111111111111111111111111",
      ticker: "SKIP",
      sentiment: 0.4,
      score: 40,
      volume5m: 1000,
      priceUsd: 0.002,
      costOutMultiple: 2,
      reason: "fade",
    });
    markOpportunitySkipped(db, skipped.id);
    const payload = chancesPayload(db, DEFAULT_POLICY);
    expect(payload.opportunities.map((o) => o.ticker)).toEqual(["OPEN"]);
    expect(payload.recentOpportunities.map((o) => o.ticker)).toEqual(["SKIP", "OPEN"]);
    expect(payload.opportunities[0]?.id).toBe(open.id);
    expect(chiefChancePulse(db, 3)).toMatch(/1 chance\(s\) on Home: OPEN/);
    expect(payload.opportunities[0]?.chiefMayApprove).toBe(true);
    expect(payload.opportunities[0]?.letter).toBe("C");
    expect(payload.mandate.chiefDeputy).toBe(true);
    expect(payload.mandate.pingTaskra).toMatch(/Grade A and B/);
  });
});
