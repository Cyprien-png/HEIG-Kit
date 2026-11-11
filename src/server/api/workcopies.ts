import { RevisionConflict, MAX_SOURCE_BYTES, checkAnnotations, createWorkcopy, deleteWorkcopy, getWorkcopy, listWorkcopies, saveSource, sourceFile, updateWorkcopy } from "../../app/workcopies.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { HttpError, intParam, json, readBody, readJson, rethrowRefusal, sendFile, stringField } from "./util.js";

const MAX_ANNOTATIONS_BYTES = 16 * 1024 ** 2;

/** Work copies of PDFs filled in on the web app (src/app/workcopies.ts). */
export function registerWorkcopyRoutes(router: Router, app: App): void {
  router.get("/api/workcopies", async () => ({ workcopies: await listWorkcopies(app.db) }));

  router.post("/api/workcopies", async ({ req }) => {
    const body = await readJson(req);
    try {
      return await createWorkcopy(app.db, {
        title: stringField(body, "title", { max: 200 }) as string,
        course: stringField(body, "course", { optional: true, max: 40 }),
        exam: stringField(body, "exam", { optional: true, max: 320 }),
        sourceLabel: stringField(body, "sourceLabel", { optional: true, max: 300 }),
        pageCount: typeof body.pageCount === "number" ? body.pageCount : undefined,
      });
    } catch (error) {
      rethrowRefusal(error);
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  });

  router.get("/api/workcopies/:id", async ({ params }) => {
    const copy = await getWorkcopy(app.db, params.id);
    if (!copy) throw new HttpError(404, "no such copy");
    return copy;
  });

  router.put("/api/workcopies/:id/source", async ({ req, params }) => {
    try {
      const copy = await saveSource(app.db, params.id, await readBody(req, MAX_SOURCE_BYTES));
      if (!copy) throw new HttpError(404, "no such copy");
      return copy;
    } catch (error) {
      rethrowRefusal(error);
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  });

  router.get("/api/workcopies/:id/source", async ({ req, res, params }) => {
    const file = sourceFile(params.id);
    if (!file) throw new HttpError(404, "no PDF for this copy");
    sendFile(req, res, file, { contentType: "application/pdf", disposition: "inline", fileName: "copie.pdf", cacheControl: "private, no-cache" });
  });

  /** Title, course, exam, annotations (with `rev`, the revision the editor started from), link to the correction. */
  router.patch("/api/workcopies/:id", async ({ req, res, params }) => {
    const body = await readJson(req, MAX_ANNOTATIONS_BYTES);
    const nullable = (name: string, max: number) => (body[name] === null ? null : stringField(body, name, { optional: true, max }));
    try {
      const copy = await updateWorkcopy(
        app.db,
        params.id,
        {
          title: stringField(body, "title", { optional: true, max: 200 }),
          course: nullable("course", 40),
          exam: nullable("exam", 320),
          annotations: body.annotations !== undefined ? checkAnnotations(body.annotations) : undefined,
          pageCount: typeof body.pageCount === "number" ? body.pageCount : undefined,
          correctionId: nullable("correctionId", 40),
          submitted: body.submitted === true,
        },
        body.rev === undefined ? undefined : intParam(String(body.rev), "rev"),
      );
      if (!copy) throw new HttpError(404, "no such copy");
      return copy;
    } catch (error) {
      rethrowRefusal(error);
      if (error instanceof RevisionConflict) {
        json(res, 409, { error: error.message, current: error.current });
        return undefined;
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  });

  router.delete("/api/workcopies/:id", async ({ params }) => {
    if (!(await deleteWorkcopy(app.db, params.id))) throw new HttpError(404, "no such copy");
    return undefined;
  });
}
