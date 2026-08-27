import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Policy, type RuntimeFlags, type Grade, dayKey } from "@night/shared";
import { CrewBoard, CREW_META } from "@night/crew";
import {
  gradePosition,
  lastAuditorScan,
  listFeedback,
  listOpenPositions,
  listRecentPositions,
  listTodos,
  listUngradedClosed,
  listPendingSizeAsks,
  listOpenOpportunities,
  insertTodo,
  insertFeedback,
  setTodoDone,
  getSizeAsk,
  answerSizeAsk,
  markOpportunitySkipped,
  approveOpportunity,
  getBudget,
  setFlag,
  insertChallengeIdea,
  updateChallengeIdea,
  getChallengeIdea,
  type Store,
} from "@night/storage";
import { appendLesson, buildReview, loadLessons } from "@night/learning";
import { loadExtraRules, setExtraRuleEnabled, effectiveDailyBudgetSol } from "@night/risk";
import { loadSources } from "@night/social";
import { fetchDexToken } from "@night/signals";
import type { TradeOutcome } from "./trade.ts";
import { parseAddOn, parseChiefApprove } from "./entries.ts";
import { dashboardHtml } from "./dashboard-html.ts";
import {
  clearPendingCookieHeader,
  clearSessionCookieHeader,
  emailsEqual,
  hashEmailCode,
  makeEmailCode,
  parseCookies,
  passwordsEqual,
  PENDING_COOKIE,
  pendingCookieHeader,
  SESSION_COOKIE,
  sessionCookieHeader,
  signPending,
  signSession,
  verifyPending,
  verifySession,
} from "./auth.ts";
import {
  addGrant,
  createGrant,
  findGrantByEmail,
  findGrantByToken,
  grokBotEmail,
  loadAccess,
  markRedeemed,
  publicGrants,
  revokeGrant,
  type AccessKind,
} from "./access.ts";
import { sendLoginCode, type SendCodeFn } from "./mail.ts";
import { addWallet, listPublicWallets, removeWallet } from "./wallets.ts";
import { auditorPulseDetail, runAuditorScan } from "./auditor.ts";
import { getDesk, lastDeskMeta, lastDeskRun, listDesks, runDeskAnalysis } from "./desks.ts";
import { challengePayload, loadChallenge, setBankrollUsd } from "./challenge.ts";
import { searchPolymarket } from "./polymarket.ts";
import type { AppConfig } from "./config.ts";

export const GROK_BOT_ORDERS_ONLY = "only Grok Bot can place buy/sell orders";

export interface DashboardContext {
  store: Store;
  crew: CrewBoard;
  cfg: AppConfig;
  policy: Policy;
  flags: () => RuntimeFlags;
  password: string;
  email: string;
  totpFile: string;
  accessFile: string;
  sendCode?: SendCodeFn;
  buy: (opts: {
    mint: string;
    sol?: number;
    force?: boolean;
    sizeAskId?: number;
    grokBotOrder?: boolean;
    chiefApproved?: boolean;
    add?: boolean;
  }) => Promise<TradeOutcome>;
  sell: (idOrMint: string, opts?: { grokBotOrder?: boolean }) => Promise<TradeOutcome>;
  repoRoot?: string;
}

const JSON_H = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const HTML_H = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
const JS_H = { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" };
const DASHBOARD_CLIENT_JS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "dashboard-client.js"),
  "utf8",
);

function json(res: ServerResponse, status: number, body: unknown, cookies?: string[]): void {
  if (cookies?.length) {
    res.writeHead(status, { ...JSON_H, "set-cookie": cookies });
  } else {
    res.writeHead(status, JSON_H);
  }
  res.end(JSON.stringify(body));
}

function isSecure(req: IncomingMessage, _cfg: AppConfig): boolean {
  // Only mark cookies Secure when the request is actually HTTPS. Forcing
  // Secure because DASHBOARD_BIND is public (or DASHBOARD_SECURE_COOKIE=true)
  // makes browsers drop the cookie on plain HTTP, so login never sticks.
  if (req.socket && (req.socket as { encrypted?: boolean }).encrypted) return true;
  const xf = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim().toLowerCase();
  return xf === "https";
}

function authed(req: IncomingMessage, ctx: DashboardContext): boolean {
  return requestActor(req, ctx) != null;
}

/** Bearer invite token wins over the session cookie so Grok Bot orders are not treated as owner. */
export function requestActor(req: IncomingMessage, ctx: DashboardContext): { kind: AccessKind } | null {
  const header = String(req.headers.authorization ?? "");
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m?.[1]) {
    const grant = findGrantByToken(ctx.accessFile, m[1].trim());
    if (grant) return { kind: grant.kind };
  }
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token && verifySession(token, ctx.password)) return { kind: "owner" };
  return null;
}

