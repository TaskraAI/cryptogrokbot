import { describe, expect, it } from "vitest";
import { buildSnapshot, scoreSentiment } from "@night/tape";
import { hit, position } from "./fixtures.ts";

describe("tape", () => {
  it("computes pct from entry and peak plus sentiment from trusted hits", () => {
    const pos = position({ entryPriceUsd: 1, peakPriceUsd: 2 });
    const snap = buildSnapshot({
      position: pos,
      market: {
        priceUsd: 1.6,
        marketCapUsd: 90_000,
        volume5m: 3000,
        volume1h: 20_000,
        liquidityUsd: 12_000,
        volumeBaseline5m: 2500,
      },
      social: {
        hits: [
          hit({ snippet: "still bullish accumulate", weight: "trusted" }),
          hit({ snippet: "looks dead dump", weight: "watch", key: "@fud" }),
        ],
      },
    });
    expect(snap.pctFromEntry).toBeCloseTo(60);
    expect(snap.pctFromPeak).toBeCloseTo(-20);
    expect(snap.uniqueRecentSources).toBeGreaterThanOrEqual(2);
    expect(snap.sentiment).toBeGreaterThan(-1);
  });

  it("scores clearly bullish text above clearly bearish text", () => {
    const bull = scoreSentiment([hit({ snippet: "moon send buy gem" })]);
    const bear = scoreSentiment([hit({ snippet: "rug scam dump honeypot" })]);
    expect(bull).toBeGreaterThan(bear);
  });
});
