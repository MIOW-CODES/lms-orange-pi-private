import { afterAll, beforeAll, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

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
const probeTable = `pg_integration_probe_${randomUUID().replaceAll("-", "")}`;

beforeAll(async () => {
  await migrator.query(
    `CREATE TABLE public.${probeTable} (id integer PRIMARY KEY, value text NOT NULL)`,
  );
});

afterAll(async () => {
  await migrator.query(`DROP TABLE IF EXISTS public.${probeTable}`);
  await Promise.all([app.end(), migrator.end()]);
});

it("runs on PostgreSQL 16 as a distinct least-privilege runtime role", async () => {
  const result = await app.query<{
    current_user: string;
    server_version_num: number;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    migration_member: boolean;
    database_create: boolean;
    database_temp: boolean;
    private_usage: boolean;
    profiles_exist: boolean;
    profiles_select: boolean;
  }>(`
    SELECT current_user,
           current_setting('server_version_num')::integer AS server_version_num,
           role.rolsuper,
           role.rolcreatedb,
           role.rolcreaterole,
           role.rolreplication,
           role.rolbypassrls,
           pg_has_role(current_user, 'miow_migrator', 'MEMBER') AS migration_member,
           has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
           has_database_privilege(current_user, current_database(), 'TEMP') AS database_temp,
           has_schema_privilege(current_user, 'private', 'USAGE') AS private_usage,
           to_regclass('public.profiles') IS NOT NULL AS profiles_exist,
           has_table_privilege(current_user, 'public.profiles', 'SELECT') AS profiles_select
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  `);
  const role = result.rows[0];
  expect(role).toBeDefined();
  expect(role!.current_user).toBe("miow_app");
  expect(role!.server_version_num).toBeGreaterThanOrEqual(160000);
  expect(role!.server_version_num).toBeLessThan(170000);
  expect(role!.rolsuper).toBe(false);
  expect(role!.rolcreatedb).toBe(false);
  expect(role!.rolcreaterole).toBe(false);
  expect(role!.rolreplication).toBe(false);
  expect(role!.rolbypassrls).toBe(false);
  expect(role!.migration_member).toBe(false);
  expect(role!.database_create).toBe(false);
  expect(role!.database_temp).toBe(false);
  expect(role!.private_usage).toBe(false);
  expect(role!.profiles_exist).toBe(true);
  expect(role!.profiles_select).toBe(true);
});

it("can use future migration-owned tables for DML without gaining DDL", async () => {
  await app.query(`INSERT INTO public.${probeTable} (id, value) VALUES (1, 'first')`);
  expect(
    (await app.query(`SELECT value FROM public.${probeTable} WHERE id = 1`)).rows[0]?.value,
  ).toBe("first");
  await app.query(`UPDATE public.${probeTable} SET value = 'updated' WHERE id = 1`);
  await app.query(`DELETE FROM public.${probeTable} WHERE id = 1`);

  await expect(
    app.query(
      `CREATE TABLE public.runtime_ddl_probe_${randomUUID().replaceAll("-", "")} (id integer)`,
    ),
  ).rejects.toThrow();
  await expect(app.query("SELECT * FROM private.schema_migrations")).rejects.toThrow();
  await expect(app.query(`TRUNCATE public.${probeTable}`)).rejects.toThrow();
});
