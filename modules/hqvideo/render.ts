/**
 * HEIG-Kit high quality videos module: renders scenes written in React (HTML, CSS, SVG) to a video with Remotion,
 * frame by frame in a headless Chromium, optionally with a spoken narration.
 *
 *   npm run hqvideo -- <video.tsx> [--audio] [--quality low|medium|high] [--open] [--frames] [--check] [--no-subtitles]
 *                      [--narration <file.json>] [--jobs N] [--out <folder>]
 *                      [--course RXI] [--mood nuit|encre|neon|aube]
 *   npm run hqvideo -- --where    default folder for generated videos
 *
 * A video is two files: `<name>.tsx` exports its scenes (`export const scenes = { intro: Intro, … }`, components using
 * the pieces of `heigkit`, this folder's kit/), and `<name>.narration.json` lists what is said in each scene, line by
 * line. A line lasts as long as its speech (--audio, OmniVoice in vendor/omnivoice) or as long as it takes to read it
 * (silent video), and the scenes place their animations on the start of the lines (`useLines()`), so the same scenes
 * work with and without sound.
 *
 * The colors are those of the course the video belongs to (themes/, docs/themes.md): the course its first comment or
 * its file name starts with, or --course; --mood tries another mood than the one of the settings.
 *
 * --check renders only an image of the key frames (the end of the lines), in seconds and without the voice, to catch
 * errors and check the layout; --frames prints the same image for the rendered video.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { CACHE_DIR } from "../../src/paths.js";
import { themeFor } from "../../src/themes.js";
import { HQ_VOICE_ID, omnivoiceHome, omnivoicePython, outputDir } from "../../src/vendor.js";
import { parseWav, wavSeconds } from "../voice/track.js";
import { FPS, type NarrationScene, type VideoData, buildTimeline, keyFrames, parseNarration, readingSeconds } from "./timeline.js";

const HERE = import.meta.dirname;
/** Share of the 1920×1080 scene that is rendered. */
const SCALE: Record<string, number> = { low: 0.5, medium: 2 / 3, high: 1 };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    audio: { type: "boolean", default: false },
    quality: { type: "string", default: "high" },
    open: { type: "boolean", default: false },
    out: { type: "string" },
    where: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
    frames: { type: "boolean", default: false },
    "no-subtitles": { type: "boolean", default: false },
    narration: { type: "string" },
    jobs: { type: "string" },
    course: { type: "string" },
    mood: { type: "string" },
  },
});

