import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

/** An error whose status and message are meant for the client. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export class TooLarge extends HttpError {
  constructor() {
    super(413, "request too large");
  }
}

export const MAX_JSON_BYTES = 4 * 1024 ** 2;

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new TooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** The JSON body as an object; a missing body is `{}`. */
export async function readJson(req: IncomingMessage, limit = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const raw = await readBody(req, limit);
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString("utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, "expected a JSON object");
  }
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }).end(JSON.stringify(body));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

/** Behind a reverse proxy, the last X-Forwarded-For entry is the one the proxy itself added. */
export function clientOf(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  return (trustProxy && value?.split(",").pop()?.trim()) || req.socket.remoteAddress || "unknown";
}

export const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".gif": "image/gif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

export interface SendFileOptions {
  contentType: string;
  /** `attachment` forces a download; `inline` lets the browser show it (only for types that cannot run scripts). */
  disposition?: "inline" | "attachment";
  fileName?: string;
  cacheControl?: string;
  /** Lets a browser page embed it in <video>, <img> or <iframe>: no CSP sandbox. */
  embeddable?: boolean;
}

/**
 * Streams a file, honouring a single `Range` (videos seek in the browser). Non-embeddable files are served with a
 * sandboxing CSP so that a generated HTML page can never run scripts on the server's address.
 */
export function sendFile(req: IncomingMessage, res: ServerResponse, file: string, options: SendFileOptions): void {
  const size = statSync(file).size;
  const headers: Record<string, string | number> = {
    "Content-Type": options.contentType,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": options.cacheControl ?? "private, no-cache",
  };
  if (!options.embeddable) headers["Content-Security-Policy"] = "sandbox; default-src 'none'";
  const disposition = options.disposition ?? "attachment";
  headers["Content-Disposition"] = options.fileName ? `${disposition}; filename*=UTF-8''${encodeURIComponent(options.fileName)}` : disposition;

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && size > 0) {
    if (range[1]) start = Number(range[1]);
    if (range[2]) end = range[1] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!range[1] && range[2]) start = Math.max(size - Number(range[2]), 0);
    if (start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === "HEAD") return void res.end();
  createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
}

/** A positive integer path or query parameter. */
export function intParam(value: string | undefined | null, name: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value ?? "") || !Number.isSafeInteger(number)) throw new HttpError(400, `invalid ${name}`);
  return number;
}

export function stringField(body: Record<string, unknown>, name: string, options: { optional?: boolean; max?: number } = {}): string | undefined {
  const value = body[name];
  if (value === undefined || value === null || value === "") {
    if (options.optional) return undefined;
    throw new HttpError(400, `missing ${name}`);
  }
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a string`);
  if (options.max && value.length > options.max) throw new HttpError(400, `${name} is too long`);
  return value;
}

export function dateField(body: Record<string, unknown>, name: string, optional = false): Date | undefined {
  const value = stringField(body, name, { optional });
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${name} must be an ISO date`);
  return date;
}
