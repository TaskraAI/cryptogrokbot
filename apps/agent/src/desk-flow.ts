import type { Connection, Keypair } from "@solana/web3.js";
import type { BudgetState, Policy, RuntimeFlags, TokenMetrics } from "@night/shared";
import {
  decideTrade,
  deskRiskFromPolicy,
  type DeskRiskConfig,
  type ForensicsFlags,
  type ProposedTrade,
  type RiskDecisionResult,
} from "@night/risk";
import { summarizePortfolio } from "@night/portfolio";
import type { LiquiditySnapshot } from "@night/liquidity";
import {
  executeApprovedTrade,
  executeBuy,
  executeSell,
  MemoryOrderRegistry,
  makeIdempotencyKey,
  type ApprovedExecResult,
  type ExecResult,
  type OrderRegistry,
} from "@night/execution";
import {
  consumeReservation,
  consumeRiskDecision,
  getBudget,
  getExecutionOrder,
  getFlag,
  getRiskDecisionByToken,
  insertRiskDecision,
  reserveCapital,
  upsertExecutionOrder,
  type RiskDecisionRow,
  type Store,
} from "@night/storage";

const defaultRegistry = new MemoryOrderRegistry();

export function sqliteOrderRegistry(store: Store): OrderRegistry {
  return {
    get(key) {
      const row = getExecutionOrder(store, key);
      if (!row) return undefined;
      return {
        key: row.idempotency_key,
        status: row.status,
        signature: row.signature ?? undefined,
        sol: row.sol,
        tokens: row.tokens,
        error: row.error ?? undefined,
        paper: row.paper === 1,
        attempts: row.attempts,
      };
    },
    put(row) {
      const [mint, side, ...rest] = row.key.split(":");
      const clientOrderId = rest.join(":");
      const existing = getExecutionOrder(store, row.key);
      upsertExecutionOrder(store, {
        idempotencyKey: row.key,
        decisionId: existing?.decision_id ?? 0,
        mint: mint ?? "",
        side: side ?? "",
        clientOrderId,
        status: row.status,
        signature: row.signature,
        sol: row.sol,
        tokens: row.tokens,
        error: row.error,
        paper: row.paper,
        attempts: row.attempts,
      });
    },
  };
}

export function persistRiskDecision(
  store: Store,
  proposed: ProposedTrade,
  result: RiskDecisionResult,
  deskRisk: DeskRiskConfig,
  now = Date.now(),
): RiskDecisionRow {
  const row = insertRiskDecision(store, {
    mint: proposed.mint,
    side: proposed.side,
    requestedSol: proposed.sizeSol,
    approvedSol: result.sizeSol ?? null,
    strategy: proposed.strategy,
    originatingAgent: proposed.originatingAgent,
    decision: result.decision,
    reasons: result.reasons,
    checks: result.checks,
    ttlMs: deskRisk.decisionTtlMs,
    now,
  });
  if (result.decision === "APPROVE" || result.decision === "APPROVE_REDUCED_SIZE") {
    reserveCapital(store, {
      decisionId: row.id,
      mint: proposed.mint,
      sol: result.sizeSol ?? proposed.sizeSol,
      strategy: proposed.strategy,
      now,
    });
  }
  return row;
}

export function decideDeskTrade(opts: {
  store: Store;
  policy: Policy;
  flags: RuntimeFlags;
  deskRisk?: DeskRiskConfig;
  proposed: ProposedTrade;
  walletSol?: number | null;
  dayKey: string;
  now?: number;
  allowExplicitLive?: boolean;
  skipDailyBudget?: boolean;
  skipOpenSlot?: boolean;
}): { result: RiskDecisionResult; row: RiskDecisionRow; deskRisk: DeskRiskConfig } {
  const deskRisk = opts.deskRisk ?? deskRiskFromPolicy(opts.policy);
  const now = opts.now ?? Date.now();
  const b = getBudget(opts.store, opts.dayKey, opts.flags.mode);
  const budget: BudgetState = {
    dayKey: b.day_key,
    spentSol: b.spent_sol,
    trades: b.trades,
    realizedLossSol: b.realized_loss_sol,
    lastEntryAt: b.last_entry_at,
    extraBudgetSol: b.extra_budget_sol,
  };
  const portfolio = summarizePortfolio({
    store: opts.store,
    mode: opts.flags.mode,
    walletSol: opts.walletSol,
    feeReserveSol: deskRisk.feeReserveSol,
    now,
    timezone: opts.policy.timezone,
  });
  const result = decideTrade(opts.proposed, {
    deskRisk,
    policy: opts.policy,
    budget,
    flags: opts.flags,
    portfolio,
    now,
    allowExplicitLive: opts.allowExplicitLive,
    skipDailyBudget: opts.skipDailyBudget,
    skipOpenSlot: opts.skipOpenSlot,
    halted: getFlag(opts.store, "trading_halt") === "true",
  });
  const row = persistRiskDecision(opts.store, opts.proposed, result, deskRisk, now);
  return { result, row, deskRisk };
}

