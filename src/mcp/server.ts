/**
 * MCP server of the knowledge base, run in Docker by rag/compose.yml: course search tools only. The full HEIG-Kit
 * server (timetable, grades, documents, animations…) needs your computer and runs there: see src/mcp/host.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ROOT } from "../paths.js";
import { openDb } from "../rag/db.js";
import { serveHttp } from "./common.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";

const PORT = Number(process.env.MCP_PORT ?? 8765);
/** Created by `npm run rag:start`; the server refuses to start without it. */
const token = readFileSync(path.join(ROOT, "data", "mcp-token"), "utf-8").trim();
const db = openDb();

serveHttp(
  () => {
    const server = new McpServer({ name: "heig-kit-knowledge", version: "0.4.0" });
    registerKnowledgeTools(server, db);
    return server;
  },
  PORT,
  token,
);
