// Profiles & kiosk auth — CRUD, PIN login, RFID, biometrics.
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, storage } from "@/integrations/db/client.server";
import {
  authRateLimitAllows,
  clearAuthFailures,
  consumeAuthAttempt,
  recordAuthFailure,
} from "@/lib/server/auth-rate-limit.server";
import { unwrap, withoutToken } from "@/lib/server/utils.server";
import {
  createSessionToken,
  revokeSessions,
  sessionSecret,
  sessionJti,
} from "@/lib/server/sessions.server";
import { schemas } from "@/lib/server/schemas.server";
import { type ProfileRow, type ProfileRole, type HttpError } from "@/lib/server/db-types";

/* ---------- PIN policy (pure decision logic — see pin-security.test.ts) ---------- */

/** Accepted self-service PIN format — digits only, 4–8 long (matches the UI). */
export const PIN_FORMAT_RE = /^\d{4,8}$/;

export function isValidPinFormat(pin: string): boolean {
  return PIN_FORMAT_RE.test(pin);
}

/** Temporary, administrator-issued credentials may be non-numeric until changed. */
export function canVerifyPinCandidate(
  pin: string,
  pinMustChange: boolean | null | undefined,
): boolean {
  return isValidPinFormat(pin) || pinMustChange === true;
}

/** All roles must replace an explicitly issued temporary PIN. */
export function pinGateRequiredForRole(role: ProfileRole): boolean {
  return role === "student" || role === "teacher" || role === "admin";
}

/**
 * Detect a non-empty PIN write; callers distinguish private changes from
 * administrator-issued temporary resets.
 */
export function hasPinWrite(patch: Record<string, unknown>): boolean {
  return typeof patch["pin"] === "string" && patch["pin"].length > 0;
}

/* ---------- Safe profile shaping (strip credentials/biometrics) ---------- */

export function safeProfile(p: ProfileRow & { pin_must_change?: boolean | null }) {
  return {
    id: p.id,
    student_id: p.student_id,
    email: p.email,
    full_name: p.full_name,
    role: p.role,
    avatar_url: p.avatar_url,
    grade_level: p.grade_level,
    section: p.section,
    created_at: p.created_at,
    // Faculty identity fields (non-sensitive).
    employee_id: p.employee_id,
    prefix: p.prefix,
    department: p.department,
    phone: p.phone ?? null,
    bio: p.bio ?? null,
    office_hours: p.office_hours ?? null,
    // Credentials never leave the server.
    pin: null,
    rfid_uid: null,
    has_pin: !!p.pin_hash || !!p.pin,
    has_rfid: !!p.rfid_uid,
    // Forced PIN-change gate (all roles) — surfaced on every login and
    // session refresh so the client can block until the PIN is replaced.
    pin_must_change: p.pin_must_change === true && pinGateRequiredForRole(p.role),
  };
}

export type SafeProfile = ReturnType<typeof safeProfile>;

/* ---------- RFID lookup ---------- */

export async function findByRfid(uid: string) {
  const p = await unwrap<ProfileRow | null>(
    db.from("profiles").select("*").eq("rfid_uid", uid).is("deleted_at", null).maybeSingle(),
  );
  return p ? { profile: safeProfile(p), token: await createSessionToken(p.id) } : null;
}

/* ---------- PIN verification ---------- */

async function verifyPin(p: ProfileRow, pin: string): Promise<boolean> {
  const key = `pin:${p.id ?? p.student_id ?? p.email ?? "unknown"}`;
  if (!(await authRateLimitAllows(key))) {
    const err = new Error("Too many attempts") as HttpError;
    err.status = 429;
    throw err;
  }
  let ok = false;
  if (!canVerifyPinCandidate(pin, p.pin_must_change)) return false;
  if (typeof p.pin_hash === "string" && p.pin_hash) {
    try {
      ok = await bcrypt.compare(pin, p.pin_hash);
    } catch {
      ok = false;
    }
  }
  // Legacy plaintext row not yet backfilled — compare, then opportunistically
  // upgrade to a bcrypt hash and clear the plaintext copy.
  if (!ok && typeof p.pin === "string" && p.pin.length > 0 && p.pin === pin) {
    await db
      .from("profiles")
      .update({ pin_hash: await bcrypt.hash(pin, 10), pin: null })
      .eq("id", p.id);
    ok = true;
  }
  if (!ok) await recordAuthFailure(key);
  else await clearAuthFailures(key);
  return ok;
}

