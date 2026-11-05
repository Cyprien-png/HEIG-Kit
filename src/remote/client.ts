/**
 * How a local installation talks to a remote HEIG-Kit server (docs/server.md): HEIG_REMOTE_URL in .env, and the access
 * token obtained with `npm run remote -- login`, kept in .cache/remote-token.json. Used by the CLI, the local MCP server
 * (remote knowledge base, calendar, cards, corrections) and the library sync.
 */
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

interface SavedToken {
  url: string;
  token: string;
  expiresAt: string;
}

export async function readRemoteToken(): Promise<SavedToken | undefined> {
  try {
    return JSON.parse(await readFile(REMOTE_TOKEN_FILE, "utf-8")) as SavedToken;
  } catch {
    return undefined;
  }
}

/** Logs in to the server and keeps the token (readable by the current user only: it opens the whole account). */
export async function remoteLogin(url: URL, username: string, password: string): Promise<SavedToken> {
  const res = await fetch(`${base(url)}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!res.ok) throw new RemoteError(res.status, res.status === 401 ? "invalid username or password" : `login failed (${res.status})`);
  const { access_token, expires_at } = (await res.json()) as { access_token: string; expires_at: string };
  const saved = { url: url.href, token: access_token, expiresAt: expires_at };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(REMOTE_TOKEN_FILE, JSON.stringify(saved), { mode: 0o600 });
  return saved;
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
    const saved = await readRemoteToken();
    if (!saved || saved.url !== url.href) throw new Error(`Not logged in to ${url.origin}: run \`npm run remote -- login\``);
    if (Date.parse(saved.expiresAt) < Date.now()) throw new Error(`The token for ${url.origin} expired: run \`npm run remote -- login\` again`);
    return new RemoteClient(url, saved.token);
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
