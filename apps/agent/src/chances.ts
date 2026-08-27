import type { Policy } from "@night/shared";
import {
  listOpenOpportunities,
  listOpportunities,
  type OpportunityRow,
  type Store,
} from "@night/storage";

export type PublicChance = {
  id: number;
  mint: string;
  ticker: string;
  sentiment: number;
  score: number;
  volume5m: number;
  priceUsd: number;
  costOutMultiple: number;
  reason: string;
  note: string;
  at: number;
  status: string;
  sizeSol: number;
  chiefApproved: boolean;
  resolvedAt: number | null;
  postPriceUsd: number | null;
  multipleSeen: number | null;
};

export function publicChance(o: OpportunityRow, policy: Policy): PublicChance {
  return {
    id: o.id,
    mint: o.mint,
    ticker: o.ticker,
    sentiment: o.sentiment,
    score: o.score,
    volume5m: o.volume5m,
    priceUsd: o.price_usd,
    costOutMultiple: o.cost_out_multiple,
    reason: o.reason,
    note: o.note,
    at: o.at,
    status: o.status,
    sizeSol: policy.maxSolPerTrade,
    chiefApproved: o.chief_approved === 1,
    resolvedAt: o.resolved_at,
    postPriceUsd: o.post_price_usd,
    multipleSeen: o.multiple_seen,
  };
}

export function chancesPayload(store: Store, policy: Policy): {
  opportunities: PublicChance[];
  recentOpportunities: PublicChance[];
} {
  const recentOpportunities = listOpportunities(store, 40).map((o) => publicChance(o, policy));
  return {
    opportunities: recentOpportunities.filter((o) => o.status === "open"),
    recentOpportunities,
  };
}

export function chiefChanceNotice(msg: string): string {
  return (
    `Chance queued for Chief — stay on the same page.\n${msg}\n` +
    `Chief: Approve or Skip on https://cryptogrokbot.com/ Home.\n` +
    `Grok Bot: wait for Chief APPROVE. Do not invent it. Do not live-buy until then.`
  );
}

export function missedGemLesson(opts: {
  ticker: string;
  sentiment: number;
  volume5m: number;
  multiple: number;
}): string {
  return (
    `MISSED GEM ${opts.ticker}: ${opts.multiple.toFixed(1)}x after we did not buy ` +
    `(hype ${opts.sentiment.toFixed(2)} vol5m ${opts.volume5m}). ` +
    `Put every chance on Home for Chief. Grok waits for Chief APPROVE — do not skip Taskra.`
  );
}

export function chiefChancePulse(store: Store, tickLines: number): string {
  const open = listOpenOpportunities(store);
  if (!open.length) return `tick done lines=${tickLines}; no open chances`;
  const names = open.map((o) => `${o.ticker}${o.chief_approved ? "*" : ""}`).join(", ");
  return `${open.length} chance(s) on Home: ${names} — Grok waits for APPROVE`;
}
