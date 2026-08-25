import type { MarketSnapshot, Pattern, Policy, PositionState } from "@night/shared";
import { appendPatternPath, applyPeakAndGreen, classifyPattern, decideExit, mergeLlmAction } from "@night/patterns";
import { tokensToRecoverPrincipal } from "@night/risk";
import { executeSell } from "@night/execution";
import type { Connection, Keypair } from "@solana/web3.js";
import {
  insertDecision,
  insertFill,
  insertTape,
  updatePosition,
  type PositionRow,
  type Store,
} from "@night/storage";
import { tagMistake } from "@night/learning";

export function rowToPosition(row: PositionRow): PositionState {
  return {
    id: row.id,
    mint: row.mint,
    ticker: row.ticker,
    mode: row.mode === "LIVE" ? "LIVE" : "PAPER",
    openedAt: row.opened_at,
    entryPriceUsd: row.entry_price_usd,
    principalSol: row.principal_sol,
    tokensHeld: row.tokens_held,
    tokensInitial: row.tokens_initial,
    solSpent: row.sol_spent,
    principalRecoveredSol: row.principal_recovered_sol,
    peakPriceUsd: row.peak_price_usd,
    everGreen: Boolean(row.ever_green),
    runner: Boolean(row.runner),
    lastPattern: (row.last_pattern as Pattern | null) ?? null,
    patternPath: row.pattern_path,
    healthyDipSince: row.healthy_dip_since,
    status: row.status === "closed" ? "closed" : "open",
    sourcesJson: row.sources_json,
  };
}

export async function managePosition(opts: {
  store: Store;
  row: PositionRow;
  snap: MarketSnapshot;
  policy: Policy;
  sellAll?: boolean;
  lpPulled?: boolean;
  creatorDumping?: boolean;
  llm?: { pattern?: Pattern; action?: "hold" | "sell"; confidence?: number };
  connection?: Connection;
  keypair?: Keypair;
  pumpApiKey?: string;
  now?: number;
}): Promise<string> {
  const now = opts.now ?? Date.now();
  let pos = applyPeakAndGreen(rowToPosition(opts.row), opts.snap.priceUsd);
  const pattern = classifyPattern(opts.snap, opts.policy, {
    lpPulled: opts.lpPulled,
    creatorDumping: opts.creatorDumping,
  });
  pos = {
    ...pos,
    lastPattern: pattern,
    patternPath: appendPatternPath(pos.patternPath, pattern),
    healthyDipSince: pattern === "healthy_dip" ? (pos.healthyDipSince ?? now) : null,
  };
  if (pattern === "healthy_dip") pos = { ...pos, runner: pos.runner };

  let action = decideExit({
    position: pos,
    snap: opts.snap,
    pattern,
    policy: opts.policy,
    now,
    sellAll: opts.sellAll,
    lpPulled: opts.lpPulled,
  });
  action = mergeLlmAction(action, opts.llm);

  insertTape(opts.store, {
    positionId: pos.id,
    at: now,
    snapshotJson: JSON.stringify(opts.snap),
    pattern,
    action: action.type,
    reason: action.reason,
  });
  insertDecision(opts.store, {
    at: now,
    kind: action.type === "hold" ? "hold" : "exit",
    mint: pos.mint,
    allowed: action.type !== "hold",
    reason: action.reason,
    pattern,
    payload: { action: action.type, pctFromPeak: opts.snap.pctFromPeak, sentiment: opts.snap.sentiment },
  });

  const solPerToken = pos.tokensInitial > 0 ? pos.principalSol / pos.tokensInitial : 0;
  const markSolPerToken = solPerToken * (opts.snap.priceUsd / Math.max(pos.entryPriceUsd, 1e-12));
  const bagValue = pos.tokensHeld * markSolPerToken;

  const patch: Record<string, unknown> = {
    peak_price_usd: pos.peakPriceUsd,
    ever_green: pos.everGreen ? 1 : 0,
    last_pattern: pattern,
    pattern_path: pos.patternPath,
    healthy_dip_since: pos.healthyDipSince,
    healthy_dip_used: pattern === "healthy_dip" || opts.row.healthy_dip_used ? 1 : 0,
    runner: pos.principalRecoveredSol + 1e-9 >= pos.principalSol ? 1 : 0,
  };

  if (action.type === "hold") {
    updatePosition(opts.store, pos.id, patch);
    return `hold #${pos.id} ${pattern} ${action.reason}`;
  }

  let tokensToSell = pos.tokensHeld;
  if (action.type === "return_principal") {
    tokensToSell = tokensToRecoverPrincipal({
      tokensHeld: pos.tokensHeld,
      markSolPerToken,
      principalRemainingSol: Math.max(0, pos.principalSol - pos.principalRecoveredSol),
    });
  }

  const solEstimate = tokensToSell * markSolPerToken;
  const result = await executeSell({
    mode: pos.mode,
    graduated: true,
    mint: pos.mint,
    tokens: tokensToSell,
    slippagePct: opts.policy.slippagePctCap,
    solEstimate,
    connection: opts.connection,
    keypair: opts.keypair,
    pumpApiKey: opts.pumpApiKey,
  });
  if (result.error) {
    insertDecision(opts.store, {
      at: now,
      kind: "block",
      mint: pos.mint,
      allowed: false,
      reason: `sell failed: ${result.error}`,
      pattern,
    });
    updatePosition(opts.store, pos.id, patch);
    return `sell failed #${pos.id} ${result.error}`;
  }

  insertFill(opts.store, {
    positionId: pos.id,
    at: now,
    side: "sell",
    sol: result.sol,
    tokens: tokensToSell,
    priceUsd: opts.snap.priceUsd,
    reason: action.reason,
    tx: result.signature,
    paper: result.paper,
  });

  if (action.type === "return_principal") {
    const recovered = pos.principalRecoveredSol + result.sol;
    const remaining = Math.max(0, pos.tokensHeld - tokensToSell);
    updatePosition(opts.store, pos.id, {
      ...patch,
      tokens_held: remaining,
      principal_recovered_sol: recovered,
      runner: recovered + 1e-9 >= pos.principalSol ? 1 : 0,
    });
    return `returned principal #${pos.id} +${result.sol.toFixed(4)} SOL remaining tokens=${remaining}`;
  }

  const soldSol = result.sol;
  const recovered = pos.principalRecoveredSol + Math.min(soldSol, Math.max(0, pos.principalSol - pos.principalRecoveredSol));
  const runnerPnl = soldSol - Math.max(0, pos.principalSol - pos.principalRecoveredSol);
  const net = recovered + Math.max(0, runnerPnl) - pos.solSpent + Math.min(0, runnerPnl);
  const netSol = soldSol + pos.principalRecoveredSol - pos.solSpent;
  const mistake = tagMistake({
    exitReason: action.reason,
    lastPattern: pattern,
    postExitPctChange: 0,
    netSol,
  });
  updatePosition(opts.store, pos.id, {
    ...patch,
    tokens_held: 0,
    status: "closed",
    closed_at: now,
    principal_recovered_sol: recovered,
    runner_pnl_sol: runnerPnl,
    net_sol: netSol,
    exit_reason: action.reason,
    exit_tx: result.signature ?? null,
    mistake,
  });
  void bagValue;
  void net;
  return `closed #${pos.id} ${action.reason} net=${netSol.toFixed(4)} SOL`;
}
