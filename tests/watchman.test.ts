import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY } from "@night/shared";
import { getPosition, insertPosition, openStore } from "@night/storage";
import { managePosition, rowToPosition } from "../apps/agent/src/watchman.ts";
import { snap } from "./fixtures.ts";

function memStore() {
  const dir = join(tmpdir(), `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return openStore(join(dir, "t.db"));
}

describe("watchman paper lifecycle", () => {
  it("paper-sells a hard stop and journals the close", async () => {
    const store = memStore();
    const id = insertPosition(store, {
      mint: "mintStopxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      ticker: "STP",
      mode: "PAPER",
      openedAt: Date.now() - 5_000,
      entryPriceUsd: 1,
      principalSol: 0.1,
      tokensHeld: 100_000,
      solSpent: 0.1,
      sourcesJson: "[]",
      entryMetricsJson: "{}",
    });
    const row = getPosition(store, id)!;
    const msg = await managePosition({
      store,
      row,
      snap: snap({ priceUsd: 0.7, pctFromEntry: -30, pctFromPeak: -30 }),
      policy: DEFAULT_POLICY,
    });
    expect(msg).toMatch(/closed/);
    expect(getPosition(store, id)?.status).toBe("closed");
    expect(getPosition(store, id)?.exit_reason).toBe("hard_stop");
  });

  it("sells only a slice to return principal and leaves a runner", async () => {
    const store = memStore();
    const id = insertPosition(store, {
      mint: "mintRunxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      ticker: "RUN",
      mode: "PAPER",
      openedAt: Date.now() - 5_000,
      entryPriceUsd: 1,
      principalSol: 0.1,
      tokensHeld: 100_000,
      solSpent: 0.1,
      sourcesJson: "[]",
      entryMetricsJson: "{}",
    });
    const row = getPosition(store, id)!;
    const msg = await managePosition({
      store,
      row,
      snap: snap({
        priceUsd: 2.6,
        pctFromEntry: 160,
        pctFromPeak: 0,
        marketCapUsd: 200_000,
        sentiment: 0.1,
      }),
      policy: DEFAULT_POLICY,
    });
    expect(msg).toMatch(/returned principal/);
    const after = getPosition(store, id)!;
    expect(after.status).toBe("open");
    expect(after.principal_recovered_sol).toBeGreaterThan(0);
    expect(after.tokens_held).toBeLessThan(100_000);
    expect(after.tokens_held).toBeGreaterThan(0);
    expect(rowToPosition(after).principalSol).toBe(0.1);
  });

  it("holds a healthy dip on the runner", async () => {
    const store = memStore();
    const id = insertPosition(store, {
      mint: "mintDipxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      ticker: "DIP",
      mode: "PAPER",
      openedAt: Date.now() - 5_000,
      entryPriceUsd: 1,
      principalSol: 0.1,
      tokensHeld: 40_000,
      solSpent: 0.1,
      sourcesJson: "[]",
      entryMetricsJson: "{}",
    });
    store.db.prepare("UPDATE positions SET principal_recovered_sol = 0.1, runner = 1, ever_green = 1, peak_price_usd = 3 WHERE id = ?").run(id);
    const row = getPosition(store, id)!;
    const msg = await managePosition({
      store,
      row,
      snap: snap({
        priceUsd: 2.4,
        pctFromEntry: 140,
        pctFromPeak: -20,
        sentiment: 0.7,
        mentionVelocity: 6,
        mentionVelocityBaseline: 3,
        volume5m: 5000,
        volumeBaseline5m: 4000,
        buySellRatio: 0.62,
        trustedSourcesStillPosting: 2,
        uniqueRecentSources: 2,
      }),
      policy: DEFAULT_POLICY,
    });
    expect(msg).toMatch(/healthy_dip/);
    expect(getPosition(store, id)?.status).toBe("open");
  });
});
