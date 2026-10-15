import path from "node:path";
import { ROOT } from "../../paths.js";
import type { Module } from "../module.js";
import { commandExists, run } from "../system.js";

export const claude: Module = {
  id: "claude",
  title: "Claude Code plugin",
  summary: "the heig:* skills in Claude Code, and the knowledge base MCP server when the knowledge module is installed",
  async install() {
    if (!commandExists("claude")) throw new Error("Claude Code is not installed: see https://claude.com/claude-code");
    run("claude", ["plugin", "marketplace", "add", ROOT]);
    run("claude", ["plugin", "install", "heig@heig-kit"]);
    // The complete HEIG-Kit MCP server (src/mcp/host.ts), started by Claude Code over stdio.
    try {
      run("claude", ["mcp", "remove", "--scope", "user", "heig-kit"], { quiet: true });
    } catch {
      // Not registered yet.
    }
    const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    // "node" from the PATH rather than this Node.js's own path, which changes with each Node.js update.
    run("claude", ["mcp", "add", "--scope", "user", "heig-kit", "--", "node", tsx, path.join(ROOT, "src", "mcp", "host.ts")], { quiet: true });
    console.log("  HEIG-Kit MCP server registered (heig-kit)");
  },
  async check() {
    const installed = commandExists("claude") && run("claude", ["plugin", "list"], { quiet: true }).includes("heig@heig-kit");
    return [{ label: "heig plugin installed in Claude Code", ok: installed, hint: "npm run setup -- claude" }];
  },
};
