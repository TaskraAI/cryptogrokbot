import { askGrokDesk } from "@night/learning";
import type { Policy } from "@night/shared";
import { fetchDexSearch, fetchDexToken, type DexPair } from "@night/signals";
import { listOpenPositions, type Store } from "@night/storage";
import type { AppConfig } from "./config.ts";
import { formatPolymarketGrounding, searchPolymarket } from "./polymarket.ts";

export type DeskField = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "select";
  options?: string[];
};

export type DeskDef = {
  id: string;
  title: string;
  blurb: string;
  fields: DeskField[];
  useXSearch: boolean;
  sections: string[];
};

export type DeskRun = {
  id: string;
  title: string;
  at: number;
  via: "xai" | "openai" | "offline";
  fields: Record<string, string>;
  grounded: string;
  report: string;
};

export const DESKS: DeskDef[] = [
  {
    id: "sentiment",
    title: "X sentiment",
    blurb: "Detect trends before they rise. Score X chatter, volume, influencers, hype vs substance.",
    useXSearch: true,
    sections: [
      "Overall sentiment score (bullish / neutral / bearish)",
      "Volume of mentions (rising / declining / stable)",
      "Key influencers talking about the token",
      "Common themes in the discussions",
      "Red flags or concerns mentioned",
      "Level of hype vs. real substance",
      "Comparison with sentiment from 7 days ago",
      "Prediction: is the momentum growing or weakening?",
    ],
    fields: [
      { key: "token", label: "Token / project", placeholder: "Bonk" },
      { key: "ticker", label: "Ticker", placeholder: "BONK" },
      { key: "period", label: "Period", type: "select", options: ["last 24 hours", "last week"] },
    ],
  },
  {
    id: "gems",
    title: "Early-stage gems",
    blurb: "Framework to find small-cap names before they explode — with rug filters.",
    useXSearch: true,
    sections: [
      "Metrics that indicate early potential",
      "Red flags for scams or rug pulls",
      "Indicators of team and developer activity",
      "Community growth patterns to watch",
      "Tokenomics that suggest bullish potential",
      "Where to find these projects first",
      "Due diligence checklist",
    ],
    fields: [
      { key: "mcap", label: "Max market cap", type: "select", options: ["less than $10M", "less than $50M", "less than $100M"] },
      { key: "sector", label: "Sector", type: "select", options: ["Meme", "DeFi", "AI", "Gaming", "Infrastructure", "any"] },
      { key: "risk", label: "Risk tolerance", type: "select", options: ["high", "medium"] },
      { key: "horizon", label: "Horizon", type: "select", options: ["weeks", "months", "years"] },
    ],
  },
  {
    id: "evaluate",
    title: "Project evaluation",
    blurb: "Score a name like a professional: fundamentals, team, tokenomics, verdict.",
    useXSearch: true,
    sections: [
      "Project fundamentals (problem it solves, use case)",
      "Team track record and credibility",
      "Tokenomics (supply, distribution, vesting)",
      "Technological level and innovation",
      "Competition and market position",
      "Community strength and engagement",
      "Partners and backers",
      "Red flags or concerns",
      "Price potential (realistic targets)",
      "Investment verdict: Buy / Hold / Avoid",
    ],
    fields: [
      { key: "token", label: "Project", placeholder: "name" },
      { key: "ticker", label: "Ticker", placeholder: "TICKER" },
      { key: "mcap", label: "Market cap (if known)", placeholder: "$12M" },
      { key: "investment", label: "Possible size", placeholder: "0.01 SOL" },
    ],
  },
  {
    id: "whales",
    title: "Whale / smart money",
    blurb: "How to read large wallets, accumulation, exits, and manipulation.",
    useXSearch: false,
    sections: [
      "How to interpret large wallet movements",
      "What a whale accumulation pattern looks like",
      "Signals of smart money entry or exit",
      "How to track key wallet addresses",
      "Which on-chain metrics matter most",
      "Tools and resources for monitoring whales",
      "How to position based on their movements",
      "Warning signs of manipulation",
    ],
    fields: [{ key: "focus", label: "Focus", placeholder: "token, DeFi, or general market" }],
  },
  {
    id: "timing",
    title: "Entry / exit timing",
    blurb: "Zones, DCA, take-profit, stops — aligned with this desk’s HOLD/dip rules.",
    useXSearch: false,
    sections: [
      "Optimal entry zones based on current conditions",
      "DCA strategy",
      "Take-profit levels (multiple targets)",
      "Stop-loss recommendations",
      "Market conditions to monitor",
      "Sentiment indicators for timing",
      "How to scale entries and exits",
      "When to hold and when to sell",
    ],
    fields: [
      { key: "token", label: "Token", placeholder: "name" },
      { key: "ticker", label: "Ticker", placeholder: "TICKER" },
      { key: "price", label: "Current price", placeholder: "optional" },
      { key: "investment", label: "Size", placeholder: "0.01 SOL" },
      { key: "objective", label: "Objective", type: "select", options: ["2x", "5x", "10x", "100x"] },
    ],
  },
  {
    id: "narratives",
    title: "Narrative shifts",
    blurb: "Spot the next flow: X traction, sectors, VCs, contrarian bets.",
    useXSearch: true,
    sections: [
      "Narratives gaining traction on X",
      "Sectors with early momentum",
      "Projects well-positioned to benefit",
      "Shifts in attention from influencers and VCs",
      "Regulatory or macro factors creating opportunities",
      "Historical patterns suggesting what's next",
      "Contrarian bets others are overlooking",
      "3-month outlook and positioning strategy",
    ],
    fields: [
      { key: "phase", label: "Market phase", type: "select", options: ["bullish", "bearish", "sideways"] },
      { key: "focus", label: "Focus", type: "select", options: ["altcoins", "Bitcoin", "DeFi", "NFTs", "AI", "Gaming", "Meme"] },
    ],
  },
  {
    id: "portfolio",
    title: "Portfolio builder",
    blurb: "Allocation, sizing, rebalance, and profit-taking for this risk budget.",
    useXSearch: false,
    sections: [
      "Portfolio allocation (% by category)",
      "Specific tokens recommended by category",
      "Proportion between blue chips and high-risk bets",
      "Rebalancing strategy",
      "When to take profits",
      "How to manage risk",
      "Position sizing guidelines",
      "Monitoring and review schedule",
    ],
    fields: [
      { key: "amount", label: "Investment amount", placeholder: "e.g. 2 SOL paper" },
      { key: "risk", label: "Risk", type: "select", options: ["conservative", "moderate", "aggressive"] },
      { key: "horizon", label: "Time horizon", type: "select", options: ["short", "medium", "long term"] },
      { key: "experience", label: "Experience", type: "select", options: ["beginner", "intermediate", "advanced"] },
    ],
  },
  {
    id: "scams",
    title: "Scam / rug radar",
    blurb: "Checklist to catch tokenomics traps, fake teams, LP pulls, and pumps.",
    useXSearch: true,
    sections: [
      "Red flags in tokenomics (supply, distribution)",
      "Team anonymity and credibility verification",
      "Smart contract audit requirements",
      "Warnings about liquidity and holder concentration",
      "Red flags on social media and community",
      "Red flags on the website and whitepaper",
      "Pump and dump patterns to recognize",
      "Tools for verifying legitimacy",
      "Common scam tactics in 2026",
      "What to do if already invested in a scam",
    ],
    fields: [
      { key: "token", label: "Token to check (optional)", placeholder: "name or mint" },
      { key: "year", label: "Year", type: "select", options: ["2026"] },
    ],
  },
  {
    id: "polymarket",
    title: "Polymarket",
    blurb: "Event markets for the rung challenge. Research only — paper ideas, no live CLOB bets.",
    useXSearch: true,
    sections: [
      "Market question and exact resolution source",
      "Current implied odds vs a base-rate / news view",
      "Why the book might be wrong (or why it is efficient)",
      "Max loss if you are wrong (defined risk)",
      "Suggested paper size vs the current rung bankroll",
      "When to kill the idea (invalidation)",
      "Correlation with the Solana meme book (do not double the same bet)",
      "Verdict: Watch / Paper / Avoid — never 'bet the rung'",
    ],
    fields: [
      { key: "query", label: "Topic / market", placeholder: "bitcoin, election, Fed, sports" },
      { key: "bias", label: "Lean", type: "select", options: ["no lean", "Yes", "No", "other outcome"] },
      { key: "horizon", label: "Horizon", type: "select", options: ["hours", "days", "weeks"] },
    ],
  },
];

