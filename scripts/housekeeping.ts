/**
 * Keeps the storage small (docs/server.md): compresses the photos of finished corrections and removes what nobody
 * will read again. The server does it by itself every day; this runs it now.
 *
 *   npm run housekeeping                 does it
 *   npm run housekeeping -- --dry-run    only says what it would do
 *   npm run housekeeping -- --after 0    compresses the photos of every finished correction, even of today
 */
import { parseArgs } from "node:util";
import { formatHousekeeping, runHousekeeping } from "../src/app/housekeeping.js";
import { migrate, openDb } from "../src/rag/db.js";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, after: { type: "string" }, json: { type: "boolean", default: false } } });
const after = values.after === undefined ? undefined : Number(values.after);
if (after !== undefined && !(Number.isFinite(after) && after >= 0)) {
  console.error("--after takes a number of days");
  process.exit(1);
}

const db = openDb();
try {
  await migrate(db);
  const report = await runHousekeeping(db, { dryRun: values["dry-run"], compressAfterDays: after, log: (line) => console.error(line) });
  console.log(values.json ? JSON.stringify(report, null, 2) : formatHousekeeping(report));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.end();
}
