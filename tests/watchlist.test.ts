import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, dayKey } from "@night/shared";
import { hitsForCandidate, loadSources, watchlistHits } from "@night/social";
import { listOpenPositions, openStore } from "@night/storage";
import { tryEnter } from "../apps/agent/src/entries.ts";
import { hit, token } from "./fixtures.ts";

describe("watchlist sources", () => {
  it("loads watchlist mints from yaml", () => {
    const path = join(tmpdir(), `src-${Date.now()}.yaml`);
    writeFileSync(
      path,
      `
watchlist:
  - mint: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
    ticker: BONK
    weight: trusted
    notes: starter
`,
    );
    const cfg = loadSources(path);
    expect(cfg.watchlist).toHaveLength(1);
    expect(cfg.watchlist[0]!.mint).toBe("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(cfg.watchlist[0]!.ticker).toBe("BONK");
  });

  it("loads the repo starter watchlist", () => {
    const cfg = loadSources("config/sources.yaml");
    const mints = cfg.watchlist.map((w) => w.mint);
    expect(mints).toContain("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(cfg.watchlist.length).toBeGreaterThanOrEqual(3);
  });
});

describe("hitsForCandidate", () => {
  it("adds a trusted watchlist hit when the mint is listed", () => {
    const path = join(tmpdir(), `src2-${Date.now()}.yaml`);
    writeFileSync(
      path,
      `
watchlist:
  - mint: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
    ticker: BONK
    weight: trusted
`,
    );
    const sources = loadSources(path);
    const hits = hitsForCandidate([], sources, "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.weight).toBe("trusted");
    expect(hits[0]!.key).toBe("watchlist:bonk");
    expect(hitsForCandidate([], sources, "not-listed")).toHaveLength(0);
    expect(watchlistHits(sources)).toHaveLength(1);
  });

  it("paper-enters a watchlist mint with only the synthetic hit", async () => {
    const dir = join(tmpdir(), `wl-${Date.now()}`);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    const store = openStore(join(dir, "t.db"));
    const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    const sources = {
      watchlist: [{ mint, ticker: "BONK", weight: "trusted" as const }],
      x_accounts: [],
      x_queries: [],
      telegram: [],
      discord: [],
      sites: [],
      wallets: [],
      mute: [],
    };
    const mintHits = hitsForCandidate([hit({ mint: "other" })], sources, mint);
    const msg = await tryEnter({
      store,
      policy: DEFAULT_POLICY,
      flags: {
        mode: "PAPER",
        masterEnabled: false,
        rpcHealthy: true,
        jupiterHealthy: true,
        telegramHealthy: false,
      },
      token: token({ mint, ticker: "BONK" }),
      sources: mintHits,
      guardrails: [],
      extraRules: [],
      dayKey: dayKey(),
    });
    expect(msg).toMatch(/^bought #/);
    expect(msg).toMatch(/PAPER/);
    expect(listOpenPositions(store)).toHaveLength(1);
  });
});
