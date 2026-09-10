import type { MarketSnapshot, PositionState, SourceHit } from "@night/shared";

export interface TapeInputs {
  priceUsd: number;
  marketCapUsd: number;
  volume1m?: number;
  volume5m: number;
  volume15m?: number;
  volume1h: number;
  volumeBaseline5m?: number;
  buySellRatio?: number;
  liquidityUsd: number;
  holders?: number;
  topHolderPct?: number;
  creatorPct?: number;
  previous?: MarketSnapshot[];
}

export function buildSnapshot(opts: {
  position: PositionState;
  market: TapeInputs;
  social: { hits: SourceHit[]; now?: number };
}): MarketSnapshot {
  const now = opts.social.now ?? Date.now();
  const recent = opts.social.hits.filter((h) => now - h.at <= 15 * 60 * 1000);
  const hour = opts.social.hits.filter((h) => now - h.at <= 60 * 60 * 1000);
  const trusted = recent.filter((h) => h.weight === "trusted");
  const unique = new Set(recent.map((h) => `${h.platform}:${h.key.toLowerCase()}`));
  const prev = opts.market.previous ?? [];
  const last = prev[0];
  const baseline =
    opts.market.volumeBaseline5m ??
    (prev.length
      ? prev.slice(0, 8).reduce((s, p) => s + p.volume5m, 0) / Math.min(8, prev.length)
      : opts.market.volume5m);
  const velocityBaseline =
    prev.length > 0
      ? prev.slice(0, 8).reduce((s, p) => s + p.mentionVelocity, 0) / Math.min(8, prev.length)
      : hour.length;
  const sentiment = scoreSentiment(recent);
  const pctFromEntry =
    opts.position.entryPriceUsd > 0
      ? ((opts.market.priceUsd - opts.position.entryPriceUsd) / opts.position.entryPriceUsd) * 100
      : 0;
  const peak = Math.max(opts.position.peakPriceUsd, opts.market.priceUsd);
  const pctFromPeak = peak > 0 ? ((opts.market.priceUsd - peak) / peak) * 100 : 0;
  const volumeDeltaPct =
    last && last.volume5m > 0 ? ((opts.market.volume5m - last.volume5m) / last.volume5m) * 100 : 0;

  return {
    at: now,
    priceUsd: opts.market.priceUsd,
    marketCapUsd: opts.market.marketCapUsd,
    volume1m: opts.market.volume1m ?? opts.market.volume5m / 5,
    volume5m: opts.market.volume5m,
    volume15m: opts.market.volume15m ?? opts.market.volume5m * 3,
    volume1h: opts.market.volume1h,
    volumeBaseline5m: baseline,
    volumeDeltaPct,
    buySellRatio: opts.market.buySellRatio ?? 0.5,
    liquidityUsd: opts.market.liquidityUsd,
    holders: opts.market.holders ?? 0,
    topHolderPct: opts.market.topHolderPct ?? 0,
    creatorPct: opts.market.creatorPct ?? 0,
    sentiment,
    mentionVelocity: hour.length,
    mentionVelocityBaseline: velocityBaseline,
    trustedSourcesStillPosting: trusted.length,
    uniqueRecentSources: unique.size,
    pctFromEntry,
    pctFromPeak,
  };
}

export function scoreSentiment(hits: SourceHit[]): number {
  if (hits.length === 0) return 0;
  const pos = ["moon", "send", "bull", "accumulate", "buy", "long", "gem", "pump"];
  const neg = ["rug", "scam", "dump", "dead", "fade", "sell", "honeypot", "migration"];
  let score = 0;
  for (const hit of hits) {
    const t = hit.snippet.toLowerCase();
    let s = 0.15;
    for (const w of pos) if (t.includes(w)) s += 0.2;
    for (const w of neg) if (t.includes(w)) s -= 0.35;
    if (hit.weight === "trusted") s *= 1.4;
    score += Math.max(-1, Math.min(1, s));
  }
  return Math.max(-1, Math.min(1, score / hits.length));
}

export function snapshotsFromJson(rows: Array<{ snapshot_json: string }>): MarketSnapshot[] {
  return rows.map((r) => JSON.parse(r.snapshot_json) as MarketSnapshot);
}
