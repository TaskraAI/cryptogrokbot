import { describe, expect, it } from "vitest";
import { classifyPattern, decideExit, mergeLlmAction } from "@night/patterns";
import { policy, position, snap } from "./fixtures.ts";

describe("classifyPattern", () => {
  it("labels a dip with high sentiment and live volume as healthy_dip", () => {
    const p = classifyPattern(
      snap({
        pctFromPeak: -18,
        pctFromEntry: 40,
        sentiment: 0.6,
        mentionVelocity: 5,
        mentionVelocityBaseline: 3,
        volume5m: 4000,
        volumeBaseline5m: 4000,
        buySellRatio: 0.6,
        trustedSourcesStillPosting: 2,
        uniqueRecentSources: 2,
      }),
      policy,
    );
    expect(p).toBe("healthy_dip");
  });

  it("labels collapsing sentiment and dying volume as fade", () => {
    const p = classifyPattern(
      snap({
        pctFromPeak: -20,
        sentiment: 0.05,
        mentionVelocity: 0,
        mentionVelocityBaseline: 5,
        volume5m: 100,
        volumeBaseline5m: 4000,
        buySellRatio: 0.5,
      }),
      policy,
    );
    expect(p).toBe("fade");
  });

  it("labels creator dump / sell-side spike as dump not a dip", () => {
    const p = classifyPattern(
      snap({
        pctFromPeak: -22,
        sentiment: 0.8,
        buySellRatio: 0.2,
        volumeDeltaPct: 90,
        creatorPct: 2,
      }),
      policy,
    );
    expect(p).toBe("dump");
  });
});

describe("decideExit", () => {
  it("hard-stops a full bag that never returned principal", () => {
    const action = decideExit({
      position: position({ principalRecoveredSol: 0, everGreen: false }),
      snap: snap({ pctFromEntry: -30, pctFromPeak: -30, priceUsd: 0.7 }),
      pattern: "fade",
      policy,
    });
    expect(action).toEqual({ type: "flatten", reason: "hard_stop" });
  });

  it("returns principal at 2.5x, not 1x, lets a strong rally run to 5x, then moons", () => {
    const bag = {
      principalSol: 0.1,
      principalRecoveredSol: 0,
      tokensHeld: 100_000,
      tokensInitial: 100_000,
      entryPriceUsd: 1,
      everGreen: true,
    };
    const early = decideExit({
      position: position({ ...bag, costOutMultiple: 2.5 }),
      snap: snap({ priceUsd: 1.2, pctFromEntry: 20, pctFromPeak: 0 }),
      pattern: "chop",
      policy,
    });
    expect(early).toEqual({ type: "hold", reason: "awaiting_principal" });
    const ready = decideExit({
      position: position({ ...bag, costOutMultiple: 2.5 }),
      snap: snap({ priceUsd: 2.6, pctFromEntry: 160, pctFromPeak: 0, sentiment: 0.1 }),
      pattern: "chop",
      policy,
    });
    expect(ready.type).toBe("return_principal");
    const waitFive = decideExit({
      position: position({ ...bag, costOutMultiple: 5 }),
      snap: snap({ priceUsd: 2.6, pctFromEntry: 160, pctFromPeak: 0, sentiment: 0.1 }),
      pattern: "chop",
      policy,
    });
    expect(waitFive).toEqual({ type: "hold", reason: "awaiting_principal" });
    const letRun = decideExit({
      position: position({ ...bag, costOutMultiple: 2.5 }),
      snap: snap({
        priceUsd: 2.6,
        pctFromEntry: 160,
        pctFromPeak: 0,
        sentiment: 0.7,
        volume5m: 8000,
        volumeBaseline5m: 4000,
        buySellRatio: 0.62,
      }),
      pattern: "chop",
      policy,
    });
    expect(letRun).toEqual({ type: "hold", reason: "strong_rally_let_run" });
    const capOut = decideExit({
      position: position({ ...bag, costOutMultiple: 2.5 }),
      snap: snap({
        priceUsd: 5.1,
        pctFromEntry: 410,
        pctFromPeak: 0,
        sentiment: 0.7,
        volume5m: 8000,
        volumeBaseline5m: 4000,
        buySellRatio: 0.62,
      }),
      pattern: "chop",
      policy,
    });
    expect(capOut.type).toBe("return_principal");
  });

  it("holds a live moon bag through climax and skips the time flatten", () => {
    const moon = position({
      principalRecoveredSol: 0.1,
      runner: true,
      everGreen: true,
      peakPriceUsd: 6,
      openedAt: Date.now() - 10 * 60 * 60_000,
      costOutMultiple: 3,
    });
    const climax = decideExit({
      position: moon,
      snap: snap({
        priceUsd: 5,
        pctFromEntry: 400,
        pctFromPeak: -5,
        sentiment: 0.7,
        volume5m: 8000,
        volumeBaseline5m: 4000,
      }),
      pattern: "climax",
      policy,
    });
    expect(climax).toEqual({ type: "hold", reason: "moon_bag" });
  });

  it("holds a runner on healthy_dip instead of selling", () => {
    const action = decideExit({
      position: position({
        principalRecoveredSol: 0.1,
        runner: true,
        everGreen: true,
        peakPriceUsd: 3,
      }),
      snap: snap({
        priceUsd: 2.4,
        pctFromEntry: 140,
        pctFromPeak: -20,
        sentiment: 0.7,
      }),
      pattern: "healthy_dip",
      policy,
    });
    expect(action).toEqual({ type: "hold", reason: "healthy_dip_hold" });
  });

  it("sells the runner on fade", () => {
    const action = decideExit({
      position: position({ principalRecoveredSol: 0.1, runner: true, everGreen: true }),
      snap: snap({ priceUsd: 1.5, pctFromEntry: 50, pctFromPeak: -20 }),
      pattern: "fade",
      policy,
    });
    expect(action).toEqual({ type: "sell_runner", reason: "fade" });
  });

  it("time-stops a bag that never went green", () => {
    const action = decideExit({
      position: position({
        openedAt: Date.now() - 61 * 60_000,
        everGreen: false,
        principalRecoveredSol: 0,
      }),
      snap: snap({ pctFromEntry: -5, priceUsd: 0.95 }),
      pattern: "chop",
      policy,
    });
    expect(action.type).toBe("flatten");
    expect(action.reason).toBe("time_stop");
  });

  it("does not let the LLM sell through a healthy dip, moon bag, or cancel a flatten", () => {
    const hold = mergeLlmAction({ type: "hold", reason: "healthy_dip_hold" }, { action: "sell", confidence: 0.99 });
    expect(hold.reason).toBe("healthy_dip_hold");
    const moon = mergeLlmAction({ type: "hold", reason: "moon_bag" }, { action: "sell", confidence: 0.99 });
    expect(moon.reason).toBe("moon_bag");
    const rally = mergeLlmAction({ type: "hold", reason: "strong_rally_let_run" }, { action: "sell", confidence: 0.99 });
    expect(rally.reason).toBe("strong_rally_let_run");
    const stop = mergeLlmAction({ type: "flatten", reason: "hard_stop" }, { action: "hold", confidence: 0.99 });
    expect(stop.reason).toBe("hard_stop");
  });
});