function refuseUnlessGrokBot(
  res: ServerResponse,
  actor: { kind: AccessKind } | null,
): boolean {
  if (actor?.kind === "grokbot") return false;
  json(res, 403, { error: GROK_BOT_ORDERS_ONLY, ok: false });
  return true;
}

function publicOrigin(req: IncomingMessage, cfg: AppConfig): string {
  const host = incomingHost(req);
  if (!host || host === "127.0.0.1" || host === "localhost") {
    const xfProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
    const proto = xfProto || "http";
    const raw = String(req.headers.host ?? cfg.dashboardHost);
    return `${proto}://${raw}`;
  }
  return `https://${canonicalHost(cfg)}`;
}

function canonicalHost(cfg: AppConfig): string {
  return (cfg.dashboardHost || "cryptogrokbot.com").replace(/^https?:\/\//, "").split("/")[0]!.toLowerCase();
}

function incomingHost(req: IncomingMessage): string {
  const raw = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  return raw.split(",")[0]?.trim().toLowerCase().split(":")[0] ?? "";
}

const ALIAS_HOSTS = new Set(["www.cryptogrokbot.com", "dash.cryptogrokbot.com", "app.cryptogrokbot.com"]);

function redirectAliasHost(
  ctx: DashboardContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): boolean {
  if (url.pathname === "/health") return false;
  const host = incomingHost(req);
  if (!host || host === "127.0.0.1" || host === "localhost") return false;
  const canon = canonicalHost(ctx.cfg);
  if (host === canon) return false;
  if (!ALIAS_HOSTS.has(host) && host !== `www.${canon}`) return false;
  const loc = `https://${canon}${url.pathname}${url.search}`;
  res.writeHead(301, { location: loc, "cache-control": "no-store" });
  res.end();
  return true;
}

async function deliverCode(ctx: DashboardContext, to: string, code: string) {
  if (ctx.sendCode) return ctx.sendCode(to, code);
  return sendLoginCode({
    to,
    code,
    resendKey: ctx.cfg.resendApiKey,
    telegramToken: ctx.cfg.telegramToken,
    telegramChatId: ctx.cfg.telegramChatId,
  });
}

async function readBody(req: IncomingMessage, limit = 256_000): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    n += buf.length;
    if (n > limit) throw new Error("body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function pnlPayload(store: Store) {
  const review = buildReview(store, "all");
  return {
    paperNetSol: review.paper.netSol,
    paperTrades: review.paper.trades,
    liveNetSol: review.live.netSol,
    liveTrades: review.live.trades,
    winRatePaper: review.paper.winRate,
  };
}

function dayBudgetPayload(store: Store, policy: Policy, allowExtra: boolean) {
  const day = dayKey(Date.now(), policy.timezone);
  const paper = getBudget(store, day, "PAPER");
  const live = getBudget(store, day, "LIVE");
  const paperCap = effectiveDailyBudgetSol(policy, paper.extra_budget_sol, allowExtra);
  const liveCap = effectiveDailyBudgetSol(policy, live.extra_budget_sol, allowExtra);
  return {
    day,
    paper: { spentSol: paper.spent_sol, trades: paper.trades, cap: paperCap.cap },
    live: { spentSol: live.spent_sol, trades: live.trades, cap: liveCap.cap },
  };
}

function publicPosition(p: ReturnType<typeof listRecentPositions>[number]) {
  return {
    id: p.id,
    mint: p.mint,
    ticker: p.ticker,
    mode: p.mode,
    status: p.status,
    sol_spent: p.sol_spent,
    tokens_held: p.tokens_held,
    net_sol: p.net_sol,
    grade: p.grade,
    grade_note: p.grade_note,
    opened_at: p.opened_at,
    closed_at: p.closed_at,
  };
}

function publicOpportunity(o: ReturnType<typeof listOpenOpportunities>[number], policy: Policy) {
  return {
    id: o.id,
    mint: o.mint,
    ticker: o.ticker,
    sentiment: o.sentiment,
    score: o.score,
    volume5m: o.volume5m,
    priceUsd: o.price_usd,
    costOutMultiple: o.cost_out_multiple,
    reason: o.reason,
    note: o.note,
    at: o.at,
    sizeSol: policy.maxSolPerTrade,
    chiefApproved: o.chief_approved === 1,
  };
}

function publicSizeAsk(a: ReturnType<typeof listPendingSizeAsks>[number], policy: Policy) {
  return {
    id: a.id,
    mint: a.mint,
    ticker: a.ticker,
    sentiment: a.sentiment,
    testSol: a.test_sol,
    ceilingSol: policy.sizeAskCeilingSol,
    status: a.status,
    note: a.note,
    at: a.at,
  };
}

function challengeState(ctx: DashboardContext) {
  const flags = ctx.flags();
  return challengePayload({
    store: ctx.store,
    challenge: loadChallenge(ctx.cfg.challengePath),
    policy: ctx.policy,
    masterEnabled: flags.masterEnabled,
    mode: flags.mode,
  });
}

function polymarketOn(ctx: DashboardContext): boolean {
  return loadChallenge(ctx.cfg.challengePath).polymarketEnabled === true;
}

export async function handleDashboardRequest(
  ctx: DashboardContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);

  if (redirectAliasHost(ctx, req, res, url)) return;

  if (path === "/health" && (method === "GET" || method === "HEAD")) {
    json(res, 200, { ok: true, service: "cryptogrokbot-dashboard" });
    return;
  }

  if ((path === "/dashboard.js" || path === "/assets/dashboard.js") && (method === "GET" || method === "HEAD")) {
    res.writeHead(200, JS_H);
    if (method === "HEAD") res.end();
    else res.end(DASHBOARD_CLIENT_JS);
    return;
  }

  if ((path === "/" || path === "/login" || path === "/index.html") && (method === "GET" || method === "HEAD")) {
    res.writeHead(200, HTML_H);
    if (method === "HEAD") res.end();
    else res.end(dashboardHtml({ ownerEmail: ctx.email }));
    return;
  }

  const invitePath = path.match(/^\/invite\/([^/]+)$/);
  if (invitePath && method === "GET") {
    const grant = findGrantByToken(ctx.accessFile, decodeURIComponent(invitePath[1]));
    if (!grant) {
      res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
      res.end("Invite expired or invalid.");
      return;
    }
    markRedeemed(ctx.accessFile, grant.id);
    const secure = isSecure(req, ctx.cfg);
    const session = signSession(ctx.password);
    res.writeHead(302, {
      location: "/",
      "set-cookie": [sessionCookieHeader(session, secure), clearPendingCookieHeader(secure)],
    });
    res.end();
    return;
  }

  if (path === "/api/login" && method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const email = str(body.email).trim().toLowerCase();
    const password = str(body.password);
    const loginEmail = email || ctx.email;
    const invited = findGrantByEmail(ctx.accessFile, loginEmail);
    const isOwner = emailsEqual(loginEmail, ctx.email);
    if (isOwner) {
      if (!passwordsEqual(password, ctx.password)) {
        json(res, 401, { error: "Wrong email or password" });
        return;
      }
    } else if (!invited || invited.kind === "grokbot") {
      json(res, 401, { error: "Wrong email or password" });
      return;
    }
    const code = makeEmailCode();
    const extra = `${hashEmailCode(code, ctx.password)}|${loginEmail}`;
    const token = signPending(ctx.password, "email", extra);
    const sent = await deliverCode(ctx, loginEmail, code);
    const secure = isSecure(req, ctx.cfg);
    json(
      res,
      200,
      {
        ok: false,
        step: "email",
        email: loginEmail,
        sent: sent.delivered,
        via: sent.via,
        ...(sent.delivered ? {} : { devCode: code }),
      },
      [pendingCookieHeader(token, secure), clearSessionCookieHeader(secure)],
    );
    return;
  }

  if (path === "/api/email/verify" && method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const pending = parseCookies(req.headers.cookie)[PENDING_COOKIE] ?? "";
    const checked = verifyPending(pending, ctx.password, "email");
    if (!checked.ok || !checked.extra) {
      json(res, 401, { error: "Email code expired — log in again" });
      return;
    }
    const [wantHash] = checked.extra.split("|");
    const got = hashEmailCode(str(body.code), ctx.password);
    if (!wantHash || !passwordsEqual(got, wantHash)) {
      json(res, 401, { error: "Wrong email code" });
      return;
    }
    const secure = isSecure(req, ctx.cfg);
    const session = signSession(ctx.password);
    json(res, 200, { ok: true }, [sessionCookieHeader(session, secure), clearPendingCookieHeader(secure)]);
    return;
  }

  if (path === "/api/bot-token" && method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const grant = findGrantByToken(ctx.accessFile, str(body.token));
    if (!grant) {
      json(res, 401, { error: "Invalid invite" });
      return;
    }
    markRedeemed(ctx.accessFile, grant.id);
    const secure = isSecure(req, ctx.cfg);
    const session = signSession(ctx.password);
    json(res, 200, { ok: true, email: grant.email, label: grant.label }, [
      sessionCookieHeader(session, secure),
      clearPendingCookieHeader(secure),
    ]);
    return;
  }

  if (path === "/api/logout" && method === "POST") {
    await readBody(req).catch(() => "");
    const secure = isSecure(req, ctx.cfg);
    json(res, 200, { ok: true }, [clearSessionCookieHeader(secure), clearPendingCookieHeader(secure)]);
    return;
  }

  const needsAuth = path.startsWith("/api/") || path.startsWith("/crew.json");
  if (needsAuth && !authed(req, ctx)) {
    if (mutating || path.startsWith("/api/") || path.startsWith("/crew.json")) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
  }

  if (!authed(req, ctx) && (path.startsWith("/api/") || path.startsWith("/crew.json"))) {
    json(res, 401, { error: "unauthorized" });
    return;
  }

  try {
    await routeAuthed(ctx, req, res, url, method, path, requestActor(req, ctx));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "internal";
    if (msg === "invalid json" || msg === "body too large") {
      json(res, 400, { error: msg });
      return;
    }
    json(res, 500, { error: "internal" });
  }
}

