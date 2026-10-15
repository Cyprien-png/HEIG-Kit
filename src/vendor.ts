import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { ROOT } from "./paths.js";

dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

/** Programs installed by `npm run setup` (manim, TinyTeX), never committed. */
export const VENDOR_DIR = path.join(ROOT, "vendor");
export const MANIM_DIR = path.join(VENDOR_DIR, "manim");
const windows = process.platform === "win32";

/** Where generated documents and videos go: HEIG_OUTPUT_DIR in .env, ~/Documents/HEIG-Kit by default. */
export function outputDir(kind: "documents" | "videos"): string {
  const base = process.env.HEIG_OUTPUT_DIR || path.join(os.homedir(), "Documents", "HEIG-Kit");
  return path.join(base.replace(/^~(?=$|[\\/])/, os.homedir()), kind);
}

/** Executable of a program of manim's Python environment (python, pip, manimgl). */
export function manimBin(name: string): string {
  return windows ? path.join(MANIM_DIR, ".venv", "Scripts", `${name}.exe`) : path.join(MANIM_DIR, ".venv", "bin", name);
}

/** TinyTeX installation folder: TinyTeX on macOS and Windows, .TinyTeX on Linux (the installer's own naming). */
export function tinytexDir(): string {
  return path.join(VENDOR_DIR, process.platform === "linux" ? ".TinyTeX" : "TinyTeX");
}

/** Folder of the TinyTeX executables (latex, dvisvgm, tlmgr), if installed. */
export function tinytexBinDir(): string | undefined {
  const bin = path.join(tinytexDir(), "bin");
  if (!existsSync(bin)) return undefined;
  const platform = readdirSync(bin).find((entry) => !entry.startsWith("."));
  return platform ? path.join(bin, platform) : undefined;
}
