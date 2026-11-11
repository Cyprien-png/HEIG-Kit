import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createApi } from "./api/index.js";
import { type Principal, type Router, runRoute } from "./api/router.js";
import { serveWeb } from "./api/static.js";
import { CONTENT_TYPES, HttpError, TooLarge, clientOf, json, readBody, readJson, sendFile } from "./api/util.js";
import { type User, authenticate, identityOf, setupStep } from "../accounts/users.js";
import { AccessDenied, type Identity, runAs } from "../identity.js";
import type { App } from "./app.js";
import { resolveGenerated } from "./files.js";
import { OAuth, challengeHeader } from "./oauth.js";
import { SESSION_COOKIE, accountOf, describeAccount, renewCampus, sessionCookie, sessionOf } from "./session.js";

const MAX_MCP_BYTES = 32 * 1024 ** 2;

/** What an account that has not finished its setup is told, whatever it asks. */
export const setupMessage = (publicUrl: URL, step: "password" | "campus") =>
  `This account is not ready: ${step === "password" ? "its first password must be replaced" : "it must connect its edu-ID account"}. ` +
  `Open ${publicUrl.origin} in a browser, log in and finish the setup; nothing else works until then.`;

/**
 * Login of the web application with the address and the password of an account: a session cookie, also for an account
 * that still has to finish its setup (the setup routes need it). Everything else (agents, the CLI) gets its tokens
 * through OAuth (src/server/oauth.ts) and never sees a password.
 */