/* ---------- Unified PIN/password sign-in (all roles) ---------- */

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;

async function verifySecret(p: ProfileRow, secret: string): Promise<boolean> {
  if (await verifyPin(p, secret)) return true;
  const key = `secret:${p.id ?? p.email ?? "unknown"}`;
  if (!(await authRateLimitAllows(key))) {
    const err = new Error("Too many attempts") as HttpError;
    err.status = 429;
    throw err;
  }
  if (typeof p.password_hash === "string" && p.password_hash) {
    try {
      const ok = await bcrypt.compare(secret, p.password_hash);
      if (ok) {
        await Promise.all([
          clearAuthFailures(key),
          clearAuthFailures(`pin:${p.id ?? p.student_id ?? p.email ?? "unknown"}`),
        ]);
      } else await recordAuthFailure(key);
      return ok;
    } catch {
      await recordAuthFailure(key);
      return false;
    }
  }
  await recordAuthFailure(key);
  return false;
}

export async function verifyPinLogin(login: string, secret: string) {
  const dbgS = (msg: string, data?: unknown) => {
    if (process.env["DEBUG_LOGS"] === "true") console.debug(`[auth:server] ${msg}`, data ?? "");
  };
  const identifier = login.trim().replace(/[*%_]/g, "");
  if (!identifier || !secret) return { ok: false as const, reason: "invalid" as const };

  const identifierKey = `login:ident:${identifier.toLowerCase()}`;
  if (!(await authRateLimitAllows(identifierKey))) {
    const err = new Error("Too many attempts") as HttpError;
    err.status = 429;
    throw err;
  }

  let p: ProfileRow | null = null;
  for (const column of ["email", "student_id", "username", "employee_id"] as const) {
    p = await unwrap<ProfileRow | null>(
      db
        .from("profiles")
        .select("*")
        .ilike(column, identifier)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle(),
    );
    if (p) break;
  }
  if (!p) {
    dbgS("profile not found");
    await recordAuthFailure(identifierKey);
    return { ok: false as const, reason: "invalid" as const };
  }
  dbgS("profile found", {
    role: p.role,
    hasPinHash: !!p.pin_hash,
    locked: !!p.locked_until,
  });

  const now = Date.now();
  const lockedUntil = typeof p.locked_until === "string" ? Date.parse(p.locked_until) : 0;
  if (lockedUntil > now) {
    return {
      ok: false as const,
      reason: "locked" as const,
      retryAfterMinutes: Math.max(1, Math.ceil((lockedUntil - now) / 60000)),
    };
  }

  const profileKey = `login:profile:${p.id}`;
  if (!(await authRateLimitAllows(profileKey))) {
    const err = new Error("Too many attempts") as HttpError;
    err.status = 429;
    throw err;
  }

  if (!(await verifySecret(p, secret))) {
    await Promise.all([recordAuthFailure(identifierKey), recordAuthFailure(profileKey)]);
    const attempts =
      (typeof p.failed_login_attempts === "number" ? p.failed_login_attempts : 0) + 1;
    const lock = attempts >= LOGIN_MAX_ATTEMPTS;
    await db
      .from("profiles")
      .update({
        failed_login_attempts: lock ? 0 : attempts,
        locked_until: lock ? new Date(now + LOGIN_LOCK_MINUTES * 60000).toISOString() : null,
      })
      .eq("id", p.id);
    return lock
      ? { ok: false as const, reason: "locked" as const, retryAfterMinutes: LOGIN_LOCK_MINUTES }
      : {
          ok: false as const,
          reason: "invalid" as const,
          attemptsLeft: LOGIN_MAX_ATTEMPTS - attempts,
        };
  }

  if (p.failed_login_attempts || p.locked_until) {
    await db
      .from("profiles")
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq("id", p.id);
  }
  await Promise.all([
    clearAuthFailures(identifierKey),
    clearAuthFailures(profileKey),
    clearAuthFailures(`secret:${p.id ?? p.email ?? "unknown"}`),
  ]);
  dbgS("login success", { role: p.role });
  return { ok: true as const, profile: safeProfile(p), token: await createSessionToken(p.id) };
}

