/* eslint-disable @typescript-eslint/no-explicit-any */
// Signed kiosk session tokens — HMAC-SHA256 with JTI revocation.
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { db } from "@/integrations/db/client.server";
import { unwrap } from "@/lib/server/utils.server";

const SESSION_TTL_MS = Number(process.env["SESSION_TTL_MS"]) || 12 * 60 * 60 * 1000;

export function sessionSecret(): string {
  const key = process.env["SESSION_SECRET"];
  if (!key) throw new Error("Missing SESSION_SECRET env var. Set it in .env");
  return key;
}

/** Row persisted for JTI revocation (see {@link createSessionToken}). */
export interface JtiRow {
  jti: string;
  profile_id: string;
  expires_at: string;
}

/** Pluggable JTI writer — default persists to `sessions`; tests inject stubs. */
export type JtiWriter = (row: JtiRow) => PromiseLike<unknown>;

async function persistJti(row: JtiRow): Promise<void> {
  await unwrap(db.from("sessions").insert(row as any));
}

/**
 * Issue a signed session token. FAIL-CLOSED (Gate-1 3f / C12): the JTI row must
 * be written before the token is returned — if it cannot be persisted the token
 * is never issued and login errors, instead of handing out an unrevocable token.
 */
export async function createSessionToken(
  profileId: string,
  jti: string = randomUUID(),
  writeJti: JtiWriter = persistJti,
): Promise<string> {
  const secret = sessionSecret();
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ sub: profileId, jti, exp })).toString("base64url");
  try {
    await writeJti({ jti, profile_id: profileId, expires_at: new Date(exp).toISOString() });
  } catch (e) {
    console.error("[sessions] JTI insert failed — refusing to issue token:", e);
    throw new Error("Sign-in failed: the session could not be recorded. Please try again.");
  }
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * JTI carried by a signed token, or null for malformed payloads.
 */
export function sessionJti(token: string): string | null {
  const payloadPart = token.split(".")[0];
  if (!payloadPart) return null;
  try {
    const body = JSON.parse(Buffer.from(payloadPart, "base64url").toString()) as { jti?: unknown };
    return typeof body.jti === "string" && body.jti ? body.jti : null;
  } catch {
    return null;
  }
}

export function verifySessionToken(token: string): string {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) throw new Error("Unauthorized");
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  const actualBytes = Buffer.from(sig);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error("Unauthorized");
  }
  let body: { sub?: unknown; jti?: unknown; exp?: unknown };
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    throw new Error("Unauthorized");
  }
  if (
    typeof body.sub !== "string" ||
    typeof body.exp !== "number" ||
    !Number.isFinite(body.exp) ||
    body.exp < Date.now() ||
    typeof body.jti !== "string" ||
    body.jti.length === 0
  ) {
    throw new Error("Unauthorized");
  }
  return body.sub;
}

/** Revoke all active sessions for a profile; callers must observe DB failures. */
export async function revokeSessions(profileId: string): Promise<void> {
  await unwrap(
    db
      .from("sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("profile_id", profileId)
      .is("revoked_at", null),
  );
}

/** Revoke only the caller's current session (used for explicit sign-out). */
export async function revokeSessionJti(jti: string, profileId: string): Promise<void> {
  await unwrap(
    db
      .from("sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("jti", jti)
      .eq("profile_id", profileId)
      .is("revoked_at", null),
  );
}
