import { describe, it, expect, beforeEach, afterEach } from "bun:test";

process.env["HARDWARE_API_KEY"] = "test-key-123";

import {
  hitRateLimit,
  authorized,
  guardHardwareRequest,
  RATE_LIMIT_MAX_CLIENTS,
} from "./hardware-auth.server";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/hardware", { headers });
}

function validTimestamp(): string {
  return new Date().toISOString();
}

describe("hitRateLimit", () => {
  it("returns false when under the limit", () => {
    for (let i = 0; i < 10; i++) {
      expect(hitRateLimit("rl-ok")).toBe(false);
    }
  });

  it("returns true after exceeding 60 requests", () => {
    for (let i = 0; i < 60; i++) {
      hitRateLimit("rl-exceed");
    }
    expect(hitRateLimit("rl-exceed")).toBe(true);
  });

  it("uses separate counters per IP", () => {
    for (let i = 0; i < 60; i++) {
      hitRateLimit("rl-a");
    }
    expect(hitRateLimit("rl-a")).toBe(true);
    expect(hitRateLimit("rl-b")).toBe(false);
  });

  it("bounds memory by evicting the oldest active client entry", () => {
    for (let i = 0; i < 60; i++) hitRateLimit("rl-bound-first");
    for (let i = 0; i < RATE_LIMIT_MAX_CLIENTS + 2; i++) hitRateLimit(`rl-bound-${i}`);
    expect(hitRateLimit("rl-bound-first")).toBe(false);
  });
});

describe("authorized", () => {
  it("returns true with correct Bearer token and valid timestamp", () => {
    const req = makeRequest({
      Authorization: "Bearer test-key-123",
      "X-Hardware-Timestamp": validTimestamp(),
    });
    expect(authorized(req)).toBe(true);
  });

  it("returns false with wrong Bearer token", () => {
    const req = makeRequest({
      Authorization: "Bearer wrong-key",
      "X-Hardware-Timestamp": validTimestamp(),
    });
    expect(authorized(req)).toBe(false);
  });

  it("returns false with expired timestamp (>5 min old)", () => {
    const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const req = makeRequest({
      Authorization: "Bearer test-key-123",
      "X-Hardware-Timestamp": old,
    });
    expect(authorized(req)).toBe(false);
  });

  it("returns false with future timestamp (>5 min ahead)", () => {
    const future = new Date(Date.now() + 6 * 60 * 1000).toISOString();
    const req = makeRequest({
      Authorization: "Bearer test-key-123",
      "X-Hardware-Timestamp": future,
    });
    expect(authorized(req)).toBe(false);
  });

  it("returns false when Authorization header is missing", () => {
    const req = makeRequest({ "X-Hardware-Timestamp": validTimestamp() });
    expect(authorized(req)).toBe(false);
  });

  it("returns false when X-Hardware-Timestamp header is missing", () => {
    const req = makeRequest({ Authorization: "Bearer test-key-123" });
    expect(authorized(req)).toBe(false);
  });

  it("returns false with unparseable timestamp", () => {
    const req = makeRequest({
      Authorization: "Bearer test-key-123",
      "X-Hardware-Timestamp": "not-a-date",
    });
    expect(authorized(req)).toBe(false);
  });

  it("returns false when HARDWARE_API_KEY env is not set", () => {
    const orig = process.env["HARDWARE_API_KEY"];
    delete process.env["HARDWARE_API_KEY"];
    const req = makeRequest({
      Authorization: "Bearer test-key-123",
      "X-Hardware-Timestamp": validTimestamp(),
    });
    expect(authorized(req)).toBe(false);
    process.env["HARDWARE_API_KEY"] = orig;
  });
});

describe("guardHardwareRequest", () => {
  it("uses NPM's validated X-Real-IP and ignores client-supplied XFF", async () => {
    const req = makeRequest({
      Authorization: "Bearer test-key-123",
      "X-Hardware-Timestamp": validTimestamp(),
      "X-Real-IP": "192.168.1.50",
      "X-Forwarded-For": "10.0.0.1",
    });
    const result = await guardHardwareRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ip).toBe("192.168.1.50");
  });

  it("returns 401 for unauthorized requests", async () => {
    const req = makeRequest({
      "X-Hardware-Timestamp": validTimestamp(),
    });
    const result = await guardHardwareRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const req = makeRequest({
      Authorization: "Bearer test-key-123",
      "X-Hardware-Timestamp": validTimestamp(),
      "X-Real-IP": "10.99.99.99",
    });
    for (let i = 0; i < 60; i++) {
      await guardHardwareRequest(
        makeRequest({
          Authorization: "Bearer test-key-123",
          "X-Hardware-Timestamp": validTimestamp(),
          "X-Real-IP": "10.99.99.99",
        }),
      );
    }
    const result = await guardHardwareRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(429);
      expect(result.response.headers.get("Retry-After")).toBe("60");
    }
  });

  it("uses X-Real-IP when X-Forwarded-For is absent", async () => {
    const req = makeRequest({
      Authorization: "Bearer test-key-123",
      "X-Hardware-Timestamp": validTimestamp(),
      "X-Real-Ip": "192.168.1.50",
    });
    const result = await guardHardwareRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ip).toBe("192.168.1.50");
  });

  it("ignores forged X-Forwarded-For when X-Real-IP is absent", async () => {
    const req = makeRequest({
      Authorization: "Bearer test-key-123",
      "X-Hardware-Timestamp": validTimestamp(),
      "X-Forwarded-For": "192.0.2.66",
    });
    const result = await guardHardwareRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ip).toBe("unknown");
  });

  it("uses the shared unknown bucket for invalid X-Real-IP values", async () => {
    const req = makeRequest({
      Authorization: "Bearer test-key-123",
      "X-Hardware-Timestamp": validTimestamp(),
      "X-Real-IP": "attacker-controlled",
      "X-Forwarded-For": "192.0.2.67",
    });
    const result = await guardHardwareRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ip).toBe("unknown");
  });
});
