import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import type { Grade, Policy } from "@night/shared";
import type { PositionRow, Store } from "@night/storage";
import { addSuggestion, listAllClosed, listClosedSince } from "@night/storage";

export interface PatternStats {
  updatedAt: number;
  highSentiment: number;
  volumeAlivePctOfBaseline: number;
  byPattern: Record<string, { n: number; wins: number; netSol: number }>;
  mistakes: Array<{ at: number; type: string; positionId: number }>;
  suggestions: string[];
}

export function loadPatternStats(path: string): PatternStats {
  return JSON.parse(readFileSync(path, "utf8")) as PatternStats;
}

export function savePatternStats(path: string, stats: PatternStats): void {
  writeFileSync(path, JSON.stringify(stats, null, 2), "utf8");
}

export function loadLessons(path: string): string {
  return readFileSync(path, "utf8");
}

export function appendLesson(path: string, text: string): void {
  appendFileSync(path, `\n- ${new Date().toISOString()} ${text.trim()}\n`, "utf8");
}

export function windowStart(kind: "today" | "7d" | "30d" | "all", now = Date.now()): number {
  if (kind === "all") return 0;
  if (kind === "today") {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  if (kind === "7d") return now - 7 * 86400000;
  return now - 30 * 86400000;
}

export interface ReviewReport {
  window: string;
  paper: ReviewSlice;
  live: ReviewSlice;
}

export interface ReviewSlice {
  trades: number;
  netSol: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  principalReturnedPct: number;
  avgRunner: number;
  bySource: Record<string, { n: number; net: number; wins: number }>;
  byExit: Record<string, { n: number; net: number }>;
  byPattern: Record<string, { n: number; net: number; wins: number }>;
  mistakes: Record<string, number>;
  best: Array<{ id: number; mint: string; net: number; why: string }>;
  worst: Array<{ id: number; mint: string; net: number; why: string }>;
}

function sliceOf(rows: PositionRow[]): ReviewSlice {
  const closed = rows.filter((r) => r.net_sol != null);
  const nets = closed.map((r) => r.net_sol as number);
  const wins = nets.filter((n) => n > 0);
  const losses = nets.filter((n) => n <= 0);
  const bySource: ReviewSlice["bySource"] = {};
  const byExit: ReviewSlice["byExit"] = {};
  const byPattern: ReviewSlice["byPattern"] = {};
  const mistakes: Record<string, number> = {};
  for (const r of closed) {
    let sources: Array<{ key?: string }> = [];
    try {
      sources = JSON.parse(r.sources_json) as Array<{ key?: string }>;
    } catch {
      sources = [];
    }
    for (const s of sources) {
      const key = s.key ?? "unknown";
      bySource[key] ??= { n: 0, net: 0, wins: 0 };
      bySource[key].n += 1;
      bySource[key].net += r.net_sol ?? 0;
      if ((r.net_sol ?? 0) > 0) bySource[key].wins += 1;
    }
    const exit = r.exit_reason ?? "unknown";
    byExit[exit] ??= { n: 0, net: 0 };
    byExit[exit].n += 1;
    byExit[exit].net += r.net_sol ?? 0;
    const pat = r.last_pattern ?? "unknown";
    byPattern[pat] ??= { n: 0, net: 0, wins: 0 };
    byPattern[pat].n += 1;
    byPattern[pat].net += r.net_sol ?? 0;
    if ((r.net_sol ?? 0) > 0) byPattern[pat].wins += 1;
    if (r.mistake) mistakes[r.mistake] = (mistakes[r.mistake] ?? 0) + 1;
  }
  const ranked = [...closed].sort((a, b) => (b.net_sol ?? 0) - (a.net_sol ?? 0));
  const card = (r: PositionRow) => ({
    id: r.id,
    mint: r.mint,
    net: r.net_sol ?? 0,
    why: r.exit_reason ?? r.grade_note ?? "",
  });
  const returned = closed.filter((r) => r.principal_recovered_sol + 1e-9 >= r.principal_sol).length;
  return {
    trades: closed.length,
    netSol: nets.reduce((a, b) => a + b, 0),
    winRate: closed.length ? wins.length / closed.length : 0,
    avgWin: wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
    expectancy: closed.length ? nets.reduce((a, b) => a + b, 0) / closed.length : 0,
    principalReturnedPct: closed.length ? (returned / closed.length) * 100 : 0,
    avgRunner: closed.length ? closed.reduce((a, r) => a + r.runner_pnl_sol, 0) / closed.length : 0,
    bySource,
    byExit,
    byPattern,
    mistakes,
    best: ranked.slice(0, 5).map(card),
    worst: ranked.slice(-5).reverse().map(card),
  };
}

export function buildReview(store: Store, window: "today" | "7d" | "30d" | "all"): ReviewReport {
  const since = windowStart(window);
  const rows = since === 0 ? listAllClosed(store) : listClosedSince(store, since);
  return {
    window,
    paper: sliceOf(rows.filter((r) => r.mode === "PAPER")),
    live: sliceOf(rows.filter((r) => r.mode === "LIVE")),
  };
}

export function formatReview(report: ReviewReport): string {
  const fmt = (s: ReviewSlice, label: string) =>
    `${label}: n=${s.trades} net=${s.netSol.toFixed(3)} SOL win=${(s.winRate * 100).toFixed(0)}% exp=${s.expectancy.toFixed(3)} principalBack=${s.principalReturnedPct.toFixed(0)}%\n` +
    `  exits: ${Object.entries(s.byExit)
      .map(([k, v]) => `${k}:${v.n}`)
      .join(" ") || "none"}\n` +
    `  patterns: ${
      Object.entries(s.byPattern)
        .map(([k, v]) => `${k}:${v.n}/${((v.wins / Math.max(1, v.n)) * 100).toFixed(0)}%`)
        .join(" ") || "none"
    }\n` +
    `  mistakes: ${Object.entries(s.mistakes)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ") || "none"}`;
  return [`Review ${report.window}`, fmt(report.paper, "PAPER"), fmt(report.live, "LIVE")].join("\n");
}

export function tagMistake(opts: {
  exitReason: string | null;
  lastPattern: string | null;
  postExitPctChange: number;
  netSol: number;
}): string | null {
  if (opts.exitReason && ["fade", "climax", "sentiment"].includes(opts.exitReason) && opts.lastPattern === "healthy_dip" && opts.postExitPctChange >= 10) {
    return "sold_dip_that_bounced";
  }
  if (opts.lastPattern === "healthy_dip" && opts.exitReason === "hard_stop") {
    return "held_fake_sentiment_dump";
  }
  if (opts.lastPattern === "climax" && opts.netSol < 0) {
    return "held_climax";
  }
  if (opts.exitReason === "fade" && opts.postExitPctChange < -5) {
    return "correct_fade";
  }
  return null;
}

export function applyNightlyLearning(opts: {
  store: Store;
  statsPath: string;
  policy: Policy;
}): PatternStats {
  const stats = loadPatternStats(opts.statsPath);
  const closed = listAllClosed(opts.store);
  stats.byPattern = {};
  stats.mistakes = [];
  const sourceFails: Record<string, { n: number; net: number }> = {};
  for (const row of closed) {
    const pat = row.last_pattern ?? "unknown";
    stats.byPattern[pat] ??= { n: 0, wins: 0, netSol: 0 };
    stats.byPattern[pat].n += 1;
    stats.byPattern[pat].netSol += row.net_sol ?? 0;
    if ((row.net_sol ?? 0) > 0) stats.byPattern[pat].wins += 1;
    if (row.mistake && row.mistake !== "correct_fade") {
      stats.mistakes.push({ at: row.closed_at ?? row.opened_at, type: row.mistake, positionId: row.id });
    }
    let sources: Array<{ key?: string }> = [];
    try {
      sources = JSON.parse(row.sources_json) as Array<{ key?: string }>;
    } catch {
      sources = [];
    }
    for (const s of sources) {
      const key = s.key ?? "unknown";
      sourceFails[key] ??= { n: 0, net: 0 };
      sourceFails[key].n += 1;
      sourceFails[key].net += row.net_sol ?? 0;
    }
  }

  const dip = stats.byPattern.healthy_dip;
  if (dip && dip.n >= 5 && dip.netSol < 0) {
    stats.highSentiment = Math.min(0.7, stats.highSentiment + 0.05);
    stats.volumeAlivePctOfBaseline = Math.min(100, stats.volumeAlivePctOfBaseline + 5);
  } else if (dip && dip.n >= 5 && dip.netSol > 0) {
    stats.highSentiment = Math.max(0.25, Math.min(stats.highSentiment, opts.policy.highSentiment));
  }

  stats.suggestions = [];
  for (const [source, s] of Object.entries(sourceFails)) {
    if (s.n >= 5 && s.net < 0) {
      const text = `${s.n} trades from ${source} have negative expectancy (${s.net.toFixed(3)} SOL). Mute or /never source:${source}?`;
      stats.suggestions.push(text);
      addSuggestion(opts.store, text);
    }
  }
  stats.updatedAt = Date.now();
  savePatternStats(opts.statsPath, stats);
  return stats;
}

export function similarFewShots(rows: PositionRow[], pattern: string, limit = 8): PositionRow[] {
  const scored = rows
    .filter((r) => r.grade || r.mistake)
    .map((r) => ({
      row: r,
      score: (r.last_pattern === pattern ? 2 : 0) + (r.grade === "fail" ? 1 : 0) + (r.grade === "win" ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.row);
}

export async function askLlm(opts: {
  apiKey?: string;
  xaiKey?: string;
  model: string;
  timeoutMs: number;
  system: string;
  user: string;
}): Promise<{ pattern?: string; action?: "hold" | "sell"; confidence?: number; reason?: string; thesis?: string } | null> {
  const xai = opts.xaiKey || (opts.apiKey?.startsWith("xai-") ? opts.apiKey : "");
  const openai = xai ? "" : opts.apiKey;
  if (!xai && !openai) return null;
  const url = xai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const key = xai || openai || "";
  const model = xai && (opts.model.startsWith("gpt-") || !opts.model) ? "grok-4-fast" : opts.model;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content) as { pattern?: string; action?: "hold" | "sell"; confidence?: number; reason?: string; thesis?: string };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function askGrokResearch(opts: {
  xaiKey?: string;
  mint: string;
  ticker?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  if (!opts.xaiKey) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  try {
    const res = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.xaiKey}`,
        "content-type": "application/json",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "grok-4.20-multi-agent",
        reasoning: { effort: "low" },
        tools: [{ type: "web_search" }, { type: "x_search" }],
        input: [
          {
            role: "user",
            content: `You are the research desk for a Solana meme-coin night agent. Research mint ${opts.mint} ticker ${opts.ticker ?? ""}. Report: (1) social sentiment on X (2) likely rug/honeypot signs (3) whether a dip looks healthy vs dump. Be brief. Not financial advice.`,
          },
        ],
      }),
    });
    if (!res.ok) return `Grok research HTTP ${res.status}`;
    const body = (await res.json()) as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    if (body.output_text) return body.output_text;
    const text = body.output?.flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("\n");
    return text || "Grok returned no text";
  } catch (err) {
    return err instanceof Error ? err.message : "Grok research failed";
  } finally {
    clearTimeout(t);
  }
}

export async function askGrokDesk(opts: {
  xaiKey?: string;
  openaiKey?: string;
  model?: string;
  prompt: string;
  timeoutMs?: number;
  useXSearch?: boolean;
}): Promise<{ text: string; via: "xai" | "openai" | "none" }> {
  const timeoutMs = opts.timeoutMs ?? 55_000;
  if (opts.xaiKey) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const tools: Array<{ type: string }> = [{ type: "web_search" }];
      if (opts.useXSearch !== false) tools.push({ type: "x_search" });
      const res = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.xaiKey}`,
          "content-type": "application/json",
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: opts.model && !opts.model.startsWith("gpt-") ? opts.model : "grok-4.20-multi-agent",
          reasoning: { effort: "low" },
          tools,
          input: [{ role: "user", content: opts.prompt }],
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
        const text =
          body.output_text ||
          body.output?.flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("\n") ||
          "";
        if (text.trim()) return { text, via: "xai" };
      }
    } catch {
      // fall through to OpenAI
    } finally {
      clearTimeout(t);
    }
  }
  if (opts.openaiKey) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 40_000));
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.openaiKey}`,
          "content-type": "application/json",
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: opts.model && opts.model.startsWith("gpt-") ? opts.model : "gpt-4.1-mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are the CryptoGrokBot research desk for a personal Solana meme-coin paper agent. Be objective. Number every requested section. Call out missing data. This is not financial advice.",
            },
            { role: "user", content: opts.prompt },
          ],
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = body.choices?.[0]?.message?.content ?? "";
        if (text.trim()) return { text, via: "openai" };
      }
    } catch {
      // none
    } finally {
      clearTimeout(t);
    }
  }
  return { text: "", via: "none" };
}

export function lessonPrompt(lessons: string, few: PositionRow[]): string {
  const shots = few
    .map(
      (r) =>
        `- ${r.mint} pattern=${r.last_pattern} exit=${r.exit_reason} net=${r.net_sol} grade=${r.grade ?? ""} note=${r.grade_note ?? r.mistake ?? ""}`,
    )
    .join("\n");
  return `You advise a Solana meme-coin night agent. Return JSON only.
Rules: never disable hard stops or rugs. healthy_dip with high sentiment must HOLD.
You cannot increase size or spend budget.

Lessons:\n${lessons.slice(-4000)}\n
Similar past trades:\n${shots || "none yet"}`;
}

export function gradeLabel(g: Grade): string {
  return g;
}
