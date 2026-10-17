/**
 * HEIG-Kit visuals module: renders a ManimGL (3b1b/manim) scene to a video.
 *
 *   npm run video -- <scene.py> [SceneName] [--quality low|medium|high] [--open] [--frames] [--check] [--jobs N] [--out <folder>]
 *   npm run video -- --where    default folder for generated videos
 *
 * With a scene name, a dry run first checks the scene in a few seconds (Python, LaTeX and layout errors) and measures
 * its animations; the frames are then rendered in parallel parts (manimgl -n start,end) joined with FFmpeg. --check
 * stops after the dry run and prints the image of the last frame; --frames prints a sheet of key frames of the video,
 * to check its layout. Without a scene name, every scene of the file is rendered, one after the other.
 *
 * Videos go to ~/Documents/HEIG-Kit/videos by default (HEIG_OUTPUT_DIR in .env). LaTeX formulas (Tex, TexText) use the
 * TinyTeX installed by the setup; scenes can import the ready-made pieces of heigkit_manim.py (this folder).
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { manimBin, outputDir, tinytexBinDir } from "../../src/vendor.js";
import { keyFrameTimes, splitAnimations } from "./parts.js";

const QUALITY: Record<string, string> = { low: "-l", medium: "-m", high: "--hd" };
const HERE = import.meta.dirname;
/** Parallel parts by default: half the processors (each manim process also uses the GPU and FFmpeg), at most 4. */
const DEFAULT_JOBS = Math.min(4, Math.max(1, Math.floor(os.availableParallelism() / 2)));
const SHEET_FRAMES = 9;
/** A part shorter than this is not worth a process of its own (manim takes a few seconds to start). */
const MIN_PART_SECONDS = 8;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    quality: { type: "string", default: "medium" },
    open: { type: "boolean", default: false },
    out: { type: "string" },
    where: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
    frames: { type: "boolean", default: false },
    jobs: { type: "string" },
  },
});

