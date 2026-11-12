/**
 * Loaded before every test file (see the `test` script): the tests get cache, data and output folders of their own,
 * so that none of them can read, replace or delete the sessions, tokens, credentials, photos and documents of the
 * real installation (`.cache`, `data`, ~/Documents/HEIG-Kit).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.HEIG_TEST_ROOT) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "heig-test-"));
  process.env.HEIG_TEST_ROOT = dir;
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
}
const root = process.env.HEIG_TEST_ROOT;
process.env.HEIG_TEST_CACHE = path.join(root, "cache");
process.env.HEIG_CACHE_DIR = process.env.HEIG_TEST_CACHE;
process.env.HEIG_DATA_DIR = path.join(root, "data");
process.env.HEIG_OUTPUT_DIR = path.join(root, "outputs");
// Folders set one by one in .env would win over HEIG_OUTPUT_DIR.
for (const name of ["HEIG_DOCUMENTS_DIR", "HEIG_VIDEOS_DIR", "HEIG_EXAMS_DIR"]) process.env[name] = "";
for (const dir of [process.env.HEIG_CACHE_DIR, process.env.HEIG_DATA_DIR]) mkdirSync(dir, { recursive: true });

// The tests never reach the school, edu-ID or any other machine: only this computer (the database, the servers the
// tests start themselves). A test that would log in somewhere with made-up credentials fails here instead.
const realFetch = globalThis.fetch;
const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const address = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  let host = "";
  try {
    host = new URL(address).hostname;
  } catch {
    // A relative address cannot leave this computer.
  }
  if (host && !LOCAL.has(host)) return Promise.reject(new TypeError(`fetch failed: the tests are offline (${host})`));
  return realFetch(input, init);
}) as typeof fetch;
