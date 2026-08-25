import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Grade, Mode, Pattern } from "@night/shared";

export interface Store {
  db: DatabaseSync;
}

export function openStore(path: string): Store {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return { db };
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      ticker TEXT NOT NULL,
      mode TEXT NOT NULL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      entry_price_usd REAL NOT NULL,
      principal_sol REAL NOT NULL,
      tokens_held REAL NOT NULL,
      tokens_initial REAL NOT NULL,
      sol_spent REAL NOT NULL,
      principal_recovered_sol REAL NOT NULL DEFAULT 0,
      runner_pnl_sol REAL NOT NULL DEFAULT 0,
      fees_sol REAL NOT NULL DEFAULT 0,
      net_sol REAL,
      peak_price_usd REAL NOT NULL,
      ever_green INTEGER NOT NULL DEFAULT 0,
      runner INTEGER NOT NULL DEFAULT 0,
      last_pattern TEXT,
      pattern_path TEXT NOT NULL DEFAULT '',
      healthy_dip_since INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      sources_json TEXT NOT NULL DEFAULT '[]',
      entry_metrics_json TEXT NOT NULL DEFAULT '{}',
      thesis TEXT,
      score REAL,
      exit_reason TEXT,
      exit_tx TEXT,
      entry_tx TEXT,
      grade TEXT,
      grade_note TEXT,
      healthy_dip_used INTEGER NOT NULL DEFAULT 0,
      post_exit_price_usd REAL,
      mistake TEXT
    );

    CREATE TABLE IF NOT EXISTS fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      at INTEGER NOT NULL,
      side TEXT NOT NULL,
      sol REAL NOT NULL,
      tokens REAL NOT NULL,
      price_usd REAL NOT NULL,
      reason TEXT NOT NULL,
      tx TEXT,
      paper INTEGER NOT NULL,
      FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    CREATE TABLE IF NOT EXISTS tape (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      at INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      pattern TEXT,
      action TEXT,
      reason TEXT,
      FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      mint TEXT NOT NULL,
      allowed INTEGER NOT NULL,
      reason TEXT NOT NULL,
      score REAL,
      pattern TEXT,
      payload_json TEXT
    );

    CREATE TABLE IF NOT EXISTS source_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      platform TEXT NOT NULL,
      key TEXT NOT NULL,
      weight TEXT NOT NULL,
      mint TEXT,
      ticker TEXT,
      permalink TEXT,
      snippet TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budget (
      day_key TEXT PRIMARY KEY,
      spent_sol REAL NOT NULL DEFAULT 0,
      trades INTEGER NOT NULL DEFAULT 0,
      realized_loss_sol REAL NOT NULL DEFAULT 0,
      last_entry_at INTEGER NOT NULL DEFAULT 0,
      extra_budget_sol REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS flags (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      text TEXT NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      public_key TEXT NOT NULL DEFAULT '',
      has_secret INTEGER NOT NULL DEFAULT 0,
      assigned_desk TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      text TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'improve'
    );

    CREATE TABLE IF NOT EXISTS auditor_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      summary TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
  `);
  seedStarterTodos(db);
}

export function setFlag(store: Store, key: string, value: string): void {
  store.db
    .prepare("INSERT INTO flags (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function getFlag(store: Store, key: string, fallback = ""): string {
  const row = store.db.prepare("SELECT value FROM flags WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export interface NewPosition {
  mint: string;
  ticker: string;
  mode: Mode;
  openedAt: number;
  entryPriceUsd: number;
  principalSol: number;
  tokensHeld: number;
  solSpent: number;
  sourcesJson: string;
  entryMetricsJson: string;
  thesis?: string;
  score?: number;
  entryTx?: string;
}

export function insertPosition(store: Store, p: NewPosition): number {
  const result = store.db
    .prepare(
      `INSERT INTO positions (
        mint, ticker, mode, opened_at, entry_price_usd, principal_sol,
        tokens_held, tokens_initial, sol_spent, peak_price_usd, sources_json,
        entry_metrics_json, thesis, score, entry_tx
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.mint,
      p.ticker,
      p.mode,
      p.openedAt,
      p.entryPriceUsd,
      p.principalSol,
      p.tokensHeld,
      p.tokensHeld,
      p.solSpent,
      p.entryPriceUsd,
      p.sourcesJson,
      p.entryMetricsJson,
      p.thesis ?? null,
      p.score ?? null,
      p.entryTx ?? null,
    );
  return Number(result.lastInsertRowid);
}

function asRows<T>(rows: unknown): T {
  return rows as T;
}

export function listOpenPositions(store: Store) {
  return asRows<PositionRow[]>(store.db.prepare("SELECT * FROM positions WHERE status = 'open' ORDER BY id").all());
}