/* ---------- Self-service PIN change (clears the forced-change gate) ---------- */

const changeOwnPinSchema = z.object({
  token: z.string().min(1),
  current_pin: z.string().min(1).max(200).nullable().optional(),
  new_pin: z.string().min(1).max(200),
});

export function parseChangeOwnPinInput(data: unknown) {
  return changeOwnPinSchema.parse(data);
}

/**
 * Self-service PIN change: the caller proves identity with their signed
 * session (and optionally their current PIN), the new PIN must match the
 * existing PIN format rules, and the forced-change flag is cleared in the
 * same write. The same 5-per-15-minute rate limiting as sign-in applies
 * (dedicated change bucket + the shared per-profile PIN bucket when the
 * current PIN is verified).
 */
export async function changeOwnPin(token: string, newPin: string, currentPin?: string | null) {
  const { requireSession } = await import("@/lib/server/auth.server");
  const caller = await requireSession(token, { allowTemporaryPin: true });
  if (!(await consumeAuthAttempt(`pinchange:${caller.id}`))) {
    const err = new Error("Too many attempts") as HttpError;
    err.status = 429;
    throw err;
  }
  if (!isValidPinFormat(newPin)) throw new Error("New PIN must be 4–8 digits");
  const p = await unwrap<ProfileRow | null>(
    db.from("profiles").select("*").eq("id", caller.id).is("deleted_at", null).maybeSingle(),
  );
  if (!p) throw new Error("Profile not found");
  if (p.pin_must_change && (await verifySecret(p, newPin))) {
    throw new Error("Choose a different PIN from your temporary PIN.");
  }
  // Current PIN is optional proof on top of the session — when given it is
  // verified through the shared rate-limited PIN verifier.
  if (typeof currentPin === "string" && currentPin.length > 0) {
    if (!(await verifyPin(p, currentPin))) throw new Error("Current PIN is incorrect");
  }
  await unwrap(
    db
      .from("profiles")
      .update({
        pin_hash: await bcrypt.hash(newPin, 12),
        pin: null,
        pin_must_change: false,
        ...(p.pin_must_change ? { password_hash: null } : {}),
      })
      .eq("id", caller.id),
  );
  // A session established with the old temporary PIN must not gain access
  // after another session replaces it. Preserve only the current session.
  const currentJti = sessionJti(token);
  const sessions = await unwrap<Array<{ jti: string }>>(
    db.from("sessions").select("jti").eq("profile_id", caller.id).is("revoked_at", null),
  );
  const stale = sessions.filter((s) => s.jti !== currentJti).map((s) => s.jti);
  if (stale.length)
    await unwrap(
      db.from("sessions").update({ revoked_at: new Date().toISOString() }).in("jti", stale),
    );
  return getProfileById(caller.id);
}

/* ---------- Profile CRUD ---------- */

export async function getProfileById(id: string) {
  const p = await unwrap<ProfileRow | null>(
    db.from("profiles").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
  );
  return p ? safeProfile(p) : null;
}

export async function createProfile(input: z.infer<typeof schemas.profileInput>) {
  const row: Record<string, unknown> = withoutToken(input);
  if (typeof row["email"] === "string")
    row["email"] = (row["email"] as string).trim().toLowerCase();
  await assertUniqueIdentity({
    email: (row["email"] as string | null) ?? null,
    student_id: (row["student_id"] as string | null) ?? null,
    rfid_uid: (row["rfid_uid"] as string | null) ?? null,
  });
  if (typeof row["pin"] === "string" && row["pin"]) {
    row["pin_hash"] = await bcrypt.hash(row["pin"], 10);
    row["pin"] = null;
    row["pin_must_change"] = true;
  }
  const p = await unwrap<ProfileRow>(db.from("profiles").insert(row).select().single());
  return safeProfile(p);
}

const SELF_PATCH_KEYS = ["full_name", "email", "avatar_url", "pin"];

