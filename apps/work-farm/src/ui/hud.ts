import type { FarmSnapshot } from "../sim/types";
import { CREW_META, STAGE_LABEL, STAGES } from "../sim/types";

const root = () => document.getElementById("hud")!;

function fmtSol(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(3)} SOL`;
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

function stageBars(progress: FarmSnapshot["stageProgress"]): string {
  return STAGES.map((s) => {
    const pct = Math.round(progress[s] ?? 0);
    return `<div class="stage-row"><span>${STAGE_LABEL[s]}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>`;
  }).join("");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let mounted = false;

function ensureShell(): void {
  if (mounted) return;
  mounted = true;
  root().innerHTML = `
    <header class="title-bar">
      <div class="brand">GROK BOT WORK FARM</div>
      <div class="tag" id="source-tag">SIM · SIX CREW DESKS</div>
    </header>

    <aside class="panel left">
      <section>
        <h2>CREW ON FARM</h2>
        <div id="crew-list" class="crew-list"></div>
      </section>
      <section>
        <h2>MAJOR DECISIONS</h2>
        <ul id="decisions" class="feed"></ul>
      </section>
      <section>
        <h2>LIVE FEED</h2>
        <ul id="feed" class="feed"></ul>
      </section>
    </aside>

    <aside class="panel right">
      <section>
        <div class="kv"><span>MODE</span><strong id="mode-line"></strong></div>
        <div class="kv"><span>AGENTS ONLINE</span><strong id="agents-online"></strong></div>
        <div class="kv"><span>WORK TIME</span><strong id="work-time"></strong></div>
        <div class="kv"><span>OPEN BAGS</span><strong id="open-count"></strong></div>
      </section>
      <section>
        <h2>PROFIT / P&L</h2>
        <div class="value-row"><strong id="pnl-value"></strong><div id="value-spark"></div></div>
        <div class="kv"><span>Paper trades</span><strong id="paper-trades"></strong></div>
        <div class="kv"><span>Win rate</span><strong id="win-rate"></strong></div>
        <div class="kv"><span>Live P&L</span><strong id="live-pnl"></strong></div>
      </section>
      <section>
        <h2>CURRENT TRADES</h2>
        <ul id="positions" class="trade-list"></ul>
      </section>
      <section>
        <h2>AGENT TRADES (BUY / SELL)</h2>
        <ul id="fills" class="trade-list"></ul>
      </section>
      <section>
        <h2>CREW ACTIVITY</h2>
        <div id="activity-bars"></div>
      </section>
      <div class="inbox-chip" id="inbox-chip"></div>
    </aside>

    <footer class="bottom">
      <div class="stages" id="stages"></div>
      <div class="roi">
        <div><b id="roi-paper">0</b><span>PAPER NET</span></div>
        <div><b id="roi-open">0</b><span>OPEN</span></div>
        <div><b id="roi-fills">0</b><span>FILLS</span></div>
        <div><b id="roi-done">0</b><span>TASKS</span></div>
      </div>
      <div class="slogans">
        <span>AUTOMATE. DELEGATE. DELIVER.</span>
        <span>ALL SIX GROKBOT DESKS ON THE FARM.</span>
        <span>AI AGENTS WORKING 24/7.</span>
      </div>
    </footer>
  `;
}

export function renderHud(snap: FarmSnapshot): void {
  ensureShell();

  const tag = document.getElementById("source-tag")!;
  tag.textContent =
    snap.source === "live"
      ? `LIVE · ${snap.mode}${snap.masterEnabled ? " · MASTER ON" : ""}`
      : "SIM · SIX CREW DESKS (start npm run agent for live)";

  document.getElementById("crew-list")!.innerHTML = snap.agents
    .map((a) => {
      const st = a.crewStatus;
      return `<div class="crew-row ${st}">
        <b>${escapeHtml(a.name)}</b>
        <em>${escapeHtml(st)}</em>
        <span>${escapeHtml(a.detail)}</span>
      </div>`;
    })
    .join("");

  const majors = snap.decisions.filter((d) => d.major).slice(0, 8);
  const decs = majors.length ? majors : snap.decisions.slice(0, 8);
  document.getElementById("decisions")!.innerHTML = decs
    .map(
      (d) =>
        `<li><b>${escapeHtml(CREW_META[d.agent].title)}</b> · ${escapeHtml(d.text)}</li>`,
    )
    .join("");

  document.getElementById("feed")!.innerHTML = snap.feed
    .slice(0, 10)
    .map((f) => `<li>${escapeHtml(f.text)}</li>`)
    .join("");

  document.getElementById("mode-line")!.textContent = `${snap.mode}${
    snap.masterEnabled ? " + MASTER" : ""
  }`;
  document.getElementById("agents-online")!.textContent =
    `${snap.agentsOnline} / ${snap.agentsTotal}`;
  document.getElementById("work-time")!.textContent = fmtClock(snap.now - snap.startedAt);
  document.getElementById("open-count")!.textContent = String(snap.openCount);

  const net = snap.pnl.paperNetSol + snap.pnl.liveNetSol;
  document.getElementById("pnl-value")!.textContent = fmtSol(net);
  document.getElementById("pnl-value")!.className = net >= 0 ? "up" : "down";
  document.getElementById("value-spark")!.innerHTML = sparkline(
    snap.pnlHistory,
    120,
    28,
    net >= 0 ? "#4ade80" : "#f87171",
  );
  document.getElementById("paper-trades")!.textContent = String(snap.pnl.paperTrades);
  document.getElementById("win-rate")!.textContent =
    `${Math.round((snap.pnl.winRatePaper || 0) * 100)}%`;
  document.getElementById("live-pnl")!.textContent = fmtSol(snap.pnl.liveNetSol);

  document.getElementById("positions")!.innerHTML = snap.positions.length
    ? snap.positions
        .slice(0, 6)
        .map(
          (p) =>
            `<li><b>${escapeHtml(p.ticker)}</b> <em>${p.mode}</em> <span>${p.solSpent.toFixed(3)} SOL in</span></li>`,
        )
        .join("")
    : `<li class="muted">No open bags</li>`;

  document.getElementById("fills")!.innerHTML = snap.fills.length
    ? snap.fills
        .slice(0, 8)
        .map((f) => {
          const who = CREW_META[f.agent]?.title ?? f.agent;
          return `<li class="${f.side === "BUY" ? "buy" : "sell"}"><b>${f.side}</b> ${escapeHtml(f.ticker)} · ${f.sol.toFixed(3)} SOL · ${escapeHtml(who)}</li>`;
        })
        .join("")
    : `<li class="muted">No fills yet</li>`;

  document.getElementById("activity-bars")!.innerHTML = bars(snap.activityHistory);

  const inbox = document.getElementById("inbox-chip")!;
  inbox.textContent = `INBOX ${snap.inboxCount}`;
  inbox.classList.toggle("hot", snap.inboxCount > 0);

  document.getElementById("stages")!.innerHTML = stageBars(snap.stageProgress);

  document.getElementById("roi-paper")!.textContent = fmtSol(snap.pnl.paperNetSol);
  document.getElementById("roi-open")!.textContent = String(snap.openCount);
  document.getElementById("roi-fills")!.textContent = String(snap.fills.length);
  document.getElementById("roi-done")!.textContent = String(snap.tasksDone);
}
