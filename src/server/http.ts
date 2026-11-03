import { createReadStream, statSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Auth, LoginLimiter } from "./auth.js";
import type { ServerConfig } from "./config.js";
import { CONTENT_TYPES, resolveGenerated } from "./files.js";

const MAX_LOGIN_BYTES = 4 * 1024;
const MAX_MCP_BYTES = 32 * 1024 ** 2;

class TooLarge extends Error {}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new TooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function json(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers }).end(JSON.stringify(body));
}

/** Behind a reverse proxy, the last X-Forwarded-For entry is the one the proxy itself added. */
function clientOf(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  return (trustProxy && value?.split(",").pop()?.trim()) || req.socket.remoteAddress || "unknown";
}

async function login(req: IncomingMessage, res: ServerResponse, auth: Auth, limiter: LoginLimiter, client: string): Promise<void> {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" }, { Allow: "POST" });
  if (!limiter.allowed(client)) {
    console.error(`Login refused (too many failures) from ${client}`);
    return json(res, 429, { error: "too many attempts, try again later" }, { "Retry-After": "900" });
  }
  let credentials: { username?: unknown; password?: unknown };
  try {
    const parsed = JSON.parse((await readBody(req, MAX_LOGIN_BYTES)).toString("utf-8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error();
    credentials = parsed;
  } catch (error) {
    if (error instanceof TooLarge) throw error;
    return json(res, 400, { error: 'expected JSON: {"username": …, "password": …}' });
  }
  if (!auth.checkCredentials(credentials.username, credentials.password)) {
    limiter.fail(client);
    console.error(`Login failed from ${client}`);
    return json(res, 401, { error: "invalid credentials" });
  }
  limiter.succeed(client);
  const { token, expiresAt } = await auth.issueToken();
  json(res, 200, { access_token: token, token_type: "Bearer", expires_at: expiresAt.toISOString() });
}

async function download(req: IncomingMessage, res: ServerResponse, url: URL, auth: Auth): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" }, { Allow: "GET, HEAD" });
  const id = await auth.verifyFileToken(url.searchParams.get("token") ?? "");
  const file = id && resolveGenerated(id);
  // Same answer for a bad link and a missing file.
  if (!file) return json(res, 404, { error: "invalid or expired link" });
  const name = path.basename(file);
  res.writeHead(200, {
    // Never rendered on the server's address: a generated HTML page could otherwise run scripts there.
    "Content-Type": CONTENT_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": statSync(file).size,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

async function mcp(req: IncomingMessage, res: ServerResponse, buildServer: () => Promise<McpServer>): Promise<void> {
  const server = await buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  let body: unknown;
  if (req.method === "POST") {
    const raw = await readBody(req, MAX_MCP_BYTES);
    try {
      body = raw.length > 0 ? JSON.parse(raw.toString("utf-8")) : undefined;
    } catch {
      return json(res, 400, { error: "invalid JSON" });
    }
  }
  await transport.handleRequest(req, res, body);
}

/**
 * The public face of the remote server: /health, POST /auth/login, /mcp (access token), GET /files (signed link).
 * Requests for another host name are refused, which blocks DNS rebinding from a browser.
 */
export function createRemoteServer(config: ServerConfig, buildServer: () => Promise<McpServer>, auth = new Auth(config), limiter = new LoginLimiter()): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", config.publicUrl);
      if (url.pathname === "/health") return void res.writeHead(200).end("ok");
      if (req.headers.host !== config.publicUrl.host) return json(res, 421, { error: "unknown host" });
      if (url.pathname === "/auth/login") return await login(req, res, auth, limiter, clientOf(req, config.trustProxy));
      if (url.pathname === "/files") return await download(req, res, url, auth);
      if (url.pathname === "/mcp") {
        if (!(await auth.verifyHeader(req.headers.authorization))) return json(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
        return await mcp(req, res, buildServer);
      }
      json(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof TooLarge) {
        if (!res.headersSent) json(res, 413, { error: "request too large" });
        return;
      }
      // The details stay in the server's log.
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: "internal error" });
    }
  });
}
