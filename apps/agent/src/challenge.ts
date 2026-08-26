import { readFileSync } from "node:fs";
import type { Policy } from "@night/shared";
import { getFlag, listChallengeIdeas, setFlag, type Store } from "@night/storage";

export type ChallengeVenue = { id: "solana" | "polymarket" | string; label: string; weight: number };

export type ChallengeConfig = {
  title: string;
  startUsd: number;
  goalUsd: number;
  rungsUsd: number[];
  venues: ChallengeVenue[];
  disclaimer: string;
};

export const DEFAULT_CHALLENGE: ChallengeConfig = {
  title: "Rung challenge",
  startUsd: 100,
  goalUsd: 1_000_000,
  rungsUsd: [100, 5000, 10000, 20000, 40000, 80000, 160000, 320000, 640000, 1_000_000],
  venues: [
    { id: "solana", label: "Solana memes (CryptoGrokBot)", weight: 0.6 },
    { id: "polymarket", label: "Polymarket events", weight: 0.4 },
  ],
  disclaimer: "Not financial advice. Most 50x paths fail. Survive first. Grok Bot does not promise $1M.",
};

export const BANKROLL_FLAG = "challenge_bankroll_usd";

export function loadChallenge(path: string): ChallengeConfig {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ChallengeConfig>;
    const rungs = (raw.rungsUsd ?? DEFAULT_CHALLENGE.rungsUsd).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const sorted = [...new Set(rungs)].sort((a, b) => a - b);
    return {
      title: String(raw.title || DEFAULT_CHALLENGE.title),
      startUsd: Number(raw.startUsd) > 0 ? Number(raw.startUsd) : DEFAULT_CHALLENGE.startUsd,
      goalUsd: Number(raw.goalUsd) > 0 ? Number(raw.goalUsd) : DEFAULT_CHALLENGE.goalUsd,
      rungsUsd: sorted.length >= 2 ? sorted : DEFAULT_CHALLENGE.rungsUsd,
      venues: Array.isArray(raw.venues) && raw.venues.length ? raw.venues : DEFAULT_CHALLENGE.venues,
      disclaimer: String(raw.disclaimer || DEFAULT_CHALLENGE.disclaimer),
    };
  } catch {
    return { ...DEFAULT_CHALLENGE };
  }
}

export function currentRung(bankrollUsd: number, rungsUsd: number[]): {
  index: number;
  from: number;
  to: number;
  multiple: number;
  progressPct: number;
  done: boolean;
} {
  const rungs = rungsUsd.length ? rungsUsd : DEFAULT_CHALLENGE.rungsUsd;
  const goal = rungs[rungs.length - 1]!;
  if (bankrollUsd >= goal) {
    return { index: rungs.length - 1, from: goal, to: goal, multiple: 1, progressPct: 100, done: true };
  }
  let index = 0;
  for (let i = 0; i < rungs.length - 1; i++) {
    if (bankrollUsd >= rungs[i]!) index = i;
  }
  const from = rungs[index]!;
  const to = rungs[index + 1]!;
  const span = Math.max(1e-9, to - from);
  const progressPct = Math.max(0, Math.min(99.9, ((bankrollUsd - from) / span) * 100));
  return { index, from, to, multiple: to / from, progressPct, done: false };
}

export function getBankrollUsd(store: Store, challenge: ChallengeConfig): number {
  const raw = Number(getFlag(store, BANKROLL_FLAG, String(challenge.startUsd)));
  return Number.isFinite(raw) && raw >= 0 ? raw : challenge.startUsd;
}

export function setBankrollUsd(store: Store, usd: number): void {
  const n = Math.max(0, Number(usd));
  setFlag(store, BANKROLL_FLAG, n.toFixed(2));
}

function rungJobs(rung: ReturnType<typeof currentRung>): string[] {
  if (rung.done) {
    return [
      "Goal hit on the declared bankroll. Stop. Do not raise size. Ask Taskra what happens next.",
      "Grade the path. Do not invent a new 10x ticket because the number looks round.",
    ];
  }
  if (rung.multiple >= 10) {
    return [
      "This rung is a 50x. Treat it as research + survival, not a daily compounding plan.",
      "Crypto: at most one tiny ticket inside maxSolPerTrade. Ask Taskra before any live spend. MASTER stays off.",
      "Polymarket: research live markets, log paper ideas only. Do not place CLOB bets (no live PM keys).",
      "Never put more than ~10–20% of remaining bankroll on one idea, and never above the desk size cap.",
      "If declared bankroll drops under 50% of this rung start, pause 24h, grade the losses, no revenge trades.",
    ];
  }
  return [
    `This rung is about ${rung.multiple.toFixed(2)}x (${fmtUsd(rung.from)} → ${fmtUsd(rung.to)}). Prefer defined-risk Polymarket ideas and fewer moon tickets.`,
    "Crypto: Grok Bot Bearer only. Keep MASTER off. Size stays at policy maxSolPerTrade until Taskra raises it.",
    "Polymarket: paper journal until Taskra funds a PM account and we add live keys. Research mispriced events with a clear resolution source.",
    "Return principal first on any winner. Do not disable stops to 'let it run to the next rung'.",
    "Update declared bankroll honestly after fills. Do not mark a rung done until the number is real.",
  ];
}

