# MCP server: HEIG-Kit for any AI assistant

Every HEIG-Kit feature is available to any [MCP](https://modelcontextprotocol.io) client (Claude Desktop, Claude Code,
Open WebUI, n8n…) through a server that runs on your computer: timetables (yours and anyone's), study plan, unit and
module sheets, grades, absences, deadlines, Cyberlearn course pages, the course knowledge base, documents (PDF, DOCX,
HTML) and manim animations, and what was already generated.

```sh
npm run -s mcp                # stdio
npm run -s mcp -- --http      # http://127.0.0.1:8766/mcp, header "Authorization: Bearer <data/mcp-token>"
```

The server also gives clients usage instructions and two prompts (`teacher`, `practice_exam`). Tools that need
GAPS or Cyberlearn accept an `mfa_code` when edu-ID asks for a two-step login code. Features follow the installed
modules (knowledge base: `knowledge`; documents: `documents`; animations: `visuals`).

## Clients

- **Claude Code**: `npm run setup -- claude` registers it.
- **Claude Desktop**: in `claude_desktop_config.json`, add
  `"heig-kit": { "command": "node", "args": ["<HEIG-Kit>/node_modules/tsx/dist/cli.mjs", "<HEIG-Kit>/src/mcp/host.ts"] }`
  under `mcpServers`.
- **Open WebUI, n8n and other HTTP clients**: start `npm run -s mcp -- --http` and add the server
  `http://127.0.0.1:8766/mcp` (Streamable HTTP) with the bearer token of `data/mcp-token`. For clients that only
  support OpenAPI tools, put [mcpo](https://github.com/open-webui/mcpo) in front of the stdio server.

With a local model, nothing leaves your computer except the requests to GAPS and Cyberlearn; the model must support
tool calls, and answers depend on its quality.

The Docker service `mcp` (port 8765) only exposes the knowledge base tools, for clients that cannot reach your computer.
