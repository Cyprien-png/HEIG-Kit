/**
 * Creates the token clients must send to the HEIG-Kit MCP server (data/mcp-token, readable by the current user only)
 * and prints the command registering the server in Claude Code. Run by `npm run rag:start`; keeps an existing token.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../src/paths.js";

const file = path.join(ROOT, "data", "mcp-token");
if (!existsSync(file)) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  console.log(`Created the MCP access token in ${path.relative(ROOT, file)}`);
}

if (process.argv.includes("--print")) {
  const token = readFileSync(file, "utf-8").trim();
  console.log("Register the server in Claude Code with:\n");
  console.log(`claude mcp add --transport http heig-kit http://127.0.0.1:8765/mcp --header "Authorization: Bearer ${token}"`);
}
