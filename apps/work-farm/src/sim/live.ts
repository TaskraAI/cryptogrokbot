import type { GrokFarmSim } from "./engine";
import type {
  CrewId,
  CrewStatus,
  DecisionEvent,
  OpenTrade,
  PnlState,
  TradeFill,
} from "./types";
import { CREW_IDS } from "./types";

interface CrewPulseDto {
  id: string;
  title?: string;
  status: CrewStatus;
  detail: string;
  ticks?: number;
  at?: number;
  job?: string;
}

interface FarmDto {
  mode?: "PAPER" | "LIVE";
  masterEnabled?: boolean;
  pulses?: CrewPulseDto[];
  log?: Array<{ at: number; id: string; detail: string }>;
  pnl?: PnlState;
  positions?: Array<{
    id: number | string;
    mint: string;
    ticker: string;
    mode: "PAPER" | "LIVE";
    status: "open" | "closed";
    sol_spent: number;
    tokens_held: number;
    net_sol: number | null;
    opened_at: number;
  }>;
  openCount?: number;
  opportunities?: Array<{ id?: string | number; ticker?: string; mint?: string; status?: string }>;
  recentOpportunities?: Array<{
    id?: string | number;
    ticker?: string;
    reason?: string;
    status?: string;
  }>;
  auditor?: { ok: boolean; summary: string; at: number } | null;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const headers: Record<string, string> = {};
    const token =
      (typeof localStorage !== "undefined" && localStorage.getItem("farmToken")) ||
      import.meta.env.VITE_FARM_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, {
      credentials: "include",
      headers,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function mapPositions(farm: FarmDto): OpenTrade[] {
  if (!farm.positions) return [];
  return farm.positions
    .filter((p) => p.status === "open")
    .map((p) => ({
      id: String(p.id),
      ticker: p.ticker || "?",
      mint: p.mint,
      mode: p.mode,
      solSpent: p.sol_spent,
      tokensHeld: p.tokens_held,
      netSol: p.net_sol,
      openedAt: p.opened_at,
      status: p.status,
    }));
}

function mapFills(farm: FarmDto): TradeFill[] {
  if (!farm.positions) return [];
  const out: TradeFill[] = [];
  for (const p of farm.positions) {
    if (p.status === "closed" && p.net_sol != null) {
      out.push({
        id: `sell-${p.id}`,
        at: Date.now(),
        side: "SELL",
        ticker: p.ticker,
        mint: p.mint,
        sol: Math.abs(p.net_sol),
        agent: "sentinel",
        note: "closed position",
        mode: p.mode,
      });
    } else if (p.status === "open") {
      out.push({
        id: `buy-${p.id}`,
        at: p.opened_at || Date.now(),
        side: "BUY",
        ticker: p.ticker,
        mint: p.mint,
        sol: p.sol_spent,
        agent: "chief",
        note: "open bag",
        mode: p.mode,
      });
    }
  }
  return out.slice(0, 12);
}

function decisionsFromFarm(farm: FarmDto): DecisionEvent[] {
  const out: DecisionEvent[] = [];
  if (farm.auditor?.summary) {
    out.push({
      id: `aud-${farm.auditor.at}`,
      at: farm.auditor.at || Date.now(),
      agent: "auditor",
      kind: "scan",
      text: `Auditor: ${farm.auditor.summary}`,
      major: !farm.auditor.ok,
    });
  }
  for (const o of farm.recentOpportunities ?? []) {
    out.push({
      id: `opp-${o.id ?? o.ticker}`,
      at: Date.now(),
      agent: "scout",
      kind: "lead",
      text: `Chance ${o.ticker ?? "?"}: ${o.reason ?? o.status ?? "queued"}`,
      major: true,
    });
  }
  for (const e of farm.log?.slice(0, 8) ?? []) {
    const id = (CREW_IDS.includes(e.id as CrewId) ? e.id : "chief") as CrewId;
    out.push({
      id: `log-${e.at}-${e.id}`,
      at: e.at ?? Date.now(),
      agent: id,
      kind: "hold",
      text: `${e.id}: ${e.detail}`,
      major: false,
    });
  }
  for (const p of farm.pulses ?? []) {
    if (p.status === "blocked" || p.status === "error") {
      out.push({
        id: `pulse-${p.id}-${p.at}`,
        at: p.at ?? Date.now(),
        agent: (CREW_IDS.includes(p.id as CrewId) ? p.id : "chief") as CrewId,
        kind: p.status === "blocked" ? "block" : "scan",
        text: `${p.title ?? p.id} ${p.status}: ${p.detail}`,
        major: true,
      });
    }
  }
  return out;
}

/** Poll GrokBot desk; prefer compact /api/farm, fall back to crew+home+book. */
export async function syncLiveDesk(sim: GrokFarmSim): Promise<boolean> {
  let farm = await getJson<FarmDto>("/api/farm");

  if (!farm?.pulses?.length) {
    const [crew, home, book] = await Promise.all([
      getJson<{ pulses: CrewPulseDto[]; log: Array<{ at: number; id: string; detail: string }> }>(
        "/api/crew",
      ),
      getJson<{
        mode?: "PAPER" | "LIVE";
        masterEnabled?: boolean;
        pnl?: PnlState;
        openCount?: number;
        opportunities?: FarmDto["opportunities"];
        recentOpportunities?: FarmDto["recentOpportunities"];
        auditor?: FarmDto["auditor"];
      }>("/api/home"),
      getJson<{ pnl?: PnlState; positions?: FarmDto["positions"] }>("/api/book"),
    ]);
    if (!crew?.pulses?.length) {
      sim.markLive(false);
      return false;
    }
    farm = {
      mode: home?.mode,
      masterEnabled: home?.masterEnabled,
      pulses: crew.pulses,
      log: crew.log,
      pnl: home?.pnl ?? book?.pnl,
      positions: book?.positions,
      openCount: home?.openCount,
      opportunities: home?.opportunities,
      recentOpportunities: home?.recentOpportunities,
      auditor: home?.auditor,
    };
  }

  sim.applyLive({
    pulses: farm.pulses,
    log: farm.log ?? [],
    pnl: farm.pnl,
    positions: mapPositions(farm),
    fills: mapFills(farm),
    decisions: decisionsFromFarm(farm),
    mode: farm.mode,
    masterEnabled: farm.masterEnabled,
    inboxCount: farm.opportunities?.length ?? farm.openCount,
  });
  sim.markLive(true);
  return true;
}
