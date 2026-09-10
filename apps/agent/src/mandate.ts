import type { Policy } from "@night/shared";
import {
  listOpenOpportunities,
  markOpportunitySkipped,
  type OpportunityRow,
  type Store,
} from "@night/storage";

/** GrokBot impersonator mint — standing Taskra intent: never live. */
export const GROKBOT_IMPERSONATOR = "GeSfrQiscfsEv4Hx2TKaB9Nfid12qND1YYRYS1vSpump";

export type ChiefAction = "approve" | "skip" | "escalate";

export type ChanceDecision = {
  action: ChiefAction;
  chiefMayApprove: boolean;
  needsTaskra: boolean;
  why: string;
};

export type StandingIntent = {
  chiefDeputy: boolean;
  routine: string;
  escalate: string[];
  never: string[];
  sizeSol: number;
  pingTaskra: string;
};

function mutedSet(extra?: string[]): Set<string> {
  return new Set([GROKBOT_IMPERSONATOR, ...(extra ?? [])].map((m) => m.trim()).filter(Boolean));
}

export function classifyChance(opts: {
  mint: string;
  ticker?: string;
  sol?: number;
  add?: boolean;
  policy: Policy;
  mutedMints?: string[];
}): ChanceDecision {
  const mint = opts.mint.trim();
  const muted = mutedSet(opts.mutedMints);
  if (mint && muted.has(mint)) {
    return {
      action: "skip",
      chiefMayApprove: false,
      needsTaskra: false,
      why: "standing Taskra intent: muted / impersonator mint is never live — Chief skips",
    };
  }
  const sol = Number(opts.sol);
  const oversize = Number.isFinite(sol) && sol > 0 && sol > opts.policy.maxSolPerTrade;
  if (opts.add || oversize) {
    return {
      action: "escalate",
      chiefMayApprove: false,
      needsTaskra: true,
      why: "major: add-on or size above cap — wait for Taskra unless they already named this ticket",
    };
  }
  return {
    action: "approve",
    chiefMayApprove: true,
    needsTaskra: false,
    why: `routine: queued gem at ≤ ${opts.policy.maxSolPerTrade} SOL, no add-on — wait for Taskra, Chief, Grok Bot, or invited team`,
  };
}

export function standingIntent(policy: Policy): StandingIntent {
  return {
    chiefDeputy: false,
    routine:
      `The desk never Approves and never trades. Taskra, Chief, invited team, or Grok Bot decide on Home. Size stays ≤ ${policy.maxSolPerTrade} SOL. Grade A and B: tell Taskra right away.`,
    escalate: [
      "Size above maxSolPerTrade",
      "Add-on / average-down",
      "Raise maxSolPerTrade, dailyBudgetSol, or extra budget",
      "Kill or resume MASTER",
      "Enable Polymarket",
      "New wallet or unmute a fail-closed mint",
      "Anything not covered by standing lessons — unless Chief already knows what Taskra would do",
    ],
    never: [
      "GrokBot impersonator mint never live",
      "Grok must not invent chief:APPROVE — Chief (or Taskra) sends it",
      "Scout never live-buys",
    ],
    sizeSol: policy.maxSolPerTrade,
    pingTaskra: "Grade A and B — Chief tells Taskra right away",
  };
}

export function deputyChief(store: Store, policy: Policy, mutedMints?: string[]): string[] {
  const logs: string[] = [];
  for (const opp of listOpenOpportunities(store)) {
    if (opp.chief_approved === 1) continue;
    const decision = classifyChance({
      mint: opp.mint,
      ticker: opp.ticker,
      policy,
      mutedMints,
    });
    if (decision.action === "skip") {
      markOpportunitySkipped(store, opp.id);
      logs.push(`chief skipped #${opp.id} ${opp.ticker}: ${decision.why}`);
      continue;
    }
    logs.push(
      `chief: #${opp.id} ${opp.ticker} waiting for Taskra / Chief / Grok Bot / team — desk does not auto-approve or trade`,
    );
  }
  return logs;
}

export function chanceDecisionFor(opp: OpportunityRow, policy: Policy, mutedMints?: string[]): ChanceDecision {
  return classifyChance({ mint: opp.mint, ticker: opp.ticker, policy, mutedMints });
}
