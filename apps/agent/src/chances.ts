import type { Policy } from "@night/shared";
import { letterGrade } from "@night/risk";
import {
  listOpenOpportunities,
  listOpportunities,
  type OpportunityRow,
  type Store,
} from "@night/storage";
import { chanceDecisionFor, standingIntent, type ChanceDecision } from "./mandate.ts";

export type PublicChance = {
  id: number;
  mint: string;
  ticker: string;
  sentiment: number;
  score: number;
  letter: string;
  volume5m: number;
  priceUsd: number;
  costOutMultiple: number;
  reason: string;
  note: string;
  at: number;
  status: string;
  sizeSol: number;
  chiefApproved: boolean;
  approvedBy: string;
  chiefMayApprove: boolean;
  needsTaskra: boolean;
  decisionWhy: string;
  resolvedAt: number | null;
  postPriceUsd: number | null;
  multipleSeen: number | null;
};

export function publicChance(o: OpportunityRow, policy: Policy, mutedMints?: string[]): PublicChance {
  const decision: ChanceDecision = chanceDecisionFor(o, policy, mutedMints);
  return {
    id: o.id,
    mint: o.mint,
    ticker: o.ticker,
    sentiment: o.sentiment,
    score: o.score,
    letter: letterGrade(o.score, policy.minScore),
    volume5m: o.volume5m,
    priceUsd: o.price_usd,
    costOutMultiple: o.cost_out_multiple,
    reason: o.reason,
    note: o.note,
    at: o.at,
    status: o.status,
    sizeSol: policy.maxSolPerTrade,
    chiefApproved: o.chief_approved === 1,
    approvedBy: o.approved_by || "",
    chiefMayApprove: decision.chiefMayApprove,
    needsTaskra: decision.needsTaskra,
    decisionWhy: decision.why,
    resolvedAt: o.resolved_at,
    postPriceUsd: o.post_price_usd,
    multipleSeen: o.multiple_seen,
  };
}

export function chancesPayload(store: Store, policy: Policy, mutedMints?: string[]): {
  opportunities: PublicChance[];
  recentOpportunities: PublicChance[];
  mandate: ReturnType<typeof standingIntent>;
} {
  const recentOpportunities = listOpportunities(store, 40).map((o) => publicChance(o, policy, mutedMints));
  return {
    opportunities: recentOpportunities.filter((o) => o.status === "open"),
    recentOpportunities,
    mandate: standingIntent(policy),
  };
}

export function chiefChanceNotice(msg: string, opts?: { grade?: string }): string {
  const g = (opts?.grade ?? "").toUpperCase();
  const ab = g === "A" || g === "B";
  const head = ab
    ? `URGENT Grade ${g} — Chief, tell Taskra right away. Stay on the same page.\n`
    : `Chance queued for Chief — stay on the same page.\n`;
  return (
    `${head}${msg}\n` +
    `Chief: Taskra may be away. If this is a routine queued gem (≤ cap, no add-on, not muted), Approve — you are deputized. The desk also deputy-approves those this tick. Majors wait for Taskra unless standing lessons already say what they would do.\n` +
    `Grok Bot: wait for Chief APPROVE. Do not invent it. Do not live-buy until then.\n` +
    `Home: https://cryptogrokbot.com/`
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
  const pending = open.filter((o) => o.chief_approved !== 1).length;
  if (!pending) return `${open.length} chance(s) on Home: ${names} — Chief deputy done, Grok may buy`;
  return `${open.length} chance(s) on Home: ${names} — ${pending} still need Taskra`;
}
