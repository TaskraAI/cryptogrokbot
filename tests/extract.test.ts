import { describe, expect, it } from "vitest";
import { dedupeHits, extractMints, isMuted } from "@night/social";
import { hit } from "./fixtures.ts";

describe("extractMints", () => {
  it("pulls base58 contract addresses out of a tweet", () => {
    const text = "buy this 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU now";
    const mints = extractMints(text);
    expect(mints).toContain("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
  });

  it("ignores short junk", () => {
    expect(extractMints("hi $PEPE moon")).toEqual([]);
  });
});

describe("mute and dedupe", () => {
  it("mutes by mint, handle, and keyword", () => {
    const mute = [
      { type: "mint", value: "abc" },
      { type: "handle", value: "@spam" },
      { type: "keyword", value: "tax" },
    ];
    expect(isMuted(mute, { mint: "abc" })).toBe(true);
    expect(isMuted(mute, { key: "@spam", snippet: "hi" })).toBe(true);
    expect(isMuted(mute, { snippet: "1% tax coin" })).toBe(true);
    expect(isMuted(mute, { mint: "zzz", snippet: "bullish" })).toBe(false);
  });

  it("dedupes the same mint inside the 30m window", () => {
    const now = Date.now();
    const hits = dedupeHits([
      hit({ mint: "AAA", weight: "watch", at: now, key: "@a" }),
      hit({ mint: "AAA", weight: "trusted", at: now + 1000, key: "@b" }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].weight).toBe("trusted");
  });
});
