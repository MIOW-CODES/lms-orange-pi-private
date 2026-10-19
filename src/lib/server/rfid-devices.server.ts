// RFID device registry — per-device API keys, heartbeat status, deactivation.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/integrations/db/client.server";
import { unwrap } from "@/lib/server/utils.server";

export interface RfidDeviceRow {
  id: string;
  name: string;
  location: string | null;
  key_prefix: string;
  key_hash: string;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
}

export interface RfidDevicePublic {
  id: string;
  name: string;
  location: string | null;
  key_prefix: string;
  is_active: boolean;
  last_seen_at: string | null;
  status: "online" | "offline";
  created_at: string;
}

/** Heartbeat window: a device is "online" if it checked in within this window. */
const ONLINE_WINDOW_MS = 90_000;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/** Generate a fresh device key: `mw_` + 40 hex chars, plus its prefix and sha256 hash. */
export function generateDeviceKey(): { apiKey: string; keyPrefix: string; keyHash: string } {
  const apiKey = `mw_${randomBytes(20).toString("hex")}`;
  return { apiKey, keyPrefix: apiKey.slice(0, 11), keyHash: sha256Hex(apiKey) };
}

/** Generate a new device key and persist its hash. Raw key is returned ONCE. */
export async function createRfidDevice(input: {
  name: string;
  location?: string | null;
}): Promise<{ id: string; name: string; key_prefix: string; api_key: string }> {
  const { apiKey, keyPrefix, keyHash } = generateDeviceKey();
  const row = await unwrap<{ id: string; name: string }>(
    db
      .from("rfid_devices")
      .insert({
        name: input.name.trim(),
        location: input.location?.trim() || null,
        key_prefix: keyPrefix,
        key_hash: keyHash,
      })
      .select("id, name")
      .single(),
  );
  return { id: row.id, name: row.name, key_prefix: keyPrefix, api_key: apiKey };
}

/** Strip key material and compute the liveness badge for a device row. */
export function toRfidDevicePublic(row: RfidDeviceRow, now = Date.now()): RfidDevicePublic {
  const seen = row.last_seen_at ? Date.parse(row.last_seen_at) : NaN;
  const online = Number.isFinite(seen) && now - seen <= ONLINE_WINDOW_MS;
  const { key_hash: _key_hash, ...rest } = row;
  return { ...rest, status: online ? "online" : "offline" };
}

/** List registered devices without exposing key material. */
export async function listRfidDevices(): Promise<RfidDevicePublic[]> {
  const rows = await unwrap<RfidDeviceRow[]>(
    db.from("rfid_devices").select("*").order("created_at", { ascending: false }),
  );
  const now = Date.now();
  return rows.map((r) => toRfidDevicePublic(r, now));
}

/** Deactivate a device (key stops working immediately). */
export async function deactivateRfidDevice(id: string): Promise<void> {
  await unwrap(db.from("rfid_devices").update({ is_active: false }).eq("id", id));
}

/** Pluggable active-device lookup — default queries the DB; tests inject stubs. */
export type RfidDeviceLookup = (keyPrefix: string) => Promise<RfidDeviceRow[]>;

async function defaultDeviceLookup(keyPrefix: string): Promise<RfidDeviceRow[]> {
  return unwrap<RfidDeviceRow[]>(
    db.from("rfid_devices").select("*").eq("key_prefix", keyPrefix).eq("is_active", true),
  );
}

/**
 * Verify a presented device key against stored hashes (active devices only).
 * Fails closed: any lookup error (DB down) resolves to null, never throws.
 */
export async function verifyRfidDeviceKey(
  key: string,
  lookup: RfidDeviceLookup = defaultDeviceLookup,
): Promise<RfidDeviceRow | null> {
  if (!key || !key.startsWith("mw_")) return null;
  const prefix = key.slice(0, 11);
  try {
    const rows = await lookup(prefix);
    const presented = sha256Hex(key);
    const match = rows.find((r) => safeEqualHex(presented, r.key_hash));
    return match ?? null;
  } catch (err) {
    console.warn("[rfid-devices] key verify degraded (db unavailable):", err);
    return null;
  }
}

/**
 * Record a device heartbeat. Never throws — heartbeats must not break requests.
 * Returns true when the key matched an active device.
 */
export async function touchRfidDevice(
  key: string,
  lookup: RfidDeviceLookup = defaultDeviceLookup,
): Promise<boolean> {
  try {
    const device = await verifyRfidDeviceKey(key, lookup);
    if (!device) return false;
    await db
      .from("rfid_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device.id);
    return true;
  } catch (err) {
    console.warn("[rfid-devices] heartbeat failed:", err);
    return false;
  }
}
