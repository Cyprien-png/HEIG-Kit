import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../../paths.js";
import type { Module } from "../module.js";
import { NPM, run } from "../system.js";

const WEB_DIR = path.join(ROOT, "web");

/** The web application served by `npm run server` (the server image builds it itself). */
export const web: Module = {
  id: "web",
  title: "Web application",
  summary: "calendar, courses, flashcards, corrections, profile and status pages served by the server (docs/app.md)",
  async install() {
    console.log("  installing and building the web application (Vite, React)…");
    run(NPM, ["ci", "--no-audit", "--no-fund"], { cwd: WEB_DIR });
    run(NPM, ["run", "build"], { cwd: WEB_DIR });
  },
  async check() {
    return [{ label: "web application built", ok: existsSync(path.join(WEB_DIR, "dist", "index.html")), hint: "npm run setup -- web" }];
  },
};
