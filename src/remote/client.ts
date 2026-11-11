/**
 * How a local installation talks to a remote HEIG-Kit server (docs/server.md): HEIG_REMOTE_URL in .env, and the tokens
 * obtained with `npm run remote -- login`, kept in .cache/remote-token.json. Used by the CLI, the local MCP server
 * (remote knowledge base, calendar, cards, corrections) and the library sync.
 *
 * The login is the standard OAuth 2.1 one for an application on a computer (RFC 8252): the browser opens the server's
 * login page, the person logs in with their account there, and the code comes back to a port of this computer. The
 * password never goes through this program. The access token is short-lived and renewed with the refresh token.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CACHE_DIR } from "../paths.js";

export const REMOTE_TOKEN_FILE = `${CACHE_DIR}/remote-token.json`;

export class RemoteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The server's address from .env, or undefined when this installation works on its own. */
export function remoteUrl(env: NodeJS.ProcessEnv = process.env): URL | undefined {
  const value = env.HEIG_REMOTE_URL?.trim();
  if (!value) return undefined;
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

/** The server's address without a trailing slash, so that paths never get a double slash. */
const base = (url: URL) => url.href.replace(/\/+$/, "");

export interface SavedToken {
  url: string;
  token: string;
  expiresAt: string;
  /** What renews the access token: the OAuth client registered for this computer and its refresh token. */
  clientId?: string;
  refreshToken?: string;
}

export async function readRemoteToken(): Promise<SavedToken | undefined> {
  try {
    return JSON.parse(await readFile(REMOTE_TOKEN_FILE, "utf-8")) as SavedToken;
  } catch {
    return undefined;
  }
}

/** Readable by the current user only: the tokens open the whole account. */
async function save(saved: SavedToken): Promise<SavedToken> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(REMOTE_TOKEN_FILE, JSON.stringify(saved), { mode: 0o600 });
  return saved;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function tokenRequest(url: URL, body: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(`${base(url)}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  } catch (error) {
    throw new RemoteError(0, `Cannot reach ${url.origin}: ${error instanceof Error ? error.message : error}`);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error_description?: string; error?: string };
    throw new RemoteError(res.status, data.error_description ?? data.error ?? `token request failed (${res.status})`);
  }
  return (await res.json()) as TokenResponse;
}

const saved = (url: URL, clientId: string, tokens: TokenResponse): SavedToken => ({
  url: url.href,
  token: tokens.access_token,
  expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  clientId,
  refreshToken: tokens.refresh_token,
});

const DONE_PAGE = (text: string) => `<!doctype html><meta charset="utf-8"><title>HEIG-Kit</title><body style="font:16px system-ui;margin:15vh auto;max-width:28rem;text-align:center"><p>${text}</p></body>`;

/**
 * Logs in to the server: authorization code with PKCE, the code received on a loopback port. `open` shows the login
 * page to the person (their browser); the returned tokens are saved.
 */
export async function remoteLogin(url: URL, open: (loginUrl: string) => void | Promise<void>, timeoutMs = 10 * 60_000): Promise<SavedToken> {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  let finish: (result: { code: string } | { error: string }) => void = () => undefined;
  const result = new Promise<{ code: string } | { error: string }>((resolve) => (finish = resolve));
  const listener = createServer((req, res) => {
    const got = new URL(req.url ?? "/", "http://127.0.0.1");
    if (got.pathname !== "/callback") return void res.writeHead(404).end();
    const code = got.searchParams.get("code");
    const ok = code !== null && got.searchParams.get("state") === state;
    res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" }).end(DONE_PAGE(ok ? "Connexion réussie : vous pouvez fermer cet onglet." : "Connexion refusée : relancez la commande."));
    finish(ok ? { code } : { error: got.searchParams.get("error_description") ?? got.searchParams.get("error") ?? "the answer of the server does not match this login" });
  });
  await new Promise<void>((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/callback`;
  const timer = setTimeout(() => finish({ error: "nobody logged in within ten minutes" }), timeoutMs);
  try {
    const registration = await fetch(`${base(url)}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "HEIG-Kit CLI", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }),
    }).catch((error: unknown) => {
      throw new RemoteError(0, `Cannot reach ${url.origin}: ${error instanceof Error ? error.message : error}`);
    });
    if (!registration.ok) throw new RemoteError(registration.status, `the server refused this client (${registration.status})`);
    const { client_id: clientId } = (await registration.json()) as { client_id: string };
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state,
    });
    await open(`${base(url)}/oauth/authorize?${query}`);
    const answer = await result;
    if ("error" in answer) throw new RemoteError(400, `login failed: ${answer.error}`);
    return await save(saved(url, clientId, await tokenRequest(url, { grant_type: "authorization_code", code: answer.code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier })));
  } finally {
    clearTimeout(timer);
    listener.close();
  }
}

/** A valid access token: the saved one, renewed with the refresh token when it has (almost) expired. */
async function freshToken(url: URL): Promise<SavedToken> {
  const again = `run \`npm run remote -- login\``;
  const current = await readRemoteToken();
  if (!current || current.url !== url.href) throw new Error(`Not logged in to ${url.origin}: ${again}`);
  if (Date.parse(current.expiresAt) - Date.now() > 5 * 60_000) return current;
  if (!current.refreshToken || !current.clientId) throw new Error(`The token for ${url.origin} expired: ${again} again`);
  try {
    return await save(saved(url, current.clientId, await tokenRequest(url, { grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: current.clientId })));
  } catch (error) {
    // Another program of this installation may have renewed it in the meantime: its token is the good one.
    const other = await readRemoteToken();
    if (other && other.token !== current.token && Date.parse(other.expiresAt) > Date.now()) return other;
    if (error instanceof RemoteError && error.status === 0) throw error;
    throw new Error(`The session on ${url.origin} has ended (${error instanceof Error ? error.message : error}): ${again} again`);
  }
}

export class RemoteClient {
  constructor(
    readonly url: URL,
    private readonly token: string,
  ) {}

  /** The client of .env and the saved token, or undefined without HEIG_REMOTE_URL. Throws when the token is missing. */
  static async fromEnv(): Promise<RemoteClient | undefined> {
    const url = remoteUrl();
    if (!url) return undefined;
    return new RemoteClient(url, (await freshToken(url)).token);
  }

  /** Absolute URL of an API path such as `/api/calendar`. */
  href(path: string): string {
    return `${base(this.url)}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  async request(method: string, path: string, options: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, ...options.headers };
    let body = options.body;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }
    let res: Response;
    try {
      res = await fetch(this.href(path), { method, headers, body });
    } catch (error) {
      throw new RemoteError(0, `Cannot reach ${this.url.origin}: ${error instanceof Error ? error.message : error}`);
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // Not JSON.
      }
      if (res.status === 401) message = `The server refused the token (${message}): run \`npm run remote -- login\``;
      throw new RemoteError(res.status, message);
    }
    return res;
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.request(method, path, { json: body });
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  get<T>(path: string): Promise<T> {
    return this.json<T>("GET", path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.json<T>("POST", path, body);
  }
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.json<T>("PUT", path, body);
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.json<T>("PATCH", path, body);
  }
  delete<T = void>(path: string): Promise<T> {
    return this.json<T>("DELETE", path);
  }
}