export function getPosition(store: Store, id: number): PositionRow | undefined {
  return store.db.prepare("SELECT * FROM positions WHERE id = ?").get(id) as PositionRow | undefined;
}

export function findPositionByMint(store: Store, mint: string): PositionRow | undefined {
  return store.db
    .prepare("SELECT * FROM positions WHERE mint = ? ORDER BY id DESC LIMIT 1")
    .get(mint) as PositionRow | undefined;
}

export function findOpenPosition(store: Store, idOrMint: string): PositionRow | undefined {
  const asId = Number(idOrMint);
  if (Number.isInteger(asId) && asId > 0 && String(asId) === idOrMint.trim()) {
    const row = getPosition(store, asId);
    return row?.status === "open" ? row : undefined;
  }
  return store.db
    .prepare("SELECT * FROM positions WHERE mint = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
    .get(idOrMint) as PositionRow | undefined;
}

export function listFills(store: Store, positionId: number) {
  return store.db
    .prepare("SELECT * FROM fills WHERE position_id = ? ORDER BY id")
    .all(positionId) as Array<{
    id: number;
    position_id: number;
    at: number;
    side: string;
    sol: number;
    tokens: number;
    price_usd: number;
    reason: string;
    tx: string | null;
    paper: number;
  }>;
}

export interface PositionRow {
  id: number;
  mint: string;
  ticker: string;
  mode: string;
  opened_at: number;
  closed_at: number | null;
  entry_price_usd: number;
  principal_sol: number;
  tokens_held: number;
  tokens_initial: number;
  sol_spent: number;
  principal_recovered_sol: number;
  runner_pnl_sol: number;
  fees_sol: number;
  net_sol: number | null;
  peak_price_usd: number;
  ever_green: number;
  runner: number;
  last_pattern: string | null;
  pattern_path: string;
  healthy_dip_since: number | null;
  status: string;
  sources_json: string;
  entry_metrics_json: string;
  thesis: string | null;
  score: number | null;
  exit_reason: string | null;
  exit_tx: string | null;
  entry_tx: string | null;
  grade: string | null;
  grade_note: string | null;
  healthy_dip_used: number;
  post_exit_price_usd: number | null;
  mistake: string | null;
}

export function updatePosition(store: Store, id: number, patch: Record<string, unknown>): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  store.db.prepare(`UPDATE positions SET ${sets} WHERE id = ?`).run(...keys.map((k) => patch[k] as string | number | null), id);
}

