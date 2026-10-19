import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Pool } from "pg";
import { _resetPool, _setPoolForTests, db } from "./client.server";

const calls: Array<{ sql: string; values: unknown[] }> = [];
let nextRows: Record<string, unknown>[] = [];
const fakePool = {
  query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    return { rows: nextRows, rowCount: nextRows.length };
  },
} as unknown as Pool;

beforeEach(() => {
  calls.length = 0;
  nextRows = [];
  _setPoolForTests(fakePool);
});

afterEach(() => _resetPool());

describe("native PostgreSQL query bounds", () => {
  it("applies zero, one, and requested N as SQL limits", async () => {
    await db.from("query_limits").select("id").limit(0);
    await db.from("query_limits").select("id").limit(1);
    await db.from("query_limits").select("id").limit(17);

    expect(calls.map((call) => call.sql.match(/LIMIT \d+/)?.[0])).toEqual([
      "LIMIT 0",
      "LIMIT 1",
      "LIMIT 17",
    ]);
  });

  it("validates limits and uses bounded range pagination", async () => {
    expect(() => db.from("query_limits").limit(-1)).toThrow("Invalid query limit");
    expect(() => db.from("query_limits").limit(1.5)).toThrow("Invalid query limit");
    expect(() => db.from("query_limits").limit(10_001)).toThrow("Invalid query limit");

    await db.from("query_limits").select("id").order("id").range(4, 8);
    expect(calls[0]?.sql).toContain("LIMIT 5 OFFSET 4");
  });

  it("parameterizes filters and rejects SQL in the selected-column list", async () => {
    await db.from("query_limits").select("id, label").eq("id", "1 OR TRUE").limit(2);
    expect(calls[0]?.sql).toContain('"id" = $1');
    expect(calls[0]?.values).toEqual(["1 OR TRUE"]);
    expect(calls[0]?.sql).toContain("LIMIT 2");

    const invalid = await db.from("query_limits").select("id; DROP TABLE query_limits");
    expect(invalid.data).toBeNull();
    expect(invalid.error?.message).toBe("Invalid column identifier");
  });

  it("reports multiple rows when a caller requests a single result", async () => {
    nextRows = [{ id: 1 }, { id: 2 }];
    const result = await db.from("query_limits").select("id").maybeSingle();
    expect(result.error?.code).toBe("TOO_MANY_ROWS");
    expect(calls[0]?.sql).toContain("LIMIT 2");
  });
});
