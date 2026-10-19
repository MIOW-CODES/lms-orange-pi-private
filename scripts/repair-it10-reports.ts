// Default: read-only preview. Run only after the four class-record migrations.
// bun run scripts/repair-it10-reports.ts [--apply]
import { repairIT10Reports } from "../src/lib/server/it10-report-repair.server";
const apply = process.argv.includes("--apply");
try {
  console.log(JSON.stringify(await repairIT10Reports(apply), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Report repair failed");
  process.exitCode = 1;
}
