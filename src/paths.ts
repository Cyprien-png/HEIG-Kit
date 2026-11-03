import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/** Project root, so the CLI works whatever the current directory (e.g. when run by the plugin skill). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

/** A folder set in .env, with `~` expanded; `fallback` when it is not set. */
export function folderFromEnv(value: string | undefined, fallback: string): string {
  const text = value?.trim();
  return text ? path.resolve(text.replace(/^~(?=$|[\\/])/, os.homedir())) : fallback;
}

/** Login session and caches. */
export const CACHE_DIR = folderFromEnv(process.env.HEIG_CACHE_DIR, path.join(ROOT, ".cache"));
/** Downloaded and extracted course documents, repositories, tokens. */
export const DATA_DIR = folderFromEnv(process.env.HEIG_DATA_DIR, path.join(ROOT, "data"));
