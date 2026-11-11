import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FPS, type VideoData, buildTimeline, keyFrames, parseNarration, readingSeconds } from "../modules/hqvideo/timeline.js";
import { listGenerated } from "../src/generated.js";

const data = (scenes: [string, [string, number][]][]): VideoData => ({
  audio: false,
  subtitles: true,
  scenes: scenes.map(([scene, lines]) => ({ scene, lines: lines.map(([id, seconds]) => ({ id, text: id, seconds })) })),
});

test("lines follow each other in their scene, and scenes in the video", () => {
  const { scenes, total } = buildTimeline(data([["intro", [["a", 2], ["b", 1]]], ["end", [["c", 3]]]]));
  const [intro, end] = scenes;
  // Half a second before the first line, a quarter of a second between lines.
  assert.deepEqual([intro.lines.a.s, intro.lines.a.d, intro.lines.a.e], [15, 60, 75]);
  assert.equal(intro.lines.b.s, 75 + Math.round(0.25 * FPS));
  assert.equal(intro.from, 0);
  assert.equal(end.from, intro.dur, "a scene starts when the previous one ends");
  assert.equal(end.lines.c.s, 15, "frames are counted from the start of the scene");
  assert.equal(total, intro.dur + end.dur);
  assert.ok(intro.dur > intro.lines.b.e, "a scene outlasts its last line");
});

test("a spoken line lasts as long as its speech, rounded up to a frame", () => {
  const { scenes } = buildTimeline(data([["s", [["a", 1.01]]]]));
  assert.equal(scenes[0].lines.a.d, 31);
});

test("the narration is checked with messages its author can act on", () => {
  const ok = parseNarration([{ scene: "intro", lines: [{ id: "a1", text: " Bonjour. ", tts: "Bon jour." }, { id: "a2", text: "Fin", seconds: 2 }] }]);
  assert.deepEqual(ok, [{ scene: "intro", lines: [{ id: "a1", text: "Bonjour.", tts: "Bon jour." }, { id: "a2", text: "Fin", seconds: 2 }] }]);
  assert.throws(() => parseNarration([]), /non-empty list/);
  assert.throws(() => parseNarration([{ scene: "my scene", lines: [{ id: "a", text: "x" }] }]), /name made of letters/);
  assert.throws(() => parseNarration([{ scene: "s", lines: [] }]), /has no line/);
  assert.throws(() => parseNarration([{ scene: "s", lines: [{ id: "1a", text: "x" }] }]), /needs an id/);
  assert.throws(() => parseNarration([{ scene: "s", lines: [{ id: "a", text: "  " }] }]), /has no text/);
  // Scenes read their lines by id: the same id in two scenes would hide a mistake.
  assert.throws(() => parseNarration([{ scene: "s", lines: [{ id: "a", text: "x" }] }, { scene: "t", lines: [{ id: "a", text: "y" }] }]), /unique in the whole video/);
  assert.throws(() => parseNarration([{ scene: "s", lines: [{ id: "a", text: "x" }] }, { scene: "s", lines: [{ id: "b", text: "y" }] }]), /Two scenes/);
});

test("a silent line leaves the time to read it", () => {
  assert.equal(readingSeconds("Oui."), 1.6);
  assert.ok(readingSeconds("x".repeat(140)) > 10);
});

test("key frames are the end of lines, spread over the video when there are many", () => {
  const short = buildTimeline(data([["s", [["a", 1], ["b", 1]]], ["t", [["c", 1]]]]));
  assert.deepEqual(keyFrames(short), [short.scenes[0].lines.a.e - 3, short.scenes[0].lines.b.e - 3, short.scenes[1].from + short.scenes[1].lines.c.e - 3]);
  const long = buildTimeline(data([["s", Array.from({ length: 40 }, (_, i): [string, number] => [`l${i}`, 1])]]));
  const frames = keyFrames(long, 12);
  assert.equal(frames.length, 12);
  assert.equal(frames[0], long.scenes[0].lines.l0.e - 3);
  assert.equal(frames[11], long.scenes[0].lines.l39.e - 3);
  assert.deepEqual([...frames].sort((a, b) => a - b), frames);
});

test("a high quality video is found by its scenes and its narration, described by its first comment", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "heig-kit-hqvideo-"));
  const previous = process.env.HEIG_OUTPUT_DIR;
  process.env.HEIG_OUTPUT_DIR = base;
  try {
    const videos = path.join(base, "videos");
    mkdirSync(videos, { recursive: true });
    writeFileSync(path.join(videos, "syl-mux.tsx"), '/** SYL : réaliser une fonction avec un multiplexeur. */\nexport const scenes = {};\n');
    writeFileSync(path.join(videos, "syl-mux.narration.json"), JSON.stringify([{ scene: "intro", lines: [{ id: "a", text: "La table de vérité." }] }]));
    writeFileSync(path.join(videos, "syl-mux.mp4"), "");
    const [video] = listGenerated(["multiplexeur"]);
    assert.equal(video.title, "SYL : réaliser une fonction avec un multiplexeur.");
    assert.match(video.extra, /High quality/);
    assert.equal(listGenerated(["verite"]).length, 1, "the narration is searched too");
  } finally {
    if (previous === undefined) delete process.env.HEIG_OUTPUT_DIR;
    else process.env.HEIG_OUTPUT_DIR = previous;
    rmSync(base, { recursive: true, force: true });
  }
});