export function selfServicePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SELF_PATCH_KEYS) {
    if (key in patch) out[key] = patch[key];
  }
  if (Object.keys(out).length === 0) throw new Error("Forbidden");
  return out;
}

const CREDENTIAL_KEYS = ["pin", "rfid_uid", "email", "username", "password"];

export async function authorizeProfileUpdate(
  token: string,
  targetId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Import dynamically to avoid circular deps
  const { requireSession } = await import("@/lib/server/auth.server");
  const caller = await requireSession(token);
  if (caller.id === targetId) {
    const allowed = caller.role === "student" ? selfServicePatch(patch) : patch;
    return hasPinWrite(allowed) ? { ...allowed, pin_must_change: false } : allowed;
  }
  if (caller.role === "student") throw new Error("Forbidden");

  const target = await getProfileById(targetId);
  if (!target) throw new Error("Profile not found");

  if (target.role !== "student" && caller.role !== "admin") {
    throw new Error("Forbidden: only an administrator may edit staff accounts.");
  }
  if (caller.role !== "admin") {
    const touched = CREDENTIAL_KEYS.filter((k) => k in patch);
    if (touched.length > 0) {
      throw new Error("Forbidden: only an administrator may change login credentials.");
    }
  }
  return patch;
}

export async function updateProfile(id: string, patch: Record<string, unknown>) {
  const row = { ...patch };
  if (typeof row["email"] === "string" && row["email"]) {
    row["email"] = (row["email"] as string).trim().toLowerCase();
  }
  await assertUniqueIdentity(
    {
      email: (row["email"] as string | null) ?? null,
      student_id: (row["student_id"] as string | null) ?? null,
      rfid_uid: (row["rfid_uid"] as string | null) ?? null,
      employee_id: (row["employee_id"] as string | null) ?? null,
    },
    id,
  );
  if (hasPinWrite(row)) {
    // Administrative resets issue temporary PINs; self-service callers
    // explicitly clear the flag after choosing their own PIN.
    row["pin_hash"] = await bcrypt.hash(row["pin"] as string, 10);
    row["pin"] = null;
    row["pin_must_change"] = row["pin_must_change"] !== false;
  }
  await unwrap(db.from("profiles").update(row).eq("id", id));
  if ("role" in row || "pin_hash" in row || "password_hash" in row) {
    await revokeSessions(id);
  }
}

export async function updateTeacherSettings(teacherId: string, patch: Record<string, unknown>) {
  if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
  await updateProfile(teacherId, hasPinWrite(patch) ? { ...patch, pin_must_change: false } : patch);
  const fresh = await getProfileById(teacherId);
  if (!fresh) throw new Error("Unauthorized");
  return fresh;
}

