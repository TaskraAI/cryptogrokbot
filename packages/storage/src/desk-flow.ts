import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type Store = { db: DatabaseSync };

export type ExecutionOrderStatus = "submitting" | "confirmed" | "failed";

export interface RiskDecisionRow {
  id: number;
  token: string;
  at: number;
  expires_at: number;
  mint: string;
  side: string;
  requested_sol: number;
  approved_sol: number | null;
  strategy: string;
  originating_agent: string;
  decision: string;
  reasons_json: string;
  checks_json: string;
  consumed: number;
  consumed_at: number | null;
}

export interface CapitalReservationRow {
  id: number;
  decision_id: number;
  mint: string;
  sol: number;
  strategy: string;
  status: string;
  created_at: number;
  released_at: number | null;
}

export interface ExecutionOrderRow {
  id: number;
  idempotency_key: string;
  decision_id: number;
  mint: string;
  side: string;
  client_order_id: string;
  status: ExecutionOrderStatus;
  signature: string | null;
  sol: number;
  tokens: number;
  error: string | null;
  paper: number;
  attempts: number;
  created_at: number;
  updated_at: number;
}

export function migrateDeskFlow(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      mint TEXT NOT NULL,
      side TEXT NOT NULL,
      requested_sol REAL NOT NULL,
      approved_sol REAL,
      strategy TEXT NOT NULL DEFAULT '',
      originating_agent TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL,
      reasons_json TEXT NOT NULL DEFAULT '[]',
      checks_json TEXT NOT NULL DEFAULT '{}',
      consumed INTEGER NOT NULL DEFAULT 0,
      consumed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS capital_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id INTEGER NOT NULL,
      mint TEXT NOT NULL,
      sol REAL NOT NULL,
      strategy TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      released_at INTEGER,
      FOREIGN KEY (decision_id) REFERENCES risk_decisions(id)
    );

    CREATE TABLE IF NOT EXISTS execution_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL UNIQUE,
      decision_id INTEGER NOT NULL,
      mint TEXT NOT NULL,
      side TEXT NOT NULL,
      client_order_id TEXT NOT NULL,
      status TEXT NOT NULL,
      signature TEXT,
      sol REAL NOT NULL DEFAULT 0,
      tokens REAL NOT NULL DEFAULT 0,
      error TEXT,
      paper INTEGER NOT NULL DEFAULT 1,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

export function newRiskToken(): string {
  return `rd_${randomBytes(16).toString("hex")}`;
}

