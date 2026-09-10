import {
  BUILDING_ANCHORS,
  CREW_IDS,
  CREW_META,
  PLAZA,
  STAGES,
  type CrewId,
  type CrewStatus,
  type DecisionEvent,
  type FarmAgent,
  type FarmSnapshot,
  type FeedItem,
  type OpenTrade,
  type PnlState,
  type StageId,
  type TradeFill,
} from "./types";

const TICKERS = ["BONK", "WIF", "POPCAT", "TRUMP", "MOODENG", "MEW", "PNUT", "GOAT"];
const MINTS: Record<string, string> = {
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  POPCAT: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  TRUMP: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
  MOODENG: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY",
  MEW: "MEW1gQWJ3nEXg2qgERiXuLXb2WHiTHCKjDvM8KGkLgw",
  PNUT: "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump",
  GOAT: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump",
};

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function lerpPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  const mid = {
    x: from.x + (to.x - from.x) * 0.5 + (Math.random() - 0.5) * 20,
    y: from.y + (to.y - from.y) * 0.5 + (Math.random() - 0.5) * 14,
  };
  return [from, mid, to];
}

function doorOf(stage: StageId): { x: number; y: number } {
  const a = BUILDING_ANCHORS[stage];
  return {
    x: a.x + (Math.random() - 0.5) * 14,
    y: a.y + 8 + Math.random() * 6,
  };
}

const WORK_LINES: Record<CrewId, string[]> = {
  scout: [
    "scanning X / Pump.fun leads",
    "DexScreener volume spike",
    "new CA from social tape",
    "filtering rug keywords",
  ],
  grok: [
    "writing entry thesis",
    "runner gray-zone check",
    "scoring narrative fit",
    "xAI desk brief",
  ],
  scholar: [
    "journaling last fill",
    "extra rule review",
    "pattern lesson draft",
    "grading closed bag",
  ],
  sentinel: [
    "watching open bags",
    "dip-hold sentiment ≥ 0.4",
    "cost-out ladder armed",
    "hard-stop tape check",
  ],
  auditor: [
    "paper/live fail-closed scan",
    "secrets not in git",
    "size-cap assertion",
    "typecheck desk",
  ],
  chief: [
    "budget + chance queue",
    "APPROVE handoff ready",
    "routing Scout → Grok",
    "daily cap watch",
  ],
};

/** Offline GrokBot farm: all six crew desks stay busy with trades + decisions. */
export class GrokFarmSim {
  private agents = new Map<CrewId, FarmAgent>();
  private feed: FeedItem[] = [];
  private decisions: DecisionEvent[] = [];
  private fills: TradeFill[] = [];
  private positions: OpenTrade[] = [];
  private startedAt = Date.now();
  private pnl: PnlState = {
    paperNetSol: 0,
    paperTrades: 0,
    liveNetSol: 0,
    liveTrades: 0,
    winRatePaper: 0,
  };
  private pnlHistory: number[] = Array.from({ length: 24 }, () => 0);
  private activityHistory: number[] = Array.from({ length: 12 }, () => 0);
  private wins = 0;
  private closed = 0;
  private inboxCount = 3;
  private tasksDone = 0;
  private tickAcc = 0;
  private nextEventAt = 0;
  private workUntil = new Map<CrewId, number>();

  constructor() {
    for (const id of CREW_IDS) {
      const meta = CREW_META[id];
      const home = doorOf(meta.home);
      this.agents.set(id, {
        id,
        name: meta.title,
        job: meta.job,
        color: meta.color,
        hat: meta.hat,
        crewStatus: "running",
        motion: "working",
        detail: pick(WORK_LINES[id]),
        stage: meta.home,
        path: [],
        pathIndex: 0,
        x: home.x,
        y: home.y,
        ticks: 1,
      });
      this.workUntil.set(id, Date.now() + 1500 + Math.random() * 2500);
    }
    this.pushFeed("GrokBot farm online — all six crew desks live");
    this.pushDecision("chief", "approve", "Chief opened the farm desk", true);
    // seed one open paper bag so HUD is never empty
    this.openBuy("scout", pick(TICKERS), 0.05, "Scout seed watchlist fill");
  }

