import { describe, expect, it } from "vitest";
import { scoreCandidate } from "@night/risk";
import { hit, policy, token } from "./fixtures.ts";

describe("scoreCandidate", () => {
  it("passes a clean token with a trusted source", () => {
    const r = scoreCandidate({
      token: token(),
      sources: [hit()],
      guardrails: [],
      policy,
    });
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(policy.minScore);
  });

  it("blocks honeypots", () => {
    const r = scoreCandidate({
      token: token({ sellSimOk: false }),
      sources: [hit()],
      guardrails: [],
      policy,
    });
    expect(r.passed).toBe(false);
    expect(r.blockedReason).toMatch(/honeypot/);
  });

  it("blocks freeze authority still active", () => {
    const r = scoreCandidate({
      token: token({ freezeAuthorityRevoked: false }),
      sources: [hit()],
      guardrails: [],
      policy,
    });
    expect(r.passed).toBe(false);
    expect(r.blockedReason).toMatch(/freeze/);
  });

  it("blocks high creator supply", () => {
    const r = scoreCandidate({
      token: token({ creatorPct: 20 }),
      sources: [hit()],
      guardrails: [],
      policy,
    });
    expect(r.passed).toBe(false);
    expect(r.blockedReason).toMatch(/creator/);
  });

  it("blocks a single untrusted source", () => {
    const r = scoreCandidate({
      token: token(),
      sources: [hit({ weight: "watch", key: "@random" })],
      guardrails: [],
      policy,
    });
    expect(r.passed).toBe(false);
    expect(r.blockedReason).toMatch(/sources/);
  });

  it("enforces a source guardrail before other checks", () => {
    const r = scoreCandidate({
      token: token(),
      sources: [hit({ key: "@shadykol" })],
      guardrails: [
        { id: "g1", type: "source", value: "@shadykol", origin: "manual", createdAt: 1 },
      ],
      policy,
    });
    expect(r.passed).toBe(false);
    expect(r.blockedReason).toMatch(/guardrail/);
  });

  it("grades A at 80+, B at 70+, and scores younger coins higher than stale ones", () => {
    const young = scoreCandidate({
      token: token({ ageMinutes: 8 }),
      sources: [hit()],
      guardrails: [],
      policy,
    });
    const stale = scoreCandidate({
      token: token({ ageMinutes: 12 * 60 }),
      sources: [hit()],
      guardrails: [],
      policy,
    });
    expect(young.passed).toBe(true);
    expect(stale.passed).toBe(true);
    expect(young.score).toBeGreaterThan(stale.score);
    expect(young.letter).toMatch(/^[AB]$/);
  });
});
