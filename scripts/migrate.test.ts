import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Pool, type PoolClient } from "pg";
import { provisionFirstAdmin } from "./bootstrap-admin";
import { applyMigrations, loadMigrations, type Migration } from "./migrate";

const db = new PGlite();
const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 4 });
let migrator: Pool;
let migrations: Migration[];

beforeAll(async () => {
  await db.waitReady;
  await db.exec(`
    CREATE ROLE miow_migrator LOGIN PASSWORD 'migrator-test' NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
    CREATE ROLE miow_app LOGIN PASSWORD 'runtime-test' NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
    GRANT CONNECT ON DATABASE postgres TO miow_migrator, miow_app;
    ALTER DATABASE postgres OWNER TO miow_migrator;
    ALTER SCHEMA public OWNER TO miow_migrator;
    CREATE SCHEMA private AUTHORIZATION miow_migrator;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO miow_app;
  `);
  await server.start();
  const connection = server.getServerConn();
  migrator = new Pool({
    connectionString: `postgres://postgres:postgres@${connection}/postgres`,
    max: 1,
  });
  const migrationClient = await migrator.connect();
  await migrationClient.query("SET ROLE miow_migrator");
  migrationClient.release();
  migrations = await loadMigrations();
});

afterAll(async () => {
  await migrator?.end();
  await server.stop();
  await db.close();
});

function migration(id: string, name: string, sql: string): Migration {
  const fileName = `${id}_${name}.sql`;
  return { id, fileName, sql, checksum: createHash("sha256").update(sql).digest("hex") };
}