if (values.where) {
  console.log(outputDir("videos"));
  process.exit(0);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [file] = positionals;
if (!file) fail("Usage: npm run hqvideo -- <video.tsx> [--audio] [--quality low|medium|high] [--open] [--frames] [--check] [--no-subtitles] [--narration <file.json>] [--jobs N] [--out <folder>] [--course <CODE>] [--mood <name>]");
if (!SCALE[values.quality]) fail(`Invalid --quality "${values.quality}", expected low, medium or high`);
/** Browser tabs drawing frames in parallel: half the processors, at most 8 (each tab takes a few hundred MB). */
const jobs = values.jobs ? Number(values.jobs) : Math.min(8, Math.max(1, Math.floor(os.availableParallelism() / 2)));
if (!Number.isInteger(jobs) || jobs < 1) fail(`Invalid --jobs "${values.jobs}", expected a positive integer`);
if (!existsSync(path.join(HERE, "node_modules", "remotion"))) fail("The high quality videos module is not installed: npm run setup -- hqvideo");

const source = path.resolve(file);
if (!existsSync(source)) fail(`${source} does not exist`);
const name = path.basename(source).replace(/\.[jt]sx?$/, "");
/** The theme of the course the video starts with (its first comment, "RXI ch. 5 : …", or its file name), unless --course says it. */
const firstComment = /^\s*\/\*\*?\s*([^\n]*)/.exec(readFileSync(source, "utf8"))?.[1];
let theme: ReturnType<typeof themeFor>;
try {
  theme = themeFor(values.course, [firstComment, name], values.mood);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const narrationFile = path.resolve(values.narration ?? path.join(path.dirname(source), `${name}.narration.json`));
if (!existsSync(narrationFile)) fail(`The narration ${narrationFile} does not exist: a video needs its lines, [{ "scene": "intro", "lines": [{ "id": "i1", "text": "…" }] }]`);
let narration: NarrationScene[];
try {
  narration = parseNarration(JSON.parse(readFileSync(narrationFile, "utf-8")));
} catch (error) {
  fail(`Invalid narration (${path.basename(narrationFile)}): ${error instanceof Error ? error.message : error}`);
}
const audio = values.audio && !values.check;
if (audio && !existsSync(omnivoicePython())) fail("The voice of the high quality videos is not installed: npm run setup -- hqvideo");

const folder = path.resolve(values.out ?? outputDir("videos"));
mkdirSync(folder, { recursive: true });
const work = mkdtempSync(path.join(os.tmpdir(), "heig-kit-hqvideo-"));
let staging: string | undefined;

function open(target: string): void {
  if (process.platform === "darwin") spawnSync("open", [target]);
  else if (process.platform === "win32") spawnSync("cmd", ["/c", "start", '""', target], { shell: true });
  else spawnSync("xdg-open", [target], { stdio: "ignore" });
}

/** The speech of each line, synthesized only once (.cache/hqvoice): rendering again only pays for the lines that changed. */
function speak(texts: string[]): Map<string, string> {
  const cache = path.join(CACHE_DIR, "hqvoice");
  mkdirSync(cache, { recursive: true });
  const fileOf = (text: string) => path.join(cache, `${createHash("sha256").update(`${HQ_VOICE_ID}\n${text}`).digest("hex").slice(0, 32)}.wav`);
  const unique = [...new Set(texts)];
  const missing = unique.filter((text) => !existsSync(fileOf(text)));
  if (missing.length > 0) {
    const lines = path.join(work, "lines.json");
    writeFileSync(lines, JSON.stringify(missing.map((text) => ({ text, file: fileOf(text) }))));
    const voice = path.join(HERE, "voice");
    const result = spawnSync(omnivoicePython(), [path.join(HERE, "synth.py"), path.join(voice, "reference.wav"), path.join(voice, "reference.txt"), lines], {
      encoding: "utf-8",
      // The model is only read (the worker of the remote server has a read-only system): caches go to the temporary folder.
      env: { ...process.env, HF_HOME: omnivoiceHome(), HF_HUB_OFFLINE: "1", PYTHONWARNINGS: "ignore", TOKENIZERS_PARALLELISM: "false", NUMBA_CACHE_DIR: path.join(work, "numba"), MPLCONFIGDIR: path.join(work, "matplotlib") },
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.status !== 0) fail(`Speech synthesis failed:\n${(result.stderr || result.error?.message || "").split("\n").slice(-15).join("\n")}`);
  }
  console.log(`Voice: ${unique.length} line${unique.length > 1 ? "s" : ""}, ${missing.length} synthesized.`);
  return new Map(unique.map((text) => [text, fileOf(text)]));
}

/** A sheet of images, 3 per row, written to a temporary file whose path is returned. */
function sheet(images: string[]): string | undefined {
  if (images.length === 0) return undefined;
  const dir = path.join(work, "sheet");
  mkdirSync(dir, { recursive: true });
  images.forEach((image, i) => copyFileSync(image, path.join(dir, `${i}.png`)));
  const target = path.join(os.tmpdir(), "heig-kit-frames", `${name}.png`);
  mkdirSync(path.dirname(target), { recursive: true });
  const tile = `scale=640:-2,tile=${Math.min(3, images.length)}x${Math.ceil(images.length / 3)}:padding=6`;
  spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "1", "-i", path.join(dir, "%d.png"), "-vf", tile, "-frames:v", "1", target]);
  return existsSync(target) ? target : undefined;
}

/** The useful part of a Remotion or webpack error: its message, and the components it went through, without the internal stack. */
function errorText(error: unknown): string {
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  const internal = /node_modules|node:|render\.ts|^undefined$|renderWithHooks|updateFunctionComponent|beginWork|performUnitOfWork|workLoop|renderRootSync|performWorkOnRoot|performWorkUntilDeadline|__puppeteer|delayRender/;
  const lines = text
    .split("\n")
    .map((line) => line.trim().replace(/\s*\(?https?:\/\/localhost:\d+\/[^)\s]*\)?/, ""))
    .filter((line) => line && !internal.test(line));
  return [...new Set(lines)].slice(0, 15).join("\n");
}

