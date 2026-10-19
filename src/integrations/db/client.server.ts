// Native PostgreSQL pool and small typed query helper used by server modules.
// This module has no remote provider or external auth/storage backend.

import { Pool, type QueryResult } from "pg";
import { storage as localStorage } from "./storage";

let _pool: Pool | undefined;

function getPool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) throw new Error("[db] DATABASE_URL is required");
  const max = Number(process.env["PG_POOL_MAX"] ?? 5);
  if (!Number.isSafeInteger(max) || max < 1 || max > 20) {
    throw new Error("[db] PG_POOL_MAX must be an integer between 1 and 20");
  }
  _pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
  });
  _pool.on("error", (err) => console.error("[db] pool error", err));
  if (process.env["DEBUG_LOGS"])
    console.log(`[db] Using PostgreSQL (${connectionString.replace(/:.*@/, ":***@")})`);
  return _pool;
}

/** Fail fast during server startup when the required database setting is absent. */
export function assertDatabaseConfigured(): void {
  if (!process.env["DATABASE_URL"]) throw new Error("[db] DATABASE_URL is required");
}

/** For tests and development hot reload. */
export function _resetPool(): void {
  _pool = undefined;
}

/** Inject an isolated PostgreSQL-compatible client in tests. */
export function _setPoolForTests(pool: Pool | undefined): void {
  _pool = pool;
}

/** Expose the native pool for explicit transactional operations. */
export function getPoolRaw(): Pool {
  return getPool();
}

// ── Native PostgreSQL query surface ────────────────────────────────

interface DbError {
  code?: string;
  message?: string;
}

interface DbQueryBuilder extends PromiseLike<{ data: unknown; error: DbError | null }> {
  select(cols?: string, opts?: Record<string, unknown>): DbQueryBuilder;
  insert(data: unknown): DbQueryBuilder;
  upsert(data: unknown, opts?: { onConflict?: string; ignoreDuplicates?: boolean }): DbQueryBuilder;
  update(data: Record<string, unknown>): DbQueryBuilder;
  delete(): DbQueryBuilder;
  eq(col: string, val: unknown): DbQueryBuilder;
  gte(col: string, val: unknown): DbQueryBuilder;
  ilike(col: string, val: string): DbQueryBuilder;
  is(col: string, val: unknown): DbQueryBuilder;
  in(col: string, vals: unknown[]): DbQueryBuilder;
  order(col: string, opts?: { ascending?: boolean }): DbQueryBuilder;
  limit(n: number): DbQueryBuilder;
  range(from: number, to: number): DbQueryBuilder;
  maybeSingle(): DbQueryBuilder;
  single(): DbQueryBuilder;
}

type DbLike = {
  from(table: string): DbQueryBuilder;
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: DbError | null }>;
};

const _db = createNativePgClient();
export const storage = localStorage;
export const db: DbLike & { storage: typeof localStorage } = Object.assign(_db, { storage });

// ── Internal PostgreSQL query helper ───────────────────────────────

