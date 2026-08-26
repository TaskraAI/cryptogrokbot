import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, type MarketSnapshot, type PositionState, type SourceHit, type TokenMetrics } from "@night/shared";

export const policy = { ...DEFAULT_POLICY };

export function hit(partial: Partial<SourceHit> = {}): SourceHit {
  return {
    platform: "x",
    key: "@alpha",
    weight: "trusted",
    snippet: "this looks bullish send it CA below",
    at: Date.now(),
    mint: "So11111111111111111111111111111111111111112",
    ...partial,
  };
}

/** Trusted listing chatter without moon/send language — below policy.highSentiment. */
export function quietHit(partial: Partial<SourceHit> = {}): SourceHit {
  return hit({ snippet: "watchlist listing", ...partial });
}

export function token(partial: Partial<TokenMetrics> = {}): TokenMetrics {
  return {
    mint: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    ticker: "MEME",
    priceUsd: 0.001,
    marketCapUsd: 80_000,
    liquidityUsd: 25_000,
    volume1h: 40_000,
    volume5m: 5_000,
    holders: 400,
    creatorPct: 2,
    top10HolderPct: 18,
    buyImpactPct: 3,
    ageMinutes: 40,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    sellSimOk: true,
    graduated: true,
    ...partial,
  };
}

export function position(partial: Partial<PositionState> = {}): PositionState {
  return {
    id: 1,
    mint: token().mint,
    ticker: "MEME",
    mode: "PAPER",
    openedAt: Date.now() - 10 * 60_000,
    entryPriceUsd: 1,
    principalSol: 0.1,
    tokensHeld: 100_000,
    tokensInitial: 100_000,
    solSpent: 0.1,
    principalRecoveredSol: 0,
    peakPriceUsd: 1,
    everGreen: false,
    runner: false,
    lastPattern: null,
    patternPath: "",
    healthyDipSince: null,
    status: "open",
    sourcesJson: "[]",
    costOutMultiple: 2,
    ...partial,
  };
}

export function snap(partial: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    at: Date.now(),
    priceUsd: 1,
    marketCapUsd: 80_000,
    volume1m: 800,
    volume5m: 4_000,
    volume15m: 12_000,
    volume1h: 40_000,
    volumeBaseline5m: 4_000,
    volumeDeltaPct: 0,
    buySellRatio: 0.55,
    liquidityUsd: 25_000,
    holders: 400,
    topHolderPct: 18,
    creatorPct: 2,
    sentiment: 0.1,
    mentionVelocity: 3,
    mentionVelocityBaseline: 3,
    trustedSourcesStillPosting: 1,
    uniqueRecentSources: 2,
    pctFromEntry: 0,
    pctFromPeak: 0,
    ...partial,
  };
}

export function tmpYaml(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "night-"));
  const path = join(dir, "file.yaml");
  writeFileSync(path, contents);
  return path;
}