const lastRuns = new Map<string, DeskRun>();

export function listDesks(): DeskDef[] {
  return DESKS;
}

export function getDesk(id: string): DeskDef | undefined {
  return DESKS.find((d) => d.id === id);
}

export function lastDeskRun(id: string): DeskRun | undefined {
  return lastRuns.get(id);
}

export function allLastDeskRuns(): DeskRun[] {
  return [...lastRuns.values()].sort((a, b) => b.at - a.at);
}

export function lastDeskMeta(id: string): { at: number; via: DeskRun["via"]; preview: string } | null {
  const r = lastRuns.get(id);
  if (!r) return null;
  return { at: r.at, via: r.via, preview: r.report.slice(0, 240) };
}

function clip(v: string, n = 400): string {
  return v.trim().slice(0, n);
}

export function buildDeskPrompt(desk: DeskDef, fields: Record<string, string>, grounded: string): string {
  const f = (k: string, fallback = "") => clip(fields[k] || fallback);
  const numbered = desk.sections.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const rules = `You are CryptoGrokBot on cryptogrokbot.com — a personal Solana meme-coin night desk plus Polymarket research. Paper is default. Never recommend disabling hard stops. Dip + high/rising sentiment + volume alive = HOLD. Dedicated hot wallet only. Number every section. Be brutally honest. This is research, not financial advice. Year: 2026. Taskra's rung challenge is $100 → $5,000 → $10,000 then ~2x rungs to $1,000,000. Do not promise that path. Live crypto size stays at policy maxSolPerTrade. Do not place live Polymarket bets.`;

  if (desk.id === "sentiment") {
    return `${rules}

Analyze current sentiment on X (Twitter) about this token.
Token: ${f("token", "unknown")} ticker ${f("ticker")}
Period: ${f("period", "last 24 hours")}

Provide:
${numbered}

Be objective and data-based. Use X search.

Live market grounding:
${grounded}`;
  }

  if (desk.id === "gems") {
    return `${rules}

Help find early-stage crypto projects with 100x potential (expect most to fail).
Criteria:
- Market capitalization: ${f("mcap", "less than $10M")}
- Sector: ${f("sector", "Meme")}
- Risk tolerance: ${f("risk", "high")}
- Investment horizon: ${f("horizon", "weeks")}
Prefer Solana names this desk can actually trade.

Provide a systematic framework:
${numbered}
Then list up to 5 current candidates that fit, or say none if the screen is empty.

Live screen:
${grounded}`;
  }

  if (desk.id === "evaluate") {
    return `${rules}

Conduct a comprehensive analysis of this project.
Project: ${f("token")} ticker ${f("ticker")}
Current market cap: ${f("mcap", "unknown")}
Possible investment: ${f("investment", "paper size only")}

Analyze:
${numbered}

Be brutally honest about the risks.

Live market grounding:
${grounded}`;
  }

  if (desk.id === "whales") {
    return `${rules}

Explain whale activity and smart money flows.
Focus: ${f("focus", "Solana meme coins")}

Teach:
${numbered}

Give a framework for following smart money.

Context:
${grounded}`;
  }

  if (desk.id === "timing") {
    return `${rules}

Develop an entry and exit strategy.
Token: ${f("token")} ticker ${f("ticker")}
Current price: ${f("price", "see grounding")}
Investment: ${f("investment", "policy max per trade")}
Objective: ${f("objective", "2x")}

Provide:
${numbered}

Respect return-principal-first. Never recommend a stop looser than the desk hard stop. Healthy dip + high/rising sentiment + volume alive = HOLD.

Live market + policy:
${grounded}`;
  }

  if (desk.id === "narratives") {
    return `${rules}

Identify emerging narratives that could drive the next move.
Current market phase: ${f("phase", "sideways")}
Focus: ${f("focus", "Meme")}

Analyze:
${numbered}

Use X search. Show where attention is actually moving.

Context:
${grounded}`;
  }

  if (desk.id === "portfolio") {
    return `${rules}

Create a crypto portfolio strategy.
Investment amount: ${f("amount", "small paper stack")}
Risk tolerance: ${f("risk", "aggressive")}
Time horizon: ${f("horizon", "short")}
Experience: ${f("experience", "intermediate")}

This desk is a dedicated Solana meme hot-wallet agent, not a full net-worth plan.

Provide:
${numbered}

Make it realistic. Principal first. Stay inside daily budget / max trades / hard stop. The $100→$5k rung is 50x — do not size as if 50x is a plan.

Book:
${grounded}`;
  }

  if (desk.id === "polymarket") {
    return `${rules}

Research Polymarket event contracts for Taskra's rung challenge.
Topic: ${f("query", "top volume")}
Lean: ${f("bias", "no lean")}
Horizon: ${f("horizon", "days")}

Paper ideas only. No CLOB orders. Defined risk. Do not bet the rung. Prefer liquid books with a clear resolution source.

Analyze:
${numbered}

Live Polymarket + desk policy:
${grounded}`;
  }

  return `${rules}

Teach how to identify crypto scams and rug pulls before losing money.
Token under review (optional): ${f("token", "general")}
Year: ${f("year", "2026")}

Complete checklist:
${numbered}

Make the operator harder to rug. This desk: paper sell / never add if already in a scam.

Live screen:
${grounded}`;
}

