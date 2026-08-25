import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insertPosition, listAllClosed, openStore, updatePosition } from "@night/storage";
import { buildReview, tagMistake } from "@night/learning";

describe("review + mistakes", () => {
  it("tags sold-a-bounce and fake-sentiment dump", () => {
    expect(
      tagMistake({
        exitReason: "fade",
        lastPattern: "healthy_dip",
        postExitPctChange: 20,
        netSol: 0.01,
      }),
    ).toBe("sold_dip_that_bounced");
    expect(
      tagMistake({
        exitReason: "hard_stop",
        lastPattern: "healthy_dip",
        postExitPctChange: -40,
        netSol: -0.08,
      }),
    ).toBe("held_fake_sentiment_dump");
  });

  it("rolls paper vs live performance", () => {
    const dir = join(tmpdir(), `rev-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const store = openStore(join(dir, "t.db"));
    const id = insertPosition(store, {
      mint: "mint1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      ticker: "AAA",
      mode: "PAPER",
      openedAt: Date.now() - 1000,
      entryPriceUsd: 1,
      principalSol: 0.1,
      tokensHeld: 0,
      solSpent: 0.1,
      sourcesJson: JSON.stringify([{ key: "@alpha" }]),
      entryMetricsJson: "{}",
    });
    updatePosition(store, id, {
      status: "closed",
      closed_at: Date.now(),
      net_sol: 0.05,
      principal_recovered_sol: 0.1,
      runner_pnl_sol: 0.05,
      last_pattern: "fade",
      exit_reason: "fade",
      tokens_held: 0,
    });
    const report = buildReview(store, "all");
    expect(report.paper.trades).toBe(1);
    expect(report.paper.netSol).toBeCloseTo(0.05);
    expect(report.paper.winRate).toBe(1);
    expect(report.live.trades).toBe(0);
    expect(listAllClosed(store)).toHaveLength(1);
  });
});
