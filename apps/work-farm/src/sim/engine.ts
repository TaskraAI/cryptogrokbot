import {
  BUILDING_ANCHORS,
  PLAZA,
  STAGE_LABEL,
  STAGES,
  type Agent,
  type FeedItem,
  type Job,
  type SimSnapshot,
  type StageId,
} from "./types";

const AGENT_PALETTE = [
  0xf97316, 0x22c55e, 0x3b82f6, 0xeab308, 0xec4899, 0x14b8a6, 0xa855f7, 0xf43f5e,
  0x84cc16, 0x06b6d4, 0xf59e0b, 0x8b5cf6, 0x10b981, 0xef4444, 0x6366f1,
];

const JOB_TITLES = [
  "Lead research",
  "Token scan",
  "Signal build",
  "Tool sync",
  "Inbox triage",
  "Paper test",
  "Risk check",
  "Delivery pack",
  "Desk brief",
  "Pattern hunt",
];

const FEED_LINES: Record<StageId | "spawn" | "complete", string[]> = {
  spawn: ["Agent deployed", "Crew joined farm"],
  research: ["Research started", "Research complete", "Lead collected"],
  build: ["Build started", "Build complete", "Module shipped"],
  tools: ["Tool wired", "Tools synced"],
  inbox: ["Inbox cleared", "Message routed"],
  test: ["Test started", "Test passed"],
  check: ["Check started", "Check approved"],
  delivery: ["Report delivered", "Delivery complete"],
  complete: ["Job closed", "Cycle finished"],
};

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function lerpPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  const mid = {
    x: from.x + (to.x - from.x) * 0.5 + (Math.random() - 0.5) * 24,
    y: from.y + (to.y - from.y) * 0.5 + (Math.random() - 0.5) * 16,
  };
  return [from, mid, to];
}

export class FarmSim {
  private agents: Agent[] = [];
  private jobs: Job[] = [];
  private feed: FeedItem[] = [];
  private startedAt = Date.now();
  private tasksDone = 0;
  private tasksGoal = 50;
  private timeSavedMs = 0;
  private valueCreated = 0;
  private valueHistory: number[] = Array.from({ length: 24 }, () => 0);
  private activityHistory: number[] = Array.from({ length: 12 }, () => 0);
  private stageThroughput: Record<StageId, number> = Object.fromEntries(
    STAGES.map((s) => [s, 0]),
  ) as Record<StageId, number>;
  private inboxCount = 8;
  private nextSpawnAt = 0;
  private nextJobAt = 0;
  private tickAcc = 0;
  private agentCount: number;

  constructor(agentCount = 15) {
    this.agentCount = agentCount;
    for (let i = 0; i < agentCount; i++) this.spawnAgent(true);
    for (let i = 0; i < 8; i++) this.enqueueJob();
    this.pushFeed("Farm online — agents syncing");
  }

  snapshot(now = Date.now()): SimSnapshot {
    const working = this.agents.filter((a) => a.status !== "idle").length;
    const stageProgress = Object.fromEntries(
      STAGES.map((stage) => {
        const atStage = this.agents.filter((a) => a.stage === stage).length;
        const jobsHere = this.jobs.filter(
          (j) => !j.done && STAGES[j.stageIndex] === stage,
        ).length;
        const base = Math.min(92, 18 + this.stageThroughput[stage] * 6 + atStage * 8 + jobsHere * 5);
        return [stage, base];
      }),
    ) as Record<StageId, number>;

    return {
      now,
      startedAt: this.startedAt,
      agents: this.agents.map((a) => ({ ...a, path: [...a.path] })),
      jobs: this.jobs.map((j) => ({ ...j })),
      feed: [...this.feed].slice(0, 14),
      tasksDone: this.tasksDone,
      tasksGoal: this.tasksGoal,
      tasksInProgress: working,
      timeSavedMs: this.timeSavedMs,
      valueCreated: this.valueCreated,
      valueHistory: [...this.valueHistory],
      activityHistory: [...this.activityHistory],
      stageProgress,
      inboxCount: this.inboxCount,
      agentsOnline: this.agents.length,
      agentsTotal: this.agents.length,
    };
  }

  update(dtMs: number, now = Date.now()): SimSnapshot {
    this.tickAcc += dtMs;
    while (this.tickAcc >= 50) {
      this.tickAcc -= 50;
      this.step(50, now);
    }
    return this.snapshot(now);
  }

  private step(dt: number, now: number): void {
    if (now >= this.nextSpawnAt && this.agents.length < this.agentCount) {
      this.spawnAgent(false);
      this.nextSpawnAt = now + 4000 + Math.random() * 4000;
    }

    if (now >= this.nextJobAt) {
      this.enqueueJob();
      this.nextJobAt = now + 1200 + Math.random() * 2200;
      if (Math.random() < 0.4) this.inboxCount = Math.min(24, this.inboxCount + 1);
    }

    for (const agent of this.agents) {
      this.advanceAgent(agent, dt, now);
    }

    this.assignIdleAgents(now);

    if (Math.random() < 0.08) {
      this.valueCreated += 0.02 + Math.random() * 0.08;
      this.valueHistory.push(this.valueCreated);
      if (this.valueHistory.length > 24) this.valueHistory.shift();
    }

    const active = this.agents.filter((a) => a.status !== "idle").length;
    this.activityHistory.push(active);
    if (this.activityHistory.length > 12) this.activityHistory.shift();

    this.timeSavedMs += (active / this.agentCount) * dt * 0.35;
  }

