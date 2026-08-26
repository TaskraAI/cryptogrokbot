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
      day_key TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'PAPER',
      spent_sol REAL NOT NULL DEFAULT 0,
      trades INTEGER NOT NULL DEFAULT 0,
      realized_loss_sol REAL NOT NULL DEFAULT 0,
      last_entry_at INTEGER NOT NULL DEFAULT 0,
      extra_budget_sol REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (day_key, mode)
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

    CREATE TABLE IF NOT EXISTS size_asks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      mint TEXT NOT NULL,
      ticker TEXT NOT NULL,
      sentiment REAL NOT NULL,
      test_sol REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      chosen_sol REAL,
      answered_at INTEGER,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS challenge_ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      venue TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      side TEXT NOT NULL DEFAULT '',
      size_usd REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'watch',
      rung_from INTEGER NOT NULL DEFAULT 100,
      rung_to INTEGER NOT NULL DEFAULT 5000
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      mint TEXT NOT NULL,
      ticker TEXT NOT NULL,
      sentiment REAL NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0,
      volume5m REAL NOT NULL DEFAULT 0,
      price_usd REAL NOT NULL DEFAULT 0,
      cost_out_multiple REAL NOT NULL DEFAULT 2,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      note TEXT NOT NULL DEFAULT '',
      resolved_at INTEGER,
      post_price_usd REAL,
      multiple_seen REAL,
      chief_approved INTEGER NOT NULL DEFAULT 0
    );
  `);
  migrateBudgetByMode(db);
  ensureColumn(db, "positions", "cost_out_multiple", "REAL NOT NULL DEFAULT 2");
  ensureColumn(db, "opportunities", "chief_approved", "INTEGER NOT NULL DEFAULT 0");
  seedStarterTodos(db);
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(cols.map((c) => c.name));
}

function ensureColumn(db: DatabaseSync, table: string, name: string, ddl: string): void {
  if (tableColumns(db, table).has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

function budgetColumns(db: DatabaseSync): Set<string> {
  return tableColumns(db, "budget");
}

/** Old DBs had one ledger per day. Mixed spend was paper; LIVE must start at 0. */
function migrateBudgetByMode(db: DatabaseSync): void {
  const cols = budgetColumns(db);
  if (cols.has("mode")) return;
  db.exec(`
    CREATE TABLE budget_by_mode (
      day_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      spent_sol REAL NOT NULL DEFAULT 0,
      trades INTEGER NOT NULL DEFAULT 0,
      realized_loss_sol REAL NOT NULL DEFAULT 0,
      last_entry_at INTEGER NOT NULL DEFAULT 0,
      extra_budget_sol REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (day_key, mode)
    );
    INSERT INTO budget_by_mode (day_key, mode, spent_sol, trades, realized_loss_sol, last_entry_at, extra_budget_sol)
    SELECT day_key, 'PAPER', spent_sol, trades, realized_loss_sol, last_entry_at, extra_budget_sol FROM budget;
    DROP TABLE budget;
    ALTER TABLE budget_by_mode RENAME TO budget;
  `);
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
  costOutMultiple?: number;
}

export function insertPosition(store: Store, p: NewPosition): number {
  const result = store.db
    .prepare(
      `INSERT INTO positions (
        mint, ticker, mode, opened_at, entry_price_usd, principal_sol,
        tokens_held, tokens_initial, sol_spent, peak_price_usd, sources_json,
        entry_metrics_json, thesis, score, entry_tx, cost_out_multiple
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      p.costOutMultiple ?? 2,
    );
  return Number(result.lastInsertRowid);
}

function asRows<T>(rows: unknown): T {
  return rows as T;
}

