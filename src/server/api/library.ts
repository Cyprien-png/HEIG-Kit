import path from "node:path";
import { deleteLibraryFile, libraryFile, listLibrary, listLibraryFiles, saveLibraryFile } from "../../app/library.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { CONTENT_TYPES, HttpError, readBody, sendFile } from "./util.js";

const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
/** Shown in the browser; everything else (HTML, DOCX) is downloaded, HTML never rendered on the server's address. */
const INLINE = new Set([".pdf", ".mp4", ".mov", ".gif", ".md", ".py"]);

export function registerLibraryRoutes(router: Router, _app: App): void {
  router.get("/api/library", async ({ url }) => {
    const keywords = (url.searchParams.get("q") ?? "").split(/\s+/).filter(Boolean);
    return { items: listLibrary(keywords) };
  });

  /** Flat list with sizes and times, for syncs. */
  router.get("/api/library/files", async () => ({ files: listLibraryFiles() }));

  router.get("/api/library/files/:kind/:name", async ({ req, res, params, url }) => {
    const id = `${params.kind}/${params.name}`;
    const file = libraryFile(id);
    if (!file) throw new HttpError(404, "no such file");
    const ext = path.extname(file).toLowerCase();
    const inline = INLINE.has(ext) && url.searchParams.get("download") !== "1";
    sendFile(req, res, file, {
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
      disposition: inline ? "inline" : "attachment",
      fileName: path.basename(file),
      embeddable: inline && ext !== ".md" && ext !== ".py",
      cacheControl: "private, no-cache",
    });
  });

  router.put("/api/library/files/:kind/:name", async ({ req, params }) => {
    const id = `${params.kind}/${params.name}`;
    const content = await readBody(req, MAX_UPLOAD_BYTES);
    const mtime = req.headers["x-file-mtime"];
    try {
      return saveLibraryFile(id, content, typeof mtime === "string" ? new Date(mtime) : undefined);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  });

  router.delete("/api/library/files/:kind/:name", async ({ params }) => {
    if (!deleteLibraryFile(`${params.kind}/${params.name}`)) throw new HttpError(404, "no such file");
    return undefined;
  });
}
