/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "bun:test";
import {
  unwrap,
  withoutToken,
  sleep,
  isUniqueViolation,
  DatabaseError,
  allDatabaseRows,
} from "./utils.server";

describe("isUniqueViolation", () => {
  it("recognizes PostgreSQL SQLSTATE 23505 only", () => {
    expect(isUniqueViolation(new DatabaseError("Database request failed", "23505"))).toBe(true);
    expect(isUniqueViolation(new DatabaseError("Database request failed", "42P01"))).toBe(false);
    expect(isUniqueViolation(new DatabaseError("Database request failed"))).toBe(false);
    expect(isUniqueViolation(new Error("Database request failed"))).toBe(false);
  });
});

describe("sleep", () => {
  it("resolves after the specified delay", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});

describe("unwrap", () => {
  it("returns data on success", async () => {
    await expect(unwrap(Promise.resolve({ data: { id: 1 }, error: null }))).resolves.toEqual({
      id: 1,
    });
  });

  it("surfaces PostgreSQL errors without retrying a failed write", async () => {
    let calls = 0;
    const failedQuery = {
      then(resolve: (value: unknown) => void) {
        calls += 1;
        resolve({ data: null, error: { code: "40001", message: "serialization failure" } });
        return failedQuery;
      },
    };
    await expect(unwrap(failedQuery as any)).rejects.toMatchObject({
      name: "DatabaseError",
      code: "40001",
    });
    expect(calls).toBe(1);
  });

  it("throws when a database error has no SQLSTATE", async () => {
    await expect(
      unwrap(Promise.resolve({ data: null, error: { message: "connection failed" } })),
    ).rejects.toThrow("Database request failed");
  });
});

describe("withoutToken", () => {
  it("removes only the token property", () => {
    expect(withoutToken({ id: "123", token: "secret", extra: true })).toEqual({
      id: "123",
      extra: true,
    });
  });
});

describe("allDatabaseRows", () => {
  it("retains rows across bounded pages", async () => {
    const source = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const rows = await allDatabaseRows<{ id: number }>((from, to) =>
      Promise.resolve({ data: source.slice(from, to + 1), error: null }),
    );
    expect(rows).toHaveLength(1201);
    expect(rows.at(-1)?.id).toBe(1200);
  });
});