export function insertRiskDecision(
  store: Store,
  row: {
    mint: string;
    side: string;
    requestedSol: number;
    approvedSol?: number | null;
    strategy?: string;
    originatingAgent?: string;
    decision: string;
    reasons: string[];
    checks: Record<string, unknown>;
    ttlMs: number;
    now?: number;
  },
): RiskDecisionRow {
  const now = row.now ?? Date.now();
  const token = newRiskToken();
  const result = store.db
    .prepare(
      `INSERT INTO risk_decisions (
        token, at, expires_at, mint, side, requested_sol, approved_sol,
        strategy, originating_agent, decision, reasons_json, checks_json, consumed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      token,
      now,
      now + Math.max(1_000, row.ttlMs),
      row.mint,
      row.side,
      row.requestedSol,
      row.approvedSol ?? null,
      (row.strategy ?? "").slice(0, 48),
      (row.originatingAgent ?? "").slice(0, 48),
      row.decision,
      JSON.stringify(row.reasons),
      JSON.stringify(row.checks ?? {}),
    );
  return getRiskDecision(store, Number(result.lastInsertRowid))!;
}

export function getRiskDecision(store: Store, id: number): RiskDecisionRow | undefined {
  return store.db.prepare("SELECT * FROM risk_decisions WHERE id = ?").get(id) as RiskDecisionRow | undefined;
}

export function getRiskDecisionByToken(store: Store, token: string): RiskDecisionRow | undefined {
  return store.db.prepare("SELECT * FROM risk_decisions WHERE token = ?").get(token) as RiskDecisionRow | undefined;
}

export function consumeRiskDecision(store: Store, id: number, now = Date.now()): boolean {
  const result = store.db
    .prepare("UPDATE risk_decisions SET consumed = 1, consumed_at = ? WHERE id = ? AND consumed = 0")
    .run(now, id);
  return result.changes > 0;
}

export function listRecentRiskDecisions(store: Store, limit = 20): RiskDecisionRow[] {
  return store.db
    .prepare("SELECT * FROM risk_decisions ORDER BY id DESC LIMIT ?")
    .all(limit) as unknown as RiskDecisionRow[];
}

export function reserveCapital(
  store: Store,
  row: { decisionId: number; mint: string; sol: number; strategy?: string; now?: number },
): CapitalReservationRow {
  const now = row.now ?? Date.now();
  const result = store.db
    .prepare(
      `INSERT INTO capital_reservations (decision_id, mint, sol, strategy, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
    .run(row.decisionId, row.mint, row.sol, (row.strategy ?? "").slice(0, 48), now);
  return store.db
    .prepare("SELECT * FROM capital_reservations WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as unknown as CapitalReservationRow;
}

export function consumeReservation(store: Store, decisionId: number, now = Date.now()): void {
  store.db
    .prepare(
      "UPDATE capital_reservations SET status = 'consumed', released_at = ? WHERE decision_id = ? AND status = 'pending'",
    )
    .run(now, decisionId);
}

export function releaseExpiredReservations(store: Store, now = Date.now()): number {
  const expired = store.db
    .prepare(
      `SELECT r.id FROM capital_reservations r
       JOIN risk_decisions d ON d.id = r.decision_id
       WHERE r.status = 'pending' AND (d.expires_at < ? OR d.consumed = 1)`,
    )
    .all(now) as Array<{ id: number }>;
  for (const row of expired) {
    store.db
      .prepare("UPDATE capital_reservations SET status = 'released', released_at = ? WHERE id = ?")
      .run(now, row.id);
  }
  return expired.length;
}

export function sumPendingReserved(store: Store, mint?: string): number {
  releaseExpiredReservations(store);
  if (mint) {
    const row = store.db
      .prepare("SELECT COALESCE(SUM(sol), 0) AS sol FROM capital_reservations WHERE status = 'pending' AND mint = ?")
      .get(mint) as { sol: number };
    return Number(row.sol) || 0;
  }
  const row = store.db
    .prepare("SELECT COALESCE(SUM(sol), 0) AS sol FROM capital_reservations WHERE status = 'pending'")
    .get() as { sol: number };
  return Number(row.sol) || 0;
}

export function getExecutionOrder(store: Store, idempotencyKey: string): ExecutionOrderRow | undefined {
  return store.db
    .prepare("SELECT * FROM execution_orders WHERE idempotency_key = ?")
    .get(idempotencyKey) as ExecutionOrderRow | undefined;
}

export function upsertExecutionOrder(
  store: Store,
  row: {
    idempotencyKey: string;
    decisionId: number;
    mint: string;
    side: string;
    clientOrderId: string;
    status: ExecutionOrderStatus;
    signature?: string | null;
    sol?: number;
    tokens?: number;
    error?: string | null;
    paper?: boolean;
    attempts?: number;
    now?: number;
  },
): ExecutionOrderRow {
  const now = row.now ?? Date.now();
  const existing = getExecutionOrder(store, row.idempotencyKey);
  if (existing) {
    store.db
      .prepare(
        `UPDATE execution_orders SET
          status = ?, signature = ?, sol = ?, tokens = ?, error = ?, paper = ?, attempts = ?, updated_at = ?
         WHERE idempotency_key = ?`,
      )
      .run(
        row.status,
        row.signature ?? existing.signature,
        row.sol ?? existing.sol,
        row.tokens ?? existing.tokens,
        row.error ?? null,
        row.paper == null ? existing.paper : row.paper ? 1 : 0,
        row.attempts ?? existing.attempts,
        now,
        row.idempotencyKey,
      );
    return getExecutionOrder(store, row.idempotencyKey)!;
  }
  store.db
    .prepare(
      `INSERT INTO execution_orders (
        idempotency_key, decision_id, mint, side, client_order_id, status,
        signature, sol, tokens, error, paper, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.idempotencyKey,
      row.decisionId,
      row.mint,
      row.side,
      row.clientOrderId,
      row.status,
      row.signature ?? null,
      row.sol ?? 0,
      row.tokens ?? 0,
      row.error ?? null,
      row.paper ? 1 : 0,
      row.attempts ?? 0,
      now,
      now,
    );
  return getExecutionOrder(store, row.idempotencyKey)!;
}
