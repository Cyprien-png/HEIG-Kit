/**
 * Syncs the generated documents and videos of this computer with the remote server (HEIG_REMOTE_URL, docs/app.md):
 *
 *   npm run library -- list            what the server holds
 *   npm run library -- push            send what the server lacks (or has an older copy of)
 *   npm run library -- pull            fetch what this computer lacks
 *   npm run library -- sync            both ways
 *   … --dry-run                        only show what would be copied
 *   npm run library -- items [--course MAD] [--tag exercices]        the library by course, with its tags
 *   npm run library -- tag <item> [--course MAD] [--tags "a,b"] [--add a] [--remove b]
 *                                      (item: document:name, documents/name.pdf or the title; local database without HEIG_REMOTE_URL)
 */
import { parseArgs } from "node:util";
import { type HeigApi, LocalApi, RemoteApi } from "../src/app/api.js";
import { migrate, openDb } from "../src/rag/db.js";
import { RemoteClient } from "../src/remote/client.js";
import { type Direction, formatReport, remoteFiles, syncLibrary } from "../src/remote/library.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    course: { type: "string" },
    tag: { type: "string" },
    tags: { type: "string" },
    add: { type: "string" },
    remove: { type: "string" },
  },
});
const action = positionals[0] ?? "list";
const list = (value: string | undefined) => value?.split(",").map((t) => t.trim()).filter(Boolean);

async function openApi(): Promise<{ api: HeigApi; close: () => Promise<void> }> {
  const remote = await RemoteClient.fromEnv();
  if (remote) return { api: new RemoteApi(remote), close: async () => {} };
  const db = openDb();
  await migrate(db).catch((error: unknown) => {
    throw new Error(`Database unreachable: run \`npm run rag:start\`, or set HEIG_REMOTE_URL to use your server (${error instanceof Error ? error.message : error})`);
  });
  return { api: new LocalApi(db), close: () => db.end() };
}

async function tagging(): Promise<void> {
  const { api, close } = await openApi();
  try {
    if (action === "items") {
      const course = values.course?.toUpperCase();
      const items = (await api.library()).filter((i) => (!course || i.course === course) && (!values.tag || i.tags.includes(values.tag.toLowerCase())));
      if (items.length === 0) return console.log("Nothing in the library matches.");
      for (const i of items) console.log(`${(i.course ?? "–").padEnd(6)} ${i.kind.padEnd(8)} ${i.modifiedAt.slice(0, 10)}  ${i.tags.join(", ")}${i.tagged ? "" : " (guessed)"}\n       ${i.title}  [${i.kind}:${i.name}]`);
      return;
    }
    if (!positionals[1]) throw new Error("Usage: npm run library -- tag <item> [--course MAD] [--tags \"a,b\"] [--add a] [--remove b]");
    const item = await api.tagLibraryItem(positionals[1], { course: values.course, tags: list(values.tags), add: list(values.add), remove: list(values.remove) });
    console.log(`${item.course ?? "–"} · ${item.tags.join(", ") || "no tags"}  ${item.title}  [${item.kind}:${item.name}]`);
  } finally {
    await close();
  }
}

async function main(): Promise<void> {
  if (action === "items" || action === "tag") return tagging();
  const client = await RemoteClient.fromEnv();
  if (!client) throw new Error("Set HEIG_REMOTE_URL in .env and run `npm run remote -- login` first");
  if (action === "list") {
    const files = await remoteFiles(client);
    if (files.length === 0) return console.log("The server's library is empty.");
    for (const f of files) console.log(`${f.modifiedAt.slice(0, 16).replace("T", " ")}  ${String(f.size).padStart(11)}  ${f.id}`);
    return;
  }
  const direction: Direction | undefined = action === "push" || action === "pull" ? action : action === "sync" ? "both" : undefined;
  if (!direction) throw new Error("Usage: npm run library -- list | push | pull | sync [--dry-run] | items | tag <item>");
  const report = await syncLibrary(client, direction, values["dry-run"], (line) => console.log(line));
  console.log(formatReport(report, direction, values["dry-run"]));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