function createNativePgClient(): DbLike {
  type Filter =
    | { type: "eq"; col: string; val: unknown }
    | { type: "gte"; col: string; val: unknown }
    | { type: "ilike"; col: string; val: string }
    | { type: "is"; col: string; val: unknown }
    | { type: "in"; col: string; vals: unknown[] };

  class QueryBuilder implements PromiseLike<{ data: unknown; error: DbError | null }> {
    private table: string;
    private op: "select" | "insert" | "update" | "delete" = "select";
    private selectCols: string = "*";
    private filters: Filter[] = [];
    private orders: Array<{ col: string; ascending: boolean }> = [];
    private limitOne: boolean = false;
    private maxRows: number | null = null;
    private rangeStart = 0;
    private rangeSize: number | null = null;
    private expectSingle: boolean = false;
    private expectAtMostOne: boolean = false;
    private insertData: unknown = null;
    private updateData: Record<string, unknown> | null = null;
    private returning: string | null = null;
    private conflictTarget: string | null = null;
    private ignoreDuplicates = false;

    constructor(table: string) {
      this.table = table;
    }

    select(cols: string = "*"): this {
      if (this.op === "insert" || this.op === "update" || this.op === "delete") {
        this.returning = cols;
        return this;
      }
      this.op = "select";
      this.selectCols = cols;
      return this;
    }

    insert(data: unknown): this {
      this.op = "insert";
      this.insertData = data;
      this.returning = "*";
      return this;
    }

    upsert(data: unknown, opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
      this.op = "insert";
      this.insertData = data;
      this.returning = "*";
      this.conflictTarget = opts?.onConflict ?? null;
      this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
      return this;
    }

    update(data: Record<string, unknown>): this {
      this.op = "update";
      this.updateData = data;
      this.returning = null;
      return this;
    }

    delete(): this {
      this.op = "delete";
      this.returning = null;
      return this;
    }

    eq(col: string, val: unknown): this {
      this.filters.push({ type: "eq", col, val });
      return this;
    }

    gte(col: string, val: unknown): this {
      this.filters.push({ type: "gte", col, val });
      return this;
    }

    ilike(col: string, val: string): this {
      this.filters.push({ type: "ilike", col, val });
      return this;
    }

    is(col: string, val: unknown): this {
      this.filters.push({ type: "is", col, val });
      return this;
    }

    in(col: string, vals: unknown[]): this {
      this.filters.push({ type: "in", col, vals });
      return this;
    }

    order(col: string, opts?: { ascending?: boolean }): this {
      this.orders.push({ col, ascending: opts?.ascending ?? true });
      return this;
    }

    limit(n: number): this {
      if (!Number.isSafeInteger(n) || n < 0 || n > 10_000) {
        throw new Error("Invalid query limit");
      }
      this.maxRows = n;
      return this;
    }

    range(from: number, to: number): this {
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from)
        throw new Error("Invalid query range");
      this.rangeStart = from;
      this.rangeSize = to - from + 1;
      return this;
    }

    maybeSingle(): this {
      this.limitOne = true;
      this.maxRows = 2;
      this.expectSingle = false;
      this.expectAtMostOne = true;
      return this;
    }

    single(): this {
      this.limitOne = true;
      this.maxRows = 2;
      this.expectSingle = true;
      this.expectAtMostOne = true;
      return this;
    }

    then<TResult1 = { data: unknown; error: DbError | null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: unknown; error: DbError | null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return this.execute().then(onfulfilled, onrejected);
    }

    private async execute(): Promise<{ data: unknown; error: DbError | null }> {
      try {
        const pool = getPool();
        return await this.run(pool);
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };
        return {
          data: null,
          error: { code: err?.code ?? "UNKNOWN", message: err?.message ?? String(e) },
        };
      }
    }

    private async run(pool: Pool): Promise<{ data: unknown; error: DbError | null }> {
      if (!/^[a-z_][a-z0-9_]*$/i.test(this.table)) {
        throw new Error("Invalid table identifier");
      }
      const table = `public.${qi(this.table)}`;
      const params: unknown[] = [];
      let idx = 1;

      const projection = (value: string): string => {
        if (value.trim() === "*") return "*";
        const columns = value.split(",").map((column) => column.trim());
        if (!columns.length || columns.some((column) => !column)) {
          throw new Error("Invalid column projection");
        }
        return columns.map(qi).join(", ");
      };

      const whereClause = (): string => {
        if (!this.filters.length) return "";
        const parts = this.filters.map((f) => {
          if (f.type === "eq") {
            params.push(f.val);
            return `${qi(f.col)} = $${idx++}`;
          }
          if (f.type === "gte") {
            params.push(f.val);
            return `${qi(f.col)} >= $${idx++}`;
          }
          if (f.type === "ilike") {
            params.push(f.val);
            return `${qi(f.col)} ILIKE $${idx++}`;
          }
          if (f.type === "is") {
            if (f.val === null) return `${qi(f.col)} IS NULL`;
            params.push(f.val);
            return `${qi(f.col)} IS NOT DISTINCT FROM $${idx++}`;
          }
          if (f.type === "in") {
            if (!f.vals.length) return "FALSE";
            const ph = f.vals.map((v) => {
              params.push(v);
              return `$${idx++}`;
            });
            return `${qi(f.col)} IN (${ph.join(", ")})`;
          }
          return "";
        });
        return `WHERE ${parts.join(" AND ")}`;
      };

      const orderClause = (): string =>
        this.orders.length
          ? `ORDER BY ${this.orders.map((o) => `${qi(o.col)} ${o.ascending ? "ASC" : "DESC"}`).join(", ")}`
          : "";

      const returningClause = (): string => {
        if (!this.returning) return "";
        return `RETURNING ${projection(this.returning)}`;
      };

      if (this.op === "select") {
        const cols = projection(this.selectCols);
        const sql =
          `SELECT ${cols} FROM ${table} ${whereClause()} ${orderClause()} ${this.rangeSize == null ? (this.maxRows == null ? "" : `LIMIT ${this.maxRows}`) : `LIMIT ${this.rangeSize} OFFSET ${this.rangeStart}`}`.trim();
        const res: QueryResult = await pool.query(sql + ";", params);
        if (this.limitOne) {
          if (this.expectAtMostOne && res.rows.length > 1) {
            return {
              data: null,
              error: { code: "TOO_MANY_ROWS", message: "More than one row found" },
            };
          }
          if (!res.rows.length) {
            if (this.expectSingle)
              return { data: null, error: { code: "NO_ROWS", message: "No rows found" } };
            return { data: null, error: null };
          }
          return { data: res.rows[0], error: null };
        }
        return { data: res.rows, error: null };
      }

      if (this.op === "insert") {
        const rows = Array.isArray(this.insertData) ? this.insertData : [this.insertData];
        if (!rows.length) return { data: [], error: null };
        const keys = Object.keys(rows[0] as Record<string, unknown>);
        if (
          !keys.length ||
          rows.some((row) => {
            const rowKeys = Object.keys(row as Record<string, unknown>);
            return rowKeys.length !== keys.length || keys.some((key) => !rowKeys.includes(key));
          })
        ) {
          throw new Error("Invalid insert rows");
        }
        const colsSql = keys.map(qi).join(", ");
        const valuesSql = rows
          .map((row) => {
            const vals = keys.map((k) => {
              params.push((row as Record<string, unknown>)[k]);
              return `$${idx++}`;
            });
            return `(${vals.join(", ")})`;
          })
          .join(", ");
        let conflictClause = "";
        if (this.conflictTarget) {
          const targetSql = this.conflictTarget
            .split(",")
            .map((c) => qi(c.trim()))
            .join(", ");
          if (this.ignoreDuplicates) {
            conflictClause = ` ON CONFLICT (${targetSql}) DO NOTHING`;
          } else {
            // An explicit conflict target updates non-key columns unless the
            // caller asked to ignore duplicates.
            const conflictCols = new Set(this.conflictTarget.split(",").map((c) => c.trim()));
            const setSql = keys
              .filter((k) => !conflictCols.has(k))
              .map((k) => `${qi(k)} = EXCLUDED.${qi(k)}`)
              .join(", ");
            conflictClause = setSql
              ? ` ON CONFLICT (${targetSql}) DO UPDATE SET ${setSql}`
              : ` ON CONFLICT (${targetSql}) DO NOTHING`;
          }
        }
        const sql =
          `INSERT INTO ${table} (${colsSql}) VALUES ${valuesSql}${conflictClause} ${returningClause()};`.trim();
        const res = await pool.query(sql, params);
        if (this.limitOne) {
          if (this.expectAtMostOne && res.rows.length > 1) {
            return {
              data: null,
              error: { code: "TOO_MANY_ROWS", message: "More than one row found" },
            };
          }
          if (!res.rows.length) {
            if (this.expectSingle)
              return { data: null, error: { code: "NO_ROWS", message: "No rows found" } };
            return { data: null, error: null };
          }
          return { data: res.rows[0], error: null };
        }
        return { data: res.rows, error: null };
      }

      if (this.op === "update") {
        const data = this.updateData ?? {};
        const keys = Object.keys(data);
        if (!keys.length) return { data: [], error: null };
        const setSql = keys
          .map((k) => {
            params.push(data[k]);
            return `${qi(k)} = $${idx++}`;
          })
          .join(", ");
        const where = whereClause();
        const sql = `UPDATE ${table} SET ${setSql} ${where} ${returningClause()};`.trim();
        const res = await pool.query(sql, params);
        if (this.returning) {
          if (this.limitOne) {
            if (this.expectAtMostOne && res.rows.length > 1) {
              return {
                data: null,
                error: { code: "TOO_MANY_ROWS", message: "More than one row found" },
              };
            }
            if (!res.rows.length) {
              if (this.expectSingle)
                return { data: null, error: { code: "NO_ROWS", message: "No rows found" } };
              return { data: null, error: null };
            }
            return { data: res.rows[0], error: null };
          }
          return { data: res.rows, error: null };
        }
        return { data: res.rows, error: null };
      }

      if (this.op === "delete") {
        const where = whereClause();
        if (!where) throw new Error("Delete without WHERE is not allowed");
        const sql = `DELETE FROM ${table} ${where} ${returningClause()};`.trim();
        const res = await pool.query(sql, params);
        if (this.returning) {
          if (this.limitOne) {
            if (this.expectAtMostOne && res.rows.length > 1) {
              return {
                data: null,
                error: { code: "TOO_MANY_ROWS", message: "More than one row found" },
              };
            }
            if (!res.rows.length) {
              if (this.expectSingle)
                return { data: null, error: { code: "NO_ROWS", message: "No rows found" } };
              return { data: null, error: null };
            }
            return { data: res.rows[0], error: null };
          }
          return { data: res.rows, error: null };
        }
        return { data: res.rows, error: null };
      }

      return { data: null, error: { code: "UNKNOWN", message: `Unknown op ${this.op}` } };
    }
  }

  function qi(ident: string): string {
    if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/i.test(ident)) {
      throw new Error("Invalid column identifier");
    }
    return ident
      .split(".")
      .map((p) => `"${p.replace(/"/g, '""')}"`)
      .join(".");
  }

  return {
    from(table: string) {
      return new QueryBuilder(table);
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
        return { data: null, error: { code: "INVALID_FUNCTION", message: "Invalid RPC name" } };
      }
      const keys = Object.keys(args);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      try {
        const result = await getPool().query(
          `SELECT * FROM public."${name}"(${placeholders});`,
          keys.map((key) => args[key]),
        );
        return { data: result.rows, error: null };
      } catch (error) {
        const e = error as { code?: string; message?: string };
        return {
          data: null,
          error: { code: e.code ?? "DATABASE_ERROR", message: e.message ?? "RPC failed" },
        };
      }
    },
  };
}
