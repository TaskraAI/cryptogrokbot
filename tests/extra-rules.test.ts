import { describe, expect, it } from "vitest";
import { consecutiveLosses, evaluateExtraRules, inHours, type ExtraRule } from "@night/risk";
import { hit, token } from "./fixtures.ts";

const on = (partial: Partial<ExtraRule> & Pick<ExtraRule, "id" | "type">): ExtraRule => ({
  enabled: true,
  value: 1,
  when: "entry",
  ...partial,
});

describe("extra rules", () => {
  it("blocks a coin younger than min_age_minutes", () => {
    const r = evaluateExtraRules([on({ id: "age", type: "min_age_minutes", value: 10 })], {
      token: token({ ageMinutes: 1 }),
      sources: [hit()],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/age/);
  });

  it("blocks migration keyword in snippets", () => {
    const r = evaluateExtraRules([on({ id: "kw", type: "block_keyword", value: "migration" })], {
      token: token(),
      sources: [hit({ snippet: "migration incoming" })],
    });
    expect(r.ok).toBe(false);
  });

  it("blocks fade wallets", () => {
    const r = evaluateExtraRules([on({ id: "fade", type: "fade_wallet", value: true })], {
      token: token(),
      sources: [hit({ key: "FadeWallet1111111111111111111111111111111" })],
      fadeWallets: ["FadeWallet1111111111111111111111111111111"],
    });
    expect(r.ok).toBe(false);
  });

  it("requires a copy-wallet hit when that rule is on", () => {
    const miss = evaluateExtraRules([on({ id: "copy", type: "require_copy_wallet", value: true })], {
      token: token(),
      sources: [hit({ key: "@alpha" })],
      copyWallets: ["Copy11111111111111111111111111111111111111"],
    });
    expect(miss.ok).toBe(false);
    const hitOk = evaluateExtraRules([on({ id: "copy", type: "require_copy_wallet", value: true })], {
      token: token(),
      sources: [hit({ key: "Copy11111111111111111111111111111111111111" })],
      copyWallets: ["Copy11111111111111111111111111111111111111"],
    });
    expect(hitOk.ok).toBe(true);
  });

  it("ignores disabled rules", () => {
    const r = evaluateExtraRules(
      [on({ id: "age", type: "min_age_minutes", value: 999, enabled: false })],
      { token: token({ ageMinutes: 1 }), sources: [hit()] },
    );
    expect(r.ok).toBe(true);
  });

  it("parses UTC hour windows including wrap", () => {
    expect(inHours("13-23", 15)).toBe(true);
    expect(inHours("13-23", 2)).toBe(false);
    expect(inHours("22-4", 23)).toBe(true);
    expect(inHours("22-4", 3)).toBe(true);
    expect(inHours("22-4", 12)).toBe(false);
  });

  it("counts a loss streak from newest-first nets", () => {
    expect(consecutiveLosses([-0.1, -0.05, 0.2])).toBe(2);
    expect(consecutiveLosses([0.1, -0.2])).toBe(0);
  });
});
