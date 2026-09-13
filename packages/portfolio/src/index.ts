import { dayKey, type Mode } from "@night/shared";
import {
  getBudget,
  listClosedSince,
  listFills,
  listOpenPositions,
  sumPendingReserved,
  type PositionRow,
  type Store,
} from "@night/storage";

export interface MarkedPosition {
  id: number;
  mint: string;
  ticker: string;
  strategy: string;
  qty: number;
  avgEntryUsd: number;
  markUsd: number | null;
  solSpent: number;
  principalSol: number;
  realizedSol: number;
  unrealizedSol: number | null;
  mode: string;
}

export interface PortfolioSummary {
  walletSol: number | null;
  feeReserveSol: number;
  availableSol: number | null;
  openCount: number;
  openPositions: MarkedPosition[];
  totalExposureSol: number;
  realizedPnlSol: number;
  unrealizedPnlSol: number | null;
  exposureByStrategy: Record<string, number>;
  pendingReservedSol: number;
  drawdownPct: number;
  dayKey: string;
  mode: Mode;
}

export interface PortfolioMarks {
  /** mint → last USD mark. Optional; unrealised is null when missing. */
  [mint: string]: number;
}

/**
 * Source-of-truth book from the existing SQLite ledger (night-agent.db).
 * Does not invent a second positions table. Wallet SOL is a hook — pass it
 * in when the RPC is available; otherwise availableSol is null (fail-closed
 * for live size that needs a cash check).
 */
export function summarizePortfolio(opts: {
  store: Store;
  mode?: Mode;
  walletSol?: number | null;
  feeReserveSol?: number;
  marks?: PortfolioMarks;
  now?: number;
  timezone?: string;
}): PortfolioSummary {
  const mode = opts.mode;
  const feeReserveSol = Math.max(0, opts.feeReserveSol ?? 0);
  const openRows = listOpenPositions(opts.store, mode);
  const pendingReservedSol = sumPendingReserved(opts.store);
  const day = dayKey(opts.now, opts.timezone ?? "UTC");
  const budget = mode
    ? getBudget(opts.store, day, mode)
    : { realized_loss_sol: 0, spent_sol: 0, trades: 0, extra_budget_sol: 0, last_entry_at: 0, day_key: day };

  const startOfDay = startOfUtcDay(opts.now ?? Date.now());
  const closed = listClosedSince(opts.store, startOfDay);
  const realizedFromClosed = closed
    .filter((p) => (mode ? p.mode === mode : true))
    .reduce((s, p) => s + (typeof p.net_sol === "number" ? p.net_sol : 0), 0);
  const realizedPnlSol = realizedFromClosed - (budget.realized_loss_sol > 0 && realizedFromClosed === 0 ? budget.realized_loss_sol : 0);

  const openPositions = openRows.map((row) => markPosition(row, opts.marks));
  const totalExposureSol = openPositions.reduce((s, p) => s + p.solSpent, 0);
  const exposureByStrategy: Record<string, number> = {};
  for (const p of openPositions) {
    const key = p.strategy || "default";
    exposureByStrategy[key] = (exposureByStrategy[key] ?? 0) + p.solSpent;
  }

  const marked = openPositions.filter((p) => p.unrealizedSol != null);
  const unrealizedPnlSol = marked.length ? marked.reduce((s, p) => s + (p.unrealizedSol ?? 0), 0) : null;

  const walletSol = opts.walletSol == null || !Number.isFinite(opts.walletSol) ? null : Number(opts.walletSol);
  const availableSol =
    walletSol == null ? null : Math.max(0, walletSol - feeReserveSol - pendingReservedSol);

  let drawdownPct = 0;
  if (unrealizedPnlSol != null && unrealizedPnlSol < 0 && totalExposureSol > 0) {
    drawdownPct = (Math.abs(unrealizedPnlSol) / totalExposureSol) * 100;
  }

  return {
    walletSol,
    feeReserveSol,
    availableSol,
    openCount: openPositions.length,
    openPositions,
    totalExposureSol,
    realizedPnlSol,
    unrealizedPnlSol,
    exposureByStrategy,
    pendingReservedSol,
    drawdownPct,
    dayKey: day,
    mode: mode ?? "PAPER",
  };
}

export function exposureForMint(summary: PortfolioSummary, mint: string): number {
  return summary.openPositions.filter((p) => p.mint === mint).reduce((s, p) => s + p.solSpent, 0);
}

export function exposureForStrategy(summary: PortfolioSummary, strategy: string): number {
  return summary.exposureByStrategy[strategy || "default"] ?? 0;
}

function markPosition(row: PositionRow, marks?: PortfolioMarks): MarkedPosition {
  const strategy = (row.strategy || strategyFromMetrics(row.entry_metrics_json) || "").trim();
  const qty = row.tokens_held;
  const avgEntryUsd = row.entry_price_usd;
  const markUsd = marks && Number.isFinite(marks[row.mint]) ? marks[row.mint]! : null;
  let unrealizedSol: number | null = null;
  if (markUsd != null && avgEntryUsd > 0 && row.sol_spent > 0) {
    const multiple = markUsd / avgEntryUsd;
    unrealizedSol = row.sol_spent * (multiple - 1);
  }
  const realizedSol = (row.principal_recovered_sol ?? 0) + (row.runner_pnl_sol ?? 0);
  return {
    id: row.id,
    mint: row.mint,
    ticker: row.ticker,
    strategy,
    qty,
    avgEntryUsd,
    markUsd,
    solSpent: row.sol_spent,
    principalSol: row.principal_sol,
    realizedSol,
    unrealizedSol,
    mode: row.mode,
  };
}

function strategyFromMetrics(json: string): string {
  try {
    const parsed = JSON.parse(json) as { strategy?: string };
    return typeof parsed.strategy === "string" ? parsed.strategy : "";
  } catch {
    return "";
  }
}

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export { listFills };
