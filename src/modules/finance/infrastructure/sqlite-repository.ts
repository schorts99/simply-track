import type { Database, SqlJsStatic } from "sql.js";
import type { FinanceRepository } from "../application/finance-service";
import { FinanceBook, type FinanceState } from "../domain/finance";

export class SqliteFinanceRepository implements FinanceRepository {
  constructor(private db: Database, private readonly persist: (bytes: Uint8Array) => Promise<void>) {}
  static create(sql: SqlJsStatic, state: FinanceState) {
    const db = new sql.Database();
    db.run(`
      PRAGMA user_version = 1;
      CREATE TABLE book (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);
      CREATE TABLE transactions (id TEXT PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), data TEXT NOT NULL);
      CREATE INDEX transactions_date ON transactions(date);
      CREATE TABLE budgets (id TEXT PRIMARY KEY, category TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE goals (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE scenarios (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE domain_events (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL);
    `);
    db.run("INSERT INTO book VALUES (1, ?)", [JSON.stringify(state)]);
    return db;
  }
  static validate(db: Database): FinanceState {
    const version = db.exec("PRAGMA user_version")[0]?.values[0]?.[0];
    if (version !== 1) throw new Error("Unsupported SQLite schema version. Update SimplyTrack before opening this vault.");
    const integrity = db.exec("PRAGMA quick_check")[0]?.values[0]?.[0];
    if (integrity !== "ok") throw new Error("The SQLite database is damaged.");
    const value = db.exec("SELECT data FROM book WHERE id = 1")[0]?.values[0]?.[0];
    if (typeof value !== "string") throw new Error("The vault has no finance book.");
    const state = JSON.parse(value) as FinanceState;
    return new FinanceBook(state).toPrimitives();
  }
  async load(): Promise<FinanceState> { return SqliteFinanceRepository.validate(this.db); }
  async save(state: FinanceState, events: ReturnType<FinanceBook["pullDomainEvents"]>) {
    const previous = this.db.export();
    this.db.run("BEGIN");
    try {
      this.db.run("UPDATE book SET data = ? WHERE id = 1", [JSON.stringify(state)]);
      for (const table of ["transactions", "budgets", "goals", "scenarios"]) this.db.run(`DELETE FROM ${table}`);
      state.transactions.forEach((t) => this.db.run("INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?)", [t.id, t.date, t.type, t.category, t.amount, JSON.stringify(t)]));
      state.budgets.forEach((b) => this.db.run("INSERT INTO budgets VALUES (?, ?, ?)", [b.id, b.category, JSON.stringify(b)]));
      state.goals.forEach((g) => this.db.run("INSERT INTO goals VALUES (?, ?)", [g.id, JSON.stringify(g)]));
      state.scenarios.forEach((s) => this.db.run("INSERT INTO scenarios VALUES (?, ?)", [s.id, JSON.stringify(s)]));
      events.forEach((event) => this.db.run("INSERT INTO domain_events VALUES (?, ?, ?)", [event.id, event.getEventName(), JSON.stringify(event.toPrimitives())]));
      this.db.run("COMMIT");
      await this.persist(this.db.export());
    } catch (error) {
      // Restore memory too: a failed device write must never look like a saved edit.
      this.db.close();
      const sql = await loadSqlite();
      this.db = new sql.Database(previous);
      throw error;
    }
  }
  export() { return this.db.export(); }
  close() { this.db.close(); }
}
let sqlite: Promise<SqlJsStatic> | undefined;
export function loadSqlite() {
  sqlite ??= import("sql.js").then(({ default: init }) => typeof window === "undefined" ? init() : init({ locateFile: () => "/sqlite/sql-wasm.wasm" }));
  return sqlite;
}