export async function deleteUser(adminId: string, id: string) {
  if (adminId === id) throw new Error("You can't remove your own account");
  const target = await unwrap<{ id: string; role: ProfileRole; full_name: string } | null>(
    db
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  if (!target) throw new Error("User not found");
  if (target.role === "admin") {
    const admins = await unwrap<Array<{ id: string }>>(
      db.from("profiles").select("id").eq("role", "admin").is("deleted_at", null),
    );
    if (admins.length <= 1) throw new Error("You can't remove the last remaining admin");
  }
  const cleared = await unwrap<Array<{ id: string }>>(
    db.from("courses").update({ teacher_id: null }).eq("teacher_id", id).select("id"),
  );
  const stamp = new Date().toISOString();
  const tombstone = (value: unknown) =>
    typeof value === "string" && value && !value.startsWith("deleted:")
      ? `deleted:${stamp}:${value}`.slice(0, 300)
      : (value ?? null);
  const archived = await unwrap<{
    email: string | null;
    student_id: string | null;
    username: string | null;
    employee_id: string | null;
  } | null>(
    db
      .from("profiles")
      .select("email, student_id, username, employee_id")
      .eq("id", id)
      .maybeSingle(),
  );
  await unwrap(
    db
      .from("profiles")
      .update({
        deleted_at: stamp,
        rfid_uid: null,
        pin: null,
        pin_hash: null,
        password_hash: null,
        email: tombstone(archived?.email),
        student_id: tombstone(archived?.student_id),
        username: tombstone(archived?.username),
        employee_id: tombstone(archived?.employee_id),
      })
      .eq("id", id),
  );
  await revokeSessions(id);

  return { unassignedCourses: cleared.length };
}

export async function listStudents() {
  const rows = await unwrap<ProfileRow[]>(
    db.from("profiles").select("*").eq("role", "student").is("deleted_at", null).order("full_name"),
  );
  return rows.map(safeProfile);
}

export async function listStaff() {
  const rows = await unwrap<ProfileRow[]>(
    db
      .from("profiles")
      .select("*")
      .in("role", ["teacher", "admin"])
      .is("deleted_at", null)
      .order("full_name"),
  );
  return rows.map(safeProfile);
}

export async function listTeachers() {
  const rows = await unwrap<ProfileRow[]>(
    db.from("profiles").select("*").eq("role", "teacher").is("deleted_at", null).order("full_name"),
  );
  return rows.map(safeProfile);
}

export async function listTeacherDirectory() {
  const [rows, courses] = await Promise.all([
    unwrap<ProfileRow[]>(
      db
        .from("profiles")
        .select("*")
        .eq("role", "teacher")
        .is("deleted_at", null)
        .order("full_name"),
    ),
    unwrap<Array<{ id: string; title: string; code: string; teacher_id: string | null }>>(
      db.from("courses").select("id, title, code, teacher_id"),
    ),
  ]);
  return rows.map((r) => ({
    ...safeProfile(r),
    courses: courses
      .filter((c) => c.teacher_id === r.id)
      .map((c) => ({ id: c.id, title: c.title, code: c.code })),
  }));
}

export async function assertUniqueIdentity(
  fields: {
    email?: string | null;
    employee_id?: string | null;
    rfid_uid?: string | null;
    student_id?: string | null;
    username?: string | null;
  },
  exceptId?: string,
) {
  const checks: Array<[string, string, string]> = [];
  if (fields.email) checks.push(["email", fields.email.toLowerCase(), "email address"]);
  if (fields.employee_id) checks.push(["employee_id", fields.employee_id, "employee ID"]);
  if (fields.rfid_uid) checks.push(["rfid_uid", fields.rfid_uid, "RFID card"]);
  if (fields.student_id) checks.push(["student_id", fields.student_id, "student ID"]);
  if (fields.username) checks.push(["username", fields.username, "username"]);

  for (const [column, value, label] of checks) {
    const hits = await unwrap<Array<{ id: string }>>(
      db.from("profiles").select("id").ilike(column, value).is("deleted_at", null),
    );
    if (hits.some((h) => h.id !== exceptId)) {
      throw new Error(`That ${label} is already registered to another account`);
    }
  }
}

export async function createTeacher(input: z.infer<typeof schemas.teacherInput>) {
  const row = withoutToken(input) as Record<string, unknown>;
  const email = input.email.trim().toLowerCase();
  await assertUniqueIdentity({
    email,
    employee_id: input.employee_id,
    rfid_uid: input.rfid_uid ?? null,
  });
  row["email"] = email;
  row["role"] = "teacher";
  row["pin_must_change"] = true;
  row["pin_hash"] = await bcrypt.hash(input.pin, 12);
  row["pin"] = null;
  row["username"] = input.employee_id.trim();
  if (!row["rfid_uid"]) row["rfid_uid"] = null;
  const created = await unwrap<ProfileRow>(db.from("profiles").insert(row).select().single());

  return { ...safeProfile(created), courses: [] as { id: string; title: string; code: string }[] };
}

export async function enrollBiometrics(id: string, fields: { rfid_uid?: string | null }) {
  const row: Record<string, unknown> = {};
  if ("rfid_uid" in fields) row["rfid_uid"] = fields.rfid_uid ?? null;
  if (Object.keys(row).length === 0) throw new Error("Nothing to enroll");
  if (fields.rfid_uid) await assertUniqueIdentity({ rfid_uid: fields.rfid_uid }, id);
  await unwrap(db.from("profiles").update(row).eq("id", id));
  const fresh = await getProfileById(id);
  if (!fresh) throw new Error("User not found");
  return fresh;
}

export async function listAllUsers() {
  const rows = await unwrap<ProfileRow[]>(
    db.from("profiles").select("*").is("deleted_at", null).order("full_name"),
  );
  return rows.map(safeProfile);
}

export async function updateUserRole(
  adminId: string,
  id: string,
  role: "student" | "teacher" | "admin",
) {
  if (adminId === id) throw new Error("You can't change your own role");
  const target = await getProfileById(id);
  if (!target) throw new Error("User not found");
  if (target.role === "admin" && role !== "admin") {
    const admins = await unwrap<Array<{ id: string }>>(
      db.from("profiles").select("id").eq("role", "admin").is("deleted_at", null),
    );
    if (admins.length <= 1) throw new Error("You can't demote the last remaining admin");
  }
  let unassignedCourses = 0;
  if (role === "student" && target.role !== "student") {
    const cleared = await unwrap<Array<{ id: string }>>(
      db.from("courses").update({ teacher_id: null }).eq("teacher_id", id).select("id"),
    );
    unassignedCourses = cleared.length;
  }
  await unwrap(db.from("profiles").update({ role }).eq("id", id));
  await revokeSessions(id);
  const profile = await getProfileById(id);
  if (!profile) throw new Error("User not found after update");
  return { profile, unassignedCourses };
}

/* ---------- File-type sniff (file-type pkg or magic-byte fallback) ---------- */

const AVATAR_ALLOWED_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function detectMimeByMagic(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
    return "application/pdf";
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0)
    return "application/msword";
  if (
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
    (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)
  )
    return "application/zip";
  return null;
}

