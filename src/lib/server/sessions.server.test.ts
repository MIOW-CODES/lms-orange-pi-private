import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Pool } from "pg";
import { _resetPool, _setPoolForTests } from "@/integrations/db/client.server";
import { revokeSessions } from "./sessions.server";

describe("sessions.server edge cases", () => {
  const origSessionSecret = process.env["SESSION_SECRET"];

  afterEach(() => {
    if (origSessionSecret === undefined) delete process.env["SESSION_SECRET"];
    else process.env["SESSION_SECRET"] = origSessionSecret;
  });

  describe("sessionSecret", () => {
    it("returns SESSION_SECRET when set", async () => {
      process.env["SESSION_SECRET"] = "my-secret-32-hex-1234567890abcdef";
      const { sessionSecret } = await import("./sessions.server");
      expect(sessionSecret()).toBe("my-secret-32-hex-1234567890abcdef");
    });

    it("throws when SESSION_SECRET is missing", async () => {
      delete process.env["SESSION_SECRET"];
      const { sessionSecret } = await import("./sessions.server");
      expect(() => sessionSecret()).toThrow("Missing SESSION_SECRET");
    });
  });

  describe("verifySessionToken edge cases", () => {
    it("rejects token with missing sub field", async () => {
      process.env["SESSION_SECRET"] = "edge-case-secret-1234567890abcdef1234";

      const { verifySessionToken } = await import("./sessions.server");
      const { createHmac } = await import("node:crypto");

      const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 3600000 })).toString(
        "base64url",
      );
      const sig = createHmac("sha256", process.env["SESSION_SECRET"]!)
        .update(payload)
        .digest("base64url");
      expect(() => verifySessionToken(`${payload}.${sig}`)).toThrow("Unauthorized");
    });

    it("rejects a correctly signed token without a revocable jti", async () => {
      process.env["SESSION_SECRET"] = "legacy-token-secret-1234567890abcdef";
      const { verifySessionToken } = await import("./sessions.server");
      const { createHmac } = await import("node:crypto");
      const payload = Buffer.from(
        JSON.stringify({ sub: "user-1", exp: Date.now() + 3600000 }),
      ).toString("base64url");
      const sig = createHmac("sha256", process.env["SESSION_SECRET"]!)
        .update(payload)
        .digest("base64url");
      expect(() => verifySessionToken(`${payload}.${sig}`)).toThrow("Unauthorized");
    });

    it("rejects token with non-string jti", async () => {
      process.env["SESSION_SECRET"] = "jti-test-secret-1234567890abcdef1234";

      const { verifySessionToken } = await import("./sessions.server");
      const { createHmac } = await import("node:crypto");

      const payload = Buffer.from(
        JSON.stringify({
          sub: "user-1",
          jti: 12345,
          exp: Date.now() + 3600000,
        }),
      ).toString("base64url");
      const sig = createHmac("sha256", process.env["SESSION_SECRET"]!)
        .update(payload)
        .digest("base64url");
      expect(() => verifySessionToken(`${payload}.${sig}`)).toThrow("Unauthorized");
    });

    it("rejects token with missing dot separator", async () => {
      process.env["SESSION_SECRET"] = "sep-test-secret-1234567890abcdef1234";

      const { verifySessionToken } = await import("./sessions.server");
      expect(() => verifySessionToken("noseparator")).toThrow("Unauthorized");
    });

    it("rejects empty string token", async () => {
      process.env["SESSION_SECRET"] = "empty-test-secret-1234567890abcdef";

      const { verifySessionToken } = await import("./sessions.server");
      expect(() => verifySessionToken("")).toThrow("Unauthorized");
    });
  });

  describe("createSessionToken", () => {
    const okWrite = async () => {};

    it("returns a token with payload.signature format", async () => {
      process.env["SESSION_SECRET"] = "create-test-secret-1234567890abcdef";

      const { createSessionToken } = await import("./sessions.server");
      const token = await createSessionToken("user-abc", undefined, okWrite);
      const parts = token.split(".");
      expect(parts.length).toBe(2);
      expect(parts[0]!.length).toBeGreaterThan(0);
      expect(parts[1]!.length).toBeGreaterThan(0);
    });

    it("accepts a custom jti parameter", async () => {
      process.env["SESSION_SECRET"] = "jti-custom-secret-1234567890abcdef";

      const { createSessionToken, verifySessionToken } = await import("./sessions.server");
      const token = await createSessionToken("user-custom", "my-custom-jti", okWrite);
      const payload = token.split(".")[0]!;
      const body = JSON.parse(Buffer.from(payload, "base64url").toString());
      expect(body.jti).toBe("my-custom-jti");
      expect(verifySessionToken(token)).toBe("user-custom");
    });

    it("persists the JTI row before returning (fail-closed write)", async () => {
      process.env["SESSION_SECRET"] = "jti-persist-secret-1234567890abcdef";
      const { createSessionToken } = await import("./sessions.server");
      const rows: Array<{ jti: string; profile_id: string; expires_at: string }> = [];
      const token = await createSessionToken("user-persist", "my-persist-jti", async (row) => {
        rows.push(row);
      });
      expect(token).toContain(".");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.jti).toBe("my-persist-jti");
      expect(rows[0]!.profile_id).toBe("user-persist");
      expect(Number.isFinite(Date.parse(rows[0]!.expires_at))).toBe(true);
    });

    it("is fail-closed: no token is issued when the JTI row cannot be written", async () => {
      process.env["SESSION_SECRET"] = "jti-failclosed-secret-1234567890abcdef";
      const { createSessionToken } = await import("./sessions.server");
      const failWrite = async () => {
        throw new Error("database unavailable");
      };
      await expect(createSessionToken("user-fail", undefined, failWrite)).rejects.toThrow(
        "Sign-in failed",
      );
    });
  });

  it("propagates PostgreSQL errors when revoking a profile's sessions", async () => {
    const fakePool = {
      query: async () => {
        throw Object.assign(new Error("connection lost"), { code: "08006" });
      },
    } as unknown as Pool;
    _setPoolForTests(fakePool);
    try {
      await expect(revokeSessions("profile-1")).rejects.toMatchObject({
        name: "DatabaseError",
        code: "08006",
      });
    } finally {
      _resetPool();
    }
  });
});