if (values.where) {
  // Default folder for generated videos and their scene files (HEIG_OUTPUT_DIR in .env).
  console.log(outputDir("videos"));
  process.exit(0);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [file, scene] = positionals;
if (!file) fail("Usage: npm run video -- <scene.py> [SceneName] [--quality low|medium|high] [--open] [--frames] [--check] [--jobs N] [--out <folder>]");
if (!QUALITY[values.quality]) fail(`Invalid --quality "${values.quality}", expected low, medium or high`);
const jobs = values.jobs ? Number(values.jobs) : DEFAULT_JOBS;
if (!Number.isInteger(jobs) || jobs < 1) fail(`Invalid --jobs "${values.jobs}", expected a positive integer`);
const manimgl = manimBin("manimgl");
if (!existsSync(manimgl)) fail("manim is not installed: npm run setup -- visuals");

const source = path.resolve(file);
const folder = path.resolve(values.out ?? outputDir("videos"));
mkdirSync(folder, { recursive: true });

const tex = tinytexBinDir();
const env = {
  ...process.env,
  PATH: [tex, process.env.PATH].filter(Boolean).join(path.delimiter),
  // Scenes can `from heigkit_manim import *`.
  PYTHONPATH: [HERE, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  // manim 1.7 imports pkg_resources, whose deprecation warning is noise here.
  PYTHONWARNINGS: "ignore",
  // No __pycache__ folder next to the scenes in the videos folder.
  PYTHONDONTWRITEBYTECODE: "1",
};
// ManimGL renders with OpenGL: on a Linux machine without display, through a virtual one.
const headless = process.platform === "linux" && !process.env.DISPLAY;
const command = (program: string, args: string[]): [string, string[]] => (headless ? ["xvfb-run", ["-a", program, ...args]] : [program, args]);

/**
 * Whether a player has the video open: the user may be watching it, so a new render must neither close nor reopen it
 * (reopening restarts the video and interrupts them). QuickTime Player is asked through AppleScript (macOS asks once
 * for the permission), by document name: after a render that did not reopen it, it shows the former file, replaced
 * since; other players are found with lsof, on macOS and Linux.
 */
function isOpenInPlayer(file: string): boolean {
  if (!existsSync(file)) return false;
  if (process.platform === "darwin" && spawnSync("pgrep", ["-x", "QuickTime Player"]).status === 0) {
    const script = [
      "on run argv",
      'tell application "QuickTime Player"',
      "repeat with d in (get documents)",
      "try",
      'if name of d is (item 1 of argv) then return "open"',
      "end try",
      "end repeat",
      "end tell",
      'return ""',
      "end run",
    ];
    const asked = spawnSync("osascript", [...script.flatMap((line) => ["-e", line]), path.basename(file)], { encoding: "utf-8", timeout: 5000 });
    if (asked.stdout?.trim() === "open") return true;
  }
  if (process.platform === "win32") return false;
  return spawnSync("lsof", ["-t", "--", file], { stdio: "ignore", timeout: 5000 }).status === 0;
}

/** Opens the video, unless a player already shows it: it then says so instead of interrupting the user. */
function openUnlessWatched(file: string, watched: boolean): void {
  if (watched) console.log("Already open in a player: not reopened, so as not to interrupt it. Reopen it to see the new version.");
  else open(file);
}

function open(file: string): void {
  if (process.platform === "darwin") spawnSync("open", [file]);
  else if (process.platform === "win32") spawnSync("cmd", ["/c", "start", '""', file], { shell: true });
  else spawnSync("xdg-open", [file], { stdio: "ignore" });
}

/** Last lines of manim's output, without its progress bars. */
function errorLog(output: string): string {
  return output
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim() && !/it\/s\]|\d+%\||it \[/.test(l))
    .slice(-30)
    .join("\n");
}

function run(program: string, args: string[], extraEnv: Record<string, string> = {}): Promise<{ status: number; output: string }> {
  const [bin, argv] = command(program, args);
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(bin, argv, { env: { ...env, ...extraEnv }, cwd: path.dirname(source), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    child.on("close", (status) => resolve({ status: status ?? 1, output }));
  });
}

/** A sheet of the frames at `times`, 3 per row, written to a temporary file whose path is returned. */
function frameSheet(video: string, times: number[], name: string): string | undefined {
  const dir = mkdtempSync(path.join(os.tmpdir(), "heig-kit-frames-"));
  times.forEach((t, i) =>
    spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=640:-2", path.join(dir, `${i}.png`)]),
  );
  const count = readdirSync(dir).length;
  const sheet = path.join(os.tmpdir(), "heig-kit-frames", `${name}.png`);
  mkdirSync(path.dirname(sheet), { recursive: true });
  if (count > 0) {
    const tile = `tile=${Math.min(3, count)}x${Math.ceil(count / 3)}:padding=6`;
    spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "1", "-i", path.join(dir, "%d.png"), "-vf", tile, "-frames:v", "1", sheet]);
  }
  rmSync(dir, { recursive: true, force: true });
  return count > 0 && existsSync(sheet) ? sheet : undefined;
}

/** Every scene of the file, one after the other, as manim does it (no dry run, no parallel parts). */
function renderAll(): void {
  const started = Date.now();
  const watching = new Set(values.open ? readdirSync(folder).map((f) => path.join(folder, f)).filter((f) => /\.(mp4|mov|gif)$/i.test(f) && isOpenInPlayer(f)) : []);
  const [bin, argv] = command(manimgl, [source, "-a", "-w", QUALITY[values.quality], "--video_dir", folder]);
  const result = spawnSync(bin, argv, { env, stdio: "inherit", cwd: path.dirname(source) });
  if (result.status !== 0) {
    // A failed render leaves a partial "<Scene>_temp.mp4" behind.
    for (const f of readdirSync(folder).filter((f) => f.includes("_temp."))) {
      if (statSync(path.join(folder, f)).mtimeMs >= started) rmSync(path.join(folder, f), { force: true });
    }
    fail(`manim failed (exit code ${result.status})`);
  }
  const videos = readdirSync(folder)
    .filter((f) => /\.(mp4|mov|gif)$/i.test(f) && !f.includes("_temp"))
    .map((f) => path.join(folder, f))
    .filter((f) => statSync(f).mtimeMs >= started);
  for (const video of videos) {
    console.log(video);
    if (values.open) openUnlessWatched(video, watching.has(video));
  }
}

