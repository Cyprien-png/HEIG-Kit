/**
 * Syncs the generated documents and videos of this computer with the remote server (HEIG_REMOTE_URL, docs/app.md):
 *
 *   npm run library -- list            what the server holds
 *   npm run library -- push            send what the server lacks (or has an older copy of)
 *   npm run library -- pull            fetch what this computer lacks
 *   npm run library -- sync            both ways
 *   … --dry-run                        only show what would be copied
 */
import { parseArgs } from "node:util";
import { RemoteClient } from "../src/remote/client.js";
import { type Direction, formatReport, remoteFiles, syncLibrary } from "../src/remote/library.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { "dry-run": { type: "boolean", default: false } } });
const action = positionals[0] ?? "list";

async function main(): Promise<void> {
  const client = await RemoteClient.fromEnv();
  if (!client) throw new Error("Set HEIG_REMOTE_URL in .env and run `npm run remote -- login` first");
  if (action === "list") {
    const files = await remoteFiles(client);
    if (files.length === 0) return console.log("The server's library is empty.");
    for (const f of files) console.log(`${f.modifiedAt.slice(0, 16).replace("T", " ")}  ${String(f.size).padStart(11)}  ${f.id}`);
    return;
  }
  const direction: Direction | undefined = action === "push" || action === "pull" ? action : action === "sync" ? "both" : undefined;
  if (!direction) throw new Error("Usage: npm run library -- list | push | pull | sync [--dry-run]");
  const report = await syncLibrary(client, direction, values["dry-run"], (line) => console.log(line));
  console.log(formatReport(report, direction, values["dry-run"]));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
