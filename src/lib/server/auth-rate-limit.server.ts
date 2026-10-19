import { createHash } from "node:crypto";
import { db } from "@/integrations/db/client.server";

const MAX_FAILURES = 5;
const WINDOW_SECONDS = 15 * 60;

function bucketKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(name, args);
  if (error)
    throw new Error(`Authentication rate limit unavailable: ${error.message ?? error.code}`);
  return data;
}

export async function authRateLimitAllows(key: string): Promise<boolean> {
  const data = await rpc("check_auth_rate_limit", {
    p_bucket_key: bucketKey(key),
    p_max_failures: MAX_FAILURES,
    p_window_seconds: WINDOW_SECONDS,
  });
  const row = Array.isArray(data) ? data[0] : data;
  const allowed =
    !!row && typeof row === "object" && (row as { allowed?: unknown }).allowed === true;
  if (!allowed) {
    console.warn("[auth] login rate limit reached", { bucket: bucketKey(key) });
  }
  return allowed;
}

export async function recordAuthFailure(key: string): Promise<void> {
  await rpc("record_auth_rate_failure", {
    p_bucket_key: bucketKey(key),
    p_window_seconds: WINDOW_SECONDS,
  });
}

export async function clearAuthFailures(key: string): Promise<void> {
  await rpc("clear_auth_rate_limit", { p_bucket_key: bucketKey(key) });
}

/** Shared 5-per-15-minute limiter for actions that count every attempt. */
export async function consumeAuthAttempt(key: string): Promise<boolean> {
  const data = await rpc("consume_auth_rate_attempt", {
    p_bucket_key: bucketKey(key),
    p_max_attempts: MAX_FAILURES,
    p_window_seconds: WINDOW_SECONDS,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return !!row && typeof row === "object" && (row as { allowed?: unknown }).allowed === true;
}
