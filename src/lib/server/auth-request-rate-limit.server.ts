import { isIP } from "node:net";

export const AUTH_REQUEST_RATE_LIMIT = 120;
export const AUTH_REQUEST_WINDOW_MS = 60_000;
export const AUTH_REQUEST_RATE_LIMIT_MAX_CLIENTS = 2048;
const RATE_LIMIT_SWEEP_INTERVAL = 128;

type RateEntry = { windowStartedAt: number; lastSeenAt: number; count: number };
const clients = new Map<string, RateEntry>();
let rateLimitCalls = 0;

function evictExpired(now: number): void {
  for (const [ip, entry] of clients) {
    if (now - entry.lastSeenAt >= AUTH_REQUEST_WINDOW_MS) clients.delete(ip);
  }
}

/** NPM overwrites X-Real-IP with its connected client address; XFF is untrusted. */
export function authClientIp(request: Request): string {
  const candidate = request.headers.get("x-real-ip")?.trim() ?? "";
  return isIP(candidate) ? candidate : "unknown";
}

/** Returns true once a source exceeds the fixed one-minute request window. */
export function authRequestRateLimited(request: Request, now = Date.now()): boolean {
  const ip = authClientIp(request);
  rateLimitCalls++;
  const existing = clients.get(ip);
  if (existing && now - existing.windowStartedAt < AUTH_REQUEST_WINDOW_MS) {
    existing.count++;
    existing.lastSeenAt = now;
    clients.delete(ip);
    clients.set(ip, existing);
    return existing.count > AUTH_REQUEST_RATE_LIMIT;
  }

  if (rateLimitCalls % RATE_LIMIT_SWEEP_INTERVAL === 0) evictExpired(now);
  if (clients.size >= AUTH_REQUEST_RATE_LIMIT_MAX_CLIENTS) {
    const oldestIp = clients.keys().next().value as string | undefined;
    if (oldestIp !== undefined) clients.delete(oldestIp);
  }
  clients.set(ip, { windowStartedAt: now, lastSeenAt: now, count: 1 });
  return false;
}
