/**
 * Loaded before every test file (see the `test` script): the tests get a cache folder of their own, so that none of
 * them can read or replace the sessions, tokens and credentials of the real installation in `.cache`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.HEIG_TEST_CACHE) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "heig-test-cache-"));
  process.env.HEIG_TEST_CACHE = dir;
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
}
process.env.HEIG_CACHE_DIR = process.env.HEIG_TEST_CACHE;
