import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_POLICY, dayKey, type RuntimeFlags } from "@night/shared";
import { lastAuditorScan, listOpenPositions, listTodos, openStore, getFlag } from "@night/storage";
import { CrewBoard } from "@night/crew";
import { loadAppConfig } from "../apps/agent/src/config.ts";
import { createDashboardServer, type DashboardContext } from "../apps/agent/src/board.ts";
import { buyChosenMint, sellChosen } from "../apps/agent/src/trade.ts";
import { resolveDashboardEmail, resolveDashboardPassword } from "../apps/agent/src/auth.ts";
import { addWallet } from "../apps/agent/src/wallets.ts";
import { runAuditorScan } from "../apps/agent/src/auditor.ts";
import { token } from "./fixtures.ts";

function tmp() {
  const dir = join(tmpdir(), `dash-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const paperFlags: RuntimeFlags = {
  mode: "PAPER",
  masterEnabled: false,
  rpcHealthy: true,
  jupiterHealthy: true,
  telegramHealthy: false,
};

async function startCtx(
  dir: string,
  password = "test-dashboard-pass",
  email = "hello@taskra.ai",
  runtimeFlags: RuntimeFlags = { ...paperFlags },
  policy = DEFAULT_POLICY,
) {
  const store = openStore(join(dir, "t.db"));
  const lessonsPath = join(dir, "lessons.md");
  writeFileSync(lessonsPath, "# Lessons\n");
  const cfg = {
    ...loadAppConfig({
      MODE: "PAPER",
      MASTER_ENABLED: "false",
      DASHBOARD_PASSWORD: password,
      DASHBOARD_EMAIL: email,
      DATABASE_PATH: join(dir, "t.db"),
      WALLET_SECRETS_PATH: join(dir, "wallet-secrets.json"),
    }),
    lessonsPath,
    walletSecretsPath: join(dir, "wallet-secrets.json"),
  };
  const crew = new CrewBoard();
  const codes: string[] = [];
  const ctx: DashboardContext = {
    store,
    crew,
    cfg,
    policy,
    flags: () => ({
      ...runtimeFlags,
      masterEnabled: getFlag(store, "master", String(runtimeFlags.masterEnabled)) === "true",
    }),
    password,
    email,
    totpFile: join(dir, ".dashboard-totp"),
    accessFile: join(dir, "dashboard-access.json"),
    sendCode: async (_to, code) => {
      codes.push(code);
      return { delivered: true, via: "log" };
    },
    buy: (opts) =>
      buyChosenMint({
        store,
        policy,
        flags: runtimeFlags,
        mint: opts.mint,
        token: token({ mint: opts.mint, ticker: "API" }),
        sol: opts.sol ?? policy.maxSolPerTrade,
        force: opts.force,
        sizeAskId: opts.sizeAskId,
        grokBotOrder: opts.grokBotOrder,
        chiefApproved: opts.chiefApproved,
        dayKey: dayKey(),
      }),
    sell: (idOrMint, opts) =>
      sellChosen({ store, policy, idOrMint, flags: runtimeFlags, priceUsd: 0.001, grokBotOrder: opts?.grokBotOrder }),
  };
  const server = createDashboardServer(ctx);
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no port"));
    });
  });
  const url = `http://127.0.0.1:${port}`;
  return { store, ctx, server, url, dir, flags: runtimeFlags, codes };
}

function cookiesOf(res: Response): string {
  const hdrs =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  return hdrs
    .filter(Boolean)
    .map((c) => c.split(";")[0]!)
    .join("; ");
}

async function inviteGrokBot(url: string, cookie: string): Promise<string> {
  const invited = await fetch(`${url}/api/access/invite`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind: "grokbot" }),
  });
  expect(invited.status).toBe(200);
  const grant = (await invited.json()) as { token?: string };
  expect(grant.token).toMatch(/^cgbot_/);
  return grant.token!;
}

