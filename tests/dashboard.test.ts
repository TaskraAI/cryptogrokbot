import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_POLICY, dayKey } from "@night/shared";
import { lastAuditorScan, listOpenPositions, listTodos, openStore } from "@night/storage";
import { CrewBoard } from "@night/crew";
import { loadAppConfig } from "../apps/agent/src/config.ts";
import { createDashboardServer, type DashboardContext } from "../apps/agent/src/board.ts";
import { buyChosenMint, sellChosen } from "../apps/agent/src/trade.ts";
import { totpAt } from "../apps/agent/src/totp.ts";
import { resolveDashboardEmail, resolveDashboardPassword } from "../apps/agent/src/auth.ts";
import { addWallet } from "../apps/agent/src/wallets.ts";
import { runAuditorScan } from "../apps/agent/src/auditor.ts";
import { token } from "./fixtures.ts";

function tmp() {
  const dir = join(tmpdir(), `dash-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const paperFlags = {
  mode: "PAPER" as const,
  masterEnabled: false,
  rpcHealthy: true,
  jupiterHealthy: true,
  telegramHealthy: false,
};

async function startCtx(dir: string, password = "test-dashboard-pass", email = "hello@taskra.ai") {
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
  const ctx: DashboardContext = {
    store,
    crew,
    cfg,
    policy: DEFAULT_POLICY,
    flags: () => paperFlags,
    password,
    email,
    totpFile: join(dir, ".dashboard-totp"),
    buy: (opts) =>
      buyChosenMint({
        store,
        policy: DEFAULT_POLICY,
        flags: paperFlags,
        mint: opts.mint,
        token: token({ mint: opts.mint, ticker: "API" }),
        sol: opts.sol ?? 0.05,
        force: opts.force,
        dayKey: dayKey(),
      }),
    sell: (idOrMint) => sellChosen({ store, policy: DEFAULT_POLICY, idOrMint, priceUsd: 0.001 }),
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
  return { store, ctx, server, url, dir };
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

async function completeLogin(url: string, password: string, email = "hello@taskra.ai"): Promise<string> {
  const login = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const body = (await login.json()) as { step?: string; secret?: string; ok?: boolean };
  const jar = cookiesOf(login);
  if (body.ok) return jar;
  if (body.step === "enroll" && body.secret) {
    const enroll = await fetch(`${url}/api/2fa/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar },
      body: JSON.stringify({ code: totpAt(body.secret) }),
    });
    expect(enroll.status).toBe(200);
    expect(cookiesOf(enroll)).toMatch(/cg_dash=/);
    return cookiesOf(enroll);
  }
  if (body.step === "totp") {
    throw new Error("expected enroll or session; totp already enrolled in this test helper path");
  }
  throw new Error("login did not return session or enroll");
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

  it("rejects login with the wrong email", async () => {
    const { server, url } = await startCtx(tmp());
    servers.push(server);
    const res = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-you@example.com", password: "test-dashboard-pass" }),
    });
    expect(res.status).toBe(401);
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
  });

  it("first login returns enroll step, then enroll with valid TOTP sets session", async () => {
    const dir = tmp();
    const { server, url } = await startCtx(dir, "pw-2fa");
    servers.push(server);
    const first = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hello@taskra.ai", password: "pw-2fa" }),
    });
    expect(first.status).toBe(200);
    const enroll = (await first.json()) as { step?: string; secret?: string; otpauth?: string };
    expect(enroll.step).toBe("enroll");
    expect(enroll.secret).toBeTruthy();
    expect(enroll.otpauth).toMatch(/^otpauth:\/\/totp\//);
    expect(cookiesOf(first)).toMatch(/cg_pending=/);
    expect(existsSync(join(dir, ".dashboard-totp"))).toBe(false);
    const session = await fetch(`${url}/api/session`, { headers: { cookie: cookiesOf(first) } });
    expect(session.status).toBe(401);
    const done = await fetch(`${url}/api/2fa/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookiesOf(first) },
      body: JSON.stringify({ code: totpAt(enroll.secret!) }),
    });
    expect(done.status).toBe(200);
    expect(cookiesOf(done)).toMatch(/cg_dash=/);
    expect(existsSync(join(dir, ".dashboard-totp"))).toBe(true);
    const me = await fetch(`${url}/api/session`, { headers: { cookie: cookiesOf(done) } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { email?: string; twoFactor?: boolean };
    expect(meBody.email).toBe("hello@taskra.ai");
    expect(meBody.twoFactor).toBe(true);
  });

  it("later login requires totp verify", async () => {
    const { server, url } = await startCtx(tmp(), "pw-2fa");
    servers.push(server);
    const first = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hello@taskra.ai", password: "pw-2fa" }),
    });
    const enrolled = (await first.json()) as { secret?: string };
    const enroll = await fetch(`${url}/api/2fa/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookiesOf(first) },
      body: JSON.stringify({ code: totpAt(enrolled.secret!) }),
    });
    expect(enroll.status).toBe(200);

    const again = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hello@taskra.ai", password: "pw-2fa" }),
    });
    expect(again.status).toBe(200);
    const step = (await again.json()) as { step?: string; secret?: string };
    expect(step.step).toBe("totp");
    expect(step.secret).toBeUndefined();
    const pending = cookiesOf(again);
    expect(pending).toMatch(/cg_pending=/);

    const stillLocked = await fetch(`${url}/api/session`, { headers: { cookie: pending } });
    expect(stillLocked.status).toBe(401);

    const bad = await fetch(`${url}/api/2fa/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: pending },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(bad.status).toBe(401);

    const ok = await fetch(`${url}/api/2fa/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: pending },
      body: JSON.stringify({ code: totpAt(enrolled.secret!) }),
    });
    expect(ok.status).toBe(200);
    expect(cookiesOf(ok)).toMatch(/cg_dash=/);
    const me = await fetch(`${url}/api/session`, { headers: { cookie: cookiesOf(ok) } });
    expect(me.status).toBe(200);
  });

  it("logs in, paper-buys via API, and never returns a wallet secret", async () => {
    const dir = tmp();
    const { server, url, store } = await startCtx(dir, "s3cret-pass");
    servers.push(server);
    const cookie = await completeLogin(url, "s3cret-pass");
    expect(cookie).toMatch(/cg_dash=/);

    const mint = "DashMint11111111111111111111111111111111111";
    const buy = await fetch(`${url}/api/buy`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
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
  });

  it("serves the mobile dashboard HTML without auth and health without secrets", async () => {
    const { server, url } = await startCtx(tmp());
    servers.push(server);
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toMatch(/bottom: 0/);
    expect(html).toMatch(/type="email"/);
    expect(html).toMatch(/2FA/);
    const health = await fetch(`${url}/health`);
    expect(health.status).toBe(200);
    expect(JSON.stringify(await health.json())).not.toMatch(/cfat_|WALLET_SECRET/);
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