describe("migration file preflight", () => {
  it("rejects hosted-security and nontransactional SQL before connecting", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "miow-migrations-"));
    const file = path.join(directory, "20261020000000_probe.sql");
    try {
      await writeFile(file, "CREATE INDEX CONCURRENTLY probe_idx ON probe_table (id);");
      await expect(loadMigrations(directory)).rejects.toThrow(
        "Migration contains a command that cannot run transactionally",
      );

      await writeFile(
        file,
        "CREATE FUNCTION public.probe() RETURNS void SECURITY DEFINER LANGUAGE sql AS $$ SELECT $$;",
      );
      await expect(loadMigrations(directory)).rejects.toThrow("definer-security dependency");

      await writeFile(file, "CREATE POLICY probe ON public.profiles USING (true);");
      await expect(loadMigrations(directory)).rejects.toThrow("row-policy");

      await writeFile(file, "SELECT 1;");
      expect(await loadMigrations(directory)).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function asRuntimeRole<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await migrator.connect();
  try {
    await client.query("RESET ROLE");
    await client.query("SET ROLE miow_app");
    return await run(client);
  } finally {
    await client.query("RESET ROLE");
    await client.query("SET ROLE miow_migrator");
    client.release();
  }
}

describe("native PostgreSQL migration runner", () => {
  it("applies the clean baseline, grants only runtime DML, rejects drift, and rolls back failures", async () => {
    expect(migrations).toHaveLength(1);
    expect(await applyMigrations(migrator, migrations)).toBe(1);
    expect(await applyMigrations(migrator, migrations)).toBe(0);

    const ledger = await migrator.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM private.schema_migrations",
    );
    expect(ledger.rows[0]?.count).toBe("1");
    const schema = await migrator.query<{
      relation_count: number;
      profile_count: string;
      view_options: string[] | null;
    }>(`
      SELECT (SELECT count(*)::integer
                FROM pg_catalog.pg_class AS c
                JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')) AS relation_count,
             (SELECT count(*)::text FROM public.profiles) AS profile_count,
             (SELECT reloptions FROM pg_catalog.pg_class WHERE oid = 'public.question_bank'::regclass) AS view_options
    `);
    expect(schema.rows[0]?.relation_count).toBe(34);
    expect(schema.rows[0]?.profile_count).toBe("0");
    expect(schema.rows[0]?.view_options).toContain("security_invoker=true");
    await migrator.query("CREATE TABLE public.future_grant_probe (id integer PRIMARY KEY)");

    await asRuntimeRole(async (client) => {
      const runtimeUser = await client.query<{ current_user: string }>("SELECT current_user");
      expect(runtimeUser.rows[0]?.current_user).toBe("miow_app");
      expect((await client.query("SELECT count(*) FROM public.profiles")).rows).toHaveLength(1);
      await client.query("INSERT INTO public.future_grant_probe (id) VALUES (1)");
      expect((await client.query("SELECT id FROM public.future_grant_probe")).rows[0]?.id).toBe(1);
      await expect(
        client.query("CREATE TABLE public.runtime_must_not_ddl (id integer)"),
      ).rejects.toThrow();
      await expect(client.query("TRUNCATE public.future_grant_probe")).rejects.toThrow();
      await expect(client.query("SELECT * FROM private.schema_migrations")).rejects.toThrow();
    });
    await migrator.query("DROP TABLE public.future_grant_probe");

    const failed = migration(
      "20261020000001",
      "rollback_probe",
      "CREATE TABLE public.migration_rollback_probe (id integer); SELECT 1 / 0;",
    );
    await expect(applyMigrations(migrator, [...migrations, failed])).rejects.toThrow(
      "A native PostgreSQL migration failed",
    );
    const rolledBack = await migrator.query<{ relation: string | null; count: string }>(`
      SELECT to_regclass('public.migration_rollback_probe')::text AS relation,
             count(*)::text AS count
        FROM private.schema_migrations
    `);
    expect(rolledBack.rows[0]?.relation).toBe(null);
    expect(rolledBack.rows[0]?.count).toBe("1");

    const retry = migration(
      "20261020000001",
      "rollback_probe",
      "CREATE TABLE public.migration_rollback_probe (id integer);",
    );
    expect(await applyMigrations(migrator, [...migrations, retry])).toBe(1);

    await migrator.query(`
      CREATE FUNCTION private.fail_test_migration_ledger_insert() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.migration_id = '20261020000002' THEN
            RAISE EXCEPTION 'injected migration-ledger failure';
          END IF;
          RETURN NEW;
        END
        $$;
      CREATE TRIGGER fail_test_migration_ledger_insert
        BEFORE INSERT ON private.schema_migrations
        FOR EACH ROW EXECUTE FUNCTION private.fail_test_migration_ledger_insert();
    `);
    const ledgerFailure = migration(
      "20261020000002",
      "ledger_rollback_probe",
      "CREATE TABLE public.ledger_rollback_probe (id integer);",
    );
    await expect(applyMigrations(migrator, [...migrations, retry, ledgerFailure])).rejects.toThrow(
      "A native PostgreSQL migration failed",
    );
    const ledgerRollback = await migrator.query<{ relation: string | null; count: string }>(`
      SELECT to_regclass('public.ledger_rollback_probe')::text AS relation,
             count(*)::text AS count
        FROM private.schema_migrations
    `);
    expect(ledgerRollback.rows[0]?.relation).toBe(null);
    expect(ledgerRollback.rows[0]?.count).toBe("2");
    await migrator.query(`
      DROP TRIGGER fail_test_migration_ledger_insert ON private.schema_migrations;
      DROP FUNCTION private.fail_test_migration_ledger_insert();
    `);

    await expect(applyMigrations(migrator, [retry, retry])).rejects.toThrow(
      "Migration set contains an invalid or duplicate migration ID",
    );

    const driftedSql = `${migrations[0]!.sql}\n-- checked-in drift`;
    const drifted = {
      ...migrations[0]!,
      sql: driftedSql,
      checksum: createHash("sha256").update(driftedSql).digest("hex"),
    };
    const blockedUpgrade = migration(
      "20261020000003",
      "must_not_run_after_drift",
      "CREATE TABLE public.must_not_run_after_drift (id integer);",
    );
    await expect(applyMigrations(migrator, [drifted, retry, blockedUpgrade])).rejects.toThrow(
      "An applied migration differs from the checked-in migration",
    );
    const notApplied = await migrator.query<{ relation: string | null }>(
      "SELECT to_regclass('public.must_not_run_after_drift')::text AS relation",
    );
    expect(notApplied.rows[0]?.relation).toBe(null);

    const laterApplied = migration(
      "20261020000004",
      "late_applied_probe",
      "CREATE TABLE public.late_applied_probe (id integer);",
    );
    await migrator.query(
      "INSERT INTO private.schema_migrations (migration_id,file_name,checksum) VALUES ($1,$2,$3)",
      [laterApplied.id, laterApplied.fileName, laterApplied.checksum],
    );
    const earlyPending = migration(
      "20261020000003",
      "must_not_run_before_checksum_preflight",
      "CREATE TABLE public.must_not_run_before_checksum_preflight (id integer);",
    );
    const changedLaterApplied = migration(
      laterApplied.id,
      "late_applied_probe",
      "CREATE TABLE public.late_applied_probe (id integer, changed boolean);",
    );
    await expect(
      applyMigrations(migrator, [...migrations, retry, earlyPending, changedLaterApplied]),
    ).rejects.toThrow("An applied migration differs from the checked-in migration");
    const earlyMigrationResult = await migrator.query<{ relation: string | null }>(
      "SELECT to_regclass('public.must_not_run_before_checksum_preflight')::text AS relation",
    );
    expect(earlyMigrationResult.rows[0]?.relation).toBe(null);
    await migrator.query("DELETE FROM private.schema_migrations WHERE migration_id = $1", [
      laterApplied.id,
    ]);

    await migrator.query(
      "INSERT INTO private.schema_migrations (migration_id,file_name,checksum) VALUES ($1,$2,$3)",
      ["20261020999999", "20261020999999_orphan.sql", "a".repeat(64)],
    );
    await expect(applyMigrations(migrator, [...migrations, retry])).rejects.toThrow(
      "Database has migration history that is absent from this release",
    );
    await migrator.query("DELETE FROM private.schema_migrations WHERE migration_id = $1", [
      "20261020999999",
    ]);

    const temporaryPassword = await provisionFirstAdmin(migrator, {
      fullName: "Bootstrap Administrator",
      email: "admin@example.test",
    });
    expect(temporaryPassword.length).toBeGreaterThan(40);
    const admin = await migrator.query<{
      role: string;
      pin_must_change: boolean;
      pin: string | null;
      password_hash: string | null;
    }>("SELECT role, pin_must_change, pin, password_hash FROM public.profiles WHERE email = $1", [
      "admin@example.test",
    ]);
    expect(admin.rows[0]?.role).toBe("admin");
    expect(admin.rows[0]?.pin_must_change).toBe(true);
    expect(admin.rows[0]?.pin).toBe(null);
    expect(await bcrypt.compare(temporaryPassword, admin.rows[0]!.password_hash!)).toBe(true);
    await expect(
      provisionFirstAdmin(migrator, {
        fullName: "Another Administrator",
        email: "another-admin@example.test",
      }),
    ).rejects.toThrow("An active administrator already exists; bootstrap is one-time.");
  });
});
