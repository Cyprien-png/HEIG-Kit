import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../../paths.js";
import type { Module } from "../module.js";
import { NPM, commandExists, ensureCommand, installPackage, run } from "../system.js";

const MODULE_DIR = path.join(ROOT, "modules", "documents");

export const documents: Module = {
  id: "documents",
  title: "Documents",
  summary: "Markdown with LaTeX math and Mermaid diagrams to PDF, HTML and DOCX (skill heig:documents)",
  async install() {
    if (process.platform === "linux") installPackage("chrome-libs");
    console.log("  installing the renderer (Markdown, KaTeX, Mermaid, headless Chromium)…");
    run(NPM, ["install", "--no-audit", "--no-fund"], { cwd: MODULE_DIR });
    ensureCommand("pandoc");
  },
  async check() {
    return [
      { label: "renderer installed", ok: existsSync(path.join(MODULE_DIR, "node_modules", "puppeteer")), hint: "npm run setup -- documents" },
      { label: "pandoc (DOCX export)", ok: commandExists("pandoc"), hint: "npm run setup -- documents" },
    ];
  },
};
