import type { Connection, Keypair } from "@solana/web3.js";
import { dayKey, type Policy, type RuntimeFlags, type TokenMetrics } from "@night/shared";
import { effectiveDailyBudgetSol, loadExtraRules, type DeskRiskConfig, type ExtraRule } from "@night/risk";
import {
  fetchDexSearch,
  fetchDexToken,
  fetchPumpNewTokens,
  jupiterQuote,
  pairToMetrics,
} from "@night/signals";
import { buildSnapshot } from "@night/tape";
import {
  findOpenPosition,
  getBudget,
  listFills,
  listOpenPositions,
  type Store,
} from "@night/storage";
import { manualSource, tryEnter } from "./entries.ts";
import { managePosition, rowToPosition } from "./watchman.ts";

const SOL = "So11111111111111111111111111111111111111112";

export interface TradeOutcome {
  ok: boolean;
  message: string;
}

export function liveTxBlocked(
  flags: RuntimeFlags,
  kind: "buy" | "sell",
  hasWallet?: boolean,
  grokBotOrder?: boolean,
): string | null {
  if (flags.mode !== "LIVE") return null;
  if (!flags.masterEnabled && !grokBotOrder) return `LIVE ${kind} refused: MASTER_ENABLED is not true`;
  if (hasWallet === false) return `LIVE ${kind} refused: WALLET_SECRET_KEY is missing`;
  return null;
}

export async function buyChosenMint(opts: {
  store: Store;
  policy: Policy;
  flags: RuntimeFlags;
  mint: string;
  token?: TokenMetrics;
  sol?: number;
  strict?: boolean;
  force?: boolean;
  extraRules?: ExtraRule[];
  extraRulesPath?: string;
  dayKey: string;
  connection?: Connection;
  keypair?: Keypair;
  pumpApiKey?: string;
  /** Confirmed keep/increase; one-shot size may exceed maxSolPerTrade up to sizeAskCeilingSol. */
  sizeAskId?: number;
  grokBotOrder?: boolean;
  /** Live buy: Chief must send chief:"APPROVE". Scout never sets this. */
  chiefApproved?: boolean;
  /** Add SOL onto an existing open row. Requires grokBotOrder + chiefApproved. */
  add?: boolean;
  clientOrderId?: string;
  strategy?: string;
  originatingAgent?: string;
  deskRisk?: DeskRiskConfig;
}): Promise<TradeOutcome> {
  const blocked = liveTxBlocked(opts.flags, "buy", Boolean(opts.keypair), opts.grokBotOrder);
  if (blocked) {
    return { ok: false, message: blocked };
  }
  if (opts.force && opts.flags.mode === "LIVE") {
    return { ok: false, message: "--force is paper-only" };
  }

  let token = opts.token;
  if (!token) {
    const pair = await fetchDexToken(opts.mint);
    if (!pair) {
      return { ok: false, message: `no Solana DexScreener market for ${opts.mint}` };
    }
    token = pairToMetrics(pair);
  }

  const extraRules = opts.strict
    ? (opts.extraRules ?? (opts.extraRulesPath ? loadExtraRules(opts.extraRulesPath) : []))
    : [];

  const msg = await tryEnter({
    store: opts.store,
    policy: opts.policy,
    flags: opts.flags,
    token,
    sources: [manualSource(token.mint, token.ticker)],
    guardrails: [],
    extraRules,
    dayKey: opts.dayKey,
    sol: opts.sol,
    skipScore: Boolean(opts.force),
    sizeAskId: opts.sizeAskId,
    grokBotOrder: opts.grokBotOrder,
    chiefApproved: opts.chiefApproved,
    add: opts.add,
    clientOrderId: opts.clientOrderId,
    strategy: opts.strategy,
    originatingAgent: opts.originatingAgent,
    deskRisk: opts.deskRisk,
    connection: opts.connection,
    keypair: opts.keypair,
    pumpApiKey: opts.pumpApiKey,
  });
  return { ok: msg.startsWith("bought"), message: msg };
}

export async function sellChosen(opts: {
  store: Store;
  policy: Policy;
  idOrMint: string;
  flags?: RuntimeFlags;
  connection?: Connection;
  keypair?: Keypair;
  pumpApiKey?: string;
  /** Skip DexScreener (tests / offline paper). */
  priceUsd?: number;
  grokBotOrder?: boolean;
}): Promise<TradeOutcome> {
  const flags = opts.flags ?? {
    mode: "PAPER" as const,
    masterEnabled: false,
    rpcHealthy: true,
    jupiterHealthy: true,
    telegramHealthy: false,
  };
  const blocked = liveTxBlocked(flags, "sell", Boolean(opts.keypair), opts.grokBotOrder);
  if (blocked) {
    return { ok: false, message: blocked };
  }
  const row = findOpenPosition(opts.store, opts.idOrMint);
  if (!row) {
    return { ok: false, message: `no open position matching ${opts.idOrMint}` };
  }
  const pair = opts.priceUsd == null ? await fetchDexToken(row.mint) : null;
  const priceUsd = opts.priceUsd ?? Number(pair?.priceUsd ?? row.entry_price_usd);
  const pos = rowToPosition(row);
  const snap = buildSnapshot({
    position: pos,
    market: {
      priceUsd,
      marketCapUsd: pair?.marketCap ?? pair?.fdv ?? 0,
      volume5m: pair?.volume?.m5 ?? 0,
      volume1h: pair?.volume?.h1 ?? 0,
      liquidityUsd: pair?.liquidity?.usd ?? 0,
    },
    social: { hits: [] },
  });
  const msg = await managePosition({
    store: opts.store,
    row,
    snap,
    policy: opts.policy,
    sellAll: true,
    flags,
    grokBotOrder: opts.grokBotOrder,
    connection: opts.connection,
    keypair: opts.keypair,
    pumpApiKey: opts.pumpApiKey,
  });
  return { ok: msg.startsWith("closed") || msg.startsWith("trimmed") || msg.startsWith("returned"), message: msg };
}

