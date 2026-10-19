import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  generateDeviceKey,
  toRfidDevicePublic,
  verifyRfidDeviceKey,
  touchRfidDevice,
  type RfidDeviceRow,
} from "./rfid-devices.server";

function row(overrides: Partial<RfidDeviceRow> = {}): RfidDeviceRow {
  return {
    id: "2f6b1f5a-0f6e-4f5e-9f6e-2f6b1f5a0f6e",
    name: "Main gate kiosk",
    location: "Building A",
    key_prefix: "mw_01234567",
    key_hash: createHash("sha256").update("mw_deadbeef").digest("hex"),
    is_active: true,
    last_seen_at: null,
    created_at: "2026-10-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("generateDeviceKey", () => {
  it("emits mw_ + 40 hex chars with a matching prefix and sha256 hash", () => {
    const { apiKey, keyPrefix, keyHash } = generateDeviceKey();
    expect(apiKey).toMatch(/^mw_[0-9a-f]{40}$/);
    expect(keyPrefix).toBe(apiKey.slice(0, 11));
    expect(keyPrefix).toMatch(/^mw_[0-9a-f]{8}$/);
    expect(keyHash).toBe(createHash("sha256").update(apiKey).digest("hex"));
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats across generations", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateDeviceKey().apiKey));
    expect(keys.size).toBe(50);
  });
});

describe("verifyRfidDeviceKey", () => {
  it("rejects non-device keys without hitting the database", async () => {
    expect(await verifyRfidDeviceKey("")).toBeNull();
    expect(await verifyRfidDeviceKey("abc")).toBeNull();
    expect(await verifyRfidDeviceKey("MW_0123456789abcdef")).toBeNull();
    expect(await verifyRfidDeviceKey("global-env-key")).toBeNull();
  });

  it("resolves to null for an mw_ key with no matching active device (fail-closed)", async () => {
    const { apiKey } = generateDeviceKey();
    expect(await verifyRfidDeviceKey(apiKey, async () => [])).toBeNull();
  });

  it("resolves to null when the lookup errors (db unavailable)", async () => {
    const { apiKey } = generateDeviceKey();
    expect(
      await verifyRfidDeviceKey(apiKey, async () => {
        throw new Error("database unavailable");
      }),
    ).toBeNull();
  });

  it("returns the matching active device when the stored hash matches", async () => {
    const { apiKey } = generateDeviceKey();
    const device = row({
      key_prefix: apiKey.slice(0, 11),
      key_hash: createHash("sha256").update(apiKey).digest("hex"),
    });
    expect(await verifyRfidDeviceKey(apiKey, async () => [device])).toEqual(device);
  });
});

describe("toRfidDevicePublic", () => {
  const now = Date.parse("2026-10-09T12:00:00.000Z");

  it("reports online when last_seen_at is within the 90s heartbeat window", () => {
    const r = toRfidDevicePublic(row({ last_seen_at: "2026-10-09T11:59:30.000Z" }), now);
    expect(r.status).toBe("online");
  });

  it("reports offline when last_seen_at is older than the window", () => {
    const r = toRfidDevicePublic(row({ last_seen_at: "2026-10-09T11:50:00.000Z" }), now);
    expect(r.status).toBe("offline");
  });

  it("reports offline when the device has never checked in", () => {
    expect(toRfidDevicePublic(row({ last_seen_at: null }), now).status).toBe("offline");
  });

  it("never exposes key_hash", () => {
    const r = toRfidDevicePublic(row(), now);
    expect("key_hash" in r).toBe(false);
    expect(Object.keys(r)).not.toContain("key_hash");
  });
});

describe("touchRfidDevice", () => {
  it("returns false and never throws for an unknown device key", async () => {
    const { apiKey } = generateDeviceKey();
    await expect(touchRfidDevice(apiKey, async () => [])).resolves.toBe(false);
  });

  it("returns false without throwing when the lookup errors", async () => {
    const { apiKey } = generateDeviceKey();
    await expect(
      touchRfidDevice(apiKey, async () => {
        throw new Error("database unavailable");
      }),
    ).resolves.toBe(false);
  });

  it("returns false for malformed keys without throwing", async () => {
    await expect(touchRfidDevice("")).resolves.toBe(false);
  });
});