export async function executeDeskTrade(opts: {
  store: Store;
  policy: Policy;
  flags: RuntimeFlags;
  deskRisk?: DeskRiskConfig;
  riskToken: string;
  clientOrderId: string;
  mint: string;
  side: "buy" | "sell" | "partial";
  sizeSol: number;
  graduated?: boolean;
  tokens?: number;
  tokenDecimals?: number;
  solEstimate?: number;
  grokBotOrder?: boolean;
  connection?: Connection;
  keypair?: Keypair;
  pumpApiKey?: string;
  now?: number;
  registry?: OrderRegistry;
}): Promise<ApprovedExecResult> {
  const deskRisk = opts.deskRisk ?? deskRiskFromPolicy(opts.policy);
  const row = getRiskDecisionByToken(opts.store, opts.riskToken);
  if (!row) {
    return {
      paper: opts.flags.mode === "PAPER",
      sol: 0,
      tokens: 0,
      error: "execution refused: unknown Risk token",
      attempts: 0,
      idempotencyKey: makeIdempotencyKey(opts.mint, opts.side, opts.clientOrderId),
    };
  }
  const registry = opts.registry ?? sqliteOrderRegistry(opts.store);
  const existing = registry.get(makeIdempotencyKey(opts.mint, opts.side, opts.clientOrderId));
  const result = await executeApprovedTrade({
    decision: {
      id: row.id,
      token: row.token,
      decision: row.decision,
      mint: row.mint,
      side: row.side,
      sizeSol: row.approved_sol ?? undefined,
      expiresAt: row.expires_at,
      consumed: row.consumed === 1,
    },
    presentedToken: opts.riskToken,
    mint: opts.mint,
    side: opts.side,
    sizeSol: opts.sizeSol,
    clientOrderId: opts.clientOrderId,
    registry,
    maxSolPerTrade: row.approved_sol ?? deskRisk.maxPositionSizeSol,
    now: opts.now,
    mode: opts.flags.mode,
    masterEnabled: opts.flags.masterEnabled,
    grokBotOrder: opts.grokBotOrder,
    hasWallet: Boolean(opts.keypair),
    maxRetries: deskRisk.maxSubmitRetries,
    submit: async (): Promise<ExecResult> => {
      const slippagePct = Math.min(opts.policy.slippagePctCap, deskRisk.maxSlippageBps / 100);
      if (opts.side === "buy") {
        return executeBuy({
          mode: opts.flags.mode,
          graduated: Boolean(opts.graduated),
          mint: opts.mint,
          sol: opts.sizeSol,
          slippagePct,
          maxSolPerTrade: row.approved_sol ?? deskRisk.maxPositionSizeSol,
          masterEnabled: opts.flags.masterEnabled,
          grokBotOrder: opts.grokBotOrder,
          connection: opts.connection,
          keypair: opts.keypair,
          pumpApiKey: opts.pumpApiKey,
        });
      }
      return executeSell({
        mode: opts.flags.mode,
        graduated: Boolean(opts.graduated ?? true),
        mint: opts.mint,
        tokens: opts.tokens ?? 0,
        tokenDecimals: opts.tokenDecimals,
        slippagePct,
        solEstimate: opts.solEstimate ?? opts.sizeSol,
        masterEnabled: opts.flags.masterEnabled,
        grokBotOrder: opts.grokBotOrder,
        connection: opts.connection,
        keypair: opts.keypair,
        pumpApiKey: opts.pumpApiKey,
      });
    },
  });

  if (!result.error && !result.duplicate) {
    consumeRiskDecision(opts.store, row.id, opts.now);
    consumeReservation(opts.store, row.id, opts.now);
  }
  if (!existing || existing.status === "failed") {
    upsertExecutionOrder(opts.store, {
      idempotencyKey: result.idempotencyKey,
      decisionId: row.id,
      mint: opts.mint,
      side: opts.side,
      clientOrderId: opts.clientOrderId,
      status: result.error ? "failed" : "confirmed",
      signature: result.signature,
      sol: result.sol,
      tokens: result.tokens,
      error: result.error,
      paper: result.paper,
      attempts: result.attempts,
      now: opts.now,
    });
  }
  return result;
}

export function liquidityFromToken(token: TokenMetrics, extra?: LiquiditySnapshot): LiquiditySnapshot {
  return {
    liquidityUsd: token.liquidityUsd,
    buyImpactPct: token.buyImpactPct,
    volume5m: token.volume5m,
    ageMinutes: token.ageMinutes,
    top10HolderPct: token.top10HolderPct,
    isLaunch: extra?.isLaunch ?? !token.graduated,
    ...extra,
  };
}

export function forensicsFromToken(token: TokenMetrics): ForensicsFlags {
  return {
    honeypot: token.sellSimOk === false,
    mintAuthorityLive: token.mintAuthorityRevoked === false,
    freezeAuthorityLive: token.freezeAuthorityRevoked === false,
  };
}

export { defaultRegistry };