export async function scanMemeCoins(query = "SOL"): Promise<
  Array<{
    mint: string;
    ticker: string;
    name: string;
    priceUsd: number;
    marketCapUsd: number;
    liquidityUsd: number;
    volume5m: number;
    venue: "dex" | "pump";
  }>
> {
  const [pump, dex] = await Promise.all([fetchPumpNewTokens(), fetchDexSearch(query)]);
  const seen = new Set<string>();
  const out: Awaited<ReturnType<typeof scanMemeCoins>> = [];
  for (const p of pump.slice(0, 10)) {
    if (seen.has(p.mint)) continue;
    seen.add(p.mint);
    out.push({
      mint: p.mint,
      ticker: p.symbol || "?",
      name: p.name,
      priceUsd: 0,
      marketCapUsd: 0,
      liquidityUsd: 0,
      volume5m: 0,
      venue: "pump",
    });
  }
  for (const pair of dex) {
    const mint = pair.baseToken.address;
    if (seen.has(mint)) continue;
    seen.add(mint);
    const m = pairToMetrics(pair);
    out.push({
      mint: m.mint,
      ticker: m.ticker,
      name: m.name ?? m.ticker,
      priceUsd: m.priceUsd,
      marketCapUsd: m.marketCapUsd,
      liquidityUsd: m.liquidityUsd,
      volume5m: m.volume5m,
      venue: "dex",
    });
    if (out.length >= 16) break;
  }
  return out;
}

export async function quoteMint(mint: string, sol = 0.1): Promise<string> {
  const lamports = Math.floor(sol * 1e9);
  const q = await jupiterQuote({
    inputMint: SOL,
    outputMint: mint,
    amount: lamports,
    slippageBps: 1500,
  });
  if (!q) return `no Jupiter quote for ${mint} (may still be on a pump curve)`;
  return `quote ${sol} SOL → ${q.outAmount} raw tokens  impact=${q.priceImpactPct}%`;
}

export function positionsReport(store: Store): string {
  const open = listOpenPositions(store);
  if (!open.length) return "no open positions";
  return open
    .map((p) => {
      const fills = listFills(store, p.id)
        .map((f) => `  ${f.side} ${f.sol} SOL paper=${f.paper} ${f.reason}`)
        .join("\n");
      return `#${p.id} ${p.ticker} ${p.mint}\n  ${p.mode} status=${p.status} spent=${p.sol_spent} tokens=${p.tokens_held}\n${fills}`;
    })
    .join("\n\n");
}

export function statusReport(opts: { flags: RuntimeFlags; policy: Policy; store: Store; tz: string }): string {
  const day = dayKey(Date.now(), opts.tz);
  const paper = getBudget(opts.store, day, "PAPER");
  const live = getBudget(opts.store, day, "LIVE");
  const cap = effectiveDailyBudgetSol(opts.policy, live.extra_budget_sol, Boolean(opts.flags.allowExtraBudget));
  const paperCap = effectiveDailyBudgetSol(opts.policy, paper.extra_budget_sol, Boolean(opts.flags.allowExtraBudget));
  return [
    `mode=${opts.flags.mode} master=${opts.flags.masterEnabled}`,
    `paper buys never send a transaction`,
    `live auto desk needs MODE=LIVE and MASTER_ENABLED=true and WALLET_SECRET_KEY`,
    `Grok Bot Bearer live buy needs chief:APPROVE; Scout never live-buys; Sentinel live exits need MASTER`,
    `kill/resume (dashboard or /kill) cannot set MODE`,
    `paper budget ${paper.spent_sol}/${paperCap.cap} SOL  trades ${paper.trades}/${opts.policy.maxTradesPerDay}`,
    `live budget ${live.spent_sol}/${cap.cap} SOL  trades ${live.trades}/${opts.policy.maxTradesPerDay}`,
    `size ${opts.policy.maxSolPerTrade} SOL  hard stop ${opts.policy.hardStopPct}%`,
    `open ${listOpenPositions(opts.store).length}/${opts.policy.maxOpenPositions}`,
  ].join("\n");
}