  snapshot(now = Date.now()): FarmSnapshot {
    const agents = CREW_IDS.map((id) => {
      const a = this.agents.get(id)!;
      return { ...a, path: [...a.path] };
    });
    const working = agents.filter((a) => a.crewStatus === "running").length;
    const stageProgress = Object.fromEntries(
      STAGES.map((stage, idx) => {
        const here = agents.filter((a) => a.stage === stage).length;
        const wave = (Math.sin(now / 3200 + idx) + 1) * 16;
        const base = 28 + here * 22 + wave + (stage === "inbox" ? this.inboxCount * 4 : 0);
        return [stage, Math.max(18, Math.min(94, Math.round(base)))];
      }),
    ) as Record<StageId, number>;

    const meta = this.liveMeta();

    return {
      now,
      startedAt: this.startedAt,
      source: meta.source,
      mode: meta.mode,
      masterEnabled: meta.masterEnabled,
      agents,
      feed: this.feed.slice(0, 16),
      decisions: this.decisions.slice(0, 12),
      fills: this.fills.slice(0, 12),
      positions: this.positions.filter((p) => p.status === "open"),
      pnl: { ...this.pnl },
      pnlHistory: [...this.pnlHistory],
      activityHistory: [...this.activityHistory],
      stageProgress,
      openCount: this.positions.filter((p) => p.status === "open").length,
      inboxCount: this.inboxCount,
      agentsOnline: agents.length,
      agentsTotal: agents.length,
      tasksDone: this.tasksDone,
      tasksInProgress: working,
    };
  }

  update(dtMs: number, now = Date.now()): FarmSnapshot {
    this.tickAcc += dtMs;
    while (this.tickAcc >= 50) {
      this.tickAcc -= 50;
      this.step(50, now);
    }
    return this.snapshot(now);
  }

  /** Apply a live desk snapshot on top of motion (agents already exist). */
  applyLive(partial: {
    pulses?: Array<{
      id: string;
      status: CrewStatus;
      detail: string;
      ticks?: number;
    }>;
    log?: Array<{ at: number; id: string; detail: string }>;
    pnl?: Partial<PnlState>;
    positions?: OpenTrade[];
    fills?: TradeFill[];
    decisions?: DecisionEvent[];
    mode?: "PAPER" | "LIVE";
    masterEnabled?: boolean;
    inboxCount?: number;
  }): void {
    if (partial.pulses) {
      for (const p of partial.pulses) {
        if (!CREW_IDS.includes(p.id as CrewId)) continue;
        const id = p.id as CrewId;
        const agent = this.agents.get(id);
        if (!agent) continue;
        const prev = agent.crewStatus;
        agent.crewStatus = p.status;
        agent.detail = p.detail || agent.detail;
        agent.ticks = p.ticks ?? agent.ticks;
        if (p.status === "running" && prev !== "running") {
          this.sendHome(agent, "working");
        } else if (p.status === "blocked") {
          this.sendTo(agent, "inbox", "walking");
        } else if (p.status === "idle") {
          this.sendHome(agent, "idle");
        } else if (p.status === "error") {
          this.sendTo(agent, "check", "walking");
        }
      }
    }
    if (partial.log) {
      for (const e of [...partial.log].reverse()) {
        const text = `${hhmm(e.at)} ${titleCase(e.id)}: ${e.detail}`;
        if (!this.feed.some((f) => f.text === text)) {
          this.feed.unshift({ id: uid("feed"), at: e.at, text });
        }
      }
      if (this.feed.length > 40) this.feed.length = 40;
    }
    if (partial.pnl) this.pnl = { ...this.pnl, ...partial.pnl };
    if (partial.positions) this.positions = partial.positions;
    if (partial.fills) this.fills = partial.fills;
    if (partial.decisions) this.decisions = partial.decisions;
    if (partial.mode) {
      /* mode applied in snapshot via flag — stored on instance */
      (this as unknown as { _mode?: string })._mode = partial.mode;
    }
    if (typeof partial.masterEnabled === "boolean") {
      (this as unknown as { _master?: boolean })._master = partial.masterEnabled;
    }
    if (typeof partial.inboxCount === "number") this.inboxCount = partial.inboxCount;
  }

  liveMeta(): { mode: "PAPER" | "LIVE"; masterEnabled: boolean; source: "live" | "sim" } {
    const mode = ((this as unknown as { _mode?: "PAPER" | "LIVE" })._mode ?? "PAPER") as
      | "PAPER"
      | "LIVE";
    const masterEnabled = Boolean((this as unknown as { _master?: boolean })._master);
    const source = (this as unknown as { _source?: "live" | "sim" })._source ?? "sim";
    return { mode, masterEnabled, source };
  }

  markLive(on: boolean): void {
    (this as unknown as { _source?: "live" | "sim" })._source = on ? "live" : "sim";
  }