  private spawnAgent(initial: boolean): void {
    const i = this.agents.length;
    const jitter = () => (Math.random() - 0.5) * 40;
    const agent: Agent = {
      id: uid("ag"),
      name: `Agent-${String(i + 1).padStart(2, "0")}`,
      color: AGENT_PALETTE[i % AGENT_PALETTE.length]!,
      hat: i % 5,
      status: "idle",
      stage: null,
      path: [],
      pathIndex: 0,
      x: PLAZA.x + jitter(),
      y: PLAZA.y + jitter(),
      workUntil: 0,
      jobId: null,
    };
    this.agents.push(agent);
    if (!initial) this.pushFeed(`${agent.name}: ${pick(FEED_LINES.spawn)}`);
  }

  private enqueueJob(): void {
    const open = this.jobs.filter((j) => !j.done).length;
    if (open >= 18) return;
    this.jobs.push({
      id: uid("job"),
      title: pick(JOB_TITLES),
      stageIndex: 0,
      progress: 0,
      agentId: null,
      done: false,
    });
  }

  private assignIdleAgents(now: number): void {
    const idle = this.agents.filter((a) => a.status === "idle");
    const openJobs = this.jobs.filter((j) => !j.done && !j.agentId);
    for (const job of openJobs) {
      const agent = idle.shift();
      if (!agent) break;
      const stage = STAGES[job.stageIndex]!;
      job.agentId = agent.id;
      agent.jobId = job.id;
      this.sendToStage(agent, stage, now);
    }
  }

  private sendToStage(agent: Agent, stage: StageId, now: number): void {
    const anchor = BUILDING_ANCHORS[stage];
    const door = {
      x: anchor.x + (Math.random() - 0.5) * 18,
      y: anchor.y + 10 + Math.random() * 8,
    };
    agent.status = "walking";
    agent.stage = stage;
    agent.path = lerpPath({ x: agent.x, y: agent.y }, door);
    agent.pathIndex = 0;
    agent.workUntil = 0;
    this.pushFeed(`${hhmm(now)} ${STAGE_LABEL[stage]} · ${agent.name} en route`);
  }

  private advanceAgent(agent: Agent, dt: number, now: number): void {
    if (agent.status === "walking") {
      const target = agent.path[agent.pathIndex];
      if (!target) {
        if (!agent.stage) {
          agent.status = "idle";
          agent.path = [];
          agent.pathIndex = 0;
          return;
        }
        agent.status = "working";
        agent.workUntil = now + 1800 + Math.random() * 3200;
        this.pushFeed(`${hhmm(now)} ${pick(FEED_LINES[agent.stage])}`);
        return;
      }
      const speed = 0.055 + Math.random() * 0.01;
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
      return;
    }

    if (agent.status === "working" && now >= agent.workUntil) {
      this.finishWork(agent, now);
    }
  }

  private finishWork(agent: Agent, now: number): void {
    const job = this.jobs.find((j) => j.id === agent.jobId);
    if (!job || !agent.stage) {
      agent.status = "idle";
      agent.jobId = null;
      agent.stage = null;
      return;
    }

    this.stageThroughput[agent.stage] += 1;
    job.stageIndex += 1;
    job.progress = Math.min(1, job.stageIndex / STAGES.length);

    if (agent.stage === "inbox") {
      this.inboxCount = Math.max(0, this.inboxCount - 1);
    }

    if (job.stageIndex >= STAGES.length) {
      job.done = true;
      job.agentId = null;
      agent.jobId = null;
      agent.stage = null;
      agent.workUntil = 0;
      this.tasksDone += 1;
      this.valueCreated += 0.35 + Math.random() * 0.55;
      this.pushFeed(`${hhmm(now)} ${pick(FEED_LINES.complete)}`);
      agent.status = "walking";
      agent.path = lerpPath({ x: agent.x, y: agent.y }, {
        x: PLAZA.x + (Math.random() - 0.5) * 50,
        y: PLAZA.y + (Math.random() - 0.5) * 40,
      });
      agent.pathIndex = 0;
      return;
    }

    const next = STAGES[job.stageIndex]!;
    this.pushFeed(`${hhmm(now)} ${STAGE_LABEL[agent.stage]} complete`);
    this.sendToStage(agent, next, now);
  }

  private pushFeed(text: string): void {
    this.feed.unshift({ id: uid("feed"), at: Date.now(), text });
    if (this.feed.length > 40) this.feed.length = 40;
  }
}

function hhmm(now: number): string {
  const d = new Date(now);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
