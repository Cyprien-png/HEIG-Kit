import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../../paths.js";
import { OMNIVOICE_DIR, omnivoiceHome, omnivoicePython } from "../../vendor.js";
import { type Module, runScript } from "../module.js";
import { NPM, commandExists, ensureCommand, installPackage, run } from "../system.js";
import { findPython } from "./visuals.js";

const MODULE_DIR = path.join(ROOT, "modules", "hqvideo");
/** Same versions as rag/render.Dockerfile and HQ_VOICE_ID (src/vendor.ts). */
const TORCH_VERSION = "2.8.0";
const OMNIVOICE_VERSION = "0.2.1";
const MODEL = "k2-fsa/OmniVoice";
const HINT = "npm run setup -- hqvideo";

/** Remotion downloads its browser next to the packages of the folder it runs in: rendering always runs from the root. */
function browserDir(): string {
  return path.join(ROOT, "node_modules", ".remotion", "chrome-headless-shell");
}

function modelInstalled(): boolean {
  const snapshots = path.join(omnivoiceHome(), "hub", `models--${MODEL.replace("/", "--")}`, "snapshots");
  return existsSync(snapshots) && readdirSync(snapshots).some((snapshot) => existsSync(path.join(snapshots, snapshot, "model.safetensors")));
}

function installVoice(): void {
  if (!existsSync(omnivoicePython())) {
    const [python, ...args] = findPython();
    mkdirSync(OMNIVOICE_DIR, { recursive: true });
    run(python, [...args, "-m", "venv", path.join(OMNIVOICE_DIR, ".venv")]);
  }
  console.log("  installing OmniVoice (speech synthesis) and PyTorch, about 2 GB…");
  // Without an NVIDIA card, Linux gets the CPU build of PyTorch: the default one carries 2 GB of CUDA libraries.
  const cpuOnly = process.platform === "linux" && !commandExists("nvidia-smi");
  // Its "+cpu" versions rank above the default ones, and the other packages still come from PyPI.
  const index = cpuOnly ? ["--extra-index-url", "https://download.pytorch.org/whl/cpu"] : [];
  run(omnivoicePython(), ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);
  run(omnivoicePython(), ["-m", "pip", "install", "--quiet", ...index, `torch==${TORCH_VERSION}`, `torchaudio==${TORCH_VERSION}`]);
  run(omnivoicePython(), ["-m", "pip", "install", "--quiet", ...index, `omnivoice==${OMNIVOICE_VERSION}`]);
  if (!modelInstalled()) {
    console.log("  downloading the OmniVoice model into vendor/omnivoice, about 3 GB…");
    run(omnivoicePython(), ["-c", `from huggingface_hub import snapshot_download; snapshot_download("${MODEL}")`], { env: { HF_HOME: omnivoiceHome() } });
  }
}

export const hqvideo: Module = {
  id: "hqvideo",
  title: "High quality videos",
  summary: "explanatory videos drawn in HTML and SVG with Remotion, with a natural local voice (npm run hqvideo)",
  async install() {
    ensureCommand("ffmpeg");
    if (process.platform === "linux") installPackage("chrome-libs");
    console.log("  installing the renderer (Remotion, React)…");
    run(NPM, ["install", "--no-audit", "--no-fund"], { cwd: MODULE_DIR });
    installVoice();
    // Downloads Remotion's headless browser and proves that the whole chain draws a video.
    console.log("  downloading the headless browser and checking the example video…");
    runScript("modules/hqvideo/render.ts", path.join(MODULE_DIR, "examples", "mux.tsx"), "--check");
  },
  async check() {
    const voiceOk = (() => {
      try {
        run(omnivoicePython(), ["-c", "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('omnivoice') else 1)"], { quiet: true });
        return true;
      } catch {
        return false;
      }
    })();
    return [
      { label: "renderer installed (Remotion)", ok: existsSync(path.join(MODULE_DIR, "node_modules", "remotion")), hint: HINT },
      { label: "headless browser of the renderer", ok: existsSync(browserDir()), hint: HINT },
      { label: "FFmpeg", ok: commandExists("ffmpeg"), hint: HINT },
      { label: "OmniVoice installed in vendor/omnivoice", ok: voiceOk, hint: HINT },
      { label: "OmniVoice model", ok: modelInstalled(), hint: HINT },
    ];
  },
};