  private step(dt: number, now: number): void {
    for (const agent of this.agents.values()) {
      this.advanceMotion(agent, dt, now);
    }

    const live = this.liveMeta().source === "live";

    if (!live && now >= this.nextEventAt) {
      this.rollEvent();
      this.nextEventAt = now + 1800 + Math.random() * 2200;
    }

    // keep everyone productively cycling (sim only invents work; live uses pulse details)
    if (!live) {
      for (const agent of this.agents.values()) {
        if (agent.motion === "idle" && agent.crewStatus !== "blocked") {
          agent.crewStatus = "running";
          agent.detail = pick(WORK_LINES[agent.id]);
          this.sendHome(agent, "working");
          this.workUntil.set(agent.id, now + 2000 + Math.random() * 4000);
        }
        if (agent.motion === "working" && now >= (this.workUntil.get(agent.id) ?? 0)) {
          const roam = Math.random() < 0.35 ? "inbox" : agent.stage;
          if (roam !== agent.stage && Math.random() < 0.5) {
            this.sendTo(agent, roam as StageId, "walking");
          } else {
            agent.detail = pick(WORK_LINES[agent.id]);
            agent.ticks += 1;
            this.workUntil.set(agent.id, now + 2200 + Math.random() * 3800);
            this.pushFeed(`${hhmm(now)} ${agent.name}: ${agent.detail}`);
          }
        }
      }
    } else {
      for (const agent of this.agents.values()) {
        if (agent.motion === "working" && agent.crewStatus === "running") {
          // gentle desk bob path refresh toward home if stranded
          if (Math.random() < 0.002) this.sendHome(agent, "working");
        }
      }
    }

    const active = [...this.agents.values()].filter((a) => a.crewStatus === "running").length;
    this.activityHistory.push(active);
    if (this.activityHistory.length > 12) this.activityHistory.shift();

    this.pnlHistory.push(this.pnl.paperNetSol + this.pnl.liveNetSol);
    if (this.pnlHistory.length > 24) this.pnlHistory.shift();
  }

  private rollEvent(): void {
    const roll = Math.random();
    if (roll < 0.22) {
      const ticker = pick(TICKERS);
      this.pushDecision("scout", "lead", `Scout queued ${ticker} from social/Dex`, true);
      this.inboxCount = Math.min(20, this.inboxCount + 1);
      this.busy("scout", "research", `lead collected · ${ticker}`);
      this.busy("chief", "inbox", "triaging chance queue");
    } else if (roll < 0.4) {
      const ticker = pick(TICKERS);
      this.pushDecision("grok", "thesis", `Grok thesis ready on ${ticker}`, true);
      this.busy("grok", "build", `thesis · ${ticker}`);
      this.busy("chief", "delivery", `APPROVE check · ${ticker}`);
    } else if (roll < 0.58) {
      const ticker = pick(TICKERS);
      const sol = Number((0.03 + Math.random() * 0.07).toFixed(3));
      this.pushDecision("chief", "approve", `Chief APPROVE paper buy ${ticker} ${sol} SOL`, true);
      this.openBuy("chief", ticker, sol, "Chief APPROVE → paper entry");
      this.busy("chief", "delivery", `approved BUY ${ticker}`);
      this.busy("sentinel", "test", `armed exits · ${ticker}`);
    } else if (roll < 0.72 && this.positions.some((p) => p.status === "open")) {
      const open = this.positions.filter((p) => p.status === "open");
      const pos = pick(open);
      this.pushDecision("sentinel", "exit", `Sentinel exit ${pos.ticker} — cost-out/tape`, true);
      this.closeSell("sentinel", pos, "Sentinel exit");
    } else if (roll < 0.82) {
      this.pushDecision("auditor", "scan", "Auditor pass · paper fail-closed OK", false);
      this.busy("auditor", "check", "scan complete");
    } else if (roll < 0.9) {
      this.pushDecision("scholar", "hold", "Scholar logged lesson from last bag", false);
      this.busy("scholar", "tools", "journal update");
    } else {
      this.pushDecision("sentinel", "hold", "Sentinel HOLD · healthy dip + sentiment", true);
      this.busy("sentinel", "test", "dip-hold active");
    }
  }

