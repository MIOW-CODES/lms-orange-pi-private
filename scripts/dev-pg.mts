import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const dataDir = process.env.PGLITE_DATA_DIR ?? path.resolve(process.cwd(), ".pglite-data");
const port = Number(process.env.PGPORT ?? 5432);
const host = process.env.PGHOST ?? "127.0.0.1";
const maxConnections = Number(process.env.PG_MAX_CONNECTIONS ?? 50);

console.log(`[dev-pg] Initializing PGlite at ${dataDir}...`);
const db = new PGlite(dataDir, {
  extensions: {
    pgcrypto,
  },
});

await db.waitReady;
console.log("[dev-pg] PGlite database is ready.");

const server = new PGLiteSocketServer({
  db,
  port,
  host,
  maxConnections,
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[dev-pg] Received ${signal}, stopping server...`);
  try {
    await server.stop();
  } catch (err) {
    console.error("[dev-pg] Error stopping server:", err);
  }
  try {
    await db.close();
  } catch (err) {
    console.error("[dev-pg] Error closing database:", err);
  }
  console.log("[dev-pg] Server stopped cleanly.");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await server.start();
console.log(`[dev-pg] PGlite server listening on ${host}:${port}`);
console.log(`[dev-pg] Data directory: ${dataDir}`);
console.log("[dev-pg] Ready for connections.");
