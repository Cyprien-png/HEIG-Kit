/**
 * Timing of a high quality video, shared by the renderer (Node) and the page that draws the frames (browser): the
 * narration is a list of scenes, each a list of lines; a line lasts as long as its speech (or as long as it takes to
 * read it, in a silent video), and the animations of a scene are placed on the start of its lines.
 */
import type { VideoColors } from "../../themes/index.js";

export const FPS = 30;
/** Silence after each line, at the start and at the end of a scene, in seconds. */
const GAP = 0.25;
const LEAD = 0.5;
const TAIL = 0.7;
const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface NarrationLine {
  id: string;
  /** What the subtitles show, and what is spoken. */
  text: string;
  /** What is spoken instead, when the written text is not pronounced well ("mine-termes" for "mintermes"). */
  tts?: string;
  /** Fixed duration of the line in a silent video, instead of its reading time. */
  seconds?: number;
}

export interface NarrationScene {
  scene: string;
  lines: NarrationLine[];
}

/** What the page receives: the narration with the duration of each line, and its sound file when the video is spoken. */
export interface VideoData {
  audio: boolean;
  subtitles: boolean;
  /** Colors of the course the video belongs to (themes/index.ts); the neutral ones when absent. */
  theme?: { course: string | null; mood: string; video: VideoColors };
  scenes: { scene: string; lines: { id: string; text: string; seconds: number; file?: string }[] }[];
}

export interface LineTiming {
  id: string;
  text: string;
  /** First frame of the line, counted from the start of its scene. */
  s: number;
  /** Duration in frames. */
  d: number;
  /** Frame at which the line ends: s + d. */
  e: number;
  file?: string;
}

export interface SceneTiming {
  name: string;
  /** First frame of the scene in the video. */
  from: number;
  dur: number;
  lines: Record<string, LineTiming>;
  list: LineTiming[];
}

export interface Timeline {
  scenes: SceneTiming[];
  total: number;
}

/** Checks a narration given by the author of a video; throws with a message they can act on. */
export function parseNarration(value: unknown): NarrationScene[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("The narration must be a non-empty list of scenes: [{ scene, lines: [{ id, text }] }]");
  const scenes = new Set<string>();
  const ids = new Set<string>();
  return value.map((entry: unknown, i) => {
    const { scene, lines } = (entry ?? {}) as { scene?: unknown; lines?: unknown };
    if (typeof scene !== "string" || !ID.test(scene)) throw new Error(`Scene ${i + 1} of the narration needs a name made of letters, digits and _ (found ${JSON.stringify(scene)})`);
    if (scenes.has(scene)) throw new Error(`Two scenes of the narration are named "${scene}"`);
    scenes.add(scene);
    if (!Array.isArray(lines) || lines.length === 0) throw new Error(`Scene "${scene}" of the narration has no line`);
    return {
      scene,
      lines: lines.map((line: unknown, j) => {
        const { id, text, tts, seconds } = (line ?? {}) as { id?: unknown; text?: unknown; tts?: unknown; seconds?: unknown };
        if (typeof id !== "string" || !ID.test(id)) throw new Error(`Line ${j + 1} of scene "${scene}" needs an id made of letters, digits and _ (found ${JSON.stringify(id)})`);
        if (ids.has(id)) throw new Error(`Two lines of the narration have the id "${id}": ids are unique in the whole video`);
        ids.add(id);
        if (typeof text !== "string" || !text.trim()) throw new Error(`Line "${id}" has no text`);
        if (tts !== undefined && (typeof tts !== "string" || !tts.trim())) throw new Error(`Line "${id}": tts must be a non-empty text`);
        if (seconds !== undefined && (typeof seconds !== "number" || !(seconds > 0) || seconds > 120)) throw new Error(`Line "${id}": seconds must be between 0 and 120`);
        return { id, text: text.trim(), ...(tts ? { tts: (tts as string).trim() } : {}), ...(seconds ? { seconds: seconds as number } : {}) };
      }),
    };
  });
}

/** Time to read a line of subtitles in a silent video: a little slower than speech. */
export function readingSeconds(text: string): number {
  return Math.max(1.6, text.length / 14 + 0.6);
}

export function buildTimeline(data: VideoData, fps = FPS): Timeline {
  let from = 0;
  const scenes = data.scenes.map((scene) => {
    let at = Math.round(LEAD * fps);
    const list = scene.lines.map((line) => {
      const d = Math.ceil(line.seconds * fps);
      const timing: LineTiming = { id: line.id, text: line.text, s: at, d, e: at + d, ...(line.file ? { file: line.file } : {}) };
      at += d + Math.round(GAP * fps);
      return timing;
    });
    const dur = at + Math.round(TAIL * fps);
    const timing: SceneTiming = { name: scene.scene, from, dur, lines: Object.fromEntries(list.map((l) => [l.id, l])), list };
    from += dur;
    return timing;
  });
  return { scenes, total: from };
}

/**
 * Frames worth looking at to check a video: the end of lines, when what a line announces is on screen, spread over the
 * whole video and at most `max`.
 */
export function keyFrames(timeline: Timeline, max = 12): number[] {
  const ends = timeline.scenes.flatMap((scene) => scene.list.map((line) => scene.from + Math.max(line.s, line.e - 3)));
  if (ends.length <= max) return ends;
  return Array.from({ length: max }, (_, i) => ends[Math.round((i * (ends.length - 1)) / (max - 1))]);
}