  private openBuy(agent: CrewId, ticker: string, sol: number, note: string): void {
    const mint = MINTS[ticker] ?? uid("mint");
    const pos: OpenTrade = {
      id: uid("pos"),
      ticker,
      mint,
      mode: "PAPER",
      solSpent: sol,
      tokensHeld: Math.round(10_000 + Math.random() * 90_000),
      netSol: null,
      openedAt: Date.now(),
      status: "open",
    };
    this.positions.unshift(pos);
    const fill: TradeFill = {
      id: uid("fill"),
      at: Date.now(),
      side: "BUY",
      ticker,
      mint,
      sol,
      agent,
      note,
      mode: "PAPER",
    };
    this.fills.unshift(fill);
    this.pnl.paperTrades += 1;
    this.inboxCount = Math.max(0, this.inboxCount - 1);
    this.tasksDone += 1;
    this.pushFeed(`${hhmm(Date.now())} BUY ${ticker} · ${sol} SOL · ${CREW_META[agent].title}`);
  }

  private closeSell(agent: CrewId, pos: OpenTrade, note: string): void {
    const pnl = Number(((Math.random() - 0.35) * pos.solSpent * 1.8).toFixed(4));
    pos.status = "closed";
    pos.netSol = pnl;
    this.fills.unshift({
      id: uid("fill"),
      at: Date.now(),
      side: "SELL",
      ticker: pos.ticker,
      mint: pos.mint,
      sol: Math.abs(pnl),
      agent,
      note,
      mode: "PAPER",
    });
    this.pnl.paperNetSol = Number((this.pnl.paperNetSol + pnl).toFixed(4));
    this.pnl.paperTrades += 1;
    this.closed += 1;
    if (pnl > 0) this.wins += 1;
    this.pnl.winRatePaper = this.closed ? this.wins / this.closed : 0;
    this.tasksDone += 1;
    this.pushFeed(
      `${hhmm(Date.now())} SELL ${pos.ticker} · ${pnl >= 0 ? "+" : ""}${pnl} SOL · ${CREW_META[agent].title}`,
    );
  }

  private busy(id: CrewId, stage: StageId, detail: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.crewStatus = "running";
    agent.detail = detail;
    agent.ticks += 1;
    this.sendTo(agent, stage, "walking");
    this.workUntil.set(id, Date.now() + 2500 + Math.random() * 3000);
  }

  private sendHome(agent: FarmAgent, motion: "idle" | "working"): void {
    const home = CREW_META[agent.id].home;
    this.sendTo(agent, home, motion === "idle" ? "walking" : "walking");
    if (motion === "idle") {
      // after walk completes → idle (handled when path ends with intent)
      (agent as FarmAgent & { _idleAfter?: boolean })._idleAfter = true;
    } else {
      (agent as FarmAgent & { _idleAfter?: boolean })._idleAfter = false;
    }
  }

  private sendTo(agent: FarmAgent, stage: StageId, _motion: "walking" | "working" | "idle"): void {
    const dest = doorOf(stage);
    agent.stage = stage;
    agent.motion = "walking";
    agent.path = lerpPath({ x: agent.x, y: agent.y }, dest);
    agent.pathIndex = 0;
  }

  private advanceMotion(agent: FarmAgent, dt: number, _now: number): void {
    if (agent.motion !== "walking") return;
    const target = agent.path[agent.pathIndex];
    if (!target) {
      const idleAfter = (agent as FarmAgent & { _idleAfter?: boolean })._idleAfter;
      agent.motion = idleAfter ? "idle" : "working";
      agent.path = [];
      agent.pathIndex = 0;
      if (idleAfter) agent.crewStatus = "idle";
      return;
    }
    const speed = 0.06;
    const dx = target.x - agent.x;
    const dy = target.y - agent.y;
    const dist = Math.hypot(dx, dy) || 1;
    const step = speed * dt;
    if (step >= dist) {
      agent.x = target.x;
      agent.y = target.y;
      agent.pathIndex += 1;
    } else {
      agent.x += (dx / dist) * step;
      agent.y += (dy / dist) * step;
    }
  }

  private pushFeed(text: string): void {
    this.feed.unshift({ id: uid("feed"), at: Date.now(), text });
    if (this.feed.length > 40) this.feed.length = 40;
  }

  private pushDecision(
    agent: CrewId,
    kind: DecisionEvent["kind"],
    text: string,
    major: boolean,
  ): void {
    this.decisions.unshift({
      id: uid("dec"),
      at: Date.now(),
      agent,
      kind,
      text,
      major,
    });
    if (this.decisions.length > 30) this.decisions.length = 30;
    this.pushFeed(`${hhmm(Date.now())} ${text}`);
  }
}

function hhmm(now: number): string {
  const d = new Date(now);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function titleCase(id: string): string {
  return id ? id[0]!.toUpperCase() + id.slice(1) : id;
}

// keep plaza referenced for possible future roam
void PLAZA;
