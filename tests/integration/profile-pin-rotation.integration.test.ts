import { afterAll, beforeAll, expect, it } from "bun:test";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { _setPoolForTests } from "@/integrations/db/client.server";

if (process.env["MIOW_PG_INTEGRATION_RUN"] !== "1") {
  throw new Error("Run native PostgreSQL integration tests with `bun run test:integration`.");
}

const databaseUrl = process.env["DATABASE_URL"]?.trim();
const migratorUrl = process.env["MIGRATOR_DATABASE_URL"]?.trim();
if (!databaseUrl || !migratorUrl) {
  throw new Error(
    "DATABASE_URL and MIGRATOR_DATABASE_URL are required for native PostgreSQL integration tests",
  );
}

const app = new Pool({ connectionString: databaseUrl, max: 3 });
const migrator = new Pool({ connectionString: migratorUrl, max: 1 });
const originalSessionSecret = process.env["SESSION_SECRET"];
const profileIds: string[] = [];
const priorAdminIds: string[] = [];
const authKeys: string[] = [];
let failureTriggerName: string | undefined;
let failureFunctionName: string | undefined;

let changeOwnPin: typeof import("@/lib/server/profiles.server").changeOwnPin;
let deleteUser: typeof import("@/lib/server/profiles.server").deleteUser;
let updateProfile: typeof import("@/lib/server/profiles.server").updateProfile;
let updateUserRole: typeof import("@/lib/server/profiles.server").updateUserRole;
let createSessionToken: typeof import("@/lib/server/sessions.server").createSessionToken;
let requireSession: typeof import("@/lib/server/auth.server").requireSession;
let verifyPinLogin: typeof import("@/lib/server/profiles.server").verifyPinLogin;

beforeAll(async () => {
  process.env["SESSION_SECRET"] = randomBytes(32).toString("hex");
  _setPoolForTests(app);
  ({ changeOwnPin, deleteUser, updateProfile, updateUserRole, verifyPinLogin } =
    await import("@/lib/server/profiles.server"));
  ({ createSessionToken } = await import("@/lib/server/sessions.server"));
  ({ requireSession } = await import("@/lib/server/auth.server"));
});

afterAll(async () => {
  try {
    if (failureTriggerName) {
      await migrator.query(`DROP TRIGGER IF EXISTS ${failureTriggerName} ON public.sessions`);
    }
    if (failureFunctionName) {
      await migrator.query(`DROP FUNCTION IF EXISTS private.${failureFunctionName}()`);
    }
    const hashedKeys = [...new Set(authKeys)].map((key) =>
      createHash("sha256").update(key).digest("hex"),
    );
    if (hashedKeys.length > 0) {
      await migrator.query(
        "DELETE FROM public.auth_rate_limits WHERE bucket_key = ANY($1::text[])",
        [hashedKeys],
      );
    }
    if (priorAdminIds.length > 0) {
      await migrator.query(
        "UPDATE public.profiles SET role = 'admin' WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL",
        [priorAdminIds],
      );
    }
    if (profileIds.length > 0) {
      await migrator.query("DELETE FROM public.profiles WHERE id = ANY($1::uuid[])", [profileIds]);
    }
  } finally {
    _setPoolForTests(undefined);
    if (originalSessionSecret === undefined) delete process.env["SESSION_SECRET"];
    else process.env["SESSION_SECRET"] = originalSessionSecret;
    await Promise.all([app.end(), migrator.end()]);
  }
});