function pairLine(p: DexPair): string {
  const mc = p.marketCap ?? p.fdv ?? 0;
  return `${p.baseToken.symbol} ${p.baseToken.address} MC=$${Math.round(mc)} liq=$${Math.round(p.liquidity?.usd ?? 0)} vol5m=$${Math.round(p.volume?.m5 ?? 0)} px=${p.priceUsd ?? "?"}`;
}

function parseMaxMcap(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/(\d+)\s*M/i);
  if (!m) return null;
  return Number(m[1]) * 1_000_000;
}

function searchQuery(deskId: string, fields: Record<string, string>): string {
  const direct = clip(fields.token || fields.ticker || fields.focus || "", 80);
  if (direct.length >= 2) return direct;
  if (deskId !== "gems" && deskId !== "narratives") return "";
  const sector = (fields.sector || fields.focus || "Meme").toLowerCase();
  if (sector.includes("defi")) return "JUP";
  if (sector.includes("ai")) return "AI16Z";
  if (sector.includes("gaming")) return "gaming solana";
  if (sector.includes("infra")) return "Jito";
  if (sector.includes("bitcoin")) return "WBTC";
  if (sector.includes("nft")) return "NFT solana";
  return "BONK";
}

async function dexLookup(q: string, maxMc: number | null): Promise<string[]> {
  const lines: string[] = [];
  try {
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) {
      const pair = await fetchDexToken(q);
      if (pair) lines.push("Dex token: " + pairLine(pair));
    } else {
      const pairs = await fetchDexSearch(q);
      const filtered =
        maxMc == null
          ? pairs
          : pairs.filter((p) => {
              const mc = p.marketCap ?? p.fdv ?? 0;
              return mc > 0 && mc <= maxMc;
            });
      const use = (filtered.length ? filtered : pairs).slice(0, 6);
      for (const p of use) lines.push("Dex hit: " + pairLine(p));
    }
  } catch {
    lines.push("Dex lookup failed (offline).");
  }
  return lines;
}

