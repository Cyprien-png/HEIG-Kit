import { timingSafeEqual } from "node:crypto";
import { type IncomingMessage, createServer } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MfaRequiredError } from "../auth/eduid.js";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Runs a tool, turning its result into text content and its errors into readable error results for the model. */
export async function respond(run: () => Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await run() }] };
  } catch (error) {
    const text =
      error instanceof MfaRequiredError
        ? "edu-ID asks for a two-step login code. Ask the user for the current 6-digit code of their authenticator app, " +
          "then call this tool again with mfa_code set to it."
        : error instanceof Error
          ? error.message
          : String(error);
    return { content: [{ type: "text", text }], isError: true };
  }
}

function authorized(req: IncomingMessage, token: string): boolean {
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : undefined;
}

/**
 * Serves MCP over Streamable HTTP at /mcp (stateless: a server per request), requiring `Authorization: Bearer <token>`;
 * /health answers without token.
 */
export function serveHttp(buildServer: () => McpServer, port: number, token: string, host?: string): void {
  createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200).end("ok");
      return;
    }
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }
    if (!authorized(req, token)) {
      res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("Unauthorized");
      return;
    }
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.method === "POST" ? await readJson(req) : undefined);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500).end("Internal error");
    }
  }).listen(port, host, () => console.error(`HEIG-Kit MCP server on http://${host ?? "0.0.0.0"}:${port}/mcp`));
}
