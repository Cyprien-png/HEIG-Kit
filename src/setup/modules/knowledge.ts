import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../../paths.js";
import { ensureEmbeddingModel } from "../../rag/embed.js";
import { type Module, runScript } from "../module.js";
import { commandExists, ensureDockerRunning, installPackage, isWindows, run } from "../system.js";

const COMPOSE = path.join(ROOT, "rag", "compose.yml");

async function mcpHealthy(): Promise<boolean> {
  try {
    return (await fetch("http://127.0.0.1:8765/health")).ok;
  } catch {
    return false;
  }
}

export const knowledge: Module = {
  id: "knowledge",
  title: "Course knowledge base and teacher",
  summary: "local search engine over your course documents (Docker), MCP server and the heig:teacher skill",
  requires: (options) => (options.ingest ? ["campus"] : []),
  async install(options) {
    if (!commandExists("docker")) {
      if (process.platform === "linux") {
        throw new Error("Install Docker Engine (https://docs.docker.com/engine/install/), then run the setup again");
      }
      installPackage("docker");
    }
    await ensureDockerRunning();
    runScript("scripts/mcp-token.ts");
    console.log("  starting the database, the embedding service and the MCP server…");
    run("docker", ["compose", "-f", COMPOSE, "up", "-d", "--build", "--wait"]);
    console.log("  downloading the embedding model if needed (about 1.2 GB, once)…");
    await ensureEmbeddingModel();
    if (options.ingest) {
      console.log("  indexing your Cyberlearn courses (long the first time: allow one to two hours)…");
      runScript("src/cli.ts", "ingest");
      runScript("scripts/autoupdate.ts");
    } else {
      console.log("  to index your Cyberlearn courses: npm run ingest (and npm run autoupdate for a daily update)");
    }
  },
  async check() {
    const docker = commandExists("docker");
    return [
      { label: "Docker installed", ok: docker, hint: isWindows || process.platform === "darwin" ? "npm run setup -- knowledge" : "https://docs.docker.com/engine/install/" },
      { label: "MCP server running", ok: await mcpHealthy(), hint: "npm run rag:start" },
      { label: "MCP access token created", ok: existsSync(path.join(ROOT, "data", "mcp-token")), hint: "npm run rag:start" },
    ];
  },
};
