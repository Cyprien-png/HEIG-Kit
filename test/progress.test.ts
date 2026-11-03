import assert from "node:assert/strict";
import { test } from "node:test";
import { Progress, formatBytes, formatDuration } from "../src/rag/progress.js";

test("progress weighs documents by size and estimates the time left", () => {
  let now = 0;
  const progress = new Progress([1024 ** 2, 3 * 1024 ** 2], () => now);
  assert.equal(progress.remainingMs(), undefined);
  now = 60_000;
  progress.done(0);
  // A quarter of the bytes in one minute: three minutes left.
  assert.equal(progress.remainingMs(), 180_000);
  assert.equal(progress.line(), "1/2 docs · 1.0 MB/4.0 MB (25%) · 1 min elapsed · ~3 min left · 1.0 MB/min");
  now = 240_000;
  progress.done(1);
  assert.equal(progress.line(), "2/2 docs · 4.0 MB/4.0 MB (100%) · 4 min elapsed · 1.0 MB/min");
});

test("a document of unknown size counts as the average of the known ones", () => {
  const progress = new Progress([100, undefined, 300], () => 0);
  assert.equal(progress.totalBytes, 600);
});

test("sizes and durations are short and readable", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(250 * 1024 ** 2), "250 MB");
  assert.equal(formatDuration(42_000), "42 s");
  assert.equal(formatDuration(90_000), "1 min 30 s");
  assert.equal(formatDuration(3 * 3_600_000 + 5 * 60_000), "3 h 5 min");
});
