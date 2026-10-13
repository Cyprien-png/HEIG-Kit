import path from "node:path";
import { fileURLToPath } from "node:url";

/** Project root, so the CLI works whatever the current directory (e.g. when run by the plugin skill). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CACHE_DIR = path.join(ROOT, ".cache");
