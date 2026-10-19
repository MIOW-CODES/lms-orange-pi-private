import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

const MIGRATION_DIR = path.resolve(import.meta.dir, "..", "db", "migrations");
const MIGRATION_NAME = /^(\d{14})_([a-z0-9][a-z0-9_-]*)\.sql$/i;
const LOCK_CLASS = 1_337_020;
const LOCK_OBJECT = 20_261_020;
const APP_ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const UNSUPPORTED_TRANSACTIONAL_SQL =
  /\b(?:CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|DROP\s+INDEX\s+CONCURRENTLY|REINDEX\s+(?:(?:INDEX|TABLE|SCHEMA|DATABASE|SYSTEM)\s+)?CONCURRENTLY|VACUUM|CREATE\s+DATABASE|DROP\s+DATABASE|ALTER\s+SYSTEM)\b/i;

export type Migration = { id: string; fileName: string; checksum: string; sql: string };
type AppliedMigration = { id: string; file_name: string; checksum: string };

function requiredMigratorUrl(): string {
  const value = process.env["MIGRATOR_DATABASE_URL"]?.trim();
  if (!value) throw new Error("MIGRATOR_DATABASE_URL is required for schema migrations");
  return value;
}

export async function loadMigrations(directory = MIGRATION_DIR): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  if (!names.length) throw new Error("No native PostgreSQL migrations were found");

  const seenIds = new Set<string>();
  const migrations: Migration[] = [];
  for (const fileName of names) {
    const match = MIGRATION_NAME.exec(fileName);
    if (!match) throw new Error("Migration filename does not use the required unique ID format");
    const id = match[1]!;
    if (seenIds.has(id)) throw new Error("Duplicate migration ID found");
    seenIds.add(id);

    const sql = await readFile(path.join(directory, fileName), "utf8");
    if (!sql.trim()) throw new Error("Empty SQL migration found");
    if (
      /\bauth\s*\.|\bstorage\s*\.(?:objects|buckets)\b|\b(?:anon|authenticated|service_role)\b|\bCREATE\s+POLICY\b|\b(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b|\bSECURITY\s+DEFINER\b/i.test(
        sql,
      )
    ) {
      throw new Error(
        "Migration contains a hosted-auth, row-policy, or definer-security dependency",
      );
    }
    if (UNSUPPORTED_TRANSACTIONAL_SQL.test(sql)) {
      throw new Error("Migration contains a command that cannot run transactionally");
    }

    migrations.push({
      id,
      fileName,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  return migrations;
}

async function ensureLedger(client: PoolClient): Promise<void> {
  const schema = await client.query<{ exists: boolean }>(
    "SELECT to_regnamespace('private') IS NOT NULL AS exists",
  );
  if (!schema.rows[0]?.exists)
    throw new Error("The private schema must be provisioned before migrations run");
  await client.query("REVOKE ALL ON SCHEMA private FROM PUBLIC");
  await client.query(`
    CREATE TABLE IF NOT EXISTS private.schema_migrations (
      migration_id text PRIMARY KEY,
      file_name text NOT NULL UNIQUE,
      checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query("REVOKE ALL ON private.schema_migrations FROM PUBLIC");
}

function runtimeRole(): string {
  const role = (process.env["APP_DATABASE_ROLE"] ?? "miow_app").trim();
  if (!APP_ROLE_NAME.test(role))
    throw new Error("APP_DATABASE_ROLE must be a simple PostgreSQL role name");
  return `"${role}"`;
}

async function configureRuntimePrivileges(client: PoolClient): Promise<void> {
  const roleName = (process.env["APP_DATABASE_ROLE"] ?? "miow_app").trim();
  const role = runtimeRole();
  const { rows } = await client.query<{
    migration_role: string;
    role_can_login: boolean;
    role_superuser: boolean;
    role_createdb: boolean;
    role_createrole: boolean;
    role_replication: boolean;
    role_bypassrls: boolean;
    role_is_migration_member: boolean;
    role_has_membership: boolean;
    migration_superuser: boolean;
    migration_createdb: boolean;
    migration_createrole: boolean;
    migration_replication: boolean;
    migration_bypassrls: boolean;
    migration_has_membership: boolean;
  }>(
    `SELECT current_user AS migration_role,
            migration_account.rolsuper AS migration_superuser,
            migration_account.rolcreatedb AS migration_createdb,
            migration_account.rolcreaterole AS migration_createrole,
            migration_account.rolreplication AS migration_replication,
            migration_account.rolbypassrls AS migration_bypassrls,
            EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m WHERE m.member = migration_account.oid)
              AS migration_has_membership,
            target.rolcanlogin AS role_can_login,
            target.rolsuper AS role_superuser,
            target.rolcreatedb AS role_createdb,
            target.rolcreaterole AS role_createrole,
            target.rolreplication AS role_replication,
            target.rolbypassrls AS role_bypassrls,
            pg_has_role(target.rolname, current_user, 'MEMBER') AS role_is_migration_member,
            EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m WHERE m.member = target.oid)
              AS role_has_membership
       FROM pg_catalog.pg_roles AS target
       JOIN pg_catalog.pg_roles AS migration_account ON migration_account.rolname = current_user
      WHERE target.rolname = $1`,
    [roleName],
  );
  const runtime = rows[0];
  if (
    !runtime ||
    runtime.migration_superuser ||
    runtime.migration_createdb ||
    runtime.migration_createrole ||
    runtime.migration_replication ||
    runtime.migration_bypassrls ||
    runtime.migration_has_membership ||
    runtime.migration_role === roleName ||
    !runtime.role_can_login ||
    runtime.role_superuser ||
    runtime.role_createdb ||
    runtime.role_createrole ||
    runtime.role_replication ||
    runtime.role_bypassrls ||
    runtime.role_is_migration_member ||
    runtime.role_has_membership
  ) {
    throw new Error("Runtime database role must be a distinct, non-privileged login role");
  }
  const databaseResult = await client.query<{ name: string }>("SELECT current_database() AS name");
  const database = `"${databaseResult.rows[0]!.name.replaceAll('"', '""')}"`;
  await client.query(`REVOKE CREATE, TEMP ON DATABASE ${database} FROM ${role}`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  await client.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
  await client.query(`REVOKE ALL ON SCHEMA public FROM ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await client.query("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC");
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
  await client.query("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC");
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`);
  await client.query("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC");
  await client.query(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM ${role}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
  );
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);
  await client.query("ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC");
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${role}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`,
  );
}

export async function applyMigrations(pool: Pool, migrations: Migration[]): Promise<number> {
  if (!migrations.length) throw new Error("No native PostgreSQL migrations were provided");
  const ids = new Set<string>();
  for (const migration of migrations) {
    const match = MIGRATION_NAME.exec(migration.fileName);
    if (!match || match[1] !== migration.id || ids.has(migration.id)) {
      throw new Error("Migration set contains an invalid or duplicate migration ID");
    }
    const actualChecksum = createHash("sha256").update(migration.sql).digest("hex");
    if (actualChecksum !== migration.checksum) {
      throw new Error("Migration set contains a mismatched checksum");
    }
    ids.add(migration.id);
  }

  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [LOCK_CLASS, LOCK_OBJECT]);
    locked = true;
    await ensureLedger(client);

    const { rows } = await client.query<AppliedMigration>(
      "SELECT migration_id AS id, file_name, checksum FROM private.schema_migrations",
    );
    const applied = new Map(rows.map((row) => [row.id, row]));
    const localIds = new Set(migrations.map((migration) => migration.id));
    if ([...applied.keys()].some((id) => !localIds.has(id))) {
      throw new Error("Database has migration history that is absent from this release");
    }
    for (const migration of migrations) {
      const previous = applied.get(migration.id);
      if (
        previous &&
        (previous.file_name !== migration.fileName || previous.checksum !== migration.checksum)
      ) {
        throw new Error("An applied migration differs from the checked-in migration");
      }
    }

    let ran = 0;
    for (const migration of migrations) {
      const previous = applied.get(migration.id);
      if (previous) {
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL statement_timeout = '120s'");
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO private.schema_migrations (migration_id, file_name, checksum) VALUES ($1, $2, $3)",
          [migration.id, migration.fileName, migration.checksum],
        );
        await client.query("COMMIT");
        ran++;
        console.log(`[migrate] applied ${migration.id}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = (error as { code?: string })?.code ?? "unknown";
        console.error(`[migrate] ${migration.id} failed with SQLSTATE ${code}; rolled back`);
        throw new Error("A native PostgreSQL migration failed");
      }
    }
    await client.query("BEGIN");
    try {
      await configureRuntimePrivileges(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    return ran;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_CLASS, LOCK_OBJECT]);
    client.release();
  }
}

async function main(): Promise<void> {
  const migrations = await loadMigrations();
  const pool = new Pool({
    connectionString: requiredMigratorUrl(),
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });
  try {
    const count = await applyMigrations(pool, migrations);
    console.log(
      `[migrate] complete; applied ${count} new migration(s), verified ${migrations.length} total`,
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  });
}