async function completeLogin(
  url: string,
  password: string,
  email: string,
  codes: string[],
): Promise<string> {
  const login = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const body = (await login.json()) as { step?: string; ok?: boolean };
  const jar = cookiesOf(login);
  if (body.ok) return jar;
  expect(body.step).toBe("email");
  const code = codes.at(-1);
  expect(code).toBeTruthy();
  const verify = await fetch(`${url}/api/email/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: jar },
    body: JSON.stringify({ code }),
  });
  expect(verify.status).toBe(200);
  expect(cookiesOf(verify)).toMatch(/cg_dash=/);
  return cookiesOf(verify);
}

describe("dashboard auth and paper API", () => {
  const servers: Array<{ close: () => void }> = [];
  afterAll(() => {
    for (const s of servers) s.close();
  });

  it("rejects mutating requests without a session cookie", async () => {
    const { server, url } = await startCtx(tmp());
    servers.push(server);
    const res = await fetch(`${url}/api/buy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mint: "Mint111111111111111111111111111111111111111" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects GET /api/session without a cookie", async () => {
    const { server, url } = await startCtx(tmp());
    servers.push(server);
    const res = await fetch(`${url}/api/session`);
    expect(res.status).toBe(401);
  });

  it("serves an email + password + email-code login page", async () => {
    const { server, url } = await startCtx(tmp());
    servers.push(server);
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="email"');
    expect(html).toContain('value="hello@taskra.ai"');
    expect(html).toContain('id="pw"');
    expect(html).toContain("Email code");
    expect(html).toContain("Join with invite");
    expect(html).toContain("Log in");
    expect(html).toContain('data-page="intel"');
    expect(html).toContain(">Intel<");
    expect(html).toContain('<form id="loginStepCreds">');
    expect(html).toContain('<form id="loginStepEmail"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('id="login" class="login"');
    expect(html).not.toContain('id="login" class="login hidden"');
    expect(html).toContain('src="/dashboard.js"');
    expect(html).toContain("classList.remove(\"hidden\")");
    const jsRes = await fetch(`${url}/dashboard.js`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get("content-type")).toMatch(/javascript/);
    const js = await jsRes.text();
    expect(js).toContain("Invite Grok Bot");
    expect(js).toContain("Open Intel");
    expect(js).toContain("Grok asks");
    expect(js).toContain("Paper day");
    expect(js).toContain("Live day");
    expect(js).toContain("renderIntel");
    expect(js).toContain('new RegExp("/invite/');
    expect(js).not.toMatch(/match\(\/\/invite/);
    expect(() => new Function(js)).not.toThrow();
    const head = await fetch(`${url}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(html).not.toContain("not financial advice");
    expect(html).not.toContain("Dashboard password");
    expect(html).not.toContain("Google Authenticator");
  });

  it("prefills the configured owner email on the login form", async () => {
    const { server, url } = await startCtx(tmp(), "test-dashboard-pass", "ops@taskra.ai");
    servers.push(server);
    const html = await (await fetch(`${url}/`)).text();
    expect(html).toContain('value="ops@taskra.ai"');
  });

  it("redirects dash/app/www hosts to cryptogrokbot.com", async () => {
    const { server, url } = await startCtx(tmp());
    servers.push(server);
    for (const host of ["dash.cryptogrokbot.com", "app.cryptogrokbot.com", "www.cryptogrokbot.com"]) {
      const res = await fetch(`${url}/login?x=1`, {
        redirect: "manual",
        headers: { "x-forwarded-host": host, "x-forwarded-proto": "https" },
      });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://cryptogrokbot.com/login?x=1");
    }
    const local = await fetch(`${url}/`, { redirect: "manual" });
    expect(local.status).toBe(200);
    const health = await fetch(`${url}/health`, {
      headers: { "x-forwarded-host": "dash.cryptogrokbot.com" },
    });
    expect(health.status).toBe(200);
  });

  it("rejects login with the wrong email", async () => {
    const { server, url } = await startCtx(tmp());
    servers.push(server);
    const res = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-you@example.com", password: "test-dashboard-pass" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("Wrong email or password");
  });

  it("rejects login with the wrong password", async () => {
    const { server, url } = await startCtx(tmp());
    servers.push(server);
    const res = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hello@taskra.ai", password: "not-the-password" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("Wrong email or password");
  });

  it("login sends an email code then verify sets session", async () => {
    const { server, url, codes } = await startCtx(tmp(), "pw-mail");
    servers.push(server);
    const first = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hello@taskra.ai", password: "pw-mail" }),
    });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { step?: string; email?: string; secret?: string };
    expect(body.step).toBe("email");
    expect(body.email).toBe("hello@taskra.ai");
    expect(body.secret).toBeUndefined();
    expect(codes.at(-1)).toMatch(/^\d{6}$/);
    expect(cookiesOf(first)).toMatch(/cg_pending=/);
    const session = await fetch(`${url}/api/session`, { headers: { cookie: cookiesOf(first) } });
    expect(session.status).toBe(401);
    const bad = await fetch(`${url}/api/email/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookiesOf(first) },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(bad.status).toBe(401);
    const done = await fetch(`${url}/api/email/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookiesOf(first) },
      body: JSON.stringify({ code: codes.at(-1) }),
    });
    expect(done.status).toBe(200);
    expect(cookiesOf(done)).toMatch(/cg_dash=/);
    const me = await fetch(`${url}/api/session`, { headers: { cookie: cookiesOf(done) } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { email?: string; twoFactor?: string };
    expect(meBody.email).toBe("hello@taskra.ai");
    expect(meBody.twoFactor).toBe("email");
  });

  it("does not set Secure on HTTP cookies even when dashboardSecureCookie is true", async () => {
    const { server, url, ctx } = await startCtx(tmp(), "pw-http");
    servers.push(server);
    ctx.cfg.dashboardSecureCookie = true;
    const first = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hello@taskra.ai", password: "pw-http" }),
    });
    expect(first.status).toBe(200);
    const cookies =
      typeof first.headers.getSetCookie === "function"
        ? first.headers.getSetCookie()
        : [first.headers.get("set-cookie") ?? ""];
    expect(cookies.join("\n")).toMatch(/cg_pending=/);
    for (const cookie of cookies.filter(Boolean)) {
      const attrs = cookie.split(";").slice(1).join(";").toLowerCase();
      expect(attrs).not.toContain("secure");
    }
  });

  it("sets Secure cookies when the request is HTTPS via x-forwarded-proto", async () => {
    const { server, url } = await startCtx(tmp(), "pw-https");
    servers.push(server);
    const first = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ email: "hello@taskra.ai", password: "pw-https" }),
    });
    expect(first.status).toBe(200);
    const raw =
      typeof first.headers.getSetCookie === "function"
        ? first.headers.getSetCookie().join("\n")
        : (first.headers.get("set-cookie") ?? "");
    expect(raw).toMatch(/cg_pending=/);
    expect(raw).toMatch(/Secure/);
  });

  it("invites Grok Bot and lets the token open the dashboard", async () => {
    const { server, url, codes } = await startCtx(tmp(), "pw-bot");
    servers.push(server);
    const cookie = await completeLogin(url, "pw-bot", "hello@taskra.ai", codes);
    const invited = await fetch(`${url}/api/access/invite`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "grokbot" }),
    });
    expect(invited.status).toBe(200);
    const grant = (await invited.json()) as { token?: string; url?: string; email?: string; kind?: string };
    expect(grant.kind).toBe("grokbot");
    expect(grant.email).toBe("grokbot@cryptogrokbot.com");
    expect(grant.token).toMatch(/^cgbot_/);
    expect(grant.url).toMatch(/\/invite\/cgbot_/);

    const viaUrl = await fetch(grant.url!, { redirect: "manual" });
    expect(viaUrl.status).toBe(302);
    expect(cookiesOf(viaUrl)).toMatch(/cg_dash=/);

    const viaBearer = await fetch(`${url}/api/crew`, {
      headers: { authorization: `Bearer ${grant.token}` },
    });
    expect(viaBearer.status).toBe(200);

    const viaPost = await fetch(`${url}/api/bot-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: grant.token }),
    });
    expect(viaPost.status).toBe(200);
    expect(cookiesOf(viaPost)).toMatch(/cg_dash=/);
  });

  it("invited email can log in with email verification and no owner password", async () => {
    const { server, url, codes } = await startCtx(tmp(), "pw-owner");
    servers.push(server);
    const cookie = await completeLogin(url, "pw-owner", "hello@taskra.ai", codes);
    const invited = await fetch(`${url}/api/access/invite`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "human", email: "ops@taskra.ai" }),
    });
    expect(invited.status).toBe(200);
    const guest = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ops@taskra.ai", password: "" }),
    });
    expect(guest.status).toBe(200);
    expect(((await guest.json()) as { step?: string }).step).toBe("email");
    const verify = await fetch(`${url}/api/email/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookiesOf(guest) },
      body: JSON.stringify({ code: codes.at(-1) }),
    });
    expect(verify.status).toBe(200);
    expect(cookiesOf(verify)).toMatch(/cg_dash=/);
  });

  it("logs in, paper-buys via Grok Bot Bearer, and never returns a wallet secret", async () => {
    const dir = tmp();
    const { server, url, store, codes } = await startCtx(dir, "s3cret-pass");
    servers.push(server);
    const cookie = await completeLogin(url, "s3cret-pass", "hello@taskra.ai", codes);
    expect(cookie).toMatch(/cg_dash=/);
    const bot = await inviteGrokBot(url, cookie);

    const mint = "DashMint11111111111111111111111111111111111";
    const ownerBuy = await fetch(`${url}/api/buy`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ mint, sol: 0.05 }),
    });
    expect(ownerBuy.status).toBe(403);
    expect(((await ownerBuy.json()) as { error?: string }).error).toMatch(/only Grok Bot/);

    const buy = await fetch(`${url}/api/buy`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bot}` },
      body: JSON.stringify({ mint, sol: 0.05 }),
    });
    expect(buy.status).toBe(200);
    const bought = (await buy.json()) as { ok: boolean; message: string };
    expect(bought.ok).toBe(true);
    expect(bought.message).toMatch(/PAPER/);
    expect(listOpenPositions(store)).toHaveLength(1);

    const secret = "never-echo-this-wallet-secret-value";
    const wres = await fetch(`${url}/api/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        label: "hot",
        publicKey: "11111111111111111111111111111111",
        secret,
        assignedDesk: "scout",
      }),
    });
    expect(wres.status).toBe(200);
    const raw = await wres.text();
    expect(raw).not.toContain(secret);
    const wallet = JSON.parse(raw) as { connected: boolean; publicKey: string; label: string };
    expect(wallet.connected).toBe(true);
    expect(wallet.label).toBe("hot");
    expect("secret" in wallet).toBe(false);
    const disk = JSON.parse(readFileSync(join(dir, "wallet-secrets.json"), "utf8")) as Record<string, string>;
    expect(Object.values(disk)).toContain(secret);

    const pos = listOpenPositions(store)[0]!;
    const ownerSold = await fetch(`${url}/api/sell`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ idOrMint: String(pos.id) }),
    });
    expect(ownerSold.status).toBe(403);
    expect(((await ownerSold.json()) as { error?: string }).error).toMatch(/only Grok Bot/);
    expect(listOpenPositions(store)).toHaveLength(1);
    const sold = await fetch(`${url}/api/sell`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bot}` },
      body: JSON.stringify({ idOrMint: String(pos.id) }),
    });
    expect(sold.status).toBe(200);
    const soldBody = (await sold.json()) as { ok: boolean; message: string };
    expect(soldBody.ok).toBe(true);
    expect(listOpenPositions(store)).toHaveLength(0);
  });

  it("serves the mobile dashboard HTML without auth and health without secrets", async () => {
    const { server, url } = await startCtx(tmp());
    servers.push(server);
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toMatch(/bottom: 0/);
    expect(html).toMatch(/type="email"/);
    expect(html).toMatch(/Email code/);
    const health = await fetch(`${url}/health`);
    expect(health.status).toBe(200);
    expect(JSON.stringify(await health.json())).not.toMatch(/cfat_|WALLET_SECRET/);
  });

  it("refuses owner /api/sell even in PAPER and still lets Grok Bot paper-sell with MASTER off", async () => {
    const dir = tmp();
    const { server, url, store, flags, codes } = await startCtx(dir, "sell-gate-pass");
    servers.push(server);
    const cookie = await completeLogin(url, "sell-gate-pass", "hello@taskra.ai", codes);
    const bot = await inviteGrokBot(url, cookie);
    const mint = "SellGateMint1111111111111111111111111111111";
    const buy = await fetch(`${url}/api/buy`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bot}` },
      body: JSON.stringify({ mint, sol: 0.05 }),
    });
    expect(buy.status).toBe(200);
    const id = String(listOpenPositions(store)[0]!.id);
    flags.mode = "LIVE";
    flags.masterEnabled = false;
    const ownerSell = await fetch(`${url}/api/sell`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ idOrMint: id }),
    });
    expect(ownerSell.status).toBe(403);
    expect(((await ownerSell.json()) as { error?: string }).error).toMatch(/only Grok Bot/);
    expect(listOpenPositions(store)).toHaveLength(1);
    flags.mode = "PAPER";
    flags.masterEnabled = false;
    const paperSell = await fetch(`${url}/api/sell`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bot}` },
      body: JSON.stringify({ idOrMint: id }),
    });
    expect(paperSell.status).toBe(200);
    expect(listOpenPositions(store)).toHaveLength(0);
  });

  it("lets the owner kill MASTER from the dashboard while Grok Bot can still paper-buy", async () => {
    const dir = tmp();
    const { server, url, store, codes } = await startCtx(dir, "master-kill-pass");
    servers.push(server);
    const cookie = await completeLogin(url, "master-kill-pass", "hello@taskra.ai", codes);
    const bot = await inviteGrokBot(url, cookie);
    const resumeNeedConfirm = await fetch(`${url}/api/master`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: true }),
    });
    expect(resumeNeedConfirm.status).toBe(400);
    const kill = await fetch(`${url}/api/master`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: false }),
    });
    expect(kill.status).toBe(200);
    expect(((await kill.json()) as { masterEnabled?: boolean }).masterEnabled).toBe(false);
    const home = await fetch(`${url}/api/home`, { headers: { cookie } });
    expect(((await home.json()) as { masterEnabled?: boolean; canPlaceOrders?: boolean }).masterEnabled).toBe(false);
    const grokResume = await fetch(`${url}/api/master`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bot}` },
      body: JSON.stringify({ enabled: true, confirm: "CONFIRM" }),
    });
    expect(grokResume.status).toBe(403);
    const buy = await fetch(`${url}/api/buy`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bot}` },
      body: JSON.stringify({ mint: "MasterOffMint11111111111111111111111111111", sol: 0.05 }),
    });
    expect(buy.status).toBe(200);
    expect(((await buy.json()) as { ok?: boolean }).ok).toBe(true);
    expect(listOpenPositions(store)).toHaveLength(1);
    const resume = await fetch(`${url}/api/master`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: true, confirm: "CONFIRM" }),
    });
    expect(resume.status).toBe(200);
    expect(((await resume.json()) as { masterEnabled?: boolean }).masterEnabled).toBe(true);
  });

  it("lets Grok Bot list pending size asks and keep test size before investing", async () => {
    const dir = tmp();
    const policy = { ...DEFAULT_POLICY, maxSolPerTrade: 0.01, sizeAskCeilingSol: 0.05 };
    const { server, url, store, codes } = await startCtx(dir, "size-ask-pass", "hello@taskra.ai", { ...paperFlags }, policy);
    servers.push(server);
    const cookie = await completeLogin(url, "size-ask-pass", "hello@taskra.ai", codes);
    const invited = await fetch(`${url}/api/access/invite`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "grokbot" }),
    });
    const grant = (await invited.json()) as { token?: string };
    const { insertSizeAsk } = await import("@night/storage");
    const row = insertSizeAsk(store, {
      mint: "SizeAskMint11111111111111111111111111111111",
      ticker: "HOT",
      sentiment: 0.77,
      testSol: 0.01,
      note: "high sentiment",
    });
    const listed = await fetch(`${url}/api/size-asks`, {
      headers: { authorization: `Bearer ${grant.token}` },
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { asks: Array<{ ticker: string }> };
    expect(body.asks[0]?.ticker).toBe("HOT");
    const home = await fetch(`${url}/api/home`, { headers: { cookie } });
    expect(((await home.json()) as { sizeAsks: Array<{ ticker: string }> }).sizeAsks[0]?.ticker).toBe("HOT");
    const ownerKeep = await fetch(`${url}/api/size-asks/${row.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ action: "keep" }),
    });
    expect(ownerKeep.status).toBe(403);
    const keep = await fetch(`${url}/api/size-asks/${row.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${grant.token}` },
      body: JSON.stringify({ action: "keep" }),
    });
    expect(keep.status).toBe(200);
    const kept = (await keep.json()) as { ok: boolean; message: string; chosenSol: number };
    expect(kept.ok).toBe(true);
    expect(kept.chosenSol).toBe(0.01);
    expect(kept.message).toMatch(/^bought #/);
    expect(kept.message).toMatch(/0.01 SOL/);
    expect(listOpenPositions(store)).toHaveLength(1);
  });

  it("refuses a live Grok Bot buy without Chief APPROVE and lets the owner approve a gem", async () => {
    const dir = tmp();
    const liveFlags: RuntimeFlags = { ...paperFlags, mode: "LIVE", masterEnabled: true };
    const { server, url, store, codes } = await startCtx(dir, "chief-approve-pass", "hello@taskra.ai", liveFlags);
    servers.push(server);
    const cookie = await completeLogin(url, "chief-approve-pass", "hello@taskra.ai", codes);
    const bot = await inviteGrokBot(url, cookie);
    const mint = "ChiefMint11111111111111111111111111111111111";
    const noChief = await fetch(`${url}/api/buy`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bot}` },
      body: JSON.stringify({ mint, sol: 0.05 }),
    });
    expect(noChief.status).toBe(403);
    expect(((await noChief.json()) as { error?: string }).error).toMatch(/Chief permission/);
    expect(listOpenPositions(store)).toHaveLength(0);

    const { insertOpportunity } = await import("@night/storage");
    const opp = insertOpportunity(store, {
      mint,
      ticker: "CHIEF",
      sentiment: 0.8,
      score: 70,
      volume5m: 9000,
      priceUsd: 0.001,
      costOutMultiple: 3,
      reason: "test",
    });
    const ownerBuy = await fetch(`${url}/api/opportunities/${opp.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ action: "buy" }),
    });
    expect(ownerBuy.status).toBe(403);
    const approve = await fetch(`${url}/api/opportunities/${opp.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(approve.status).toBe(200);
    expect(((await approve.json()) as { chiefApproved?: boolean }).chiefApproved).toBe(true);
    const grokBuy = await fetch(`${url}/api/opportunities/${opp.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bot}` },
      body: JSON.stringify({ action: "buy" }),
    });
    expect(grokBuy.status).not.toBe(403);
    const bought = (await grokBuy.json()) as { ok?: boolean; message?: string; error?: string };
    expect(JSON.stringify(bought)).not.toMatch(/needs Chief permission/);
    expect(listOpenPositions(store)).toHaveLength(0);
  });
});