async function sniffMime(buffer: Buffer): Promise<string | null> {
  try {
    const { fileTypeFromBuffer } = await import("file-type");
    const ft = await fileTypeFromBuffer(buffer);
    if (ft?.mime) return ft.mime;
  } catch {
    // file-type unavailable — fallback to magic bytes
  }
  return detectMimeByMagic(buffer);
}

/* ---------- Avatar upload pipeline ---------- */

const AVATAR_BUCKET = "avatars";
const AVATAR_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function avatarUrlForPath(path: string): string {
  return `/api/public/avatar?p=${encodeURIComponent(path)}`;
}

export async function uploadAvatar(tokenStr: string, base64: string, contentType: string) {
  const { requireSession } = await import("@/lib/server/auth.server");
  const caller = await requireSession(tokenStr);
  const ext = AVATAR_EXT[contentType];
  if (!ext) throw new Error("Unsupported image type — use PNG, JPEG, WebP, or GIF");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) throw new Error("Empty image");
  if (buffer.byteLength > 2 * 1024 * 1024) throw new Error("Image must be under 2 MB");
  const sniffed = await sniffMime(buffer);
  if (!sniffed || !AVATAR_ALLOWED_MIMES.has(sniffed))
    throw new Error(
      `Unsupported image content (${sniffed ?? "unknown"}) — use PNG, JPEG, WebP, or GIF`,
    );
  if (sniffed !== contentType)
    throw new Error(`MIME mismatch: declared ${contentType} but file is ${sniffed}`);
  const { createHmac, randomUUID } = await import("node:crypto");
  const rand = createHmac("sha256", sessionSecret())
    .update(`${caller.id}:${Date.now()}:${randomUUID()}`)
    .digest("hex")
    .slice(0, 16);
  const path = `${caller.id}/avatar_${Date.now()}_${rand}.${ext}`;
  const { error } = await storage
    .from(AVATAR_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });
  if (error) throw new Error(`Storage upload failed (${error.message})`);
  const previous = caller.avatar_url;
  await unwrap(
    db
      .from("profiles")
      .update({ avatar_url: avatarUrlForPath(path) })
      .eq("id", caller.id),
  );
  try {
    const m = previous?.match(/[?&]p=([^&]+)/);
    const old = m ? decodeURIComponent(m[1]!) : null;
    if (old && old.startsWith(`${caller.id}/`) && old !== path) {
      await storage.from(AVATAR_BUCKET).remove([old]);
    }
  } catch {
    /* cleanup is best-effort */
  }
  return getProfileById(caller.id);
}