try {
  const started = Date.now();
  // 1. Duration of each line: its speech, or its reading time.
  const speech = audio ? speak(narration.flatMap((scene) => scene.lines.map((line) => line.tts ?? line.text))) : undefined;
  const publicDir = path.join(work, "public");
  mkdirSync(path.join(publicDir, "audio"), { recursive: true });
  const data: VideoData = {
    audio,
    subtitles: !values["no-subtitles"],
    theme: { course: theme.course, mood: theme.mood, video: theme.video },
    scenes: narration.map((scene) => ({
      scene: scene.scene,
      lines: scene.lines.map((line) => {
        const wav = speech?.get(line.tts ?? line.text);
        if (!wav) return { id: line.id, text: line.text, seconds: line.seconds ?? readingSeconds(line.text) };
        copyFileSync(wav, path.join(publicDir, "audio", path.basename(wav)));
        return { id: line.id, text: line.text, seconds: wavSeconds(parseWav(readFileSync(wav))), file: `audio/${path.basename(wav)}` };
      }),
    })),
  };
  const dataFile = path.join(work, "data.json");
  writeFileSync(dataFile, JSON.stringify(data));
  const timeline = buildTimeline(data);

  // 2. The page: the video file and the kit, bundled with their timing.
  const modules = path.join(HERE, "node_modules");
  const serveUrl = await bundle({
    entryPoint: path.join(HERE, "entry.tsx"),
    outDir: path.join(work, "bundle"),
    publicDir,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        // The video file lives in the videos folder, outside this module: its imports resolve here.
        modules: [modules, ...(config.resolve?.modules ?? ["node_modules"])],
        alias: { ...(config.resolve?.alias as Record<string, string>), heigkit: path.join(HERE, "kit", "index.ts"), "@heigkit/video": source, "@heigkit/data": dataFile },
      },
    }),
  }).catch((error) => fail(`The video file does not compile:\n${errorText(error)}`));

  // A browser downloaded a moment ago starts slowly the first times (the system checks it): hence the long timeout.
  await ensureBrowser();
  const chromiumOptions = process.platform === "linux" ? { gl: "swangle" as const } : {};
  const composition = await selectComposition({ serveUrl, id: "Video", chromiumOptions, timeoutInMilliseconds: 90_000 }).catch((error) => fail(`The video does not start:\n${errorText(error)}`));
  const seconds = (timeline.total / FPS).toFixed(1);
  const frames = keyFrames(timeline);

  if (values.check) {
    // 3a. Only the key frames, as still images.
    const images: string[] = [];
    for (const [i, frame] of frames.entries()) {
      const output = path.join(work, `still-${i}.png`);
      await renderStill({ composition, serveUrl, output, frame, scale: 1 / 3, chromiumOptions }).catch((error) => fail(`Frame ${frame} (${(frame / FPS).toFixed(1)} s) fails:\n${errorText(error)}`));
      images.push(output);
    }
    console.log(`Theme: ${theme.course ?? "neutral (no course recognized, see --course)"}, mood ${theme.mood}.`);
    console.log(`Video OK: ${timeline.scenes.length} scene${timeline.scenes.length > 1 ? "s" : ""}, ${seconds} s without the voice.`);
    const image = sheet(images);
    if (image) console.log(`Frames: ${image}`);
  } else {
    // 3b. Every frame, into a new file that then replaces the video: a player showing the former version keeps it intact.
    const video = path.join(folder, `${name}.mp4`);
    staging = path.join(folder, `.${name}.rendering.mp4`);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: staging,
      scale: SCALE[values.quality],
      muted: !audio,
      chromiumOptions,
      concurrency: jobs,
    }).catch((error) => fail(`Rendering failed:\n${errorText(error)}`));
    renameSync(staging, video);
    console.log(video);
    if (values.open) open(video);
    console.log(`Theme: ${theme.course ?? "neutral (no course recognized, see --course)"}, mood ${theme.mood}.`);
    console.log(`Rendered in ${((Date.now() - started) / 1000).toFixed(1)} s (${seconds} s of video, ${audio ? "with the voice" : "silent"}).`);
    if (values.frames) {
      const dir = path.join(work, "frames");
      mkdirSync(dir, { recursive: true });
      frames.forEach((frame, i) => spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", (frame / FPS).toFixed(2), "-i", video, "-frames:v", "1", path.join(dir, `${i}.png`)]));
      const image = sheet(readdirSync(dir).sort((a, b) => parseInt(a) - parseInt(b)).map((f) => path.join(dir, f)));
      if (image) console.log(`Frames: ${image}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  if (staging) rmSync(staging, { force: true });
}
// Remotion keeps the browser process alive.
process.exit(0);