describe("password file", () => {
  it("generates a random password once into a gitignored path", () => {
    const dir = tmp();
    const filePath = join(dir, ".dashboard-password");
    const a = resolveDashboardPassword({ envPassword: "", filePath });
    expect(a.generated).toBe(true);
    expect(a.password.length).toBeGreaterThan(12);
    expect(existsSync(filePath)).toBe(true);
    const b = resolveDashboardPassword({ envPassword: "", filePath });
    expect(b.generated).toBe(false);
    expect(b.password).toBe(a.password);
    const env = resolveDashboardPassword({ envPassword: "from-env", filePath });
    expect(env.source).toBe("env");
    expect(env.password).toBe("from-env");
  });
});

describe("dashboard email file", () => {
  it("persists the default email and prefers env", () => {
    const dir = tmp();
    const filePath = join(dir, ".dashboard-email");
    const a = resolveDashboardEmail({ envEmail: "", filePath, fallback: "hello@taskra.ai" });
    expect(a.source).toBe("default");
    expect(a.email).toBe("hello@taskra.ai");
    expect(existsSync(filePath)).toBe(true);
    const b = resolveDashboardEmail({ envEmail: "", filePath, fallback: "other@example.com" });
    expect(b.source).toBe("file");
    expect(b.email).toBe("hello@taskra.ai");
    const env = resolveDashboardEmail({ envEmail: "Ops@Taskra.ai", filePath, fallback: "hello@taskra.ai" });
    expect(env.source).toBe("env");
    expect(env.email).toBe("ops@taskra.ai");
  });
});