async function renderScene(name: string): Promise<void> {
  const started = Date.now();
  const work = mkdtempSync(path.join(os.tmpdir(), "heig-kit-video-"));
  let staging: string | undefined;
  try {
    // 1. Dry run: errors in seconds, last frame, duration of each animation.
    const plan = path.join(work, "plan.json");
    const dry = await run(manimBin("python"), [path.join(HERE, "plan.py"), source, name, "-s", "-w", QUALITY[values.quality], "--video_dir", work], { HEIGKIT_PLAN: plan });
    if (dry.status !== 0) fail(`The scene does not run (dry run):\n${errorLog(dry.output)}`);
    const { durations, layout } = JSON.parse(readFileSync(plan, "utf-8")) as {
      durations: number[];
      layout: { animation: number; time: number; warning: string }[];
    };
    if (layout.length > 0) {
      console.log(`Layout: ${layout.length} problem${layout.length > 1 ? "s" : ""} (end of animation, time in the video):`);
      for (const p of layout) console.log(`  - animation ${p.animation} (${p.time.toFixed(1)} s): ${p.warning}`);
    } else {
      console.log("Layout: no overlapping texts, no line through a text, nothing off screen.");
    }
    const lastFrame = readdirSync(work).find((f) => f.endsWith(".png"));
    if (values.check) {
      const kept = path.join(os.tmpdir(), "heig-kit-frames", `${name}-last.png`);
      mkdirSync(path.dirname(kept), { recursive: true });
      if (lastFrame) copyFileSync(path.join(work, lastFrame), kept);
      console.log(`Scene OK: ${durations.length} animations, ${durations.reduce((a, b) => a + b, 0).toFixed(1)} s`);
      if (lastFrame) console.log(`Last frame: ${kept}`);
      return;
    }

    // 2. Parallel parts, each rendering a range of animations.
    const ranges = splitAnimations(durations, jobs, MIN_PART_SECONDS);
    const parts = await Promise.all(
      ranges.map(async ([a, b], i) => {
        const range = i === ranges.length - 1 ? `${a}` : `${a},${b}`;
        const args = [source, name, "-w", QUALITY[values.quality], "--video_dir", work, "--file_name", `part${i}`];
        if (ranges.length > 1) args.push("-n", range);
        const result = await run(manimgl, args);
        if (result.status !== 0) throw new Error(`Part ${i + 1} (animations ${range}) failed:\n${errorLog(result.output)}`);
        return path.join(work, `part${i}.mp4`);
      }),
    ).catch((error: Error) => fail(error.message));

    // 3. Joined without re-encoding, into a new file that then replaces the video: a player still showing the former
    // version keeps reading it intact (writing over it while it plays froze the picture).
    const video = path.join(folder, `${name}.mp4`);
    staging = path.join(folder, `.${name}.rendering.mp4`);
    if (parts.length === 1) {
      copyFileSync(parts[0], staging);
    } else {
      const list = path.join(work, "parts.txt");
      writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
      const joined = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", staging], { encoding: "utf-8" });
      if (joined.status !== 0) {
        rmSync(staging, { force: true });
        fail(`FFmpeg could not join the parts: ${joined.stderr}`);
      }
    }
    const watched = values.open && isOpenInPlayer(video);
    renameSync(staging, video);
    console.log(video);
    // Opened as soon as it exists: checking the frames comes after.
    if (values.open) openUnlessWatched(video, watched);
    console.log(`Rendered in ${((Date.now() - started) / 1000).toFixed(1)} s (${parts.length} part${parts.length > 1 ? "s" : ""}).`);
    if (values.frames) {
      const sheet = frameSheet(video, keyFrameTimes(durations, SHEET_FRAMES), name);
      if (sheet) console.log(`Frames: ${sheet}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
    if (staging) rmSync(staging, { force: true });
  }
}

if (scene) await renderScene(scene);
else renderAll();
