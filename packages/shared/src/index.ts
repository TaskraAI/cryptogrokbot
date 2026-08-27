export type Mode = "PAPER" | "LIVE";

export type Pattern = "healthy_dip" | "fade" | "dump" | "climax" | "chop";

export type SourceWeight = "trusted" | "watch";

export type Grade = "win" | "meh" | "fail";

export interface Policy {
  dailyBudgetSol: number;
  maxTradesPerDay: number;
  maxOpenPositions: number;
  maxSolPerTrade: number;
  /** One-shot ceiling when Taskra confirms a high-sentiment size increase. */
  sizeAskCeilingSol: number;
  dailyLossCapSol: number;
  cooldownSeconds: number;
  minIndependentSources: number;
  /** Floor for cost-out. Grok Bot may wait up to costOutMaxMultiple on stronger gems. */
  returnPrincipalMultiple: number;
  /** Take initial SOL back at this multiple (2.5x) on weaker names. */
  costOutMinMultiple: number;
  /** Strong rally names wait until this multiple (5x) before cost-out. */
  costOutMaxMultiple: number;
  sentimentPollSeconds: number;
  maxRunnerHoldMinutes: number;
  hardStopPct: number;
  timeStopMinutesIfNeverGreen: number;
  slippagePctCap: number;
  dipPctFromPeak: number;
  highSentiment: number;
  volumeAlivePctOfBaseline: number;
  healthyDipMaxHoldMinutes: number;
  postExitMarkMinutes: number;
  timezone: string;
  minScore: number;
  maxCreatorPct: number;
  maxTop10HolderPct: number;
  maxBuyImpactPct: number;
  runnerTrailPct: number;
  minLiquidityUsd: number;
  compoundWins: boolean;
  compoundWinsFraction: number;
  fadeSellFraction: number;
}

export const DEFAULT_POLICY: Policy = {
  dailyBudgetSol: 0.5,
  maxTradesPerDay: 5,
  maxOpenPositions: 3,
  maxSolPerTrade: 0.1,
  sizeAskCeilingSol: 0.1,
  dailyLossCapSol: 0.3,
  cooldownSeconds: 180,
  minIndependentSources: 2,
  returnPrincipalMultiple: 2.5,
  costOutMinMultiple: 2.5,
  costOutMaxMultiple: 5,
  sentimentPollSeconds: 180,
  maxRunnerHoldMinutes: 480,
  hardStopPct: -25,
  timeStopMinutesIfNeverGreen: 60,
  slippagePctCap: 15,
  dipPctFromPeak: 15,
  highSentiment: 0.4,
  volumeAlivePctOfBaseline: 70,
  healthyDipMaxHoldMinutes: 45,
  postExitMarkMinutes: 30,
  timezone: "UTC",
  minScore: 60,
  maxCreatorPct: 8,
  maxTop10HolderPct: 40,
  maxBuyImpactPct: 12,
  runnerTrailPct: 20,
  minLiquidityUsd: 5000,
  compoundWins: false,
  compoundWinsFraction: 0.25,
  fadeSellFraction: 1,
};

export interface MarketSnapshot {
  at: number;
  priceUsd: number;
  marketCapUsd: number;
  volume1m: number;
  volume5m: number;
  volume15m: number;
  volume1h: number;
  volumeBaseline5m: number;
  volumeDeltaPct: number;
  buySellRatio: number;
  liquidityUsd: number;
  holders: number;
  topHolderPct: number;
  creatorPct: number;
  sentiment: number;
  mentionVelocity: number;
  mentionVelocityBaseline: number;
  trustedSourcesStillPosting: number;
  uniqueRecentSources: number;
  pctFromEntry: number;
  pctFromPeak: number;
}

export interface SourceHit {
  platform: "x" | "telegram" | "discord" | "rss" | "dexscreener" | "wallet";
  key: string;
  weight: SourceWeight;
  permalink?: string;
  snippet: string;
  at: number;
  mint?: string;
  ticker?: string;
}

export interface TokenMetrics {
  mint: string;
  ticker: string;
  name?: string;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume1h: number;
  volume5m: number;
  holders: number;
  creatorPct: number;
  top10HolderPct: number;
  buyImpactPct: number;
  ageMinutes: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  sellSimOk: boolean;
  graduated: boolean;
}

export interface DecisionLog {
  at: number;
  kind: "entry" | "exit" | "block" | "hold" | "sentiment" | "ask";
  mint: string;
  allowed: boolean;
  reason: string;
  score?: number;
  pattern?: Pattern;
  payload?: Record<string, unknown>;
}

export type ExitReason =
  | "hard_stop"
  | "rug"
  | "time_stop"
  | "sellall"
  | "max_runner_hold"
  | "compound"
  | "fade"
  | "dump"
  | "climax"
  | "sentiment"
  | "healthy_dip_hold"
  | "chop_hold"
  | "awaiting_principal"
  | "moon_bag"
  | "strong_rally_let_run";

export type ExitAction =
  | { type: "flatten"; reason: Extract<ExitReason, "hard_stop" | "rug" | "time_stop" | "sellall" | "max_runner_hold" | "dump"> }
  | { type: "return_principal"; reason: "compound" }
  | { type: "sell_runner"; reason: Extract<ExitReason, "fade" | "climax" | "sentiment"> }
  | { type: "hold"; reason: Extract<ExitReason, "healthy_dip_hold" | "chop_hold" | "awaiting_principal" | "moon_bag" | "strong_rally_let_run"> };

export interface PositionState {
  id: number;
  mint: string;
  ticker: string;
  mode: Mode;
  openedAt: number;
  entryPriceUsd: number;
  principalSol: number;
  tokensHeld: number;
  tokensInitial: number;
  solSpent: number;
  principalRecoveredSol: number;
  peakPriceUsd: number;
  everGreen: boolean;
  runner: boolean;
  lastPattern: Pattern | null;
  patternPath: string;
  healthyDipSince: number | null;
  status: "open" | "closed";
  sourcesJson: string;
  /** Per-bag cost-out target, usually 2.5–5. */
  costOutMultiple: number;
}

export interface BudgetState {
  dayKey: string;
  spentSol: number;
  trades: number;
  realizedLossSol: number;
  lastEntryAt: number;
  extraBudgetSol: number;
}

export interface RuntimeFlags {
  mode: Mode;
  masterEnabled: boolean;
  rpcHealthy: boolean;
  jupiterHealthy: boolean;
  telegramHealthy: boolean;
  /** When true, budget.extraBudgetSol may raise the daily cap. Default off. */
  allowExtraBudget?: boolean;
}

export function dayKey(now = Date.now(), timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

export function solscanTx(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

export function solscanToken(mint: string): string {
  return `https://solscan.io/token/${mint}`;
}