export async function gatherDeskContext(
  fields: Record<string, string>,
  store: Store,
  opts?: { policy?: Policy; deskId?: string },
): Promise<string> {
  const lines: string[] = [];
  if (opts?.policy) {
    const p = opts.policy;
    lines.push(
      `Desk policy: hardStop=${p.hardStopPct}% dipHold=${p.dipPctFromPeak}% highSentiment>=${p.highSentiment} volAlive=${p.volumeAlivePctOfBaseline}% maxSol/trade=${p.maxSolPerTrade} dailyBudget=${p.dailyBudgetSol} maxTrades=${p.maxTradesPerDay} minLiq=$${p.minLiquidityUsd} maxTop10=${p.maxTop10HolderPct}%`,
    );
  }
  const open = listOpenPositions(store);
  if (open.length) {
    lines.push("Open paper/live positions: " + open.map((row) => `#${row.id} ${row.ticker} ${row.status}`).join(", "));
  }
  const q = searchQuery(opts?.deskId ?? "", fields);
  if (opts?.deskId === "polymarket") {
    const topic = clip(fields.query || fields.token || fields.ticker || "", 80);
    try {
      const events = await searchPolymarket(topic, 6);
      lines.push(formatPolymarketGrounding(events));
    } catch {
      lines.push("Polymarket lookup failed (offline). Research still allowed; do not invent prices.");
    }
  } else if (q.length >= 2) {
    const maxMc = opts?.deskId === "gems" ? parseMaxMcap(fields.mcap || "") : null;
    lines.push(...(await dexLookup(q, maxMc)));
  }
  return lines.join("\n") || "No live Dex/position grounding.";
}

