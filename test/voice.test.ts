import assert from "node:assert/strict";
import { test } from "node:test";
import { type Wav, buildTrack, parseWav, wavSeconds } from "../modules/voice/track.js";

const line = (rate: number, samples: number[]): Wav => {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => pcm.writeInt16LE(s, i * 2));
  return { rate, pcm };
};

test("lines are placed at their time in a track as long as the video", () => {
  const track = parseWav(buildTrack([{ time: 0.5, wav: line(10, [7, 8]) }, { time: 1, wav: line(10, [9]) }], 2));
  assert.equal(track.rate, 10);
  assert.equal(wavSeconds(track), 2);
  const samples = Array.from({ length: 20 }, (_, i) => track.pcm.readInt16LE(i * 2));
  assert.deepEqual(samples, [0, 0, 0, 0, 0, 7, 8, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("a line ending after the video lengthens the track instead of being cut", () => {
  assert.equal(wavSeconds(parseWav(buildTrack([{ time: 1, wav: line(10, new Array(20).fill(1)) }], 2))), 3);
});

test("chunks before the audio of a WAV file are skipped", () => {
  const wav = buildTrack([{ time: 0, wav: line(10, [5]) }], 0);
  const extra = Buffer.from("LIST\x03\x00\x00\x00abc\x00", "latin1"); // odd size: padded
  const parsed = parseWav(Buffer.concat([wav.subarray(0, 36), extra, wav.subarray(36)]));
  assert.equal(parsed.pcm.readInt16LE(0), 5);
});

test("only 16-bit mono WAV files are accepted", () => {
  const stereo = Buffer.from(buildTrack([], 0));
  stereo.writeUInt16LE(2, 22);
  assert.throws(() => parseWav(stereo), /16-bit mono/);
  assert.throws(() => parseWav(Buffer.from("not a wav file")), /Not a WAV/);
});
