/**
 * Installs the HEIG-Kit modules you want, with everything they need (system packages included), on macOS, Linux and
 * Windows.
 *
 *   npm run setup -- campus knowledge         install these modules (and the modules they need)
 *   npm run setup -- --all                    install every module
 *   npm run setup -- knowledge --ingest       also index your Cyberlearn courses now and every day
 *   npm run setup -- --status                 what is installed and working
 *   npm run setup -- --list                   available modules
 *   npm run setup -- … --dry-run              show what would be installed
 */
import { parseArgs } from "node:util";
import type { Module, SetupOptions } from "../src/setup/module.js";
import { MODULES } from "../src/setup/registry.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: "boolean", default: false },
    ingest: { type: "boolean", default: false },
    status: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const options: SetupOptions = { ingest: values.ingest, interactive: Boolean(process.stdin.isTTY) };

function list(): void {
  console.log("Modules:\n");
  for (const m of MODULES) console.log(`  ${m.id.padEnd(10)} ${m.title}: ${m.summary}`);
  console.log("\nUsage: npm run setup -- <module…> [--ingest] | --all | --status | --dry-run");
}

async function status(): Promise<void> {
  for (const m of MODULES) {
    const checks = await m.check().catch((error: unknown) => [{ label: String(error), ok: false, hint: undefined }]);
    const ok = checks.every((c) => c.ok);
    console.log(`${ok ? "✔" : "✘"} ${m.id.padEnd(10)} ${m.title}`);
    for (const c of checks.filter((c) => !c.ok)) console.log(`    ✘ ${c.label}${c.hint ? ` → ${c.hint}` : ""}`);
  }
}

/** Requested modules and the modules they need, in installation order. */
function resolve(ids: string[]): Module[] {
  const wanted = new Set<string>();
  const add = (id: string) => {
    const module = MODULES.find((m) => m.id === id);
    if (!module) throw new Error(`Unknown module "${id}". Available: ${MODULES.map((m) => m.id).join(", ")}`);
    if (wanted.has(id)) return;
    for (const dependency of module.requires?.(options) ?? []) add(dependency);
    wanted.add(id);
  };
  ids.forEach(add);
  return MODULES.filter((m) => wanted.has(m.id));
}

async function main(): Promise<void> {
  if (values.list) return list();
  if (values.status) return status();
  const ids = values.all ? MODULES.map((m) => m.id) : positionals;
  if (ids.length === 0) return list();

  const modules = resolve(ids);
  console.log(`Installing: ${modules.map((m) => m.id).join(", ")}${values.ingest ? " (with Cyberlearn indexing)" : ""}`);
  if (values["dry-run"]) return;

  for (const module of modules) {
    console.log(`\n▶ ${module.title} (${module.id})`);
    await module.install(options);
    const failed = (await module.check()).filter((c) => !c.ok);
    console.log(failed.length === 0 ? `✔ ${module.id} ready` : `✘ ${module.id}: ${failed.map((c) => c.label).join(", ")}`);
  }
  console.log("\nDone. Check everything at any time with: npm run setup -- --status");
}

main().catch((error: unknown) => {
  console.error(`\n✘ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
