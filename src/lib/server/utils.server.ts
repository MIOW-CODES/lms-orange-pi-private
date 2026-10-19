// Shared utilities for server modules — unwrap(), withoutToken(), sleep().

interface DbError {
  code?: string;
  message?: string;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Database error with the PostgreSQL SQLSTATE when one is available. */
export class DatabaseError extends Error {
  code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "DatabaseError";
    this.code = code;
  }
}

/**
 * True when an error is a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used by idempotent inserts to detect a racing duplicate write.
 */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof DatabaseError && e.code === "23505";
}

export async function unwrap<T>(
  p: PromiseLike<{ data: unknown; error: DbError | null }>,
): Promise<T> {
  const result = await p;
  if (!result.error) return result.data as T;
  console.error("[lms] PostgreSQL request failed:", { code: result.error.code });
  throw new DatabaseError("Database request failed", result.error.code);
}

/**
 * Wrap a value destined for a jsonb column so node-postgres serializes arrays
 * as JSON text rather than PostgreSQL array literals.
 */
export function asJsonParam<T>(value: T): { toJSON: () => T } {
  return { toJSON: () => value };
}

/**
 * Strip the session token from validated input before it is written to a table.
 */
export function withoutToken<T extends { token?: string }>(input: T): Omit<T, "token"> {
  const { token: _ignored, ...row } = input;
  return row;
}

/** Read a large result in bounded pages so no request is unbounded. */
export async function allDatabaseRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const batch = await unwrap<T[]>(page(offset, offset + size - 1));
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
}
