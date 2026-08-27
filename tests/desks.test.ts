import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_POLICY, dayKey, type RuntimeFlags } from "@night/shared";
import { openStore } from "@night/storage";
import { CrewBoard } from "@night/crew";
import { loadAppConfig } from "../apps/agent/src/config.ts";
import { createDashboardServer, type DashboardContext } from "../apps/agent/src/board.ts";
import { dashboardHtml } from "../apps/agent/src/dashboard-html.ts";
import { buildDeskPrompt, DESKS, POLYMARKET_DESK, gatherDeskContext, listDesks, runDeskAnalysis } from "../apps/agent/src/desks.ts";
import { buyChosenMint, sellChosen } from "../apps/agent/src/trade.ts";
import { token } from "./fixtures.ts";

function tmp() {
  const dir = join(tmpdir(), `desks-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

async function startCtx(dir: string, password = "test-desks-pass", email = "hello@taskra.ai") {
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
      XAI_API_KEY: "",
      OPENAI_API_KEY: "",
    }),
    lessonsPath,
    walletSecretsPath: join(dir, "wallet-secrets.json"),
    xaiKey: "",
    openaiKey: "",
  };
  const crew = new CrewBoard();
  const codes: string[] = [];
  const ctx: DashboardContext = {
    store,
    crew,
    cfg,
    policy: DEFAULT_POLICY,
    flags: () => paperFlags,
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
        policy: DEFAULT_POLICY,
        flags: paperFlags,
        mint: opts.mint,
        token: token({ mint: opts.mint, ticker: "API" }),
        sol: opts.sol ?? 0.05,
        force: opts.force,
        grokBotOrder: opts.grokBotOrder,
        chiefApproved: opts.chiefApproved,
        add: opts.add,
        dayKey: dayKey(),
      }),
    sell: (idOrMint, opts) =>
      sellChosen({
        store,
        policy: DEFAULT_POLICY,
        idOrMint,
        flags: paperFlags,
        priceUsd: 0.001,
        grokBotOrder: opts?.grokBotOrder,
      }),
  };
  const server = createDashboardServer(ctx);
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no port"));
    });
  });
  return { store, ctx, server, url: `http://127.0.0.1:${port}`, codes, password, email };
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

async function completeLogin(url: string, password: string, email: string, codes: string[]): Promise<string> {
  const login = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const jar = cookiesOf(login);
  const code = codes.at(-1);
  expect(code).toBeTruthy();
  const verify = await fetch(`${url}/api/email/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: jar },
    body: JSON.stringify({ code }),
  });
  expect(verify.status).toBe(200);
  return cookiesOf(verify);
}

describe("intel desks", () => {
  const servers: Array<{ close: () => void }> = [];
  afterAll(() => {
    for (const s of servers) s.close();
  });

  it("covers the eight Grok workflows with numbered sections", () => {
    expect(DESKS.map((d) => d.id)).toEqual([
      "sentiment",
      "gems",
      "evaluate",
      "whales",
      "timing",
      "narratives",
      "portfolio",
      "scams",
    ]);
    expect(listDesks().map((d) => d.id)).toEqual(DESKS.map((d) => d.id));
    expect(DESKS.find((d) => d.id === "polymarket")).toBeUndefined();
    expect(POLYMARKET_DESK.id).toBe("polymarket");
    expect(listDesks({ includePolymarket: true }).map((d) => d.id)).toContain("polymarket");
    for (const desk of DESKS) {
      const prompt = buildDeskPrompt(desk, {}, "grounded");
      for (const section of desk.sections) {
        expect(prompt).toContain(section);
      }
      expect(prompt).toMatch(/crypto only/i);
      expect(prompt).toMatch(/Do not research Polymarket until Taskra enables it/);
    }
    const scams = DESKS.find((d) => d.id === "scams")!;
    expect(buildDeskPrompt(scams, { year: "2026" }, "")).toContain("Common scam tactics in 2026");
  });

  it("embeds Intel on the dashboard shell", () => {
    const html = dashboardHtml();
    const js = readFileSync(join(process.cwd(), "apps/agent/src/dashboard-client.js"), "utf8");
    expect(html).toContain('data-page="intel"');
    expect(html).toContain(">Intel<");
    expect(html).toContain('src="/dashboard.js"');
    expect(js).toContain("Open Intel");
    expect(js).toContain("/api/desks");
    expect(js).toContain("X sentiment, gems, project eval");
    expect(js).toContain("Eight Grok desks");
    expect(js).toContain("Rung challenge");
    expect(js).toContain("/api/challenge");
    expect(js).toContain("Chances");
    expect(js).toContain("same page");
    expect(js).toContain("Gem — buy this");
    expect(js).toContain("/api/opportunities");
    expect(js).toContain("Chief must APPROVE");
    expect(js).toContain("data-action=\"approve\"");
    expect(js).toContain("Polymarket stays off until you say it is time");
    expect(() => new Function(js)).not.toThrow();
  });

  it("returns a numbered offline framework when no model keys are set", async () => {
    const dir = tmp();
    const store = openStore(join(dir, "t.db"));
    const cfg = {
      ...loadAppConfig({ MODE: "PAPER", MASTER_ENABLED: "false", XAI_API_KEY: "", OPENAI_API_KEY: "" }),
      xaiKey: "",
      openaiKey: "",
    };
    const ctx = await gatherDeskContext({ token: "BONK", ticker: "BONK" }, store, {
      policy: DEFAULT_POLICY,
      deskId: "evaluate",
    });
    expect(ctx).toMatch(/hardStop/);
    const run = await runDeskAnalysis({
      id: "evaluate",
      fields: { token: "BONK", ticker: "BONK" },
      cfg,
      store,
      policy: DEFAULT_POLICY,
      ask: async () => ({ text: "", via: "none" }),
    });
    expect(run.id).toBe("evaluate");
    expect(run.via).toBe("offline");
    expect(run.report).toContain("Project fundamentals (problem it solves, use case)");
    expect(run.report).toContain("Investment verdict: Buy / Hold / Avoid");
  });

  it("uses live Grok text when ask returns xai", async () => {
    const dir = tmp();
    const store = openStore(join(dir, "t.db"));
    const cfg = loadAppConfig({ MODE: "PAPER" });
    const run = await runDeskAnalysis({
      id: "scams",
      fields: { token: "", year: "2026" },
      cfg,
      store,
      ask: async (opts) => {
        expect(opts.useXSearch).toBe(true);
        expect(opts.prompt).toContain("Common scam tactics in 2026");
        return { text: "1. Red flags in tokenomics (supply, distribution)\nmock", via: "xai" };
      },
    });
    expect(run.via).toBe("xai");
    expect(run.report).toContain("mock");
  });

  it("lists, runs, and rejects unknown desks over the dashboard API", async () => {
    const { server, url, codes, password, email } = await startCtx(tmp());
    servers.push(server);

    const denied = await fetch(`${url}/api/desks`);
    expect(denied.status).toBe(401);

    const cookie = await completeLogin(url, password, email, codes);
    const listed = await fetch(`${url}/api/desks`, { headers: { cookie } });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      desks: { id: string; title: string; useXSearch: boolean }[];
      grokReady: boolean;
    };
    expect(body.desks).toHaveLength(8);
    expect(body.desks.map((d) => d.id)).toEqual(DESKS.map((d) => d.id));
    expect(body.desks.map((d) => d.id)).not.toContain("polymarket");

    const pmDesk = await fetch(`${url}/api/desks/polymarket`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    expect(pmDesk.status).toBe(404);
    expect(body.desks.find((d) => d.id === "sentiment")?.useXSearch).toBe(true);
    expect(body.desks.find((d) => d.id === "timing")?.useXSearch).toBe(false);
    expect(body.grokReady).toBe(false);

    const missing = await fetch(`${url}/api/desks/nope`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    expect(missing.status).toBe(404);

    const scams = await fetch(`${url}/api/desks/scams`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ fields: { year: "2026" } }),
    });
    expect(scams.status).toBe(200);
    const scamBody = (await scams.json()) as { report: string; via: string; id: string };
    expect(scamBody.id).toBe("scams");
    expect(scamBody.via).toBe("offline");
    expect(scamBody.report).toContain("Red flags in tokenomics (supply, distribution)");
    expect(scamBody.report).toContain("Common scam tactics in 2026");
    expect(scamBody.report).toContain("What to do if already invested in a scam");

    const sentiment = await fetch(`${url}/api/desks/sentiment`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ fields: { token: "WIF", ticker: "WIF", period: "last 24 hours" } }),
    });
    expect(sentiment.status).toBe(200);
    const sentBody = (await sentiment.json()) as { report: string; via: string };
    expect(sentBody.report).toContain("Overall sentiment score (bullish / neutral / bearish)");
    expect(sentBody.report).toContain("Prediction: is the momentum growing or weakening?");

    const again = await fetch(`${url}/api/desks`, { headers: { cookie } });
    const listed2 = (await again.json()) as { desks: { id: string; last: { via: string } | null }[] };
    expect(listed2.desks.find((d) => d.id === "scams")?.last?.via).toBe("offline");
  }, 30_000);
});
