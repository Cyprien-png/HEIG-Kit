import { existsSync } from "node:fs";
import path from "node:path";
import { LocalKnowledge } from "../../app/knowledge.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { CONTENT_TYPES, HttpError, intParam, readJson, rethrowRefusal, sendFile, stringField } from "./util.js";

const DOC_TYPES = new Set(["lecture", "exercises", "solutions", "exam", "lab", "planning", "other"]);

/** The course knowledge base over HTTP: for the web app and for local installations (RemoteKnowledge). */
export function registerKnowledgeRoutes(router: Router, app: App): void {
  const kb = new LocalKnowledge(app.db);
  const docType = (value: string | null) => {
    if (value && !DOC_TYPES.has(value)) throw new HttpError(400, "invalid document type");
    return value ?? undefined;
  };

  router.get("/api/kb/search", async ({ url }) => {
    const q = url.searchParams.get("q")?.trim();
    if (!q) throw new HttpError(400, "missing q");
    const limit = url.searchParams.get("limit");
    return { results: await kb.search(q, { course: url.searchParams.get("course") ?? undefined, docType: docType(url.searchParams.get("type")), limit: limit ? Math.min(intParam(limit, "limit"), 50) : undefined }) };
  });

  router.get("/api/kb/exercise", async ({ url }) => {
    const number = url.searchParams.get("number")?.trim();
    if (!number) throw new HttpError(400, "missing number");
    return { results: await kb.exercise(url.searchParams.get("course") ?? undefined, number) };
  });

  router.get("/api/kb/courses", async () => ({ courses: await kb.courses() }));

  router.get("/api/kb/courses/:course/documents", async ({ params, url }) => ({ documents: await kb.documents(params.course, docType(url.searchParams.get("type"))) }));

  router.get("/api/kb/documents/:id", async ({ params, url }) => {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const doc = await kb.document(intParam(params.id, "id"), from ? intParam(from, "from") : undefined, to ? intParam(to, "to") : undefined);
    if (!doc) throw new HttpError(404, "no such document");
    return doc;
  });

  router.get("/api/kb/documents/:id/figures/:n", async ({ req, res, params }) => {
    const image = await kb.figure(intParam(params.id, "id"), intParam(params.n, "n"));
    if (!image) throw new HttpError(404, "no such figure");
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": image.length, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : image);
  });

  /** The GitHub repositories the server indexes (RemoteRepos, the MCP tools of the server). */
  router.get("/api/kb/repos", async () => ({ repos: await app.repos.list() }));

  router.post("/api/kb/repos", async ({ req }) => {
    const body = await readJson(req);
    const exclude = body.exclude === undefined ? [] : body.exclude;
    if (!Array.isArray(exclude) || exclude.some((f) => typeof f !== "string")) throw new HttpError(400, "exclude must be a list of folders");
    try {
      return { message: await app.repos.add(stringField(body, "url", { max: 500 })!, stringField(body, "course", { max: 40 })!, stringField(body, "branch", { optional: true, max: 200 }), exclude as string[]) };
    } catch (error) {
      rethrowRefusal(error);
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  });

  router.delete("/api/kb/repos", async ({ url }) => {
    const address = url.searchParams.get("url")?.trim();
    if (!address) throw new HttpError(400, "missing url");
    try {
      return { message: await app.repos.remove(address) };
    } catch (error) {
      rethrowRefusal(error);
      throw new HttpError(/not an indexed/.test(String(error)) ? 404 : 400, error instanceof Error ? error.message : String(error));
    }
  });

  /** Fetches and indexes the repositories now; answers when done (minutes when much changed). */
  router.post("/api/kb/repos/update", async () => {
    try {
      return { message: await app.repos.update() };
    } catch (error) {
      rethrowRefusal(error);
      throw new HttpError(502, error instanceof Error ? error.message : String(error));
    }
  });

  /** The original document, shown in the browser (PDF) or downloaded (other types). */
  router.get("/api/kb/documents/:id/file", async ({ req, res, params }) => {
    const found = await kb.file(intParam(params.id, "id"));
    if (!found || !existsSync(found.file)) throw new HttpError(404, "the original file is not on the server");
    const ext = path.extname(found.name).toLowerCase();
    const inline = ext === ".pdf" || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".webm"].includes(ext);
    sendFile(req, res, found.file, { contentType: CONTENT_TYPES[ext] ?? "application/octet-stream", disposition: inline ? "inline" : "attachment", fileName: found.name, embeddable: inline, cacheControl: "private, max-age=3600" });
  });
}
