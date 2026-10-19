import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();
try {
  const schema = await readFile(
    new URL("../db/migrations/20261020000000_native_initial.sql", import.meta.url),
    "utf8",
  );
  await pg.exec("CREATE SCHEMA private");
  await pg.exec(schema);

  const consume = () =>
    pg.query<{ allowed: boolean; remaining: number }>(
      "SELECT * FROM public.consume_auth_rate_attempt($1, $2, $3)",
      ["test-account", 2, 900],
    );
  assert.deepEqual((await consume()).rows[0], { allowed: true, remaining: 1 });
  assert.deepEqual((await consume()).rows[0], { allowed: true, remaining: 0 });
  assert.deepEqual((await consume()).rows[0], { allowed: false, remaining: 0 });

  await pg.query("SELECT public.clear_auth_rate_limit($1)", ["test-account"]);
  const concurrent = await Promise.all(Array.from({ length: 20 }, () => consume()));
  assert.equal(concurrent.filter((result) => result.rows[0]?.allowed).length, 2);

  for (let i = 0; i < 5; i++) {
    await pg.query("SELECT public.record_auth_rate_failure($1, $2)", ["hashed-identity", 900]);
  }
  const blocked = await pg.query<{ allowed: boolean; remaining: number }>(
    "SELECT * FROM public.check_auth_rate_limit($1, $2, $3)",
    ["hashed-identity", 5, 900],
  );
  assert.deepEqual(blocked.rows[0], { allowed: false, remaining: 0 });
  await pg.query("SELECT public.clear_auth_rate_limit($1)", ["hashed-identity"]);
  const cleared = await pg.query<{ allowed: boolean; remaining: number }>(
    "SELECT * FROM public.check_auth_rate_limit($1, $2, $3)",
    ["hashed-identity", 5, 900],
  );
  assert.deepEqual(cleared.rows[0], { allowed: true, remaining: 5 });
  console.info("Native PostgreSQL authentication rate-limit checks passed.");
} finally {
  await pg.close();
}
