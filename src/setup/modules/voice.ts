import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { KOKORO_DIR, kokoroModelFile, kokoroPython, kokoroVoicesFile, manimBin } from "../../vendor.js";
import type { Module } from "../module.js";
import { run } from "../system.js";

const KOKORO_ONNX_VERSION = "0.6.1";
const MODEL_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";

/** Downloads next to the destination, so an interrupted download never looks like an installed file. */
async function download(url: string, file: string): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not download ${url} (${response.status})`);
  try {
    await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(partial));
    renameSync(partial, file);
  } finally {
    rmSync(partial, { force: true });
  }
}

export const voice: Module = {
  id: "voice",
  title: "Video narration",
  summary: "spoken explanations on the animations, with a local French voice (npm run video -- --voice)",
  requires: () => ["visuals"],
  async install() {
    // Its own environment, built from the Python of the visuals module: removing vendor/kokoro removes everything.
    if (!existsSync(kokoroPython())) run(manimBin("python"), ["-m", "venv", path.join(KOKORO_DIR, ".venv")]);
    console.log("  installing Kokoro (speech synthesis)…");
    run(kokoroPython(), ["-m", "pip", "install", "--quiet", `kokoro-onnx==${KOKORO_ONNX_VERSION}`]);
    for (const file of [kokoroModelFile(), kokoroVoicesFile()]) {
      if (existsSync(file)) continue;
      console.log(`  downloading ${path.basename(file)}…`);
      await download(`${MODEL_RELEASE}/${path.basename(file)}`, file);
    }
  },
  async check() {
    const kokoroOk = (() => {
      try {
        run(kokoroPython(), ["-c", "import kokoro_onnx"], { quiet: true });
        return true;
      } catch {
        return false;
      }
    })();
    return [
      { label: "Kokoro installed in vendor/kokoro", ok: kokoroOk, hint: "npm run setup -- voice" },
      { label: "Kokoro model and voices", ok: existsSync(kokoroModelFile()) && existsSync(kokoroVoicesFile()), hint: "npm run setup -- voice" },
    ];
  },
};
