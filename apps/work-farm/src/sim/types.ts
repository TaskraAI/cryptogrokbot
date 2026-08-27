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
  research: "RESEARCH",
  build: "BUILD",
  tools: "TOOLS",
  inbox: "INBOX",
  test: "TEST",
  check: "CHECK",
  delivery: "DELIVERY",
};

export const STAGE_COLOR: Record<StageId, number> = {
  research: 0x8b5cf6,
  build: 0x3b82f6,
  tools: 0xef4444,
  inbox: 0x22c55e,
  test: 0x38bdf8,
  check: 0xd97706,
  delivery: 0xf43f5e,
};

export const STAGE_ICON: Record<StageId, string> = {
  research: "🔍",
  build: "</>",
  tools: "🛠",
  inbox: "✉",
  test: "⚗",
  check: "✓",
  delivery: "📦",
};

export type AgentStatus = "idle" | "walking" | "working";

export interface Agent {
  id: string;
  name: string;
  color: number;
  hat: number;
  status: AgentStatus;
  stage: StageId | null;
  path: { x: number; y: number }[];
  pathIndex: number;
  x: number;
  y: number;
  workUntil: number;
  jobId: string | null;
}

export interface Job {
  id: string;
  title: string;
  stageIndex: number;
  progress: number;
  agentId: string | null;
  done: boolean;
}

export interface FeedItem {
  id: string;
  at: number;
  text: string;
}

export interface SimSnapshot {
  now: number;
  startedAt: number;
  agents: Agent[];
  jobs: Job[];
  feed: FeedItem[];
  tasksDone: number;
  tasksGoal: number;
  tasksInProgress: number;
  timeSavedMs: number;
  valueCreated: number;
  valueHistory: number[];
  activityHistory: number[];
  stageProgress: Record<StageId, number>;
  inboxCount: number;
  agentsOnline: number;
  agentsTotal: number;
}

export const TILE = 16;
export const MAP_W = 48;
export const MAP_H = 32;

/** World pixel anchors for each stage building door. */
export const BUILDING_ANCHORS: Record<StageId, { x: number; y: number; labelX: number; labelY: number }> = {
  research: { x: 8 * TILE, y: 8 * TILE, labelX: 8 * TILE, labelY: 5.2 * TILE },
  build: { x: 18 * TILE, y: 7 * TILE, labelX: 18 * TILE, labelY: 4.2 * TILE },
  tools: { x: 28 * TILE, y: 8 * TILE, labelX: 28 * TILE, labelY: 5.2 * TILE },
  inbox: { x: 38 * TILE, y: 10 * TILE, labelX: 38 * TILE, labelY: 7.2 * TILE },
  test: { x: 12 * TILE, y: 18 * TILE, labelX: 12 * TILE, labelY: 15.2 * TILE },
  check: { x: 24 * TILE, y: 20 * TILE, labelX: 24 * TILE, labelY: 17.2 * TILE },
  delivery: { x: 36 * TILE, y: 19 * TILE, labelX: 36 * TILE, labelY: 16.2 * TILE },
};

export const PLAZA = { x: 24 * TILE, y: 14 * TILE };