export function playbook(opts: {
  challenge: ChallengeConfig;
  bankrollUsd: number;
  policy: Policy;
  masterEnabled: boolean;
  mode: string;
}): {
  honesty: string;
  tonight: string[];
  never: string[];
  howToWork: string[];
  venues: ChallengeVenue[];
} {
  const rung = currentRung(opts.bankrollUsd, opts.challenge.rungsUsd);
  return {
    honesty: `${opts.challenge.disclaimer} First rung is ${fmtUsd(opts.challenge.rungsUsd[0] ?? 100)} → ${fmtUsd(opts.challenge.rungsUsd[1] ?? 5000)}. Later rungs are ~2x to ${fmtUsd(opts.challenge.goalUsd)}.`,
    tonight: [
      `You are on ${fmtUsd(rung.from)} → ${fmtUsd(rung.to)} (${rung.done ? "DONE" : rung.multiple.toFixed(2) + "x"}). Declared bankroll ${fmtUsd(opts.bankrollUsd)}.`,
      `Mode=${opts.mode} MASTER=${opts.masterEnabled}. Auto live desk is off unless MASTER is on. Only Grok Bot Bearer may POST /api/buy and /api/sell.`,
      `Live crypto size cap ${opts.policy.maxSolPerTrade} SOL / day ${opts.policy.dailyBudgetSol} SOL / loss cap ${opts.policy.dailyLossCapSol} SOL. Do not raise these.`,
      ...rungJobs(rung),
      "End of session: GET /api/challenge, list open bags, list paper PM ideas, ask Taskra one clear question.",
    ],
    never: [
      "Do not promise $1M or 50x. Say the odds are bad and the first rung is lottery-adjacent.",
      "Do not raise maxSolPerTrade, dailyBudgetSol, or resume MASTER unless Taskra types CONFIRM.",
      "Do not place live Polymarket CLOB orders. Research + paper ideas only until live PM is explicitly wired.",
      "Do not enable the GrokBot impersonator mint. Do not invent a second wallet or extra budget.",
      "Do not YOLO the whole bankroll on one meme or one sports market.",
    ],
    howToWork: [
      "Start every session with GET /api/challenge (Bearer invite token).",
      "Scan GET /api/polymarket (optional ?q=) then Intel desk `polymarket` for a brief.",
      "For Solana names: Scout/watchlist + scam radar. High sentiment → ask Taskra before size.",
      "Log PM ideas with POST /api/challenge/ideas. Update status won/lost/killed after resolution.",
      "PATCH/POST bankrollUsd only with a number Taskra agrees is real.",
    ],
    venues: opts.challenge.venues,
  };
}

export function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n);
}

export function challengePayload(opts: {
  store: Store;
  challenge: ChallengeConfig;
  policy: Policy;
  masterEnabled: boolean;
  mode: string;
}) {
  const bankrollUsd = getBankrollUsd(opts.store, opts.challenge);
  const rung = currentRung(bankrollUsd, opts.challenge.rungsUsd);
  return {
    title: opts.challenge.title,
    startUsd: opts.challenge.startUsd,
    goalUsd: opts.challenge.goalUsd,
    rungsUsd: opts.challenge.rungsUsd,
    bankrollUsd,
    rung,
    nextUsd: rung.done ? null : rung.to,
    playbook: playbook({
      challenge: opts.challenge,
      bankrollUsd,
      policy: opts.policy,
      masterEnabled: opts.masterEnabled,
      mode: opts.mode,
    }),
    ideas: listChallengeIdeas(opts.store, 40).map(publicIdea),
    polymarketLive: false,
    cryptoOrders: "grokbot-bearer-only",
  };
}

export function publicIdea(row: {
  id: number;
  at: number;
  venue: string;
  title: string;
  url: string;
  side: string;
  size_usd: number;
  note: string;
  status: string;
  rung_from: number;
  rung_to: number;
}) {
  return {
    id: row.id,
    at: row.at,
    venue: row.venue,
    title: row.title,
    url: row.url,
    side: row.side,
    sizeUsd: row.size_usd,
    note: row.note,
    status: row.status,
    rungFrom: row.rung_from,
    rungTo: row.rung_to,
  };
}
