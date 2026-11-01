import { existsSync } from "node:fs";
import path from "node:path";
import { PIPER_DIR, PIPER_VOICE, manimBin, piperPython, piperVoiceFile } from "../../vendor.js";
import type { Module } from "../module.js";
import { run } from "../system.js";

const PIPER_VERSION = "1.8.0";

export const voice: Module = {
  id: "voice",
  title: "Video narration",
  summary: "spoken explanations on the animations, with a local French voice (npm run video -- --voice)",
  requires: () => ["visuals"],
  async install() {
    // Its own environment, built from the Python of the visuals module: removing vendor/piper removes everything.
    if (!existsSync(piperPython())) run(manimBin("python"), ["-m", "venv", path.join(PIPER_DIR, ".venv")]);
    console.log("  installing Piper (speech synthesis)…");
    run(piperPython(), ["-m", "pip", "install", "--quiet", `piper-tts==${PIPER_VERSION}`]);
    if (!existsSync(piperVoiceFile())) {
      console.log(`  downloading the voice ${PIPER_VOICE} (about 60 MB)…`);
      run(piperPython(), ["-m", "piper.download_voices", "--download-dir", path.dirname(piperVoiceFile()), PIPER_VOICE]);
    }
  },
  async check() {
    const piperOk = (() => {
      try {
        run(piperPython(), ["-c", "import piper"], { quiet: true });
        return true;
      } catch {
        return false;
      }
    })();
    return [
      { label: "Piper installed in vendor/piper", ok: piperOk, hint: "npm run setup -- voice" },
      { label: `Voice ${PIPER_VOICE}`, ok: existsSync(piperVoiceFile()), hint: "npm run setup -- voice" },
    ];
  },
};
