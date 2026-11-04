import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createApi } from "./api/index.js";
import { type Principal, type Router, runRoute } from "./api/router.js";
import { serveWeb } from "./api/static.js";
import { CONTENT_TYPES, HttpError, TooLarge, clientOf, json, parseCookies, readBody, readJson, sendFile } from "./api/util.js";
import type { App } from "./app.js";
import { resolveGenerated } from "./files.js";

const MAX_MCP_BYTES = 32 * 1024 ** 2;
export const SESSION_COOKIE = "heig_session";

async function login(req: IncomingMessage, res: ServerResponse, app: App, client: string, cookie: boolean): Promise<void> {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" }, { Allow: "POST" });
  if (!app.limiter.allowed(client)) {
    console.error(`Login refused (too many failures) from ${client}`);
    return json(res, 429, { error: "too many attempts, try again later" }, { "Retry-After": "900" });
  }
  const credentials = await readJson(req, 4 * 1024);
  if (!app.auth.checkCredentials(credentials.username, credentials.password)) {
    app.limiter.fail(client);
    console.error(`Login failed from ${client}`);
    return json(res, 401, { error: "invalid credentials" });
  }
  app.limiter.succeed(client);
  const { token, expiresAt } = await app.auth.issueToken();
  if (!cookie) return json(res, 200, { access_token: token, token_type: "Bearer", expires_at: expiresAt.toISOString() });
  json(res, 200, { username: app.config.username, expires_at: expiresAt.toISOString() }, { "Set-Cookie": sessionCookie(app, token, expiresAt) });
}

function sessionCookie(app: App, token: string, expiresAt: Date): string {
  const secure = app.config.publicUrl.protocol === "https:" ? "; Secure" : "";
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearedSessionCookie(app: App): string {
  return sessionCookie(app, "", new Date(0));
}

async function download(req: IncomingMessage, res: ServerResponse, url: URL, app: App): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" }, { Allow: "GET, HEAD" });
  const id = await app.auth.verifyFileToken(url.searchParams.get("token") ?? "");
  const file = id && resolveGenerated(id);
  // Same answer for a bad link and a missing file.
  if (!file) return json(res, 404, { error: "invalid or expired link" });
  const name = path.basename(file);
  // Never rendered on the server's address: a generated HTML page could otherwise run scripts there.
  sendFile(req, res, file, { contentType: CONTENT_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream", fileName: name, cacheControl: "no-store" });
}

/** The MCP tool a JSON-RPC body calls, for the request log. */
function toolOf(body: unknown): string | undefined {
  const calls = Array.isArray(body) ? body : [body];
  for (const call of calls) {
    if (call && typeof call === "object" && (call as { method?: unknown }).method === "tools/call") {
      const name = (call as { params?: { name?: unknown } }).params?.name;
      if (typeof name === "string") return name;
    }
  }
  return undefined;
}

async function mcp(req: IncomingMessage, res: ServerResponse, buildServer: () => Promise<McpServer>): Promise<string | undefined> {
  let body: unknown;
  if (req.method === "POST") {
    const raw = await readBody(req, MAX_MCP_BYTES);
    try {
      body = raw.length > 0 ? JSON.parse(raw.toString("utf-8")) : undefined;
    } catch {
      json(res, 400, { error: "invalid JSON" });
      return undefined;
    }
  }
  const server = await buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
  return toolOf(body);
}

/** Who makes an API request, from its cookie or bearer token; `undefined` when nobody valid. */
async function authenticate(req: IncomingMessage, app: App): Promise<Principal | undefined> {
  const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
  if (bearer) {
    if (await app.auth.verifyAccessToken(bearer)) return { kind: "bearer" };
    const correctionId = await app.auth.verifyCaptureToken(bearer);
    return correctionId ? { kind: "capture", correctionId } : undefined;
  }
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (cookie && (await app.auth.verifyAccessToken(cookie))) return { kind: "cookie" };
  return undefined;
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL, app: App, router: Router, client: string): Promise<{ note?: string }> {
  const method = req.method ?? "GET";
  const matched = router.match(method, url.pathname);
  if (!matched) {
    json(res, 404, { error: "not found" });
    return {};
  }
  if ("allowed" in matched) {
    json(res, 405, { error: "method not allowed" }, { Allow: matched.allowed.join(", ") });
    return {};
  }
  const { route, params } = matched;
  let principal: Principal = { kind: "cookie" };
  if (!route.options.public) {
    const found = await authenticate(req, app);
    if (!found) {
      json(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
      return { note: req.headers.authorization || req.headers.cookie?.includes(SESSION_COOKIE) ? "invalid token" : "no token" };
    }
    principal = found;
    const allow = route.options.allow ?? ["cookie", "bearer"];
    if (!allow.includes(principal.kind)) {
      json(res, 403, { error: "forbidden" });
      return { note: "forbidden" };
    }
    // A page of another site can make the browser send the cookie, but cannot add this header.
    if (principal.kind === "cookie" && method !== "GET" && method !== "HEAD" && req.headers["x-requested-with"] !== "heig-kit") {
      json(res, 403, { error: "missing X-Requested-With header" });
      return { note: "csrf" };
    }
  }
  await runRoute(route, { req, res, url, params, principal, client });
  return {};
}

/**
 * The public face of the remote server: /health, POST /auth/login, /mcp (access token), GET /files (signed link),
 * /api/* (cookie session or access token) and the web application for every other path.
 * Requests for another host name are refused, which blocks DNS rebinding from a browser.
 */
export function createRemoteServer(app: App, buildServer: () => Promise<McpServer>): Server {
  const router = createApi(app);
  return createServer(async (req, res) => {
    const started = performance.now();
    const client = clientOf(req, app.config.trustProxy);
    let tool: string | undefined;
    let note: string | undefined;
    res.on("finish", () => {
      if (req.url === "/health") return;
      app.requests.record({ at: new Date(), client, method: req.method ?? "", path: new URL(req.url ?? "/", app.config.publicUrl).pathname, status: res.statusCode, ms: performance.now() - started, tool, note });
    });
    try {
      const url = new URL(req.url ?? "/", app.config.publicUrl);
      if (url.pathname === "/health") return void res.writeHead(200).end("ok");
      if (req.headers.host !== app.config.publicUrl.host) return json(res, 421, { error: "unknown host" });
      if (url.pathname === "/auth/login") return await login(req, res, app, client, false);
      if (url.pathname === "/api/auth/login") return await login(req, res, app, client, true);
      if (url.pathname === "/files") return await download(req, res, url, app);
      if (url.pathname === "/mcp") {
        if (!(await app.auth.verifyHeader(req.headers.authorization))) {
          note = req.headers.authorization ? "invalid token" : "no token";
          return json(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
        }
        tool = await mcp(req, res, buildServer);
        return;
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        note = (await api(req, res, url, app, router, client)).note;
        return;
      }
      if (!serveWeb(req, res, url.pathname)) json(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof TooLarge) {
        if (!res.headersSent) json(res, 413, { error: "request too large" });
        return;
      }
      if (error instanceof HttpError) {
        if (!res.headersSent) json(res, error.status, { error: error.message }, error.headers);
        return;
      }
      // The details stay in the server's log.
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: "internal error" });
    }
  });
}
