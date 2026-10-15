import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../../paths.js";
import { type Module, runScript } from "../module.js";
import { isWindows } from "../system.js";

export const shortcuts: Module = {
  id: "shortcuts",
  title: "Terminal shortcuts",
  summary: "heig:planning, heig:deadlines, heig:courses… usable from any folder (heig-planning… on Windows)",
  async install() {
    runScript("scripts/aliases.ts");
  },
  async check() {
    const files = isWindows ? [] : [".zshrc", ".bashrc", ".bash_profile"].map((f) => path.join(os.homedir(), f));
    const installed = isWindows || files.some((f) => existsSync(f) && readFileSync(f, "utf-8").includes(">>> heig-kit aliases >>>"));
    return [{ label: "shortcuts in the shell configuration", ok: installed, hint: "npm run setup -- shortcuts" }];
  },
};
