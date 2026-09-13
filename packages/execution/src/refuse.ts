import type { Mode } from "@night/shared";

export interface ExecResult {
  paper: boolean;
  signature?: string;
  sol: number;
  tokens: number;
  error?: string;
}

/** Refuse oversize at the execution boundary so callers cannot bypass tryEnter. */
export function refuseOversizeBuy(sol: number, maxSolPerTrade: number): string | null {
  if (!Number.isFinite(sol) || sol <= 0) return "invalid SOL size";
  if (!Number.isFinite(maxSolPerTrade) || maxSolPerTrade <= 0) return "invalid maxSolPerTrade";
  if (sol > maxSolPerTrade + 1e-12) {
    return `size ${sol} SOL exceeds maxSolPerTrade ${maxSolPerTrade}`;
  }
  return null;
}

export function refuseLiveExecution(opts: {
  mode: Mode;
  masterEnabled?: boolean;
  hasWallet: boolean;
  /** Explicit Grok Bot order: skip the auto-desk MASTER kill. */
  grokBotOrder?: boolean;
}): string | null {
  if (opts.mode !== "LIVE") return null;
  if (opts.masterEnabled !== true && !opts.grokBotOrder) return "LIVE execution refused: MASTER_ENABLED is not true";
  if (!opts.hasWallet) return "LIVE execution refused: WALLET_SECRET_KEY is missing";
  return null;
}
