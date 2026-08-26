import { describe, expect, it } from "vitest";
import { loadAppConfig, resolveDashboardSecureCookie } from "../apps/agent/src/config.ts";

describe("fail-closed config defaults", () => {
  it("defaults MODE=PAPER, MASTER off, localhost bind, extra budget off", () => {
    const cfg = loadAppConfig({} as NodeJS.ProcessEnv);
    expect(cfg.mode).toBe("PAPER");
    expect(cfg.masterEnabled).toBe(false);
    expect(cfg.dashboardBind).toBe("127.0.0.1");
    expect(cfg.allowExtraBudget).toBe(false);
    expect(cfg.dashboardSecureCookie).toBe(false);
    expect(cfg.challengePath).toMatch(/challenge\.json$/);
  });

  it("does not treat MODE=LIVE as enough for master", () => {
    const cfg = loadAppConfig({ MODE: "LIVE" } as NodeJS.ProcessEnv);
    expect(cfg.mode).toBe("LIVE");
    expect(cfg.masterEnabled).toBe(false);
  });

  it("turns Secure cookie on when bind is not loopback, unless explicitly false", () => {
    expect(resolveDashboardSecureCookie({} as NodeJS.ProcessEnv, "127.0.0.1")).toBe(false);
    expect(loadAppConfig({ DASHBOARD_BIND: "0.0.0.0" } as NodeJS.ProcessEnv).dashboardSecureCookie).toBe(true);
    expect(
      loadAppConfig({
        DASHBOARD_BIND: "0.0.0.0",
        DASHBOARD_SECURE_COOKIE: "false",
      } as NodeJS.ProcessEnv).dashboardSecureCookie,
    ).toBe(false);
    expect(loadAppConfig({ DASHBOARD_SECURE_COOKIE: "true" } as NodeJS.ProcessEnv).dashboardSecureCookie).toBe(true);
  });

  it("only enables extra budget from the explicit env control", () => {
    expect(loadAppConfig({} as NodeJS.ProcessEnv).allowExtraBudget).toBe(false);
    expect(loadAppConfig({ ALLOW_EXTRA_BUDGET: "true" } as NodeJS.ProcessEnv).allowExtraBudget).toBe(true);
    expect(loadAppConfig({ ALLOW_EXTRA_BUDGET: "1" } as NodeJS.ProcessEnv).allowExtraBudget).toBe(false);
  });
});
