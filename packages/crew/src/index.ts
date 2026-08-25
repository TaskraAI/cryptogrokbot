export type CrewId = "chief" | "scout" | "sentinel" | "grok" | "scholar" | "auditor";

export type CrewStatus = "idle" | "running" | "blocked" | "error";

export interface CrewPulse {
  id: CrewId;
  title: string;
  status: CrewStatus;
  detail: string;
  at: number;
  ticks: number;
}

export const CREW_META: Record<CrewId, { title: string; job: string }> = {
  chief: { title: "Chief", job: "budget, master switch, handoffs" },
  scout: { title: "Scout", job: "X / social / Pump.fun / DexScreener" },
  sentinel: { title: "Sentinel", job: "tape, exits, dip-hold" },
  grok: { title: "Grok", job: "thesis + runner gray-zone (xAI)" },
  scholar: { title: "Scholar", job: "journal, mistakes, extra rules" },
  auditor: { title: "Auditor", job: "bug scan, typecheck, paper/live fail-closed" },
};

export class CrewBoard {
  private pulses = new Map<CrewId, CrewPulse>();
  private log: Array<{ at: number; id: CrewId; detail: string }> = [];

  constructor() {
    for (const id of Object.keys(CREW_META) as CrewId[]) {
      this.pulses.set(id, {
        id,
        title: CREW_META[id].title,
        status: "idle",
        detail: "waiting first tick",
        at: Date.now(),
        ticks: 0,
      });
    }
  }

  start(id: CrewId, detail: string): void {
    this.write(id, "running", detail);
  }

  idle(id: CrewId, detail: string): void {
    this.write(id, "idle", detail);
  }

  blocked(id: CrewId, detail: string): void {
    this.write(id, "blocked", detail);
  }

  error(id: CrewId, detail: string): void {
    this.write(id, "error", detail);
  }

  snapshot(): CrewPulse[] {
    return [...this.pulses.values()];
  }

  recentLog(limit = 30): Array<{ at: number; id: CrewId; detail: string }> {
    return this.log.slice(-limit).reverse();
  }

  formatText(): string {
    const lines = this.snapshot().map((p) => {
      const age = Math.max(0, Math.round((Date.now() - p.at) / 1000));
      return `${pad(p.title, 9)} ${pad(p.status, 8)} ${p.detail} (${age}s)`;
    });
    const log = this.recentLog(8)
      .map((e) => `  ${new Date(e.at).toISOString().slice(11, 19)} ${e.id}: ${e.detail}`)
      .join("\n");
    return ["Grok crew — agents in parallel", ...lines, "", "recent:", log || "  (none)"].join("\n");
  }

  private write(id: CrewId, status: CrewStatus, detail: string): void {
    const prev = this.pulses.get(id);
    this.pulses.set(id, {
      id,
      title: CREW_META[id].title,
      status,
      detail: detail.slice(0, 180),
      at: Date.now(),
      ticks: (prev?.ticks ?? 0) + (status === "running" ? 1 : 0),
    });
    this.log.push({ at: Date.now(), id, detail: detail.slice(0, 180) });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

export function crewHtml(board: CrewBoard): string {
  const rows = board
    .snapshot()
    .map((p) => {
      const age = Math.max(0, Math.round((Date.now() - p.at) / 1000));
      return `<tr class="${p.status}"><td>${esc(p.title)}</td><td>${esc(p.status)}</td><td>${esc(p.detail)}</td><td>${age}s ago</td><td>${p.ticks}</td></tr>`;
    })
    .join("");
  const log = board
    .recentLog(20)
    .map((e) => `<li><code>${new Date(e.at).toISOString().slice(11, 19)}</code> <b>${e.id}</b> ${esc(e.detail)}</li>`)
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta http-equiv="refresh" content="2"/>
<title>Night Agent crew</title>
<style>
body{font-family:ui-sans-serif,system-ui;background:#0b0d10;color:#e8eaed;margin:24px}
table{border-collapse:collapse;width:100%;margin:16px 0}
td,th{border-bottom:1px solid #2a2f36;padding:8px 10px;text-align:left}
.running{color:#8be9fd}.idle{color:#9aa0a6}.blocked{color:#ffb86c}.error{color:#ff6b6b}
h1{font-size:20px} ul{padding-left:18px}
</style></head>
<body>
<h1>Grok crew — simultaneous agents</h1>
<p>Auto-refreshes every 2s. Telegram <code>/crew</code> is the same board.</p>
<table><thead><tr><th>Agent</th><th>Status</th><th>Doing</th><th>Updated</th><th>Ticks</th></tr></thead>
<tbody>${rows}</tbody></table>
<h2>Recent</h2><ul>${log}</ul>
</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
