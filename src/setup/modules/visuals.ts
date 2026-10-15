import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MANIM_DIR, VENDOR_DIR, manimBin, tinytexBinDir, tinytexDir } from "../../vendor.js";
import type { Module } from "../module.js";
import { commandExists, ensureCommand, installPackage, isWindows, run } from "../system.js";

/** Last ManimGL release: the development branch is being rewritten and is not stable. */
const MANIM_VERSION = "v1.7.2";
const MANIM_REPO = "https://github.com/3b1b/manim.git";
/** LaTeX packages of ManimGL's default template (manimlib/tex_templates.yml), and what they depend on. */
const TEX_PACKAGES = [
  "standalone", "xkeyval", "currfile", "filemod", "gincltex", "preview", "dvisvgm", "babel-english", "doublestroke",
  "setspace", "tipa", "relsize", "jknapltx", "calligra", "fundus-calligra", "wasysym", "wasy", "ragged2e", "physics",
  "xcolor", "microtype", "psnfss",
];
/** Python versions with prebuilt wheels for every ManimGL dependency (it needs at least 3.10). */
const PYTHON_VERSIONS = ["3.12", "3.11", "3.13"];

/** A Python 3.11 to 3.13 interpreter, installing Python 3.12 when none is found. */
function findPython(): string[] {
  const find = () => {
    for (const version of PYTHON_VERSIONS) {
      if (isWindows) {
        try {
          run("py", [`-${version}`, "--version"], { quiet: true });
          return ["py", `-${version}`];
        } catch {
          continue;
        }
      }
      if (commandExists(`python${version}`)) return [`python${version}`];
    }
    return undefined;
  };
  const found = find();
  if (found) return found;
  installPackage("python");
  const installed = find();
  if (!installed) throw new Error("Python 3.12 was installed but is not available yet: open a new terminal and run the setup again");
  return installed;
}

function installManim(): void {
  if (!existsSync(path.join(MANIM_DIR, "setup.py"))) {
    console.log(`  downloading manim ${MANIM_VERSION} into vendor/manim…`);
    rmSync(MANIM_DIR, { recursive: true, force: true });
    run("git", ["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", MANIM_VERSION, MANIM_REPO, MANIM_DIR]);
  }
  if (!existsSync(manimBin("python"))) {
    const [python, ...args] = findPython();
    run(python, [...args, "-m", "venv", path.join(MANIM_DIR, ".venv")]);
  }
  console.log("  installing manim and its Python dependencies…");
  // setuptools < 81 still provides pkg_resources, which manim 1.7 imports.
  run(manimBin("python"), ["-m", "pip", "install", "--quiet", "--upgrade", "pip", "setuptools<81"]);
  run(manimBin("python"), ["-m", "pip", "install", "--quiet", "-e", MANIM_DIR]);
}

/** TinyTeX, a small TeX Live, in vendor/ (manim renders Tex and TexText with LaTeX and dvisvgm). */
async function installTinytex(): Promise<void> {
  if (!tinytexBinDir()) {
    console.log("  downloading TinyTeX (LaTeX for manim formulas) into vendor/…");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "heig-kit-tinytex-"));
    try {
      const script = isWindows ? "install-bin-windows.ps1" : "install-bin-unix.sh";
      const response = await fetch(`https://tinytex.yihui.org/${script}`);
      if (!response.ok) throw new Error(`Could not download the TinyTeX installer (${response.status})`);
      const file = path.join(tmp, script);
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      const env = { TINYTEX_DIR: VENDOR_DIR };
      if (isWindows) {
        // TinyTeX does not support folders with spaces on Windows.
        if (VENDOR_DIR.includes(" ")) throw new Error("Move HEIG-Kit to a folder without spaces to install TinyTeX on Windows");
        run("powershell", ["-ExecutionPolicy", "Bypass", "-File", file], { env, cwd: tmp });
      } else {
        // First argument: where to keep the downloaded archive; --no-path: leave the system PATH untouched.
        run("sh", [file, tmp, "--no-path"], { env, cwd: tmp });
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  const bin = tinytexBinDir();
  if (!bin) throw new Error(`TinyTeX was not installed in ${tinytexDir()}`);
  const tool = (name: string) => path.join(bin, isWindows ? `${name}.bat` : name);
  console.log("  installing the LaTeX packages used by manim…");
  try {
    run(tool("tlmgr"), ["install", ...TEX_PACKAGES], { quiet: true });
  } catch {
    // tlmgr reports an error when some packages are already installed or a format rebuild warns: checked below.
  }
  run(tool("mktexlsr"), [], { quiet: true });
}

export const visuals: Module = {
  id: "visuals",
  title: "Visual demonstrations",
  summary: "mathematical animations with 3b1b/manim, playable or embedded in documents (skill heig:visuals)",
  async install() {
    ensureCommand("git");
    ensureCommand("ffmpeg");
    if (process.platform === "linux") installPackage("manim-libs");
    installManim();
    await installTinytex();
  },
  async check() {
    const manimOk = (() => {
      try {
        run(manimBin("manimgl"), ["--version"], { quiet: true, env: { PYTHONWARNINGS: "ignore" } });
        return true;
      } catch {
        return false;
      }
    })();
    const latex = tinytexBinDir();
    return [
      { label: "manim installed in vendor/manim", ok: manimOk, hint: "npm run setup -- visuals" },
      { label: "LaTeX (TinyTeX) installed in vendor/", ok: Boolean(latex && existsSync(path.join(latex, isWindows ? "latex.exe" : "latex"))), hint: "npm run setup -- visuals" },
      { label: "FFmpeg", ok: commandExists("ffmpeg"), hint: "npm run setup -- visuals" },
    ];
  },
};
