import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_POLICY } from "@night/shared";
import { openStore } from "@night/storage";
import { CrewBoard } from "@night/crew";
import { loadAppConfig } from "../apps/agent/src/config.ts";
import { createDashboardServer, type DashboardContext } from "../apps/agent/src/board.ts";
import { currentRung, loadChallenge, playbook, setBankrollUsd } from "../apps/agent/src/challenge.ts";
import { formatPolymarketGrounding, searchPolymarket } from "../apps/agent/src/polymarket.ts";
import { DESKS, POLYMARKET_DESK, listDesks } from "../apps/agent/src/desks.ts";

function mem() {
  const dir = join(tmpdir(), `chal-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return openStore(join(dir, "t.db"));
}

describe("rung challenge", () => {
  it("loads $100 → $5k → $10k → $1M rungs", () => {
    const chal = loadChallenge(join(process.cwd(), "config/challenge.json"));
    expect(chal.startUsd).toBe(100);
    expect(chal.rungsUsd[0]).toBe(100);
    expect(chal.rungsUsd[1]).toBe(5000);
    expect(chal.rungsUsd[2]).toBe(10000);
    expect(chal.goalUsd).toBe(1_000_000);
    expect(chal.venues.map((v) => v.id)).toEqual(["solana"]);
    expect(chal.polymarketEnabled).toBe(false);
  });

  it("places bankroll on the 50x first rung then the 2x second rung", () => {
    const chal = loadChallenge(join(process.cwd(), "config/challenge.json"));
    const first = currentRung(100, chal.rungsUsd);
    expect(first.from).toBe(100);
    expect(first.to).toBe(5000);
    expect(first.multiple).toBe(50);
    expect(first.done).toBe(false);
    const second = currentRung(5000, chal.rungsUsd);
    expect(second.from).toBe(5000);
    expect(second.to).toBe(10000);
    expect(second.multiple).toBe(2);
    const done = currentRung(1_000_000, chal.rungsUsd);
    expect(done.done).toBe(true);
  });

  it("playbook tells Grok Bot 50x is not a plan and keeps Polymarket off", () => {
    const chal = loadChallenge(join(process.cwd(), "config/challenge.json"));
    const book = playbook({
      challenge: chal,
      bankrollUsd: 100,
      policy: DEFAULT_POLICY,
      masterEnabled: false,
      mode: "LIVE",
    });
    expect(book.honesty).toMatch(/50x|not financial advice/i);
    expect(book.honesty).toMatch(/Crypto only/);
    expect(book.never.join(" ")).toMatch(/Do not research or trade Polymarket until Taskra says it is time/);
    expect(book.never.join(" ")).not.toMatch(/CLOB/);
    expect(book.never.join(" ")).toMatch(/promise/);
    expect(book.tonight.join(" ")).toMatch(/Grok Bot Bearer/);
    expect(book.howToWork.join(" ")).toMatch(/\/api\/challenge/);
    expect(book.venues.map((v) => v.id)).toEqual(["solana"]);
  });
});

describe("polymarket research client", () => {
  it("maps Gamma events and never talks to CLOB", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          title: "Will Bitcoin reach $100,000 in August?",
          slug: "will-bitcoin-reach-100k-in-august-2026",
          volume24hr: 1000,
          liquidity: 500,
          markets: [
            {
              question: "Will Bitcoin reach $100,000 in August?",
              slug: "will-bitcoin-reach-100k-in-august-2026",
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.12","0.88"]',
              endDate: "2026-09-01T04:00:00Z",
              volume24hr: 1000,
              liquidity: 500,
            },
          ],
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const events = await searchPolymarket("", 3);
    expect(events[0]?.title).toMatch(/Bitcoin/);
    expect(events[0]?.markets[0]?.outcomes[0]).toEqual({ name: "Yes", price: 0.12 });
    expect(formatPolymarketGrounding(events)).toMatch(/research only/);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/gamma-api\.polymarket\.com/);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toMatch(/clob\.polymarket\.com/);
    vi.unstubAllGlobals();
  });
});

describe("challenge dashboard API", () => {
  const servers: Array<{ close: () => void }> = [];
  afterAll(() => {
    for (const s of servers) s.close();
  });

  it("serves the playbook, stores paper ideas, and updates bankroll", async () => {
    const dir = join(tmpdir(), `chal-api-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const store = openStore(join(dir, "t.db"));
    const password = "chal-pass";
    const cfg = loadAppConfig({
      MODE: "PAPER",
      MASTER_ENABLED: "false",
      DASHBOARD_PASSWORD: password,
      DASHBOARD_EMAIL: "hello@taskra.ai",
      DATABASE_PATH: join(dir, "t.db"),
    });
    const codes: string[] = [];
    const ctx: DashboardContext = {
      store,
      crew: new CrewBoard(),
      cfg,
      policy: DEFAULT_POLICY,
      flags: () => ({
        mode: "PAPER",
        masterEnabled: false,
        rpcHealthy: true,
        jupiterHealthy: true,
        telegramHealthy: false,
      }),
      password,
      email: "hello@taskra.ai",
      totpFile: join(dir, ".totp"),
      accessFile: join(dir, "access.json"),
      sendCode: async (_to, code) => {
        codes.push(code);
        return { delivered: true, via: "log" };
      },
      buy: async () => ({ ok: false, message: "unused" }),
      sell: async () => ({ ok: false, message: "unused" }),
    };
    const server = createDashboardServer(ctx);
    servers.push(server);
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("no port"));
      });
    });
    const url = `http://127.0.0.1:${port}`;
    const login = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hello@taskra.ai", password }),
    });
    const cookies = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie") ?? ""])
      .filter(Boolean)
      .map((c) => c.split(";")[0]!)
      .join("; ");
    const verify = await fetch(`${url}/api/email/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies },
      body: JSON.stringify({ code: codes.at(-1) }),
    });
    const jar = (verify.headers.getSetCookie?.() ?? [verify.headers.get("set-cookie") ?? ""])
      .filter(Boolean)
      .map((c) => c.split(";")[0]!)
      .join("; ");

    const chal = await fetch(`${url}/api/challenge`, { headers: { cookie: jar } });
    expect(chal.status).toBe(200);
    const body = (await chal.json()) as {
      bankrollUsd: number;
      rung: { from: number; to: number };
      playbook: { never: string[] };
      polymarketLive: boolean;
      polymarketEnabled: boolean;
    };
    expect(body.bankrollUsd).toBe(100);
    expect(body.rung.from).toBe(100);
    expect(body.rung.to).toBe(5000);
    expect(body.polymarketLive).toBe(false);
    expect(body.polymarketEnabled).toBe(false);
    expect(body.playbook.never.join(" ")).toMatch(/Do not research or trade Polymarket until Taskra says it is time/);

    const idea = await fetch(`${url}/api/challenge/ideas`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar },
      body: JSON.stringify({
        venue: "solana",
        title: "Paper BONK clip inside 0.05 SOL",
        side: "long",
        sizeUsd: 8,
        status: "paper",
        note: "crypto only",
      }),
    });
    expect(idea.status).toBe(200);
    const saved = (await idea.json()) as { idea: { id: number; status: string; venue: string } };
    expect(saved.idea.status).toBe("paper");
    expect(saved.idea.venue).toBe("solana");
    const patch = await fetch(`${url}/api/challenge/ideas/${saved.idea.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: jar },
      body: JSON.stringify({ status: "killed" }),
    });
    expect(patch.status).toBe(200);

    const pmIdea = await fetch(`${url}/api/challenge/ideas`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar },
      body: JSON.stringify({
        venue: "polymarket",
        title: "Will Bitcoin reach $100k in August?",
        url: "https://polymarket.com/event/will-bitcoin-reach-100k-in-august-2026",
        side: "No",
        sizeUsd: 10,
        status: "paper",
        note: "should be refused",
      }),
    });
    expect(pmIdea.status).toBe(400);
    expect(((await pmIdea.json()) as { error: string }).error).toMatch(/crypto only/i);

    const pmApi = await fetch(`${url}/api/polymarket`, { headers: { cookie: jar } });
    expect(pmApi.status).toBe(403);
    expect(((await pmApi.json()) as { error: string; events: unknown[] }).events).toEqual([]);

    const desks = await fetch(`${url}/api/desks`, { headers: { cookie: jar } });
    expect(desks.status).toBe(200);
    const deskIds = ((await desks.json()) as { desks: { id: string }[] }).desks.map((d) => d.id);
    expect(deskIds).not.toContain("polymarket");
    expect(deskIds).toHaveLength(8);
    expect(listDesks().map((d) => d.id)).not.toContain("polymarket");
    expect(POLYMARKET_DESK.id).toBe("polymarket");
    expect(DESKS.find((d) => d.id === "polymarket")).toBeUndefined();

    setBankrollUsd(store, 120);
    const bank = await fetch(`${url}/api/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar },
      body: JSON.stringify({ bankrollUsd: 120 }),
    });
    expect(bank.status).toBe(200);
    expect(((await bank.json()) as { bankrollUsd: number }).bankrollUsd).toBe(120);
  });
});
