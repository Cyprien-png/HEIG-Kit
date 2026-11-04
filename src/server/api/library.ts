import path from "node:path";
import { type LibraryTagPatch, annotateLibrary, annotatedLibrary, deleteLibraryFile, knownCourses, libraryFile, libraryItemKey, listLibraryFiles, listLibraryTags, saveLibraryFile, setLibraryTags } from "../../app/library.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { CONTENT_TYPES, HttpError, readBody, readJson, sendFile } from "./util.js";

const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
/** Shown in the browser; everything else (HTML, DOCX) is downloaded, HTML never rendered on the server's address. */
const INLINE = new Set([".pdf", ".mp4", ".mov", ".gif", ".md", ".py"]);

function tagList(body: Record<string, unknown>, name: string): string[] | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50 || !value.every((t) => typeof t === "string" && t.length <= 100)) throw new HttpError(400, `${name} must be a list of short strings`);
  return value as string[];
}

export function registerLibraryRoutes(router: Router, app: App): void {
  router.get("/api/library", async ({ url }) => {
    const keywords = (url.searchParams.get("q") ?? "").split(/\s+/).filter(Boolean);
    return { items: await annotatedLibrary(app.db, keywords) };
  });

  /** Sets the course and tags of an item (`document` or `video`, base name without extension). */
  router.patch("/api/library/items/:kind/:name", async ({ req, params }) => {
    if (params.kind !== "document" && params.kind !== "video") throw new HttpError(404, "no such item");
    const items = await annotatedLibrary(app.db);
    const item = items.find((i) => i.kind === params.kind && i.name === params.name);
    if (!item) throw new HttpError(404, "no such item");
    const body = await readJson(req);
    if (body.course !== undefined && body.course !== null && typeof body.course !== "string") throw new HttpError(400, "course must be a string or null");
    const patch: LibraryTagPatch = { course: body.course as string | null | undefined, tags: tagList(body, "tags"), add: tagList(body, "add"), remove: tagList(body, "remove") };
    try {
      await setLibraryTags(app.db, libraryItemKey(item), patch);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return annotateLibrary([item], await listLibraryTags(app.db), await knownCourses(app.db))[0];
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