const FRAMEWORK_NOTES: Record<string, string[]> = {
  sentiment: [
    "Score from X volume, ratio of bullish vs dump talk, and whether KOLs or bots dominate.",
    "Rising mentions with no Dex volume is usually paid shill, not demand.",
    "Influencers: prefer accounts that posted before the candle, not after.",
    "Themes: launch, listing, raid, lawsuit, team dump — tag which one is driving the thread.",
    "Red flags: stealth ticker clone, 'guaranteed x', hidden CA, raid-for-pay.",
    "Hype vs substance: contract verified, LP locked, unique holders rising = substance; slogan-only = hype.",
    "Vs 7d ago: compare mention rate and whether the same wallets are still bidding.",
    "Momentum growing only if Dex 5m volume and unique buyers expand with the posts.",
  ],
  gems: [
    "Early potential: MC under your cap, liq > desk min, organic unique holders, not a ticker clone.",
    "Rug flags: mint/freeze on, LP unlocked, top-10 > policy max, bundled snipers, anonymous recycled Twitter.",
    "Dev activity: GitHub/commits, Pump.fun reply quality, not a 10-minute-old domain.",
    "Community: replies from new accounts vs raids; Discord/Telegram with slow human growth beats instant 50k.",
    "Tokenomics: no 50% team unlock this week; tax 0 on Solana memes is normal — hidden tax is not.",
    "Find first: Pump.fun new, DexScreener boosted=false, inner CT, this desk watchlist — never paid Telegram calls.",
    "DD: mint, freeze, LP lock, holder graph, site WHOIS, audit if any, then paper size only.",
  ],
  evaluate: [
    "Fundamentals: what problem, who pays, why Solana — memes can score 'culture' but say so.",
    "Team: doxxed prior exits vs anon with a trail of rugs. No LinkedIn screenshot is data.",
    "Tokenomics: supply, float, vesting, insider %. If unknown, verdict cannot be Buy.",
    "Tech: fork vs novel. Most memes have none — grade honestly.",
    "Competition: ticker collisions and the incumbent meme in the same niche.",
    "Community: quality of replies, not follower count.",
    "Backers: named funds vs fake 'partner' logos.",
    "Flags: upgradeable malicious program, wash volume, stealth liquidity pulls.",
    "Targets: range from invalidation to 2x on this desk's budget — no 100x math without float.",
    "Verdict: Buy / Hold / Avoid for paper size. Default Avoid when data is missing.",
  ],
  whales: [
    "Large moves: exchange cold → hot is often distribution; fresh wallet cluster after a dip can be accumulation.",
    "Accumulation: many mid-size buys, falling exchange reserves, little impact — not one market-buy wick.",
    "Smart-money entry: repeat profitable wallets adding; exit: those wallets seed CEX or new mixers.",
    "Track: Solscan/Helius, labels, this mint's top holders. Do not copy-trade blindly.",
    "Metrics: holder concentration, LP, volume/MC, wash-sale loops, funding if perps exist.",
    "Tools: DexScreener, Birdeye, Solscan, Bubblemaps, CEX inflow dashboards.",
    "Position: paper, size ≤ maxSolPerTrade. Never widen the hard stop because a whale bought.",
    "Manipulation: spoofed size, wash volume, coordinated CT + one wallet dumping into the raid.",
  ],
  timing: [
    "Entries: only in desk-valid setups (score + rules). No FOMO mid-vertical.",
    "DCA: split the maxSolPerTrade budget, never extra budget unless ALLOW_EXTRA_BUDGET.",
    "Take-profit: return principal at 1x first, then runner with trail. 100x is not a plan.",
    "Stop: desk hard stop is the floor. Tighter is allowed; looser is not.",
    "Watch: 5m volume, impact, LP, BTC beta if the book is risk-off.",
    "Sentiment: high/rising + healthy dip + volume alive = HOLD, not sell.",
    "Scale: add only inside daily budget and cooldown. Cut losers at stop, not at hope.",
    "Hold vs sell: HOLD on healthy_dip rule; sell dump/climax/time-stop/hard-stop.",
  ],
  narratives: [
    "X traction: rising unique posters, not the same 12 raid accounts.",
    "Sectors: follow fee/revenue and new mint rate, not slogans.",
    "Projects: Solana names this desk can buy. Skip illiquid off-chain stories.",
    "Influencer/VC: note who rotated, with timestamps vs price.",
    "Macro/reg: ETF, rate path, exchange actions — opportunity or trap.",
    "History: last cycle's leftover narrative often rugs first.",
    "Contrarian: quiet high-quality builders vs crowded ticker clones.",
    "3-month: paper allocation only; no leverage; review weekly.",
  ],
  portfolio: [
    "Allocation: this hot wallet is meme-risk, not a 60/40. Keep a boring stack elsewhere.",
    "Names: watchlist blue-chip memes vs high-risk new; never the whole budget in one mint.",
    "Blue vs degen: conservative 80/20, moderate 60/40, aggressive 40/60 — still cap per trade.",
    "Rebalance: after a 1x principal return, or weekly, not every candle.",
    "Take profits: principal first, then scale out into strength. Do not disable stops to 'let it run'.",
    "Risk: daily budget, max trades, loss cap, cooldown. Hitting a cap stops buys, not paper exits.",
    "Sizing: ≤ maxSolPerTrade unless Taskra confirms a high-sentiment one-shot up to sizeAskCeilingSol. Never auto-bump.",
    "Review: after each session + a weekly grade of closed fills (win/meh/fail).",
  ],
  scams: [
    "Tokenomics: infinite mint, hidden tax, 100% insider, vesting that unlocks on TGE.",
    "Team: stolen pfp, reused rug handle, 'doxx' that is a stock photo.",
    "Audits: no audit or a PDF from a mill. Upgradeable program with unnamed upgrade key.",
    "Liquidity: unlocked LP, one wallet = LP, thin book vs advertised MC.",
    "Social: bought followers, identical raid replies, CA posted only in DMs.",
    "Site/WP: cloned WordPress, plagiarized WP, no imprint, URL registered today.",
    "P&D: staircase bids, Telegram VIP, then one-candle exit.",
    "Tools: RugCheck, DexScreener, Solscan holders, Bubblemaps, WHOIS, this desk Auditor.",
    "2026 tactics: AI-cloned KOL video, fake stream-unlock, lookalike tickers, 'revenue-share' with no on-chain fee switch.",
    "If already in: this desk paper-sells / never adds. Live: do not send more. Record the mint as a lesson.",
  ],
  polymarket: [
    "Quote the exact question and the resolution source (site + what counts as Yes).",
    "Implied odds from the book vs a conservative base rate. If you cannot name a base rate, Avoid.",
    "Mispricing needs a specific information edge, not a vibe. Sports shorts need a number (Elo, injury, hours to start).",
    "Max loss = paper size. Never 'I'll add if it goes against me' on the first rung.",
    "Size: tiny vs declared bankroll. First rung ($100→$5k) paper $5–$20 ideas, not $50.",
    "Kill if the story changes, liquidity dries, or the event is postponed into 50-50 rules.",
    "If the same view is already in a Solana meme, do not stack it on Polymarket.",
    "Watch / Paper / Avoid. Default Avoid. Log Watch/Paper via POST /api/challenge/ideas.",
  ],
};