export function listOpenPositions(store: Store, mode?: Mode) {
  if (mode) {
    return asRows<PositionRow[]>(
      store.db.prepare("SELECT * FROM positions WHERE status = 'open' AND mode = ? ORDER BY id").all(mode),
    );
  }
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
  cost_out_multiple: number;
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

export interface BudgetRow {
  day_key: string;
  mode: Mode;
  spent_sol: number;
  trades: number;
  realized_loss_sol: number;
  last_entry_at: number;
  extra_budget_sol: number;
}

export function getBudget(store: Store, day: string, mode: Mode): BudgetRow {
  const row = store.db.prepare("SELECT * FROM budget WHERE day_key = ? AND mode = ?").get(day, mode) as
    | BudgetRow
    | undefined;
  return (
    row ?? {
      day_key: day,
      mode,
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
    mode: Mode;
    spent_sol: number;
    trades: number;
    realized_loss_sol: number;
    last_entry_at: number;
    extra_budget_sol: number;
  },
): void {
  store.db
    .prepare(
      `INSERT INTO budget (day_key, mode, spent_sol, trades, realized_loss_sol, last_entry_at, extra_budget_sol)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day_key, mode) DO UPDATE SET
         spent_sol = excluded.spent_sol,
         trades = excluded.trades,
         realized_loss_sol = excluded.realized_loss_sol,
         last_entry_at = excluded.last_entry_at,
         extra_budget_sol = excluded.extra_budget_sol`,
    )
    .run(row.day_key, row.mode, row.spent_sol, row.trades, row.realized_loss_sol, row.last_entry_at, row.extra_budget_sol);
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

export type SizeAskStatus = "pending" | "keep" | "increase" | "filled" | "expired";

export interface SizeAskRow {
  id: number;
  at: number;
  mint: string;
  ticker: string;
  sentiment: number;
  test_sol: number;
  status: SizeAskStatus;
  chosen_sol: number | null;
  answered_at: number | null;
  note: string;
}

const SIZE_ASK_TTL_MS = 45 * 60 * 1000;

export function expireOldSizeAsks(store: Store, now = Date.now()): void {
  store.db
    .prepare("UPDATE size_asks SET status = 'expired' WHERE status = 'pending' AND at < ?")
    .run(now - SIZE_ASK_TTL_MS);
}

export function listPendingSizeAsks(store: Store): SizeAskRow[] {
  expireOldSizeAsks(store);
  return asRows<SizeAskRow[]>(
    store.db.prepare("SELECT * FROM size_asks WHERE status = 'pending' ORDER BY id DESC").all(),
  );
}

export function getSizeAsk(store: Store, id: number): SizeAskRow | undefined {
  return store.db.prepare("SELECT * FROM size_asks WHERE id = ?").get(id) as SizeAskRow | undefined;
}

export function latestOpenSizeAsk(store: Store, mint: string): SizeAskRow | undefined {
  expireOldSizeAsks(store);
  return store.db
    .prepare(
      "SELECT * FROM size_asks WHERE mint = ? AND status IN ('pending','keep','increase') ORDER BY id DESC LIMIT 1",
    )
    .get(mint) as SizeAskRow | undefined;
}

export function insertSizeAsk(
  store: Store,
  row: { mint: string; ticker: string; sentiment: number; testSol: number; note: string },
): SizeAskRow {
  const result = store.db
    .prepare(
      "INSERT INTO size_asks (at, mint, ticker, sentiment, test_sol, status, note) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
    )
    .run(Date.now(), row.mint, row.ticker, row.sentiment, row.testSol, row.note);
  return getSizeAsk(store, Number(result.lastInsertRowid))!;
}

export function answerSizeAsk(
  store: Store,
  id: number,
  answer: { status: "keep" | "increase"; chosenSol: number },
): SizeAskRow | undefined {
  const result = store.db
    .prepare("UPDATE size_asks SET status = ?, chosen_sol = ?, answered_at = ? WHERE id = ? AND status = 'pending'")
    .run(answer.status, answer.chosenSol, Date.now(), id);
  if (!result.changes) return undefined;
  return getSizeAsk(store, id);
}

export function markSizeAskFilled(store: Store, id: number): void {
  store.db.prepare("UPDATE size_asks SET status = 'filled' WHERE id = ?").run(id);
}

export function closeSizeAsksForMint(store: Store, mint: string): void {
  store.db
    .prepare(
      "UPDATE size_asks SET status = 'filled' WHERE mint = ? AND status IN ('pending','keep','increase')",
    )
    .run(mint);
}

export type ChallengeIdeaStatus = "watch" | "paper" | "killed" | "won" | "lost";

export interface ChallengeIdeaRow {
  id: number;
  at: number;
  venue: string;
  title: string;
  url: string;
  side: string;
  size_usd: number;
  note: string;
  status: string;
  rung_from: number;
  rung_to: number;
}

export function insertChallengeIdea(
  store: Store,
  row: {
    venue: string;
    title: string;
    url?: string;
    side?: string;
    sizeUsd?: number;
    note?: string;
    status?: ChallengeIdeaStatus;
    rungFrom?: number;
    rungTo?: number;
  },
): ChallengeIdeaRow {
  const status = row.status && ["watch", "paper", "killed", "won", "lost"].includes(row.status) ? row.status : "watch";
  const result = store.db
    .prepare(
      "INSERT INTO challenge_ideas (at, venue, title, url, side, size_usd, note, status, rung_from, rung_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      Date.now(),
      row.venue.slice(0, 32),
      row.title.slice(0, 240),
      (row.url ?? "").slice(0, 500),
      (row.side ?? "").slice(0, 80),
      Number.isFinite(row.sizeUsd) ? Number(row.sizeUsd) : 0,
      (row.note ?? "").slice(0, 1000),
      status,
      Number(row.rungFrom) || 100,
      Number(row.rungTo) || 5000,
    );
  return getChallengeIdea(store, Number(result.lastInsertRowid))!;
}

export function getChallengeIdea(store: Store, id: number): ChallengeIdeaRow | undefined {
  return store.db.prepare("SELECT * FROM challenge_ideas WHERE id = ?").get(id) as ChallengeIdeaRow | undefined;
}

export function listChallengeIdeas(store: Store, limit = 40): ChallengeIdeaRow[] {
  return asRows<ChallengeIdeaRow[]>(
    store.db.prepare("SELECT * FROM challenge_ideas ORDER BY id DESC LIMIT ?").all(limit),
  );
}

export function updateChallengeIdea(
  store: Store,
  id: number,
  patch: { status?: ChallengeIdeaStatus; note?: string; sizeUsd?: number },
): ChallengeIdeaRow | undefined {
  const row = getChallengeIdea(store, id);
  if (!row) return undefined;
  const status =
    patch.status && ["watch", "paper", "killed", "won", "lost"].includes(patch.status) ? patch.status : row.status;
  const note = patch.note != null ? String(patch.note).slice(0, 1000) : row.note;
  const size = patch.sizeUsd != null && Number.isFinite(patch.sizeUsd) ? Number(patch.sizeUsd) : row.size_usd;
  store.db.prepare("UPDATE challenge_ideas SET status = ?, note = ?, size_usd = ? WHERE id = ?").run(status, note, size, id);
  return getChallengeIdea(store, id);
}

export type OpportunityStatus = "open" | "filled" | "missed" | "skipped" | "expired";

export interface OpportunityRow {
  id: number;
  at: number;
  mint: string;
  ticker: string;
  sentiment: number;
  score: number;
  volume5m: number;
  price_usd: number;
  cost_out_multiple: number;
  reason: string;
  status: OpportunityStatus;
  note: string;
  resolved_at: number | null;
  post_price_usd: number | null;
  multiple_seen: number | null;
  chief_approved: number;
}

const OPPORTUNITY_TTL_MS = 6 * 3600_000;

export function expireOldOpportunities(store: Store, now = Date.now()): void {
  store.db
    .prepare("UPDATE opportunities SET status = 'expired', resolved_at = ? WHERE status = 'open' AND at < ?")
    .run(now, now - OPPORTUNITY_TTL_MS);
}

export function getOpportunity(store: Store, id: number): OpportunityRow | undefined {
  return store.db.prepare("SELECT * FROM opportunities WHERE id = ?").get(id) as OpportunityRow | undefined;
}

export function latestOpenOpportunity(store: Store, mint: string): OpportunityRow | undefined {
  expireOldOpportunities(store);
  return store.db
    .prepare("SELECT * FROM opportunities WHERE mint = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
    .get(mint) as OpportunityRow | undefined;
}

export function listOpenOpportunities(store: Store): OpportunityRow[] {
  expireOldOpportunities(store);
  return asRows<OpportunityRow[]>(
    store.db.prepare("SELECT * FROM opportunities WHERE status = 'open' ORDER BY id DESC").all(),
  );
}

export function listOpportunities(store: Store, limit = 40): OpportunityRow[] {
  expireOldOpportunities(store);
  return asRows<OpportunityRow[]>(
    store.db.prepare("SELECT * FROM opportunities ORDER BY id DESC LIMIT ?").all(limit),
  );
}

export function insertOpportunity(
  store: Store,
  row: {
    mint: string;
    ticker: string;
    sentiment: number;
    score: number;
    volume5m: number;
    priceUsd: number;
    costOutMultiple: number;
    reason: string;
    note?: string;
  },
): OpportunityRow {
  const existing = latestOpenOpportunity(store, row.mint);
  if (existing) return existing;
  const result = store.db
    .prepare(
      `INSERT INTO opportunities (
        at, mint, ticker, sentiment, score, volume5m, price_usd, cost_out_multiple, reason, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      Date.now(),
      row.mint,
      row.ticker.slice(0, 32),
      row.sentiment,
      row.score,
      row.volume5m,
      row.priceUsd,
      row.costOutMultiple,
      row.reason.slice(0, 240),
      (row.note ?? "").slice(0, 1000),
    );
  return getOpportunity(store, Number(result.lastInsertRowid))!;
}

export function markOpportunityFilled(store: Store, mint: string): void {
  store.db
    .prepare("UPDATE opportunities SET status = 'filled', resolved_at = ? WHERE mint = ? AND status = 'open'")
    .run(Date.now(), mint);
}

export function approveOpportunity(store: Store, id: number): OpportunityRow | undefined {
  store.db.prepare("UPDATE opportunities SET chief_approved = 1 WHERE id = ? AND status = 'open'").run(id);
  return getOpportunity(store, id);
}

export function markOpportunitySkipped(store: Store, id: number): OpportunityRow | undefined {
  store.db
    .prepare("UPDATE opportunities SET status = 'skipped', resolved_at = ? WHERE id = ? AND status = 'open'")
    .run(Date.now(), id);
  return getOpportunity(store, id);
}

export function markOpportunityMissed(
  store: Store,
  id: number,
  opts: { postPriceUsd: number; multipleSeen: number; note?: string },
): void {
  store.db
    .prepare(
      "UPDATE opportunities SET status = 'missed', resolved_at = ?, post_price_usd = ?, multiple_seen = ?, note = ? WHERE id = ?",
    )
    .run(Date.now(), opts.postPriceUsd, opts.multipleSeen, (opts.note ?? "").slice(0, 1000), id);
}
