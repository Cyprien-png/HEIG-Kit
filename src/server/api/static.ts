import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { ROOT, folderFromEnv } from "../../paths.js";
import { CONTENT_TYPES, sendFile } from "./util.js";

/** The built web application (web/dist, or HEIG_WEB_DIR). */
export function webDir(): string | undefined {
  const dir = folderFromEnv(process.env.HEIG_WEB_DIR, path.join(ROOT, "web", "dist"));
  return existsSync(path.join(dir, "index.html")) ? dir : undefined;
}

const PAGE_HEADERS = {
  // The app only talks to its own origin; inline styles come from the UI libraries.
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
    "font-src 'self' data:; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

const pages = new Map<string, { mtime: number; html: string }>();

function indexHtml(file: string): string {
  const mtime = statSync(file).mtimeMs;
  const cached = pages.get(file);
  if (cached && cached.mtime === mtime) return cached.html;
  const html = readFileSync(file, "utf-8");
  pages.set(file, { mtime, html });
  return html;
}

/**
 * Serves the web application: hashed assets for a long time, everything else as the page (client-side routing).
 * Returns false when there is no web application, so the caller answers 404.
 */
export function serveWeb(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  const dir = webDir();
  if (!dir) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return true;
  }
  const root = realpathSync(dir);
  const file = path.join(root, path.normalize(decodeURIComponent(pathname)));
  let isFile = false;
  try {
    isFile = file.startsWith(root + path.sep) && statSync(file).isFile() && realpathSync(file).startsWith(root + path.sep);
  } catch {
    isFile = false;
  }
  if (isFile) {
    sendFile(req, res, file, {
      contentType: CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      disposition: "inline",
      embeddable: true,
      cacheControl: pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    return true;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", ...PAGE_HEADERS });
  res.end(req.method === "HEAD" ? undefined : indexHtml(path.join(root, "index.html")));
  return true;
}
