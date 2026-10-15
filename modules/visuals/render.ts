/**
 * HEIG-Kit visuals module: renders a ManimGL (3b1b/manim) scene to a video.
 *
 *   npm run video -- <scene.py> [SceneName] [--quality low|medium|high] [--open] [--out <folder>]
 *   npm run video -- --where    default folder for generated videos
 *
 * Without a scene name, every scene of the file is rendered. Videos go to ~/Documents/HEIG-Kit/videos by default
 * (HEIG_OUTPUT_DIR in .env). LaTeX formulas (Tex, TexText) use the TinyTeX installed by the setup.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { manimBin, outputDir, tinytexBinDir } from "../../src/vendor.js";

const QUALITY: Record<string, string> = { low: "-l", medium: "-m", high: "--hd" };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    quality: { type: "string", default: "medium" },
    open: { type: "boolean", default: false },
    out: { type: "string" },
    where: { type: "boolean", default: false },
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
if (!file) fail("Usage: npm run video -- <scene.py> [SceneName] [--quality low|medium|high] [--open] [--out <folder>]");
if (!QUALITY[values.quality]) fail(`Invalid --quality "${values.quality}", expected low, medium or high`);
const manimgl = manimBin("manimgl");
if (!existsSync(manimgl)) fail("manim is not installed: npm run setup -- visuals");

const source = path.resolve(file);
const folder = path.resolve(values.out ?? outputDir("videos"));
mkdirSync(folder, { recursive: true });

const tex = tinytexBinDir();
const env = {
  ...process.env,
  PATH: [tex, process.env.PATH].filter(Boolean).join(path.delimiter),
  // manim 1.7 imports pkg_resources, whose deprecation warning is noise here.
  PYTHONWARNINGS: "ignore",
  // No __pycache__ folder next to the scenes in the videos folder.
  PYTHONDONTWRITEBYTECODE: "1",
};
const args = [source, ...(scene ? [scene] : ["-a"]), "-w", QUALITY[values.quality], "--video_dir", folder];
// ManimGL renders with OpenGL: on a Linux machine without display, through a virtual one.
const headless = process.platform === "linux" && !process.env.DISPLAY;
const started = Date.now();
const result = headless
  ? spawnSync("xvfb-run", ["-a", manimgl, ...args], { env, stdio: "inherit", cwd: path.dirname(source) })
  : spawnSync(manimgl, args, { env, stdio: "inherit", cwd: path.dirname(source) });
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
for (const video of videos) console.log(video);
if (values.open) {
  for (const video of videos) {
    if (process.platform === "darwin") spawnSync("open", [video]);
    else if (process.platform === "win32") spawnSync("cmd", ["/c", "start", '""', video], { shell: true });
    else spawnSync("xdg-open", [video], { stdio: "ignore" });
  }
}
