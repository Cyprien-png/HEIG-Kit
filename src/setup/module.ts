import path from "node:path";
import { ROOT } from "../paths.js";
import { run } from "./system.js";

export interface SetupOptions {
  /** `knowledge`: index the Cyberlearn courses now and every day. */
  ingest: boolean;
  /** Questions can be asked in the terminal (credentials, two-step login code). */
  interactive: boolean;
}

export interface Check {
  label: string;
  ok: boolean;
  /** What to do when the check fails. */
  hint?: string;
}

/** An optional part of HEIG-Kit and everything it needs to work, installable with `npm run setup -- <id>`. */
export interface Module {
  id: string;
  title: string;
  summary: string;
  /** Modules installed first. */
  requires?: (options: SetupOptions) => string[];
  install(options: SetupOptions): Promise<void>;
  check(): Promise<Check[]>;
}

/** Runs a TypeScript entry point of the project (e.g. "src/cli.ts", "schedule") with tsx. */
export function runScript(file: string, ...args: string[]): void {
  run(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), path.join(ROOT, file), ...args], { cwd: ROOT });
}
