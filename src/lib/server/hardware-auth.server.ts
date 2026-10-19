import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { verifyRfidDeviceKey, touchRfidDevice } from "@/lib/server/rfid-devices.server";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_CLIENTS = 2048;
const RATE_LIMIT_SWEEP_INTERVAL = 128;
type RateEntry = { windowStartedAt: number; lastSeenAt: number; count: number };
const _rate = new Map<string, RateEntry>();
let rateLimitCalls = 0;

function evictExpired(now: number): void {
  for (const [key, entry] of _rate) {
    if (now - entry.lastSeenAt >= RATE_LIMIT_WINDOW_MS) _rate.delete(key);
  }
}

export function hitRateLimit(ip: string): boolean {
  const now = Date.now();
  rateLimitCalls++;
  const existing = _rate.get(ip);
  if (existing && now - existing.windowStartedAt < RATE_LIMIT_WINDOW_MS) {
    existing.count++;
    existing.lastSeenAt = now;
    _rate.delete(ip);
    _rate.set(ip, existing);
    return existing.count > RATE_LIMIT_MAX;
  }

  if (rateLimitCalls % RATE_LIMIT_SWEEP_INTERVAL === 0 || _rate.size >= RATE_LIMIT_MAX_CLIENTS) {
    evictExpired(now);
  }
  if (_rate.size >= RATE_LIMIT_MAX_CLIENTS) {
    const oldestKey = _rate.keys().next().value as string | undefined;
    if (oldestKey !== undefined) _rate.delete(oldestKey);
  }

  _rate.set(ip, { windowStartedAt: now, lastSeenAt: now, count: 1 });
  return false;
}

/** NPM overwrites X-Real-IP with its connected client address. XFF is ignored. */
export function clientIpFromRequest(request: Request): string {
  const candidate = request.headers.get("x-real-ip")?.trim() ?? "";
  return isIP(candidate) ? candidate : "unknown";
}

export function authorized(request: Request): boolean {
  const expected = process.env["HARDWARE_API_KEY"];
  if (!expected) return false;
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const tsRaw = request.headers.get("x-hardware-timestamp");
  if (!tsRaw) return false;
  const ts = Date.parse(tsRaw);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Accepts either a registered per-device API key (rfid_devices) or the global
 * HARDWARE_API_KEY. Timestamp freshness rules are identical for both.
 */
export async function authorizedAny(request: Request): Promise<{ ok: boolean; token: string }> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const tsRaw = request.headers.get("x-hardware-timestamp");
  if (!tsRaw) return { ok: false, token };
  const ts = Date.parse(tsRaw);
  if (!Number.isFinite(ts)) return { ok: false, token };
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) return { ok: false, token };
  if (await verifyRfidDeviceKey(token)) return { ok: true, token };
  return { ok: authorized(request), token };
}

export async function guardHardwareRequest(
  request: Request,
): Promise<{ ok: true; ip: string } | { ok: false; response: Response }> {
  const ip = clientIpFromRequest(request);
  if (hitRateLimit(ip)) {
    return {
      ok: false,
      response: new Response("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    };
  }
  const auth = await authorizedAny(request);
  if (!auth.ok) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }
  // Heartbeat for registered devices — never fails the request.
  await touchRfidDevice(auth.token);
  return { ok: true, ip };
}
