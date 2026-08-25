import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { type Policy, type RuntimeFlags, type Grade } from "@night/shared";
import { CrewBoard, CREW_META } from "@night/crew";
import {
  gradePosition,
  lastAuditorScan,
  listFeedback,
  listOpenPositions,
  listRecentPositions,
  listTodos,
  listUngradedClosed,
  insertTodo,
  insertFeedback,
  setTodoDone,
  type Store,
} from "@night/storage";
import { appendLesson, buildReview, loadLessons } from "@night/learning";
import { loadExtraRules, setExtraRuleEnabled } from "@night/risk";
import { loadSources } from "@night/social";
import { fetchDexToken } from "@night/signals";
import type { TradeOutcome } from "./trade.ts";
import { dashboardHtml } from "./dashboard-html.ts";
import {
  clearPendingCookieHeader,
  clearSessionCookieHeader,
  emailsEqual,
  loadTotpSecret,
  parseCookies,
  passwordsEqual,
  PENDING_COOKIE,
  pendingCookieHeader,
  saveTotpSecret,
  SESSION_COOKIE,
  sessionCookieHeader,
  signPending,
  signSession,
  verifyPending,
  verifySession,
} from "./auth.ts";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "./totp.ts";
import { addWallet, listPublicWallets, removeWallet } from "./wallets.ts";
import { auditorPulseDetail, runAuditorScan } from "./auditor.ts";
import type { AppConfig } from "./config.ts";

export interface DashboardContext {
  store: Store;
  crew: CrewBoard;
  cfg: AppConfig;
  policy: Policy;
  flags: () => RuntimeFlags;
  password: string;
  email: string;
  totpFile: string;
  buy: (opts: { mint: string; sol?: number; force?: boolean }) => Promise<TradeOutcome>;
  sell: (idOrMint: string) => Promise<TradeOutcome>;
  repoRoot?: string;
}

const JSON_H = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const HTML_H = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

function json(res: ServerResponse, status: number, body: unknown, cookies?: string[]): void {
  if (cookies?.length) {
    res.writeHead(status, { ...JSON_H, "set-cookie": cookies });
  } else {
    res.writeHead(status, JSON_H);
  }
  res.end(JSON.stringify(body));
}

function isSecure(req: IncomingMessage, cfg: AppConfig): boolean {
  if (cfg.dashboardSecureCookie) return true;
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
  return proto === "https";
}

