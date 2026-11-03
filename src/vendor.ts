import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, folderFromEnv } from "./paths.js";

/** Programs installed by `npm run setup` (manim, TinyTeX), never committed. */
export const VENDOR_DIR = path.join(ROOT, "vendor");
export const MANIM_DIR = path.join(VENDOR_DIR, "manim");
const windows = process.platform === "win32";

/**
 * Where generated documents and videos go: HEIG_DOCUMENTS_DIR and HEIG_VIDEOS_DIR in .env, otherwise a subfolder of
 * HEIG_OUTPUT_DIR, itself ~/Documents/HEIG-Kit by default.
 */
export function outputDir(kind: "documents" | "videos"): string {
  const base = folderFromEnv(process.env.HEIG_OUTPUT_DIR, path.join(os.homedir(), "Documents", "HEIG-Kit"));
  return folderFromEnv(process.env[kind === "documents" ? "HEIG_DOCUMENTS_DIR" : "HEIG_VIDEOS_DIR"], path.join(base, kind));
}

/** Executable of a program of manim's Python environment (python, pip, manimgl). */
export function manimBin(name: string): string {
  return windows ? path.join(MANIM_DIR, ".venv", "Scripts", `${name}.exe`) : path.join(MANIM_DIR, ".venv", "bin", name);
}

/** Speech synthesis of the voice module. */
export const KOKORO_DIR = path.join(VENDOR_DIR, "kokoro");
/** Identifies the speech in the cache: a new model or voice must not reuse former files. */
export const VOICE_ID = "kokoro-v1.0.int8/ff_siwis";

export function kokoroPython(): string {
  return windows ? path.join(KOKORO_DIR, ".venv", "Scripts", "python.exe") : path.join(KOKORO_DIR, ".venv", "bin", "python");
}

export function kokoroModelFile(): string {
  return path.join(KOKORO_DIR, "kokoro-v1.0.int8.onnx");
}

export function kokoroVoicesFile(): string {
  return path.join(KOKORO_DIR, "voices-v1.0.bin");
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
