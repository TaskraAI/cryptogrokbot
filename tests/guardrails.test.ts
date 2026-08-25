import { describe, expect, it } from "vitest";
import { addGuardrail, matchGuardrail, parseNeverRule } from "@night/risk";
import { tmpYaml } from "./fixtures.ts";

describe("guardrails", () => {
  it("parses /never forms", () => {
    expect(parseNeverRule("source:@foo")).toEqual({ type: "source", value: "@foo" });
    expect(parseNeverRule("creator_pct>8")).toEqual({ type: "creator_pct", value: "8" });
    expect(parseNeverRule("keyword:migration scam")).toEqual({ type: "keyword", value: "migration scam" });
    expect(parseNeverRule("@bar")).toEqual({ type: "source", value: "@bar" });
  });

  it("matches mint, keyword, creator, and source rules", () => {
    const rules = [
      { id: "1", type: "mint" as const, value: "abc", origin: "manual" as const, createdAt: 1 },
      { id: "2", type: "keyword" as const, value: "honeypot", origin: "manual" as const, createdAt: 1 },
      { id: "3", type: "creator_pct" as const, value: "8", origin: "manual" as const, createdAt: 1 },
      { id: "4", type: "source" as const, value: "@shady", origin: "manual" as const, createdAt: 1 },
    ];
    expect(matchGuardrail(rules, { mint: "abc" })?.id).toBe("1");
    expect(matchGuardrail(rules, { text: "this is a honeypot" })?.id).toBe("2");
    expect(matchGuardrail(rules, { creatorPct: 12 })?.id).toBe("3");
    expect(
      matchGuardrail(rules, {
        sources: [{ platform: "x", key: "@shady", weight: "watch", snippet: "x", at: 1 }],
      })?.id,
    ).toBe("4");
  });

  it("persists a new /never rule to yaml", () => {
    const path = tmpYaml("rules: []\n");
    const rule = addGuardrail(path, { type: "keyword", value: "scam", origin: "manual" });
    expect(rule.value).toBe("scam");
    const again = addGuardrail(path, { type: "source", value: "@x", origin: "learned" });
    expect(again.origin).toBe("learned");
  });
});
