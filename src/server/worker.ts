/**
 * Render worker of the remote server, run in its own container (rag/compose.yml, service `render`): no network, no
 * secrets, read-only system. It handles one job and exits; Docker starts a fresh container for the next one, so nothing a
 * scene left running or in memory survives.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../paths.js";
import { JOB_ID } from "./jobs.js";

const JOBS_DIR = process.env.HEIG_JOBS_DIR ?? "/jobs";
const TIMEOUT_MS = 45 * 60_000;
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function setStatus(dir: string, status: object): void {
  const partial = path.join(dir, ".status.partial");
  writeFileSync(partial, JSON.stringify(status));
  renameSync(partial, path.join(dir, "status.json"));
}

/** The oldest job not taken yet. */
function nextJob(): string | undefined {
  return readdirSync(JOBS_DIR)
    .filter((name) => JOB_ID.test(name) && existsSync(path.join(JOBS_DIR, name, "request.json")) && !existsSync(path.join(JOBS_DIR, name, "status.json")))
    .map((name) => ({ name, at: lstatSync(path.join(JOBS_DIR, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at)[0]?.name;
}

/** Runs a renderer in its own process group, entirely killed at the deadline. */
function runRenderer(args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(process.execPath, [TSX, ...args], { cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONWARNINGS: "ignore" } });
    let output = "";
    const keep = (data: Buffer) => {
      output = (output + data.toString()).slice(-200_000);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => {
      output += "\nStopped: the rendering took too long.";
      killGroup();
    }, TIMEOUT_MS);
    // "exit", not "close": a process left running by a scene would hold the pipes open and block the worker. It dies with
    // the container, when this worker exits.
    child.on("exit", (code) => {
      clearTimeout(timer);
      killGroup();
      // The last lines of output may still be on their way.
      setTimeout(() => resolve({ ok: code === 0, output }), 500);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: error.message });
    });
  });
}

/** The lines useful to whoever fixes the scene: no progress bars, only the end of long logs. */
function readableLog(output: string): string {
  return output
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim() && !/it\/s\]|\d+%\|/.test(line))
    .slice(-60)
    .join("\n");
}

async function handle(id: string): Promise<void> {
  const dir = path.join(JOBS_DIR, id);
  const request = JSON.parse(readFileSync(path.join(dir, "request.json"), "utf-8"));
  setStatus(dir, { state: "running" });
  const output = path.join(dir, "output");
  mkdirSync(output, { recursive: true });
  const source = path.join(dir, request.source);

  const args =
    request.kind === "document"
      ? [path.join(ROOT, "modules", "documents", "render.ts"), source, ...request.formats.map((f: string) => `--${f}`), "--out", output]
      : [path.join(ROOT, "modules", "visuals", "render.ts"), source, request.scene, "--quality", request.quality, "--frames", "--out", output, ...(request.voice ? ["--voice"] : [])];
  const result = await runRenderer(args);

  const frames = /^Frames: (.+)$/m.exec(result.output)?.[1]?.trim();
  if (result.ok && frames && existsSync(frames)) copyFileSync(frames, path.join(output, "frames.png"));
  const files = readdirSync(output).filter((name) => name !== "frames.png");
  setStatus(dir, { state: result.ok ? "done" : "failed", files, log: readableLog(result.output) });
}

mkdirSync(JOBS_DIR, { recursive: true });
for (;;) {
  const id = nextJob();
  if (id) {
    try {
      await handle(id);
    } catch (error) {
      setStatus(path.join(JOBS_DIR, id), { state: "failed", log: error instanceof Error ? error.message : String(error) });
    }
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
