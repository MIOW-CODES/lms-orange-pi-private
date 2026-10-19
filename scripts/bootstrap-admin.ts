import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { z } from "zod";

const NAME = z.string().trim().min(1).max(200);
const EMAIL = z.string().trim().email().max(320);
const BOOTSTRAP_LOCK = [1_337_022, 20_261_020] as const;

function requiredMigratorUrl(): string {
  const value = process.env["MIGRATOR_DATABASE_URL"]?.trim();
  if (!value) throw new Error("MIGRATOR_DATABASE_URL is required for administrator bootstrap");
  return value;
}

async function collectAdminIdentity(): Promise<{ fullName: string; email: string }> {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const fullName = NAME.parse(await prompt.question("Administrator name: "));
    const email = EMAIL.parse(await prompt.question("Administrator email: ")).toLowerCase();
    return { fullName, email };
  } finally {
    prompt.close();
  }
}

export async function provisionFirstAdmin(
  pool: Pool,
  identity: { fullName: string; email: string },
): Promise<string> {
  const fullName = NAME.parse(identity.fullName);
  const email = EMAIL.parse(identity.email).toLowerCase();
  const temporaryPassword = randomBytes(32).toString("base64url");
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [...BOOTSTRAP_LOCK]);
    const existing = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.profiles WHERE role = 'admin' AND deleted_at IS NULL",
    );
    if ((existing.rows[0]?.count ?? 0) > 0) {
      throw new Error("An active administrator already exists; bootstrap is one-time.");
    }

    await client.query(
      `INSERT INTO public.profiles
         (email, full_name, role, password_hash, pin_must_change)
       VALUES ($1, $2, 'admin', $3, true)`,
      [email, fullName, passwordHash],
    );
    await client.query("COMMIT");
    return temporaryPassword;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = (error as { code?: string })?.code;
    if (code === "23505") throw new Error("An administrator with that email already exists.");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const identity = await collectAdminIdentity();
  const pool = new Pool({
    connectionString: requiredMigratorUrl(),
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });
  let temporaryPassword: string;
  try {
    temporaryPassword = await provisionFirstAdmin(pool, identity);
  } finally {
    await pool.end();
  }

  console.log("Administrator created. Sign in with the email above and this temporary password:");
  console.log(temporaryPassword);
  console.log(
    "The first sign-in will require setting a personal PIN. Store this password securely until then.",
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Administrator bootstrap failed");
    process.exitCode = 1;
  });
}
