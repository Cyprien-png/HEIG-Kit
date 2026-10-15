/**
 * Brings the knowledge base up to date: makes sure Docker runs, starts the services, then indexes new or changed
 * documents of the curriculum (`npm run ingest`). Output is appended to data/logs/update.log. Used by the daily task
 * installed with `npm run autoupdate`, and runnable by hand: npm run rag:update
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../src/paths.js";
import { ensureDockerRunning } from "../src/setup/system.js";

const LOG = path.join(ROOT, "data", "logs", "update.log");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  appendFileSync(LOG, `${stamped}\n`);
}

/** Runs an npm script, appending its output to the log. */
function npm(...args: string[]): void {
  const result = spawnSync(NPM, ["run", "-s", ...args], { cwd: ROOT, encoding: "utf-8", shell: process.platform === "win32" });
  appendFileSync(LOG, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  if (result.status !== 0) {
    const reason = /two-step login code required/.test(result.stderr ?? "")
      ? "edu-ID asks for a two-step login code: run `npm run rag:update` in a terminal"
      : `\`npm run ${args.join(" ")}\` failed (exit code ${result.status}), see ${path.relative(ROOT, LOG)}`;
    throw new Error(reason);
  }
}

/** macOS notification, so a failing unattended update does not go unnoticed. */
function notify(message: string): void {
  if (process.platform !== "darwin") return;
  spawnSync("osascript", ["-e", `display notification ${JSON.stringify(message)} with title "HEIG-Kit"`]);
}

async function main(): Promise<void> {
  mkdirSync(path.dirname(LOG), { recursive: true });
  log("Update started");
  try {
    await ensureDockerRunning();
    npm("rag:start");
    npm("ingest");
    log("Update finished");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Update failed: ${message}`);
    notify(`Knowledge base update failed: ${message}`);
    process.exit(1);
  }
}

void main();