function authed(req: IncomingMessage, ctx: DashboardContext): boolean {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return Boolean(token && verifySession(token, ctx.password));
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

export async function handleDashboardRequest(
  ctx: DashboardContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);

  if (path === "/health" && method === "GET") {
    json(res, 200, { ok: true, service: "cryptogrokbot-dashboard" });
    return;
  }

  if ((path === "/" || path === "/login" || path === "/index.html") && method === "GET") {
    res.writeHead(200, HTML_H);
    res.end(dashboardHtml());
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
    const email = str(body.email);
    const password = str(body.password);
    const code = str(body.code);
    const secure = isSecure(req, ctx.cfg);
    const loginEmail = email || ctx.email;
    if (!emailsEqual(loginEmail, ctx.email) || !passwordsEqual(password, ctx.password)) {
      json(res, 401, { error: "Wrong email or password" });
      return;
    }
    const totpSecret = loadTotpSecret(ctx.totpFile);
    if (!totpSecret) {
      const pendingSecret = generateTotpSecret();
      const token = signPending(ctx.password, "enroll", pendingSecret);
      json(
        res,
        200,
        {
          ok: false,
          step: "enroll",
          email: ctx.email,
          secret: pendingSecret,
          otpauth: otpauthUrl({ email: ctx.email, secret: pendingSecret }),
        },
        [pendingCookieHeader(token, secure), clearSessionCookieHeader(secure)],
      );
      return;
    }
    if (!code) {
      const token = signPending(ctx.password, "totp");
      json(res, 200, { ok: false, step: "totp" }, [
        pendingCookieHeader(token, secure),
        clearSessionCookieHeader(secure),
      ]);
      return;
    }
    if (!verifyTotp(totpSecret, code)) {
      json(res, 401, { error: "invalid 2fa code" });
      return;
    }
    const session = signSession(ctx.password);
    json(res, 200, { ok: true }, [sessionCookieHeader(session, secure), clearPendingCookieHeader(secure)]);
    return;
  }

  if (path === "/api/2fa/enroll" && method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const pending = parseCookies(req.headers.cookie)[PENDING_COOKIE] ?? "";
    const checked = verifyPending(pending, ctx.password, "enroll");
    if (!checked.ok || !checked.extra) {
      json(res, 401, { error: "2fa setup expired — log in again" });
      return;
    }
    if (loadTotpSecret(ctx.totpFile)) {
      json(res, 409, { error: "2fa already enrolled" });
      return;
    }
    if (!verifyTotp(checked.extra, str(body.code))) {
      json(res, 401, { error: "invalid 2fa code" });
      return;
    }
    saveTotpSecret(ctx.totpFile, checked.extra);
    const secure = isSecure(req, ctx.cfg);
    const session = signSession(ctx.password);
    json(res, 200, { ok: true }, [sessionCookieHeader(session, secure), clearPendingCookieHeader(secure)]);
    return;
  }

  if (path === "/api/2fa/verify" && method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const pending = parseCookies(req.headers.cookie)[PENDING_COOKIE] ?? "";
    const checked = verifyPending(pending, ctx.password, "totp");
    if (!checked.ok) {
      json(res, 401, { error: "2fa expired — log in again" });
      return;
    }
    const totpSecret = loadTotpSecret(ctx.totpFile);
    if (!totpSecret || !verifyTotp(totpSecret, str(body.code))) {
      json(res, 401, { error: "invalid 2fa code" });
      return;
    }
    const secure = isSecure(req, ctx.cfg);
    const session = signSession(ctx.password);
    json(res, 200, { ok: true }, [sessionCookieHeader(session, secure), clearPendingCookieHeader(secure)]);
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
    await routeAuthed(ctx, req, res, url, method, path);
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
): Promise<void> {
  if ((path === "/api/session" || path === "/api/me") && method === "GET") {
    const flags = ctx.flags();
    json(res, 200, {
      ok: true,
      mode: flags.mode,
      masterEnabled: flags.masterEnabled,
      host: ctx.cfg.dashboardHost,
      email: ctx.email,
      twoFactor: true,
    });
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
      openCount: listOpenPositions(ctx.store).length,
      todos: listTodos(ctx.store).map((t) => ({
        id: t.id,
        title: t.title,
        done: t.done === 1,
        sort: t.sort,
      })),
      auditor: scan
        ? { ok: scan.ok === 1, summary: scan.summary, at: scan.at, details: JSON.parse(scan.details_json) }
        : null,
    });
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
    json(res, 200, { mode: ctx.flags().mode, watchlist });
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

  if (path === "/api/buy" && method === "POST") {
    const body = await readJson(req);
    const mint = str(body.mint).trim();
    if (!mint) {
      json(res, 400, { error: "mint required" });
      return;
    }
    const flags = ctx.flags();
    if (flags.mode === "LIVE" && !flags.masterEnabled) {
      json(res, 403, { error: "LIVE buy refused: MASTER_ENABLED is not true", ok: false });
      return;
    }
    const result = await ctx.buy({
      mint,
      sol: typeof body.sol === "number" ? body.sol : Number(body.sol) || undefined,
      force: Boolean(body.force) && flags.mode === "PAPER",
    });
    json(res, result.ok ? 200 : 400, result);
    return;
  }

  if (path === "/api/sell" && method === "POST") {
    const body = await readJson(req);
    const idOrMint = str(body.idOrMint).trim();
    if (!idOrMint) {
      json(res, 400, { error: "idOrMint required" });
      return;
    }
    const result = await ctx.sell(idOrMint);
    json(res, result.ok ? 200 : 400, result);
    return;
  }

  if (path === "/api/book" && method === "GET") {
    const wallets = await listPublicWallets({ store: ctx.store, rpcUrl: ctx.cfg.heliusRpc });
    json(res, 200, {
      pnl: pnlPayload(ctx.store),
      positions: listRecentPositions(ctx.store).map(publicPosition),
      wallets,
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
  const bind = ctx.cfg.dashboardBind || "0.0.0.0";
  server.listen(port, bind, () => {
    console.log(`Dashboard http://127.0.0.1:${port}/  (login required; JSON /api/crew)`);
  });
  return server;
}

export function pulseAuditorFromStore(ctx: DashboardContext): void {
  ctx.crew.idle("auditor", auditorPulseDetail(ctx.store));
}
