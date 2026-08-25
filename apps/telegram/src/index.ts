import { Bot } from "grammy";
import type { Policy, RuntimeFlags } from "@night/shared";
import { solscanToken, solscanTx } from "@night/shared";
import {
  findPositionByMint,
  getBudget,
  getFlag,
  getPosition,
  listOpenPositions,
  listSuggestions,
  recentDecisions,
  recentSourceHits,
  setFlag,
  type Store,
} from "@night/storage";
import { addGuardrail, effectiveDailyBudgetSol, loadExtraRules, loadGuardrails, parseNeverRule, removeGuardrail, setExtraRuleEnabled } from "@night/risk";
import { appendLesson, buildReview, formatReview, loadLessons } from "@night/learning";
import { listTape } from "@night/storage";
import { gradePosition } from "@night/storage";
import type { Grade } from "@night/shared";
import type { CrewBoard } from "@night/crew";

export interface TelegramContext {
  store: Store;
  policy: () => Policy;
  flags: () => RuntimeFlags;
  paths: { lessons: string; guardrails: string; rules: string };
  onSellAll: () => Promise<string>;
  onResearch?: (mint: string) => Promise<string>;
  crew?: () => CrewBoard;
  dayKey: () => string;
}

export function createTelegramBot(token: string, chatId: string, ctx: TelegramContext): Bot {
  const bot = new Bot(token);
  const only = async (fn: (c: { message?: { text?: string } }) => Promise<string>) => {
    return async (c: { message?: { text?: string }; from?: { id?: number }; reply: (t: string) => Promise<unknown> }) => {
      if (chatId && String(c.from?.id ?? "") !== String(chatId) && String(c.message) && chatId && !allowed(c, chatId)) {
        await c.reply("unauthorized");
        return;
      }
      await c.reply(await fn(c));
    };
  };

  bot.command("status", async (c) => {
    if (!allow(c, chatId)) return;
    await c.reply(statusText(ctx));
  });
  bot.command("positions", async (c) => {
    if (!allow(c, chatId)) return;
    await c.reply(positionsText(ctx.store));
  });
  bot.command("pnl", async (c) => {
    if (!allow(c, chatId)) return;
    const report = buildReview(ctx.store, "today");
    await c.reply(formatReview(report));
  });
  bot.command("review", async (c) => {
    if (!allow(c, chatId)) return;
    const arg = (c.match || "7d").trim() as "today" | "7d" | "30d" | "all";
    const window = ["today", "7d", "30d", "all"].includes(arg) ? arg : "7d";
    await c.reply(formatReview(buildReview(ctx.store, window)));
  });
  bot.command("trade", async (c) => {
    if (!allow(c, chatId)) return;
    const id = (c.match || "").trim();
    await c.reply(tradeCard(ctx.store, id));
  });
  bot.command("tape", async (c) => {
    if (!allow(c, chatId)) return;
    await c.reply(tapeText(ctx.store, (c.match || "").trim()));
  });
  bot.command("why", async (c) => {
    if (!allow(c, chatId)) return;
    await c.reply(whyText(ctx.store, (c.match || "").trim()));
  });
  bot.command("grade", async (c) => {
    if (!allow(c, chatId)) return;
    const parts = (c.match || "").trim().split(/\s+/);
    const id = Number(parts[0]);
    const grade = parts[1] as Grade;
    const note = parts.slice(2).join(" ");
    if (!id || !["win", "meh", "fail"].includes(grade)) {
      await c.reply("usage: /grade <id> win|meh|fail [note]");
      return;
    }
    gradePosition(ctx.store, id, grade, note);
    await c.reply(`graded #${id} ${grade}`);
  });
  bot.command("lesson", async (c) => {
    if (!allow(c, chatId)) return;
    const text = (c.match || "").trim();
    if (!text) {
      await c.reply(loadLessons(ctx.paths.lessons).slice(-1500));
      return;
    }
    appendLesson(ctx.paths.lessons, text);
    await c.reply("lesson saved");
  });
  bot.command("never", async (c) => {
    if (!allow(c, chatId)) return;
    const parsed = parseNeverRule((c.match || "").trim());
    if (!parsed) {
      await c.reply("usage: /never source:@handle | creator_pct>8 | keyword:scam");
      return;
    }
    const rule = addGuardrail(ctx.paths.guardrails, { ...parsed, origin: "manual" });
    await c.reply(`guardrail ${rule.id} ${rule.type}=${rule.value}`);
  });
  bot.command("guardrails", async (c) => {
    if (!allow(c, chatId)) return;
    const rules = loadGuardrails(ctx.paths.guardrails);
    await c.reply(rules.length ? rules.map((r) => `${r.id} ${r.type}=${r.value} (${r.origin})`).join("\n") : "no guardrails");
  });
  bot.command("unguard", async (c) => {
    if (!allow(c, chatId)) return;
    const id = (c.match || "").trim();
    const ok = removeGuardrail(ctx.paths.guardrails, id);
    await c.reply(ok ? `removed ${id}` : `not found ${id}`);
  });
  bot.command("sources", async (c) => {
    if (!allow(c, chatId)) return;
    const hits = recentSourceHits(ctx.store, Date.now() - 6 * 3600_000);
    const lines = hits.slice(0, 15).map((h) => `${h.key} ${h.mint ?? ""} ${h.snippet.slice(0, 60)}`);
    const suggestions = listSuggestions(ctx.store);
    await c.reply(
      (lines.join("\n") || "no recent source hits") +
        (suggestions.length ? `\n\nSuggestions:\n${suggestions.map((s) => s.text).join("\n")}` : ""),
    );
  });
  bot.command("kill", async (c) => {
    if (!allow(c, chatId)) return;
    setFlag(ctx.store, "master", "false");
    await c.reply(
      "MASTER off. New live entries and live exits halted. Paper sells still run. MODE is unchanged (env only).",
    );
  });
  bot.command("resume", async (c) => {
    if (!allow(c, chatId)) return;
    if ((c.match || "").trim().toUpperCase() !== "CONFIRM") {
      await c.reply("type /resume CONFIRM");
      return;
    }
    setFlag(ctx.store, "master", "true");
    if (ctx.flags().mode !== "LIVE") {
      await c.reply(
        "MASTER on. MODE is PAPER — this does not enable live trading. Live still requires MODE=LIVE in .env plus a hot wallet. /resume is a kill/resume switch, not a way around MODE.",
      );
      return;
    }
    await c.reply(
      "MASTER on. Live buys/sells allowed while MODE=LIVE and a hot wallet is present. /resume cannot change MODE; it only restores master after /kill.",
    );
  });
  bot.command("sellall", async (c) => {
    if (!allow(c, chatId)) return;
    if ((c.match || "").trim() !== "CONFIRM") {
      await c.reply("type /sellall CONFIRM");
      return;
    }
    await c.reply(await ctx.onSellAll());
  });
  bot.command("budget", async (c) => {
    if (!allow(c, chatId)) return;
    const b = getBudget(ctx.store, ctx.dayKey());
    const p = ctx.policy();
    const cap = effectiveDailyBudgetSol(p, b.extra_budget_sol, Boolean(ctx.flags().allowExtraBudget));
    await c.reply(
      `spent ${b.spent_sol.toFixed(3)}/${cap.cap} SOL\ntrades ${b.trades}/${p.maxTradesPerDay}\nloss ${b.realized_loss_sol.toFixed(3)}/${p.dailyLossCapSol}`,
    );
  });
  bot.command("policy", async (c) => {
    if (!allow(c, chatId)) return;
    await c.reply(JSON.stringify(ctx.policy(), null, 2).slice(0, 3500));
  });
  bot.command("crew", async (c) => {
    if (!allow(c, chatId)) return;
    await c.reply(ctx.crew ? ctx.crew().formatText() : "crew board not attached");
  });
  bot.command("rules", async (c) => {
    if (!allow(c, chatId)) return;
    const rules = loadExtraRules(ctx.paths.rules);
    await c.reply(
      rules.length
        ? rules.map((r) => `${r.enabled ? "ON " : "off"} ${r.id} ${r.type}=${r.value}${r.note ? ` — ${r.note}` : ""}`).join("\n")
        : "no extra rules",
    );
  });
  bot.command("rule", async (c) => {
    if (!allow(c, chatId)) return;
    const parts = (c.match || "").trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const id = parts[1];
    if (!id || (cmd !== "on" && cmd !== "off")) {
      await c.reply("usage: /rule on <id>  or  /rule off <id>\nsee /rules");
      return;
    }
    const ok = setExtraRuleEnabled(ctx.paths.rules, id, cmd === "on");
    await c.reply(ok ? `${id} ${cmd}` : `unknown rule ${id}`);
  });
  bot.command("research", async (c) => {
    if (!allow(c, chatId)) return;
    const mint = (c.match || "").trim();
    if (!mint) {
      await c.reply("usage: /research <mint>");
      return;
    }
    await c.reply("Grok multi-agent research running…");
    const text = ctx.onResearch ? await ctx.onResearch(mint) : "research not wired";
    await c.reply(text.slice(0, 3900));
  });

  bot.catch((err) => {
    console.error("telegram error", err);
  });

  void only;
  void getFlag;
  return bot;
}

