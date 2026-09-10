/** Shared farm + GrokBot crew types */

export const CREW_IDS = [
  "scout",
  "grok",
  "scholar",
  "sentinel",
  "auditor",
  "chief",
] as const;

export type CrewId = (typeof CREW_IDS)[number];

export type CrewStatus = "idle" | "running" | "blocked" | "error";

export const CREW_META: Record<
  CrewId,
  { title: string; job: string; color: number; hat: number; home: StageId }
> = {
  scout: {
    title: "Scout",
    job: "X / social / Pump.fun / DexScreener",
    color: 0x22c55e,
    hat: 0,
    home: "research",
  },
  grok: {
    title: "Grok",
    job: "thesis + runner gray-zone (xAI)",
    color: 0xa855f7,
    hat: 4,
    home: "build",
  },
  scholar: {
    title: "Scholar",
    job: "journal, mistakes, extra rules",
    color: 0x3b82f6,
    hat: 1,
    home: "tools",
  },
  sentinel: {
    title: "Sentinel",
    job: "tape, exits, dip-hold",
    color: 0xf59e0b,
    hat: 2,
    home: "test",
  },
  auditor: {
    title: "Auditor",
    job: "bug scan, paper/live fail-closed",
    color: 0xef4444,
    hat: 3,
    home: "check",
  },
  chief: {
    title: "Chief",
    job: "budget, chances, APPROVE, handoffs",
    color: 0xf43f5e,
    hat: 0,
    home: "delivery",
  },
};

export const STAGES = [
  "research",
  "build",
  "tools",
  "inbox",
  "test",
  "check",
  "delivery",
] as const;

export type StageId = (typeof STAGES)[number];

export const STAGE_LABEL: Record<StageId, string> = {
  research: "SCOUT",
  build: "GROK",
  tools: "SCHOLAR",
  inbox: "INBOX",
  test: "SENTINEL",
  check: "AUDITOR",
  delivery: "CHIEF",
};

export const STAGE_COLOR: Record<StageId, number> = {
  research: 0x22c55e,
  build: 0xa855f7,
  tools: 0x3b82f6,
  inbox: 0xeab308,
  test: 0xf59e0b,
  check: 0xef4444,
  delivery: 0xf43f5e,
};

export const STAGE_ICON: Record<StageId, string> = {
  research: "🔍",
  build: "</>",
  tools: "📚",
  inbox: "✉",
  test: "👁",
  check: "✓",
  delivery: "⚖",
};

export type AgentMotion = "idle" | "walking" | "working";

export interface FarmAgent {
  id: CrewId;
  name: string;
  job: string;
  color: number;
  hat: number;
  crewStatus: CrewStatus;
  motion: AgentMotion;
  detail: string;
  stage: StageId;
  path: { x: number; y: number }[];
  pathIndex: number;
  x: number;
  y: number;
  ticks: number;
}

export type TradeSide = "BUY" | "SELL";

export interface TradeFill {
  id: string;
  at: number;
  side: TradeSide;
  ticker: string;
  mint: string;
  sol: number;
  agent: CrewId;
  note: string;
  mode: "PAPER" | "LIVE";
}

export interface OpenTrade {
  id: string;
  ticker: string;
  mint: string;
  mode: "PAPER" | "LIVE";
  solSpent: number;
  tokensHeld: number;
  netSol: number | null;
  openedAt: number;
  status: "open" | "closed";
}

export interface DecisionEvent {
  id: string;
  at: number;
  agent: CrewId;
  kind: "entry" | "exit" | "block" | "hold" | "approve" | "scan" | "thesis" | "lead";
  text: string;
  major: boolean;
}

export interface FeedItem {
  id: string;
  at: number;
  text: string;
}

export interface PnlState {
  paperNetSol: number;
  paperTrades: number;
  liveNetSol: number;
  liveTrades: number;
  winRatePaper: number;
}

export interface FarmSnapshot {
  now: number;
  startedAt: number;
  source: "live" | "sim";
  mode: "PAPER" | "LIVE";
  masterEnabled: boolean;
  agents: FarmAgent[];
  feed: FeedItem[];
  decisions: DecisionEvent[];
  fills: TradeFill[];
  positions: OpenTrade[];
  pnl: PnlState;
  pnlHistory: number[];
  activityHistory: number[];
  stageProgress: Record<StageId, number>;
  openCount: number;
  inboxCount: number;
  agentsOnline: number;
  agentsTotal: number;
  tasksDone: number;
  tasksInProgress: number;
}

export const TILE = 16;
export const MAP_W = 48;
export const MAP_H = 32;

export const BUILDING_ANCHORS: Record<
  StageId,
  { x: number; y: number; labelX: number; labelY: number }
> = {
  research: { x: 14 * TILE, y: 7 * TILE, labelX: 14 * TILE, labelY: 4.2 * TILE },
  build: { x: 24 * TILE, y: 6 * TILE, labelX: 24 * TILE, labelY: 3.2 * TILE },
  tools: { x: 34 * TILE, y: 7 * TILE, labelX: 34 * TILE, labelY: 4.2 * TILE },
  inbox: { x: 38 * TILE, y: 14 * TILE, labelX: 38 * TILE, labelY: 11.2 * TILE },
  test: { x: 14 * TILE, y: 20 * TILE, labelX: 14 * TILE, labelY: 17.2 * TILE },
  check: { x: 24 * TILE, y: 22 * TILE, labelX: 24 * TILE, labelY: 19.2 * TILE },
  delivery: { x: 34 * TILE, y: 20 * TILE, labelX: 34 * TILE, labelY: 17.2 * TILE },
};

export const PLAZA = { x: 24 * TILE, y: 14 * TILE };