function offlineReport(desk: DeskDef, fields: Record<string, string>, grounded: string): string {
  const notes = FRAMEWORK_NOTES[desk.id] ?? [];
  const body = desk.sections
    .map((s, i) => `${i + 1}. ${s}\n   ${notes[i] ?? "Fill from live Grok + X when XAI_API_KEY is set."}`)
    .join("\n");
  return [
    `${desk.title} — offline framework (set XAI_API_KEY for live Grok + X search).`,
    `Inputs: ${JSON.stringify(fields)}`,
    "",
    "Live grounding:",
    grounded,
    "",
    body,
    "",
    "Research only. Paper default. Hard stop and HOLD rule still apply.",
  ].join("\n");
}

export async function runDeskAnalysis(opts: {
  id: string;
  fields: Record<string, string>;
  cfg: AppConfig;
  store: Store;
  policy?: Policy;
  ask?: typeof askGrokDesk;
}): Promise<DeskRun> {
  const desk = getDesk(opts.id);
  if (!desk) throw new Error("unknown desk");
  const fields: Record<string, string> = {};
  for (const spec of desk.fields) {
    const fallback = spec.type === "select" ? (spec.options?.[0] ?? "") : "";
    fields[spec.key] = clip(String(opts.fields[spec.key] ?? fallback), 400);
  }
  const grounded = await gatherDeskContext(fields, opts.store, { policy: opts.policy, deskId: desk.id });
  const prompt = buildDeskPrompt(desk, fields, grounded);
  const ask = opts.ask ?? askGrokDesk;
  const out = await ask({
    xaiKey: opts.cfg.xaiKey,
    openaiKey: opts.cfg.openaiKey,
    model: opts.cfg.xaiKey ? opts.cfg.grokModel : opts.cfg.openaiModel,
    prompt,
    timeoutMs: 55_000,
    useXSearch: desk.useXSearch,
  });
  const report =
    out.via === "none" || !out.text.trim() ? offlineReport(desk, fields, grounded) : out.text.trim();
  const run: DeskRun = {
    id: desk.id,
    title: desk.title,
    at: Date.now(),
    via: out.via === "none" || !out.text.trim() ? "offline" : out.via,
    fields,
    grounded,
    report,
  };
  lastRuns.set(desk.id, run);
  return run;
}