async function createSyntheticAccount(role: "student" | "teacher" | "admin" = "student") {
  const id = randomUUID();
  const studentId = `synthetic-pin-rotation-${id}`;
  const temporaryPin = `Temporary-${randomBytes(12).toString("hex")}`;
  const newPin = String(randomInt(1_000_000, 10_000_000));
  const pinHash = await bcrypt.hash(temporaryPin, 10);
  const passwordHash = await bcrypt.hash(
    `synthetic-password-${randomBytes(16).toString("hex")}`,
    10,
  );

  profileIds.push(id);
  authKeys.push(
    `login:ident:${studentId}`,
    `login:profile:${id}`,
    `pin:${id}`,
    `secret:${id}`,
    `pinchange:${id}`,
  );
  await migrator.query(
    `INSERT INTO public.profiles
       (id, student_id, full_name, role, pin_hash, password_hash, pin_must_change)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [id, studentId, "Synthetic PIN rotation test", role, pinHash, passwordHash],
  );
  return { id, studentId, temporaryPin, newPin, pinHash, passwordHash, role };
}

async function signIn(studentId: string, pin: string): Promise<string> {
  const result = await verifyPinLogin(studentId, pin);
  if (!result.ok || !result.token) throw new Error("Synthetic test account sign-in failed");
  return result.token;
}

it("does not persist auth rate-limit rows for nonexistent login identifiers", async () => {
  const login = `synthetic-missing-${randomUUID()}`;
  const loginKey = `login:ident:${login}`;
  authKeys.push(loginKey);

  const result = await verifyPinLogin(login, "synthetic-invalid-secret");

  expect(result).toEqual({ ok: false, reason: "invalid" });
  const bucketKey = createHash("sha256").update(loginKey).digest("hex");
  const bucket = await migrator.query(
    "SELECT 1 FROM public.auth_rate_limits WHERE bucket_key = $1",
    [bucketKey],
  );
  expect(bucket.rows).toHaveLength(0);
});

it("commits a PIN rotation with revocation and keeps only the caller session active", async () => {
  const account = await createSyntheticAccount();
  const currentToken = await signIn(account.studentId, account.temporaryPin);
  const staleToken = await createSessionToken(account.id);

  const updated = await changeOwnPin(currentToken, account.newPin);

  expect(updated?.pin_must_change).toBe(false);
  expect((await requireSession(currentToken)).id).toBe(account.id);
  await expect(requireSession(staleToken, { allowTemporaryPin: true })).rejects.toThrow(
    "Unauthorized",
  );
  expect((await verifyPinLogin(account.studentId, account.temporaryPin)).ok).toBe(false);
  expect((await verifyPinLogin(account.studentId, account.newPin)).ok).toBe(true);
});

it("commits profile PIN resets with revocation of every existing session", async () => {
  const account = await createSyntheticAccount();
  const firstToken = await createSessionToken(account.id);
  const secondToken = await createSessionToken(account.id);

  await updateProfile(account.id, { pin: account.newPin });

  const profile = (
    await migrator.query<{ pin_hash: string; pin_must_change: boolean }>(
      "SELECT pin_hash, pin_must_change FROM public.profiles WHERE id = $1",
      [account.id],
    )
  ).rows[0];
  expect(profile?.pin_hash).not.toBe(account.pinHash);
  expect(profile?.pin_must_change).toBe(true);
  await expect(requireSession(firstToken, { allowTemporaryPin: true })).rejects.toThrow(
    "Unauthorized",
  );
  await expect(requireSession(secondToken, { allowTemporaryPin: true })).rejects.toThrow(
    "Unauthorized",
  );
});

it("commits role changes with revocation of every existing session", async () => {
  const account = await createSyntheticAccount();
  const token = await createSessionToken(account.id);

  const result = await updateUserRole(randomUUID(), account.id, "teacher");

  expect(result.profile.role).toBe("teacher");
  expect(result.unassignedCourses).toBe(0);
  await expect(requireSession(token, { allowTemporaryPin: true })).rejects.toThrow("Unauthorized");
});

it("serializes concurrent admin demotion and deletion so an administrator remains", async () => {
  const existingAdmins = await migrator.query<{
    id: string;
    email: string | null;
    student_id: string | null;
  }>(
    `SELECT id, email, student_id
       FROM public.profiles
      WHERE role = 'admin' AND deleted_at IS NULL`,
  );
  const unexpectedAdmin = existingAdmins.rows.some(
    (row) =>
      row.email !== "admin@example.test" && !row.student_id?.startsWith("synthetic-pin-rotation-"),
  );
  if (unexpectedAdmin) {
    throw new Error("Refusing to modify non-synthetic administrators in the integration database");
  }
  priorAdminIds.push(...existingAdmins.rows.map((row) => row.id));
  if (priorAdminIds.length > 0) {
    await migrator.query("UPDATE public.profiles SET role = 'teacher' WHERE id = ANY($1::uuid[])", [
      priorAdminIds,
    ]);
  }

  const firstAdmin = await createSyntheticAccount("admin");
  const secondAdmin = await createSyntheticAccount("admin");
  const outcomes = await Promise.allSettled([
    deleteUser(firstAdmin.id, secondAdmin.id),
    updateUserRole(secondAdmin.id, firstAdmin.id, "teacher"),
  ]);

  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  const remainingAdmins = await migrator.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM public.profiles WHERE role = 'admin' AND deleted_at IS NULL",
  );
  expect(remainingAdmins.rows[0]?.count).toBe("1");
});

it("rolls back the PIN update when revoking stale sessions fails", async () => {
  const account = await createSyntheticAccount();
  const currentToken = await signIn(account.studentId, account.temporaryPin);
  const staleToken = await createSessionToken(account.id);
  const suffix = randomUUID().replaceAll("-", "");
  failureTriggerName = `synthetic_pin_rotation_failure_${suffix}`;
  failureFunctionName = `synthetic_pin_rotation_failure_${suffix}`;

  await migrator.query(`
    CREATE FUNCTION private.${failureFunctionName}() RETURNS trigger
    LANGUAGE plpgsql AS $body$
    BEGIN
      IF NEW.profile_id = '${account.id}'::uuid AND NEW.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'synthetic revocation failure';
      END IF;
      RETURN NEW;
    END
    $body$
  `);
  await migrator.query(`
    CREATE TRIGGER ${failureTriggerName}
    BEFORE UPDATE ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.${failureFunctionName}()
  `);

  await expect(changeOwnPin(currentToken, account.newPin)).rejects.toThrow(
    "synthetic revocation failure",
  );
  await expect(updateProfile(account.id, { pin: account.newPin })).rejects.toThrow(
    "synthetic revocation failure",
  );
  await expect(updateUserRole(randomUUID(), account.id, "teacher")).rejects.toThrow(
    "synthetic revocation failure",
  );
  await expect(deleteUser(randomUUID(), account.id)).rejects.toThrow(
    "synthetic revocation failure",
  );

  const profile = (
    await migrator.query<{
      pin_hash: string;
      password_hash: string;
      pin_must_change: boolean;
      role: string;
      deleted_at: string | null;
    }>(
      "SELECT pin_hash, password_hash, pin_must_change, role, deleted_at FROM public.profiles WHERE id = $1",
      [account.id],
    )
  ).rows[0];
  expect(profile).toEqual({
    pin_hash: account.pinHash,
    password_hash: account.passwordHash,
    pin_must_change: true,
    role: "student",
    deleted_at: null,
  });

  const activeSessions = await migrator.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM public.sessions WHERE profile_id = $1 AND revoked_at IS NULL",
    [account.id],
  );
  expect(activeSessions.rows[0]?.count).toBe("2");
  expect((await requireSession(currentToken, { allowTemporaryPin: true })).id).toBe(account.id);
  expect((await requireSession(staleToken, { allowTemporaryPin: true })).id).toBe(account.id);
});
