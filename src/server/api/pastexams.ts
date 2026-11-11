import path from "node:path";
import { deletePastExamFile, listPastExamFiles, listPastExams, pastExamFile, savePastExamFile } from "../../app/pastexams.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { CONTENT_TYPES, HttpError, readBody, rethrowRefusal, sendFile } from "./util.js";

const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
const TYPES: Record<string, string> = { ...CONTENT_TYPES, ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
/** Served with the sandboxing CSP (an SVG or a Markdown file could carry scripts); an <img> still shows them. */
const NOT_EMBEDDABLE = new Set([".md", ".svg", ".json", ".html"]);

export function registerPastExamRoutes(router: Router, app: App): void {
  /** The past exams (« anciens TE ») by branch and year, with the student's attempts. */
  router.get("/api/past-exams", async ({ url }) => ({ exams: await listPastExams(app.db, { branch: url.searchParams.get("branch") ?? undefined, course: url.searchParams.get("course") ?? undefined }) }));

  /** Flat list with sizes and times, for syncs. */
  router.get("/api/past-exams/files", async () => ({ files: listPastExamFiles() }));

  router.get("/api/past-exams/files/*", async ({ req, res, params, url }) => {
    const file = pastExamFile(params.rest);
    if (!file) throw new HttpError(404, "no such file");
    const ext = path.extname(file).toLowerCase();
    const inline = url.searchParams.get("download") !== "1";
    sendFile(req, res, file, { contentType: TYPES[ext] ?? "application/octet-stream", disposition: inline ? "inline" : "attachment", fileName: path.basename(file), embeddable: inline && !NOT_EMBEDDABLE.has(ext), cacheControl: "private, no-cache" });
  });

  router.put("/api/past-exams/files/*", async ({ req, params }) => {
    const content = await readBody(req, MAX_UPLOAD_BYTES);
    const mtime = req.headers["x-file-mtime"];
    try {
      return savePastExamFile(params.rest, content, typeof mtime === "string" ? new Date(mtime) : undefined);
    } catch (error) {
      rethrowRefusal(error);
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  });

  router.delete("/api/past-exams/files/*", async ({ params }) => {
    if (!deletePastExamFile(params.rest)) throw new HttpError(404, "no such file");
    return undefined;
  });
}
