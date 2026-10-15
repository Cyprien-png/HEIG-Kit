import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../../paths.js";
import type { Module } from "../module.js";
import { commandExists, run } from "../system.js";

const TOKEN = path.join(ROOT, "data", "mcp-token");

export const claude: Module = {
  id: "claude",
  title: "Claude Code plugin",
  summary: "the heig:* skills in Claude Code, and the knowledge base MCP server when the knowledge module is installed",
  async install() {
    if (!commandExists("claude")) throw new Error("Claude Code is not installed: see https://claude.com/claude-code");
    run("claude", ["plugin", "marketplace", "add", ROOT]);
    run("claude", ["plugin", "install", "heig@heig-kit"]);
    if (existsSync(TOKEN)) {
      const token = readFileSync(TOKEN, "utf-8").trim();
      try {
        run("claude", ["mcp", "remove", "--scope", "user", "heig-kit"], { quiet: true });
      } catch {
        // Not registered yet.
      }
      run("claude", [
        "mcp", "add", "--scope", "user", "--transport", "http", "heig-kit", "http://127.0.0.1:8765/mcp",
        "--header", `Authorization: Bearer ${token}`,
      ], { quiet: true });
      console.log("  knowledge base MCP server registered (heig-kit)");
    }
  },
  async check() {
    const installed = commandExists("claude") && run("claude", ["plugin", "list"], { quiet: true }).includes("heig@heig-kit");
    return [{ label: "heig plugin installed in Claude Code", ok: installed, hint: "npm run setup -- claude" }];
  },
};