async function routeAuthed(
  ctx: DashboardContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  path: string,
  actor: { kind: AccessKind } | null,
): Promise<void> {
  const canPlaceOrders = actor?.kind === "grokbot";
  if ((path === "/api/session" || path === "/api/me") && method === "GET") {
    const flags = ctx.flags();
    json(res, 200, {
      ok: true,
      mode: flags.mode,
      masterEnabled: flags.masterEnabled,
      host: ctx.cfg.dashboardHost,
      email: ctx.email,
      twoFactor: "email",
      actor: actor?.kind ?? null,
      canPlaceOrders,
    });
    return;
  }

  if (path === "/api/access" && method === "GET") {
    json(res, 200, {
      owner: ctx.email,
      grants: publicGrants(loadAccess(ctx.accessFile)),
    });
    return;
  }

  if (path === "/api/access/invite" && method === "POST") {
    const body = await readJson(req);
    const kind = str(body.kind) === "human" ? "human" : "grokbot";
    const email = kind === "grokbot" ? grokBotEmail() : str(body.email).trim().toLowerCase();
    if (kind === "human" && (!email || !email.includes("@"))) {
      json(res, 400, { error: "email required" });
      return;
    }
    if (kind === "human" && emailsEqual(email, ctx.email)) {
      json(res, 400, { error: "owner already has access" });
      return;
    }
    const label = str(body.label).trim() || (kind === "grokbot" ? "Grok Bot" : email);
    const { grant, token } = createGrant({ email, label, kind });
    addGrant(ctx.accessFile, grant);
    const origin = publicOrigin(req, ctx.cfg);
    json(res, 200, {
      ok: true,
      id: grant.id,
      email: grant.email,
      label: grant.label,
      kind: grant.kind,
      token,
      url: `${origin}/invite/${token}`,
      expiresAt: grant.expiresAt,
    });
    return;
  }

  if (path === "/api/access/revoke" && method === "POST") {
    const body = await readJson(req);
    const id = str(body.id);
    if (!id) {
      json(res, 400, { error: "id required" });
      return;
    }
    json(res, 200, { ok: true, grants: publicGrants(revokeGrant(ctx.accessFile, id)) });
    return;
  }

  if ((path === "/api/crew" || path === "/crew.json") && method === "GET") {
    json(res, 200, {
      pulses: ctx.crew.snapshot().map((p) => ({ ...p, job: CREW_META[p.id]?.job })),
      log: ctx.crew.recentLog(40),
    });
    return;
  }

  if (path === "/api/home" && method === "GET") {
    const flags = ctx.flags();
    const scan = lastAuditorScan(ctx.store);
    json(res, 200, {
      mode: flags.mode,
      masterEnabled: flags.masterEnabled,
      pnl: pnlPayload(ctx.store),
      budget: dayBudgetPayload(ctx.store, ctx.policy, Boolean(flags.allowExtraBudget)),
      openCount: listOpenPositions(ctx.store).length,
      email: ctx.email,
      actor: actor?.kind ?? null,
      canPlaceOrders,
      canApproveChief: actor?.kind === "owner" || actor?.kind === "grokbot",
      todos: listTodos(ctx.store).map((t) => ({
        id: t.id,
        title: t.title,
        done: t.done === 1,
        sort: t.sort,
      })),
      auditor: scan
        ? { ok: scan.ok === 1, summary: scan.summary, at: scan.at, details: JSON.parse(scan.details_json) }
        : null,
      sizeAsks: listPendingSizeAsks(ctx.store).map((a) => publicSizeAsk(a, ctx.policy)),
      opportunities: listOpenOpportunities(ctx.store).map((o) => publicOpportunity(o, ctx.policy)),
      challenge: challengeState(ctx),
    });
    return;
  }

  if (path === "/api/challenge" && method === "GET") {
    json(res, 200, challengeState(ctx));
    return;
  }

  if (path === "/api/challenge" && method === "POST") {
    if (actor?.kind !== "owner" && actor?.kind !== "grokbot") {
      json(res, 403, { error: "owner or Grok Bot can update bankroll", ok: false });
      return;
    }
    const body = await readJson(req);
    const usd = typeof body.bankrollUsd === "number" ? body.bankrollUsd : Number(body.bankrollUsd);
    if (!Number.isFinite(usd) || usd < 0 || usd > 10_000_000) {
      json(res, 400, { error: "bankrollUsd required" });
      return;
    }
    setBankrollUsd(ctx.store, usd);
    json(res, 200, { ok: true, ...challengeState(ctx) });
    return;
  }

  if (path === "/api/challenge/ideas" && method === "POST") {
    if (actor?.kind !== "owner" && actor?.kind !== "grokbot") {
      json(res, 403, { error: "owner or Grok Bot can log ideas", ok: false });
      return;
    }
    const body = await readJson(req);
    const title = str(body.title).trim();
    const venue = str(body.venue).trim().toLowerCase() || "solana";
    if (!title) {
      json(res, 400, { error: "title required" });
      return;
    }
    if (venue === "polymarket" && !polymarketOn(ctx)) {
      json(res, 400, { error: "Polymarket is off — crypto only until Taskra enables it" });
      return;
    }
    if (venue !== "solana" && venue !== "polymarket") {
      json(res, 400, { error: "venue must be solana or polymarket" });
      return;
    }
    const state = challengeState(ctx);
    const row = insertChallengeIdea(ctx.store, {
      venue,
      title,
      url: str(body.url),
      side: str(body.side),
      sizeUsd: typeof body.sizeUsd === "number" ? body.sizeUsd : Number(body.sizeUsd) || 0,
      note: str(body.note),
      status: str(body.status) as "watch" | "paper" | "killed" | "won" | "lost",
      rungFrom: state.rung.from,
      rungTo: state.rung.to,
    });
    json(res, 200, { ok: true, idea: {
      id: row.id,
      at: row.at,
      venue: row.venue,
      title: row.title,
      url: row.url,
      side: row.side,
      sizeUsd: row.size_usd,
      note: row.note,
      status: row.status,
    } });
    return;
  }

  const ideaOne = path.match(/^\/api\/challenge\/ideas\/(\d+)$/);
  if (ideaOne && method === "PATCH") {
    if (actor?.kind !== "owner" && actor?.kind !== "grokbot") {
      json(res, 403, { error: "owner or Grok Bot can update ideas", ok: false });
      return;
    }
    const existing = getChallengeIdea(ctx.store, Number(ideaOne[1]));
    if (!existing) {
      json(res, 404, { error: "idea not found" });
      return;
    }
    const body = await readJson(req);
    const row = updateChallengeIdea(ctx.store, existing.id, {
      status: str(body.status) as "watch" | "paper" | "killed" | "won" | "lost" | undefined,
      note: body.note != null ? str(body.note) : undefined,
      sizeUsd: typeof body.sizeUsd === "number" ? body.sizeUsd : undefined,
    });
    json(res, 200, { ok: true, idea: row });
    return;
  }

  if (path === "/api/polymarket" && method === "GET") {
    if (!polymarketOn(ctx)) {
      json(res, 403, {
        error: "Polymarket is off until Taskra enables it. Stick to crypto.",
        events: [],
        liveTrading: false,
      });
      return;
    }
    const q = url.searchParams.get("q") ?? "";
    try {
      const events = await searchPolymarket(q, 10);
      json(res, 200, { events, liveTrading: false, note: "research only — no CLOB orders" });
    } catch (err) {
      json(res, 502, { error: err instanceof Error ? err.message : "polymarket lookup failed", events: [] });
    }
    return;
  }

  if (path === "/api/todos" && method === "POST") {
    const body = await readJson(req);
    const title = str(body.title).trim();
    if (!title) {
      json(res, 400, { error: "title required" });
      return;
    }
    const row = insertTodo(ctx.store, title);
    json(res, 200, { id: row.id, title: row.title, done: false });
    return;
  }

  const todoPatch = path.match(/^\/api\/todos\/(\d+)$/);
  if (todoPatch && method === "PATCH") {
    const body = await readJson(req);
    const row = setTodoDone(ctx.store, Number(todoPatch[1]), Boolean(body.done));
    if (!row) {
      json(res, 404, { error: "not found" });
      return;
    }
    json(res, 200, { id: row.id, title: row.title, done: row.done === 1 });
    return;
  }

  if (path === "/api/trade" && method === "GET") {
    const sources = loadSources(ctx.cfg.sourcesPath);
    const watchlist = await Promise.all(
      sources.watchlist.map(async (w) => {
        let pairAddress = "";
        try {
          const pair = await fetchDexToken(w.mint);
          pairAddress = pair?.pairAddress ?? "";
        } catch {
          pairAddress = "";
        }
        return { mint: w.mint, ticker: w.ticker ?? "", notes: w.notes ?? "", pairAddress };
      }),
    );
    json(res, 200, { mode: ctx.flags().mode, masterEnabled: ctx.flags().masterEnabled, canPlaceOrders, watchlist });
    return;
  }

  if (path === "/api/dex" && method === "GET") {
    const mint = url.searchParams.get("mint") ?? "";
    if (!mint) {
      json(res, 400, { error: "mint required" });
      return;
    }
    const pair = await fetchDexToken(mint);
    json(res, 200, {
      mint,
      pairAddress: pair?.pairAddress ?? "",
      ticker: pair?.baseToken.symbol ?? "",
      priceUsd: pair?.priceUsd ?? null,
    });
    return;
  }

  if (path === "/api/master" && method === "POST") {
    const body = await readJson(req);
    const enable = body.enabled === true || body.enabled === "true";
    if (enable) {
      if (actor?.kind !== "owner") {
        json(res, 403, { error: "only the owner can resume MASTER", ok: false });
        return;
      }
      if (str(body.confirm).toUpperCase() !== "CONFIRM") {
        json(res, 400, { error: "type CONFIRM to resume MASTER", ok: false });
        return;
      }
      setFlag(ctx.store, "master", "true");
    } else {
      if (actor?.kind !== "owner" && actor?.kind !== "grokbot") {
        json(res, 403, { error: "only the owner or Grok Bot can kill MASTER", ok: false });
        return;
      }
      setFlag(ctx.store, "master", "false");
    }
    const flags = ctx.flags();
    json(res, 200, {
      ok: true,
      masterEnabled: flags.masterEnabled,
      mode: flags.mode,
    });
    return;
  }

  if (path === "/api/buy" && method === "POST") {
    if (refuseUnlessGrokBot(res, actor)) return;
    const body = await readJson(req);
    const mint = str(body.mint).trim();
    if (!mint) {
      json(res, 400, { error: "mint required" });
      return;
    }
    const flags = ctx.flags();
    const chiefApproved = flags.mode !== "LIVE" || parseChiefApprove(body);
    if (flags.mode === "LIVE" && !chiefApproved) {
      json(res, 403, { error: "needs Chief permission (chief: APPROVE)", ok: false });
      return;
    }
    const result = await ctx.buy({
      mint,
      sol: typeof body.sol === "number" ? body.sol : Number(body.sol) || undefined,
      force: Boolean(body.force) && flags.mode === "PAPER",
      grokBotOrder: true,
      chiefApproved,
      add: parseAddOn(body),
    });
    json(res, result.ok ? 200 : 400, result);
    return;
  }

  if (path === "/api/sell" && method === "POST") {
    if (refuseUnlessGrokBot(res, actor)) return;
    const body = await readJson(req);
    const idOrMint = str(body.idOrMint).trim();
    if (!idOrMint) {
      json(res, 400, { error: "idOrMint required" });
      return;
    }
    const result = await ctx.sell(idOrMint, { grokBotOrder: true });
    json(res, result.ok ? 200 : 400, result);
    return;
  }

  if (path === "/api/book" && method === "GET") {
    const wallets = await listPublicWallets({ store: ctx.store, rpcUrl: ctx.cfg.heliusRpc });
    json(res, 200, {
      pnl: pnlPayload(ctx.store),
      positions: listRecentPositions(ctx.store).map(publicPosition),
      wallets,
      canPlaceOrders,
    });
    return;
  }

  if (path === "/api/wallets" && method === "GET") {
    json(res, 200, { wallets: await listPublicWallets({ store: ctx.store, rpcUrl: ctx.cfg.heliusRpc }) });
    return;
  }

  if (path === "/api/wallets" && method === "POST") {
    const body = await readJson(req);
    const secret = str(body.secret).trim();
    const wallet = addWallet({
      store: ctx.store,
      secretsPath: ctx.cfg.walletSecretsPath,
      label: str(body.label),
      publicKey: str(body.publicKey),
      secret: secret || undefined,
      assignedDesk: str(body.assignedDesk),
    });
    const payload = JSON.parse(JSON.stringify(wallet)) as Record<string, unknown>;
    if (secret && JSON.stringify(payload).includes(secret)) {
      json(res, 500, { error: "refusing to return secret" });
      return;
    }
    json(res, 200, wallet);
    return;
  }

  const walletDel = path.match(/^\/api\/wallets\/(\d+)$/);
  if (walletDel && method === "DELETE") {
    const ok = removeWallet(ctx.store, ctx.cfg.walletSecretsPath, Number(walletDel[1]));
    json(res, ok ? 200 : 404, { ok });
    return;
  }

  if (path === "/api/improve" && method === "GET") {
    const lessons = loadLessons(ctx.cfg.lessonsPath);
    json(res, 200, {
      rules: loadExtraRules(ctx.cfg.rulesPath),
      ungraded: listUngradedClosed(ctx.store).map(publicPosition),
      feedback: listFeedback(ctx.store),
      lessonsTail: lessons.slice(-2500),
    });
    return;
  }

  if (path === "/api/rules" && method === "POST") {
    const body = await readJson(req);
    const id = str(body.id).trim();
    if (!id) {
      json(res, 400, { error: "id required" });
      return;
    }
    const ok = setExtraRuleEnabled(ctx.cfg.rulesPath, id, Boolean(body.enabled));
    json(res, ok ? 200 : 404, { ok, id, enabled: Boolean(body.enabled) });
    return;
  }

  if (path === "/api/feedback" && method === "POST") {
    const body = await readJson(req);
    const text = str(body.text).trim();
    if (!text) {
      json(res, 400, { error: "text required" });
      return;
    }
    const row = insertFeedback(ctx.store, text, str(body.kind) || "improve");
    appendLesson(ctx.cfg.lessonsPath, text);
    json(res, 200, { id: row.id, at: row.at, text: row.text });
    return;
  }

  if (path === "/api/grade" && method === "POST") {
    const body = await readJson(req);
    const id = Number(body.id);
    const grade = str(body.grade) as Grade;
    if (!id || !["win", "meh", "fail"].includes(grade)) {
      json(res, 400, { error: "id and grade win|meh|fail required" });
      return;
    }
    gradePosition(ctx.store, id, grade, str(body.note));
    json(res, 200, { ok: true, id, grade });
    return;
  }

  if (path === "/api/auditor" && method === "GET") {
    const scan = lastAuditorScan(ctx.store);
    json(res, 200, {
      last: scan
        ? { ok: scan.ok === 1, summary: scan.summary, at: scan.at, details: JSON.parse(scan.details_json) }
        : null,
    });
    return;
  }

  if (path === "/api/auditor" && method === "POST") {
    const body = await readJson(req).catch(() => ({} as Record<string, unknown>));
    ctx.crew.start("auditor", "running bug scan");
    const result = await runAuditorScan({
      store: ctx.store,
      repoRoot: ctx.repoRoot,
      includeSubprocess: Boolean(body.full),
    });
    if (result.ok) ctx.crew.idle("auditor", result.summary);
    else ctx.crew.error("auditor", result.summary);
    json(res, 200, result);
    return;
  }

  if (path === "/api/desks" && method === "GET") {
    json(res, 200, {
      desks: listDesks({ includePolymarket: polymarketOn(ctx) }).map((d) => ({
        id: d.id,
        title: d.title,
        blurb: d.blurb,
        fields: d.fields,
        useXSearch: d.useXSearch,
        last: lastDeskMeta(d.id),
      })),
      grokReady: Boolean(ctx.cfg.xaiKey || ctx.cfg.openaiKey),
    });
    return;
  }

  const deskOne = path.match(/^\/api\/desks\/([a-z]+)$/);
  if (deskOne && method === "GET") {
    const desk = getDesk(deskOne[1]!, { includePolymarket: polymarketOn(ctx) });
    if (!desk) {
      json(res, 404, { error: "unknown desk" });
      return;
    }
    json(res, 200, {
      ...desk,
      last: lastDeskRun(desk.id) ?? null,
      grokReady: Boolean(ctx.cfg.xaiKey || ctx.cfg.openaiKey),
    });
    return;
  }

  if (deskOne && method === "POST") {
    const id = deskOne[1]!;
    if (!getDesk(id, { includePolymarket: polymarketOn(ctx) })) {
      json(res, 404, { error: "unknown desk" });
      return;
    }
    const body = await readJson(req);
    const fields = (body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
      ? (body.fields as Record<string, string>)
      : body) as Record<string, string>;
    ctx.crew.start("grok", `intel ${id}`);
    try {
      const run = await runDeskAnalysis({
        id,
        fields,
        cfg: ctx.cfg,
        store: ctx.store,
        policy: ctx.policy,
      });
      ctx.crew.idle("grok", `${id} ${run.via}`);
      json(res, 200, run);
    } catch (err) {
      ctx.crew.error("grok", err instanceof Error ? err.message : "desk failed");
      json(res, 400, { error: err instanceof Error ? err.message : "desk failed" });
    }
    return;
  }

  if (path === "/api/opportunities" && method === "GET") {
    json(res, 200, {
      opportunities: listOpenOpportunities(ctx.store).map((o) => publicOpportunity(o, ctx.policy)),
      sizeSol: ctx.policy.maxSolPerTrade,
      costOutMin: ctx.policy.costOutMinMultiple,
      costOutMax: ctx.policy.costOutMaxMultiple,
    });
    return;
  }

  const oppOne = path.match(/^\/api\/opportunities\/(\d+)$/);
  if (oppOne && method === "POST") {
    const opp = listOpenOpportunities(ctx.store).find((o) => o.id === Number(oppOne[1]));
    if (!opp) {
      json(res, 404, { error: "opportunity not found" });
      return;
    }
    const body = await readJson(req);
    const action = str(body.action).toLowerCase();
    if (action === "approve") {
      if (actor?.kind !== "owner" && actor?.kind !== "grokbot") {
        json(res, 403, { error: "only the owner or Grok Bot can approve", ok: false });
        return;
      }
      const updated = approveOpportunity(ctx.store, opp.id);
      json(res, 200, {
        ok: true,
        approved: true,
        id: opp.id,
        chiefApproved: true,
        opportunity: updated ? publicOpportunity(updated, ctx.policy) : undefined,
      });
      return;
    }
    if (action === "skip") {
      if (actor?.kind !== "owner" && actor?.kind !== "grokbot") {
        json(res, 403, { error: GROK_BOT_ORDERS_ONLY, ok: false });
        return;
      }
      markOpportunitySkipped(ctx.store, opp.id);
      json(res, 200, { ok: true, skipped: true, id: opp.id });
      return;
    }
    if (action === "buy") {
      if (refuseUnlessGrokBot(res, actor)) return;
      const flags = ctx.flags();
      const chiefApproved = opp.chief_approved === 1 || parseChiefApprove(body);
      if (flags.mode === "LIVE" && !chiefApproved) {
        json(res, 403, { error: "needs Chief permission (chief: APPROVE)", ok: false });
        return;
      }
      const result = await ctx.buy({
        mint: opp.mint,
        sol: ctx.policy.maxSolPerTrade,
        grokBotOrder: true,
        chiefApproved: flags.mode !== "LIVE" || chiefApproved,
      });
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    json(res, 400, { error: "action must be approve, buy, or skip" });
    return;
  }

  if (path === "/api/size-asks" && method === "GET") {
    json(res, 200, {
      asks: listPendingSizeAsks(ctx.store).map((a) => publicSizeAsk(a, ctx.policy)),
      testSol: ctx.policy.maxSolPerTrade,
      ceilingSol: ctx.policy.sizeAskCeilingSol,
      highSentiment: ctx.policy.highSentiment,
    });
    return;
  }

  const sizeAskOne = path.match(/^\/api\/size-asks\/(\d+)$/);
  if (sizeAskOne && method === "POST") {
    if (refuseUnlessGrokBot(res, actor)) return;
    const askId = Number(sizeAskOne[1]);
    const existing = getSizeAsk(ctx.store, askId);
    if (!existing) {
      json(res, 404, { error: "size ask not found" });
      return;
    }
    if (existing.status !== "pending") {
      json(res, 409, { error: `size ask already ${existing.status}` });
      return;
    }
    const body = await readJson(req);
    const action = str(body.action).toLowerCase();
    const testSol = ctx.policy.maxSolPerTrade;
    const ceilingSol = ctx.policy.sizeAskCeilingSol;
    let status: "keep" | "increase";
    let chosenSol: number;
    if (action === "keep") {
      status = "keep";
      chosenSol = testSol;
    } else if (action === "increase") {
      status = "increase";
      const want = typeof body.sol === "number" ? body.sol : Number(body.sol);
      chosenSol = Number.isFinite(want) && want > 0 ? want : ceilingSol;
      chosenSol = Math.min(ceilingSol, Math.max(testSol, chosenSol));
    } else {
      json(res, 400, { error: "action must be keep or increase" });
      return;
    }
    const flags = ctx.flags();
    const chiefApproved = flags.mode !== "LIVE" || parseChiefApprove(body);
    if (flags.mode === "LIVE" && !chiefApproved) {
      json(res, 403, { error: "needs Chief permission (chief: APPROVE)", ok: false });
      return;
    }
    const answered = answerSizeAsk(ctx.store, askId, { status, chosenSol });
    if (!answered) {
      json(res, 409, { error: "size ask already answered" });
      return;
    }
    ctx.crew.start("grok", `${status} ${answered.ticker} at ${chosenSol} SOL`);
    const result = await ctx.buy({
      mint: answered.mint,
      sol: chosenSol,
      sizeAskId: answered.id,
      grokBotOrder: true,
      chiefApproved,
    });
    ctx.crew.idle("grok", result.message);
    json(res, 200, {
      ok: result.ok,
      answered: true,
      ask: publicSizeAsk(answered, ctx.policy),
      chosenSol,
      message: result.message,
    });
    return;
  }

  json(res, 404, { error: "not found" });
}

export function createDashboardServer(ctx: DashboardContext): Server {
  return createServer((req, res) => {
    void handleDashboardRequest(ctx, req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "internal" });
    });
  });
}

/** Extends the old unauthenticated crew board into the login dashboard. */
export function startCrewServer(board: CrewBoard, port: number, ctx?: DashboardContext): Server {
  if (!ctx) {
    throw new Error("dashboard context required — crew board is now behind login");
  }
  const server = createDashboardServer(ctx);
  const bind = ctx.cfg.dashboardBind || "127.0.0.1";
  server.listen(port, bind, () => {
    console.log(`Dashboard http://127.0.0.1:${port}/  bind=${bind} (login required; JSON /api/crew)`);
  });
  return server;
}

export function pulseAuditorFromStore(ctx: DashboardContext): void {
  ctx.crew.idle("auditor", auditorPulseDetail(ctx.store));
}