function allow(c: { chat?: { id?: number }; from?: { id?: number } }, chatId: string): boolean {
  if (!chatId) return true;
  return String(c.chat?.id) === String(chatId) || String(c.from?.id) === String(chatId);
}

function allowed(c: { from?: { id?: number } }, chatId: string): boolean {
  return String(c.from?.id) === String(chatId);
}

export function statusText(ctx: TelegramContext): string {
  const f = ctx.flags();
  const p = ctx.policy();
  const b = getBudget(ctx.store, ctx.dayKey());
  const master = getFlag(ctx.store, "master", String(f.masterEnabled));
  return [
    `mode=${f.mode} master=${master}`,
    `rpc=${f.rpcHealthy} jupiter=${f.jupiterHealthy} tg=${f.telegramHealthy}`,
    `budget ${b.spent_sol.toFixed(3)}/${effectiveDailyBudgetSol(p, b.extra_budget_sol, Boolean(f.allowExtraBudget)).cap} trades ${b.trades}/${p.maxTradesPerDay}`,
    `open ${listOpenPositions(ctx.store).length}/${p.maxOpenPositions}`,
    ctx.crew ? ctx.crew().snapshot().map((x) => `${x.title}:${x.status}`).join(" ") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function positionsText(store: Store): string {
  const rows = listOpenPositions(store);
  if (!rows.length) return "no open positions";
  return rows
    .map((r) => {
      let snap = "";
      const tape = listTape(store, r.id, 1)[0];
      if (tape) {
        try {
          const s = JSON.parse(tape.snapshot_json) as { marketCapUsd?: number; volume5m?: number; sentiment?: number };
          snap = ` MC=${Math.round(s.marketCapUsd ?? 0)} vol5m=${Math.round(s.volume5m ?? 0)} sent=${(s.sentiment ?? 0).toFixed(2)}`;
        } catch {
          snap = "";
        }
      }
      return `#${r.id} ${r.ticker} ${r.mint.slice(0, 6)}… runner=${r.runner} rec=${r.principal_recovered_sol.toFixed(3)}/${r.principal_sol.toFixed(3)} pat=${r.last_pattern ?? "-"}${snap}`;
    })
    .join("\n");
}

function resolvePosition(store: Store, idOrMint: string) {
  const n = Number(idOrMint);
  if (Number.isFinite(n) && n > 0) return getPosition(store, n);
  return findPositionByMint(store, idOrMint);
}

export function tradeCard(store: Store, idOrMint: string): string {
  const row = resolvePosition(store, idOrMint);
  if (!row) return "trade not found";
  return [
    `#${row.id} ${row.ticker} ${row.mode} ${row.status}`,
    solscanToken(row.mint),
    `entry ${row.entry_price_usd} spent ${row.sol_spent} recovered ${row.principal_recovered_sol}`,
    `net ${row.net_sol ?? "open"} exit ${row.exit_reason ?? "-"} grade ${row.grade ?? "-"} ${row.grade_note ?? ""}`,
    `pattern ${row.pattern_path || row.last_pattern || "-"} mistake ${row.mistake ?? "-"}`,
    `thesis ${row.thesis ?? "-"}`,
    row.entry_tx ? solscanTx(row.entry_tx) : "",
    row.exit_tx ? solscanTx(row.exit_tx) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function tapeText(store: Store, idOrMint: string): string {
  const row = resolvePosition(store, idOrMint);
  if (!row) return "position not found";
  const rows = listTape(store, row.id, 8);
  if (!rows.length) return "no tape yet";
  return rows
    .map((t) => {
      const s = JSON.parse(t.snapshot_json) as {
        priceUsd?: number;
        marketCapUsd?: number;
        volume5m?: number;
        sentiment?: number;
        pctFromPeak?: number;
      };
      return `${new Date(t.at).toISOString()} ${t.pattern} ${t.action} MC=${Math.round(s.marketCapUsd ?? 0)} px=${s.priceUsd} vol5=${s.volume5m} sent=${s.sentiment} peak%=${s.pctFromPeak} ${t.reason ?? ""}`;
    })
    .join("\n");
}

export function whyText(store: Store, mint: string): string {
  const dec = recentDecisions(store, mint);
  if (!dec.length) return "no decisions for that mint";
  return dec
    .map((d) => `${new Date(d.at).toISOString()} ${d.kind} ${d.allowed ? "allow" : "block"} ${d.reason} score=${d.score ?? "-"} pat=${d.pattern ?? "-"}`)
    .join("\n");
}

export async function notify(token: string, chatId: string, text: string): Promise<boolean> {
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
