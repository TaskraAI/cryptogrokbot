import type { Connection } from "@solana/web3.js";
import type { Mode } from "@night/shared";
import { refuseOversizeBuy, type ExecResult } from "./refuse.ts";

export const EXECUTABLE_RISK_DECISIONS = ["APPROVE", "APPROVE_REDUCED_SIZE"] as const;
export type ExecutableRiskDecision = (typeof EXECUTABLE_RISK_DECISIONS)[number];
export type RiskVerdict = ExecutableRiskDecision | "REJECT" | "HALT_TRADING";

export function riskAllowsExecution(decision: string): decision is ExecutableRiskDecision {
  return decision === "APPROVE" || decision === "APPROVE_REDUCED_SIZE";
}

export function makeIdempotencyKey(mint: string, side: string, clientOrderId: string): string {
  return `${mint}:${side}:${clientOrderId}`;
}

export type OrderStatus = "submitting" | "confirmed" | "failed";

export interface OrderRecord {
  key: string;
  status: OrderStatus;
  signature?: string;
  sol: number;
  tokens: number;
  error?: string;
  paper: boolean;
  attempts: number;
}

export interface OrderRegistry {
  get(key: string): OrderRecord | undefined;
  put(row: OrderRecord): void;
}

export class MemoryOrderRegistry implements OrderRegistry {
  private rows = new Map<string, OrderRecord>();
  get(key: string): OrderRecord | undefined {
    return this.rows.get(key);
  }
  put(row: OrderRecord): void {
    this.rows.set(row.key, { ...row });
  }
}

export interface ApprovedDecision {
  id: number;
  token: string;
  decision: string;
  mint: string;
  side: string;
  sizeSol?: number;
  expiresAt: number;
  consumed?: boolean;
}

export interface ApprovedExecResult extends ExecResult {
  duplicate?: boolean;
  attempts: number;
  decisionId?: number;
  idempotencyKey: string;
}

export function duplicateOrderResult(existing: OrderRecord, key: string): ApprovedExecResult | null {
  if (existing.status === "confirmed") {
    return {
      paper: existing.paper,
      signature: existing.signature,
      sol: existing.sol,
      tokens: existing.tokens,
      duplicate: true,
      attempts: existing.attempts,
      idempotencyKey: key,
    };
  }
  if (existing.status === "submitting") {
    return {
      paper: existing.paper,
      sol: existing.sol,
      tokens: existing.tokens,
      signature: existing.signature,
      error: "order already in flight",
      duplicate: true,
      attempts: existing.attempts,
      idempotencyKey: key,
    };
  }
  return null;
}

/**
 * Single live/paper submit entrypoint. Requires a prior Risk APPROVE or
 * APPROVE_REDUCED_SIZE token. Exit *decisions* stay in Sentinel/Exit;
 * this function only submits.
 */
export async function executeApprovedTrade(opts: {
  decision: ApprovedDecision;
  presentedToken: string;
  mint: string;
  side: "buy" | "sell" | "partial";
  sizeSol: number;
  clientOrderId: string;
  registry: OrderRegistry;
  maxSolPerTrade: number;
  now?: number;
  mode: Mode;
  masterEnabled?: boolean;
  grokBotOrder?: boolean;
  hasWallet?: boolean;
  maxRetries?: number;
  submit: () => Promise<ExecResult>;
}): Promise<ApprovedExecResult> {
  const key = makeIdempotencyKey(opts.mint, opts.side, opts.clientOrderId);
  const now = opts.now ?? Date.now();

  const existing = opts.registry.get(key);
  if (existing) {
    const dup = duplicateOrderResult(existing, key);
    if (dup) return { ...dup, decisionId: opts.decision.id };
  }

  const gate = gateApprovedTrade(opts, now);
  if (gate) {
    return { paper: opts.mode === "PAPER", sol: 0, tokens: 0, error: gate, attempts: 0, idempotencyKey: key, decisionId: opts.decision.id };
  }

  const sizeErr = opts.side === "buy" ? refuseOversizeBuy(opts.sizeSol, opts.maxSolPerTrade) : null;
  if (sizeErr) {
    return { paper: opts.mode === "PAPER", sol: 0, tokens: 0, error: sizeErr, attempts: 0, idempotencyKey: key, decisionId: opts.decision.id };
  }

  const maxRetries = Math.max(0, opts.maxRetries ?? 2);
  opts.registry.put({
    key,
    status: "submitting",
    sol: 0,
    tokens: 0,
    paper: opts.mode === "PAPER",
    attempts: 0,
  });

  let last: ExecResult = { paper: opts.mode === "PAPER", sol: 0, tokens: 0, error: "submit not attempted" };
  let attempts = 0;
  for (let i = 0; i <= maxRetries; i += 1) {
    attempts = i + 1;
    last = await opts.submit();
    if (!last.error) break;
    if (!isRetryableExecError(last.error)) break;
  }

  const record: OrderRecord = {
    key,
    status: last.error ? "failed" : "confirmed",
    signature: last.signature,
    sol: last.sol,
    tokens: last.tokens,
    error: last.error,
    paper: last.paper,
    attempts,
  };
  opts.registry.put(record);
  return {
    ...last,
    attempts,
    idempotencyKey: key,
    decisionId: opts.decision.id,
  };
}

export function gateApprovedTrade(
  opts: {
    decision: ApprovedDecision;
    presentedToken: string;
    mint: string;
    side: string;
    sizeSol: number;
  },
  now: number,
): string | null {
  if (!opts.presentedToken || opts.presentedToken !== opts.decision.token) {
    return "execution refused: Risk token mismatch";
  }
  if (!riskAllowsExecution(opts.decision.decision)) {
    return `execution refused: Risk ${opts.decision.decision} is not executable`;
  }
  if (opts.decision.consumed) {
    return "execution refused: Risk decision already consumed";
  }
  if (opts.decision.expiresAt <= now) {
    return "execution refused: Risk decision expired";
  }
  if (opts.decision.mint !== opts.mint) {
    return "execution refused: mint does not match Risk decision";
  }
  if (opts.decision.side !== opts.side) {
    return "execution refused: side does not match Risk decision";
  }
  const approved = opts.decision.sizeSol;
  if (approved != null && opts.sizeSol > approved + 1e-12) {
    return `execution refused: size ${opts.sizeSol} exceeds Risk-approved ${approved}`;
  }
  return null;
}

export function isRetryableExecError(error: string): boolean {
  const e = error.toLowerCase();
  if (e.includes("maxsolpertrade") || e.includes("invalid sol") || e.includes("master_enabled")) return false;
  if (e.includes("risk ") || e.includes("wallet_secret_key") || e.includes("token mismatch")) return false;
  if (e.includes("already consumed") || e.includes("expired")) return false;
  return (
    e.includes("timeout") ||
    e.includes("429") ||
    e.includes("503") ||
    e.includes("blockhash") ||
    e.includes("unable to confirm") ||
    e.includes("failed to send") ||
    e.includes("fetch")
  );
}

export async function confirmSignature(connection: Connection, signature: string): Promise<boolean> {
  try {
    const res = await connection.confirmTransaction(signature, "confirmed");
    return !res.value.err;
  } catch {
    return false;
  }
}
