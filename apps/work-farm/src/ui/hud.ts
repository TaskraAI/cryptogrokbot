import type { SimSnapshot, StageId } from "../sim/types";
import { STAGE_LABEL, STAGES } from "../sim/types";

const root = () => document.getElementById("hud")!;

function fmtDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function fmtClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function sparkline(values: number[], w: number, h: number, stroke: string): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.01, max - min);
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${stroke}" stroke-width="2" points="${pts}"/></svg>`;
}

function bars(values: number[]): string {
  const max = Math.max(1, ...values);
  return `<div class="bars">${values
    .map((v) => `<span style="height:${Math.max(8, (v / max) * 100)}%"></span>`)
    .join("")}</div>`;
}

function stageBars(progress: Record<StageId, number>): string {
  return STAGES.filter((s) => s !== "tools")
    .map((s) => {
      const pct = Math.round(progress[s] ?? 0);
      return `<div class="stage-row"><span>${STAGE_LABEL[s]}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>`;
    })
    .join("");
}

let mounted = false;

function ensureShell(): void {
  if (mounted) return;
  mounted = true;
  root().innerHTML = `
    <header class="title-bar">
      <div class="brand">GROK BOT WORK FARM</div>
      <div class="tag">DEMO · SIMULATED CREW</div>
    </header>

    <aside class="panel left">
      <section>
        <h2>TODAY STATS</h2>
        <div class="stat" id="stat-done"></div>
        <div class="stat" id="stat-wip"></div>
        <div class="stat" id="stat-saved"></div>
      </section>
      <section>
        <h2>LIVE FEED</h2>
        <ul id="feed" class="feed"></ul>
      </section>
    </aside>

    <aside class="panel right">
      <section>
        <div class="kv"><span>AGENTS ONLINE</span><strong id="agents-online"></strong></div>
        <div class="kv"><span>WORK TIME TODAY</span><strong id="work-time"></strong></div>
        <div class="kv"><span>JOBS IN PROGRESS</span><strong id="jobs-wip"></strong></div>
      </section>
      <section>
        <h2>VALUE CREATED</h2>
        <div class="value-row"><strong id="value-created"></strong><div id="value-spark"></div></div>
      </section>
      <section>
        <h2>AI AGENTS WORKING</h2>
        <div id="activity-bars"></div>
      </section>
      <div class="inbox-chip" id="inbox-chip"></div>
    </aside>

    <footer class="bottom">
      <div class="stages" id="stages"></div>
      <div class="roi">
        <div><b id="roi-h">0</b><span>H SAVED</span></div>
        <div><b id="roi-d">0</b><span>DAYS SAVED</span></div>
        <div><b id="roi-rate">$12</b><span>PER HOUR</span></div>
        <div><b id="roi-mo">≈ $0</b><span>PER MONTH</span></div>
      </div>
      <div class="slogans">
        <span>AUTOMATE. DELEGATE. DELIVER.</span>
        <span>THE WORK KEEPS MOVING.</span>
        <span>AI AGENTS WORKING 24/7.</span>
      </div>
    </footer>
  `;
}

export function renderHud(snap: SimSnapshot): void {
  ensureShell();

  const doneEl = document.getElementById("stat-done")!;
  doneEl.innerHTML = `<span>Tasks Done</span><strong>${snap.tasksDone} / ${snap.tasksGoal}</strong>`;
  document.getElementById("stat-wip")!.innerHTML =
    `<span>Tasks in Progress</span><strong>${snap.tasksInProgress}</strong>`;
  document.getElementById("stat-saved")!.innerHTML =
    `<span>Time Saved</span><strong>${fmtDuration(snap.timeSavedMs)}</strong>`;

  document.getElementById("agents-online")!.textContent =
    `${snap.agentsOnline} / ${snap.agentsTotal}`;
  document.getElementById("work-time")!.textContent = fmtClock(snap.now - snap.startedAt);
  document.getElementById("jobs-wip")!.textContent = String(
    snap.jobs.filter((j) => !j.done).length,
  );

  document.getElementById("value-created")!.textContent = `$${snap.valueCreated.toFixed(2)}`;
  document.getElementById("value-spark")!.innerHTML = sparkline(snap.valueHistory, 120, 28, "#4ade80");
  document.getElementById("activity-bars")!.innerHTML = bars(snap.activityHistory);

  const inbox = document.getElementById("inbox-chip")!;
  inbox.textContent = `INBOX ${snap.inboxCount}`;
  inbox.classList.toggle("hot", snap.inboxCount > 0);

  document.getElementById("feed")!.innerHTML = snap.feed
    .slice(0, 10)
    .map((f) => `<li>${escapeHtml(f.text)}</li>`)
    .join("");

  document.getElementById("stages")!.innerHTML = stageBars(snap.stageProgress);

  const hours = snap.timeSavedMs / 3600000;
  document.getElementById("roi-h")!.textContent = hours.toFixed(1) + "h";
  document.getElementById("roi-d")!.textContent = Math.floor(hours / 8) + "h";
  const month = Math.round(hours * 12 * 30);
  document.getElementById("roi-mo")!.textContent = `≈ $${month}`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
