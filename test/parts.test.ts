import assert from "node:assert/strict";
import { test } from "node:test";
import { keyFrameTimes, splitAnimations } from "../modules/visuals/parts.js";

test("animations are split into parts of similar duration covering all of them", () => {
  const durations = [1, 1, 1, 1, 10, 1, 1, 1, 1, 1, 1];
  const ranges = splitAnimations(durations, 3);
  assert.deepEqual(ranges[0][0], 0);
  assert.equal(ranges.at(-1)![1], durations.length);
  for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i][0], ranges[i - 1][1]);
  assert.deepEqual(ranges, [[0, 5], [5, 8], [8, 11]]);
});

test("short scenes are not split", () => {
  assert.deepEqual(splitAnimations([1, 2, 1], 4, 8), [[0, 3]]);
  assert.deepEqual(splitAnimations([5, 5, 5, 5], 4, 8), [[0, 2], [2, 4]]);
  assert.deepEqual(splitAnimations([3], 4), [[0, 1]]);
});

test("key frames are taken at the end of the longest animation of each slice", () => {
  // 0-1 write, 1-4 wait, 4-5 write, 5-7 wait
  assert.deepEqual(keyFrameTimes([1, 3, 1, 2], 2).map((t) => Number(t.toFixed(2))), [3.9, 6.9]);
});