async function login(req: IncomingMessage, res: ServerResponse, app: App, client: string): Promise<number | undefined> {
  if (req.method !== "POST") return void json(res, 405, { error: "method not allowed" }, { Allow: "POST" });
  if (req.headers["x-requested-with"] !== "heig-kit") return void json(res, 403, { error: "missing X-Requested-With header" });
  if (!app.limiter.allowed(client)) {
    console.error(`Login refused (too many failures) from ${client}`);
    return void json(res, 429, { error: "too many attempts, try again later" }, { "Retry-After": "900" });
  }
  const credentials = await readJson(req, 4 * 1024);
  const found = await authenticate(app.db, credentials.email, credentials.password);
  if (!found) {
    app.limiter.fail(client);
    console.error(`Login failed from ${client}`);
    return void json(res, 401, { error: "invalid credentials" });
  }
  app.limiter.succeed(client);
  const { user, vaultKey } = found;
  app.vault.unlock(user.id, vaultKey);
  renewCampus(app, user);
  const { token, expiresAt } = await app.auth.issueToken(user);
  json(res, 200, { ...describeAccount(app, user), expires_at: expiresAt.toISOString() }, { "Set-Cookie": sessionCookie(app, token, expiresAt) });
  return user.id;
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
async function principalOf(req: IncomingMessage, app: App): Promise<Principal | undefined> {
  const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
  if (bearer) {
    const user = await accountOf(app, await app.auth.verifyAccessToken(bearer));
    if (user) return { kind: "bearer", user, token: bearer };
    const capture = await app.auth.verifyCaptureToken(bearer);
    return capture ? { kind: "capture", ...capture } : undefined;
  }
  const session = await sessionOf(req, app);
  return session ? { kind: "cookie", ...session } : undefined;
}

/** The account a request works as: the one of its token. A capture link works as the owner of its correction, and nothing more. */
const identityFor = (principal: Principal): Identity => (principal.kind === "capture" ? { id: principal.userId, role: "student" } : identityOf(principal.user));

async function api(req: IncomingMessage, res: ServerResponse, url: URL, app: App, router: Router, client: string): Promise<{ note?: string; userId?: number }> {
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
  const principal = await principalOf(req, app);
  if (!principal) {
    json(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
    return { note: req.headers.authorization || req.headers.cookie?.includes(SESSION_COOKIE) ? "invalid token" : "no token" };
  }
  const userId = principal.kind === "capture" ? principal.userId : principal.user.id;
  const allow = route.options.allow ?? ["cookie", "bearer"];
  if (!allow.includes(principal.kind)) {
    json(res, 403, { error: "forbidden" });
    return { note: "forbidden", userId };
  }
  // A page of another site can make the browser send the cookie, but cannot add this header.
  if (principal.kind === "cookie" && method !== "GET" && method !== "HEAD" && req.headers["x-requested-with"] !== "heig-kit") {
    json(res, 403, { error: "missing X-Requested-With header" });
    return { note: "csrf", userId };
  }
  if (principal.kind !== "capture") {
    if (route.options.admin && principal.user.role !== "admin") {
      json(res, 403, { error: "Reserved to the administrators of this server." });
      return { note: "admin only", userId };
    }
    const step = setupStep(principal.user);
    if (step && !route.options.setup) {
      json(res, 403, { error: setupMessage(app.config.publicUrl, step), setup: step });
      return { note: `setup: ${step}`, userId };
    }
  }
  await runAs(identityFor(principal), () => runRoute(route, { req, res, url, params, principal, client }));
  return { userId };
}

/**
 * The public face of the remote server: /health, the OAuth endpoints, /mcp (access token), GET /files (signed link),
 * /api/* (cookie session or access token) and the web application for every other path. Every authenticated request
 * runs as the account its token names (`runAs`), which is what the database and the campus logins go by.
 * Requests for another host name are refused, which blocks DNS rebinding from a browser.
 */
export function createRemoteServer(app: App, buildServer: (user: User) => Promise<McpServer>): Server {
  const router = createApi(app);
  const oauth = new OAuth(app);
  return createServer(async (req, res) => {
    const started = performance.now();
    const client = clientOf(req, app.config.trustProxy);
    let tool: string | undefined;
    let note: string | undefined;
    let userId: number | undefined;
    res.on("finish", () => {
      const pathname = new URL(req.url ?? "/", app.config.publicUrl).pathname;
      // Static files of the web application would drown the log.
      if (pathname === "/health" || pathname.startsWith("/assets/") || /\.(svg|webmanifest|ico|png|woff2?)$/.test(pathname)) return;
      app.requests.record({ at: new Date(), client, method: req.method ?? "", path: pathname, status: res.statusCode, ms: performance.now() - started, tool, note, userId });
    });
    try {
      const url = new URL(req.url ?? "/", app.config.publicUrl);
      if (url.pathname === "/health") return void res.writeHead(200).end("ok");
      if (req.headers.host !== app.config.publicUrl.host) return json(res, 421, { error: "unknown host" });
      if (url.pathname === "/api/auth/login") return void (userId = await login(req, res, app, client));
      if (url.pathname === "/files") return await download(req, res, url, app);
      if (url.pathname.startsWith("/oauth/") || url.pathname.startsWith("/.well-known/oauth-")) {
        const result = await oauth.handle(req, res, url, client);
        if (result.handled) {
          note = result.note;
          userId = result.userId;
          return;
        }
      }
      if (url.pathname === "/mcp") {
        const user = await accountOf(app, await app.auth.verifyHeader(req.headers.authorization));
        if (!user) {
          note = req.headers.authorization ? "invalid token" : "no token";
          // Clients that speak OAuth find the authorization server from here (src/server/oauth.ts).
          return json(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": challengeHeader(app.config.publicUrl) });
        }
        userId = user.id;
        const step = setupStep(user);
        if (step) {
          note = `setup: ${step}`;
          return json(res, 403, { error: setupMessage(app.config.publicUrl, step), setup: step });
        }
        // The tools of this request are built for this account and run as it: no argument of a tool names an account.
        tool = await runAs(identityOf(user), () => mcp(req, res, () => buildServer(user)));
        return;
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        ({ note, userId } = await api(req, res, url, app, router, client));
        return;
      }
      if (!serveWeb(req, res, url.pathname)) json(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof TooLarge) {
        if (!res.headersSent) json(res, 413, { error: "request too large" });
        return;
      }
      if (error instanceof HttpError) {
        if (!res.headersSent) json(res, error.status, { error: error.message, ...error.details }, error.headers);
        return;
      }
      if (error instanceof AccessDenied) {
        if (!res.headersSent) json(res, 403, { error: error.message });
        return;
      }
      // The details stay in the server's log.
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: "internal error" });
    }
  });
}