export function insertFill(
  store: Store,
  fill: {
    positionId: number;
    at: number;
    side: "buy" | "sell";
    sol: number;
    tokens: number;
    priceUsd: number;
    reason: string;
    tx?: string;
    paper: boolean;
  },
): void {
  store.db
    .prepare(
      `INSERT INTO fills (position_id, at, side, sol, tokens, price_usd, reason, tx, paper)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(fill.positionId, fill.at, fill.side, fill.sol, fill.tokens, fill.priceUsd, fill.reason, fill.tx ?? null, fill.paper ? 1 : 0);
}

export function insertTape(
  store: Store,
  row: {
    positionId: number;
    at: number;
    snapshotJson: string;
    pattern?: Pattern | null;
    action?: string;
    reason?: string;
  },
): void {
  store.db
    .prepare("INSERT INTO tape (position_id, at, snapshot_json, pattern, action, reason) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.positionId, row.at, row.snapshotJson, row.pattern ?? null, row.action ?? null, row.reason ?? null);
}

export function listTape(store: Store, positionId: number, limit = 20) {
  return store.db
    .prepare("SELECT * FROM tape WHERE position_id = ? ORDER BY id DESC LIMIT ?")
    .all(positionId, limit) as Array<{
    id: number;
    at: number;
    snapshot_json: string;
    pattern: string | null;
    action: string | null;
    reason: string | null;
  }>;
}

export function insertDecision(
  store: Store,
  d: {
    at: number;
    kind: string;
    mint: string;
    allowed: boolean;
    reason: string;
    score?: number;
    pattern?: string;
    payload?: Record<string, unknown>;
  },
): void {
  store.db
    .prepare(
      `INSERT INTO decisions (at, kind, mint, allowed, reason, score, pattern, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(d.at, d.kind, d.mint, d.allowed ? 1 : 0, d.reason, d.score ?? null, d.pattern ?? null, d.payload ? JSON.stringify(d.payload) : null);
}

export function insertSourceHit(
  store: Store,
  hit: {
    at: number;
    platform: string;
    key: string;
    weight: string;
    mint?: string;
    ticker?: string;
    permalink?: string;
    snippet: string;
  },
): void {
  store.db
    .prepare(
      `INSERT INTO source_hits (at, platform, key, weight, mint, ticker, permalink, snippet)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(hit.at, hit.platform, hit.key, hit.weight, hit.mint ?? null, hit.ticker ?? null, hit.permalink ?? null, hit.snippet);
}

export function recentSourceHits(store: Store, since: number) {
  return store.db.prepare("SELECT * FROM source_hits WHERE at >= ? ORDER BY id DESC").all(since) as Array<{
    id: number;
    at: number;
    platform: string;
    key: string;
    weight: string;
    mint: string | null;
    ticker: string | null;
    permalink: string | null;
    snippet: string;
  }>;
}

export function getBudget(store: Store, day: string) {
  const row = store.db.prepare("SELECT * FROM budget WHERE day_key = ?").get(day) as
    | {
        day_key: string;
        spent_sol: number;
        trades: number;
        realized_loss_sol: number;
        last_entry_at: number;
        extra_budget_sol: number;
      }
    | undefined;
  return (
    row ?? {
      day_key: day,
      spent_sol: 0,
      trades: 0,
      realized_loss_sol: 0,
      last_entry_at: 0,
      extra_budget_sol: 0,
    }
  );
}

export function upsertBudget(
  store: Store,
  row: {
    day_key: string;
    spent_sol: number;
    trades: number;
    realized_loss_sol: number;
    last_entry_at: number;
    extra_budget_sol: number;
  },
): void {
  store.db
    .prepare(
      `INSERT INTO budget (day_key, spent_sol, trades, realized_loss_sol, last_entry_at, extra_budget_sol)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(day_key) DO UPDATE SET
         spent_sol = excluded.spent_sol,
         trades = excluded.trades,
         realized_loss_sol = excluded.realized_loss_sol,
         last_entry_at = excluded.last_entry_at,
         extra_budget_sol = excluded.extra_budget_sol`,
    )
    .run(row.day_key, row.spent_sol, row.trades, row.realized_loss_sol, row.last_entry_at, row.extra_budget_sol);
}

export function listClosedSince(store: Store, since: number) {
  return asRows<PositionRow[]>(
    store.db
      .prepare("SELECT * FROM positions WHERE status = 'closed' AND COALESCE(closed_at, opened_at) >= ? ORDER BY id DESC")
      .all(since),
  );
}

export function listAllClosed(store: Store) {
  return asRows<PositionRow[]>(store.db.prepare("SELECT * FROM positions WHERE status = 'closed' ORDER BY id DESC").all());
}

export function gradePosition(store: Store, id: number, grade: Grade, note: string): void {
  store.db.prepare("UPDATE positions SET grade = ?, grade_note = ? WHERE id = ?").run(grade, note, id);
}

export function addSuggestion(store: Store, text: string): void {
  store.db.prepare("INSERT INTO suggestions (at, text, consumed) VALUES (?, ?, 0)").run(Date.now(), text);
}

export function listSuggestions(store: Store) {
  return asRows<Array<{ id: number; at: number; text: string }>>(
    store.db.prepare("SELECT * FROM suggestions WHERE consumed = 0 ORDER BY id DESC").all(),
  );
}

export function recentDecisions(store: Store, mint: string, limit = 15) {
  return asRows<
    Array<{
      id: number;
      at: number;
      kind: string;
      allowed: number;
      reason: string;
      score: number | null;
      pattern: string | null;
      payload_json: string | null;
    }>
  >(store.db.prepare("SELECT * FROM decisions WHERE mint = ? ORDER BY id DESC LIMIT ?").all(mint, limit));
}

const STARTER_TODOS = [
  "Connect the GitHub plugin / sign in so this repo can open PRs",
  "Paper-buy a watchlist mint from Trade (MODE stays PAPER)",
  "Grade a paper fill win / meh / fail on Improve",
  "Toggle extra rules on Improve and leave a lesson",
  "Add a hot-wallet public key (secret stays on the server)",
  "Run the Auditor bug scan from Crew or Home",
  "Set DASHBOARD_PASSWORD in .env so login is not a generated file",
  "Read paper vs live before ever setting MASTER_ENABLED=true",
];

function seedStarterTodos(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS c FROM todos").get() as { c: number };
  if (row.c > 0) return;
  const ins = db.prepare("INSERT INTO todos (title, done, sort, created_at) VALUES (?, 0, ?, ?)");
  const now = Date.now();
  STARTER_TODOS.forEach((title, i) => ins.run(title, i, now));
}

export interface WalletRow {
  id: number;
  label: string;
  public_key: string;
  has_secret: number;
  assigned_desk: string;
  created_at: number;
}

export function listWallets(store: Store): WalletRow[] {
  return asRows<WalletRow[]>(store.db.prepare("SELECT * FROM wallets ORDER BY id").all());
}

export function insertWallet(
  store: Store,
  w: { label: string; publicKey: string; hasSecret: boolean; assignedDesk: string },
): WalletRow {
  const result = store.db
    .prepare("INSERT INTO wallets (label, public_key, has_secret, assigned_desk, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(w.label, w.publicKey, w.hasSecret ? 1 : 0, w.assignedDesk, Date.now());
  const id = Number(result.lastInsertRowid);
  return getWallet(store, id)!;
}

export function getWallet(store: Store, id: number): WalletRow | undefined {
  return store.db.prepare("SELECT * FROM wallets WHERE id = ?").get(id) as WalletRow | undefined;
}

export function updateWalletSecretFlag(store: Store, id: number, hasSecret: boolean): void {
  store.db.prepare("UPDATE wallets SET has_secret = ? WHERE id = ?").run(hasSecret ? 1 : 0, id);
}

export function deleteWallet(store: Store, id: number): boolean {
  const r = store.db.prepare("DELETE FROM wallets WHERE id = ?").run(id);
  return r.changes > 0;
}

export interface TodoRow {
  id: number;
  title: string;
  done: number;
  sort: number;
  created_at: number;
}

export function listTodos(store: Store): TodoRow[] {
  return asRows<TodoRow[]>(store.db.prepare("SELECT * FROM todos ORDER BY sort, id").all());
}

export function insertTodo(store: Store, title: string): TodoRow {
  const sortRow = store.db.prepare("SELECT COALESCE(MAX(sort), -1) AS m FROM todos").get() as { m: number };
  const result = store.db
    .prepare("INSERT INTO todos (title, done, sort, created_at) VALUES (?, 0, ?, ?)")
    .run(title, sortRow.m + 1, Date.now());
  return store.db.prepare("SELECT * FROM todos WHERE id = ?").get(Number(result.lastInsertRowid)) as unknown as TodoRow;
}

export function setTodoDone(store: Store, id: number, done: boolean): TodoRow | undefined {
  store.db.prepare("UPDATE todos SET done = ? WHERE id = ?").run(done ? 1 : 0, id);
  return store.db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as unknown as TodoRow | undefined;
}

export function deleteTodo(store: Store, id: number): boolean {
  return store.db.prepare("DELETE FROM todos WHERE id = ?").run(id).changes > 0;
}

export interface FeedbackRow {
  id: number;
  at: number;
  text: string;
  kind: string;
}

export function listFeedback(store: Store, limit = 40): FeedbackRow[] {
  return asRows<FeedbackRow[]>(store.db.prepare("SELECT * FROM feedback ORDER BY id DESC LIMIT ?").all(limit));
}

export function insertFeedback(store: Store, text: string, kind = "improve"): FeedbackRow {
  const result = store.db.prepare("INSERT INTO feedback (at, text, kind) VALUES (?, ?, ?)").run(Date.now(), text, kind);
  return store.db.prepare("SELECT * FROM feedback WHERE id = ?").get(Number(result.lastInsertRowid)) as unknown as FeedbackRow;
}

export interface AuditorScanRow {
  id: number;
  at: number;
  ok: number;
  summary: string;
  details_json: string;
}

export function insertAuditorScan(
  store: Store,
  scan: { ok: boolean; summary: string; details: unknown },
): AuditorScanRow {
  store.db
    .prepare("INSERT INTO auditor_scans (at, ok, summary, details_json) VALUES (?, ?, ?, ?)")
    .run(Date.now(), scan.ok ? 1 : 0, scan.summary, JSON.stringify(scan.details));
  return lastAuditorScan(store)!;
}

export function lastAuditorScan(store: Store): AuditorScanRow | undefined {
  return store.db.prepare("SELECT * FROM auditor_scans ORDER BY id DESC LIMIT 1").get() as AuditorScanRow | undefined;
}

export function listAuditorScans(store: Store, limit = 10): AuditorScanRow[] {
  return asRows<AuditorScanRow[]>(store.db.prepare("SELECT * FROM auditor_scans ORDER BY id DESC LIMIT ?").all(limit));
}

export function listRecentPositions(store: Store, limit = 40): PositionRow[] {
  return asRows<PositionRow[]>(store.db.prepare("SELECT * FROM positions ORDER BY id DESC LIMIT ?").all(limit));
}

export function listUngradedClosed(store: Store, limit = 20): PositionRow[] {
  return asRows<PositionRow[]>(
    store.db
      .prepare("SELECT * FROM positions WHERE status = 'closed' AND (grade IS NULL OR grade = '') ORDER BY id DESC LIMIT ?")
      .all(limit),
  );
}