describe("auditor scan records", () => {
  it("stores the last scan in sqlite and seeds starter todos", async () => {
    const dir = tmp();
    const store = openStore(join(dir, "a.db"));
    expect(listTodos(store).length).toBeGreaterThanOrEqual(6);
    const result = await runAuditorScan({ store, repoRoot: process.cwd(), includeSubprocess: false });
    expect(result.checks.find((c) => c.id === "paper-default")?.ok).toBe(true);
    expect(result.checks.find((c) => c.id === "no-secrets-in-git")?.ok).toBe(true);
    expect(result.checks.find((c) => c.id === "live-fail-closed")?.ok).toBe(true);
    expect(result.ok).toBe(true);
    const last = lastAuditorScan(store);
    expect(last).toBeTruthy();
    expect(last!.summary).toBe(result.summary);
    expect(last!.ok === 1).toBe(result.ok);
  });
});

describe("wallet helper", () => {
  it("does not put the secret on the public wallet object", () => {
    const dir = tmp();
    const store = openStore(join(dir, "w.db"));
    const secret = "disk-only-secret";
    const pub = addWallet({
      store,
      secretsPath: join(dir, "wallet-secrets.json"),
      label: "desk",
      publicKey: "So11111111111111111111111111111111111111112",
      secret,
      assignedDesk: "sentinel",
    });
    expect(pub.connected).toBe(true);
    expect(JSON.stringify(pub)).not.toContain(secret);
  });
});
