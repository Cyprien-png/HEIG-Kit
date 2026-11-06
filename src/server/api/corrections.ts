import { type CorrectionState, addPhoto, captureUrl, createCorrection, deleteCorrection, deletePhoto, getCorrection, listCorrections, markSent, photoFile, reorderPhotos, replacePhoto, submitResult, updateCorrection } from "../../app/corrections.js";
import type { App } from "../app.js";
import type { Principal, Router } from "./router.js";
import { HttpError, intParam, readBody, readJson, sendFile, stringField } from "./util.js";

const MAX_PHOTO_BYTES = 20 * 1024 ** 2;
const STATES = new Set<CorrectionState>(["capture", "received", "corrected"]);

/** The phone may only touch the correction its token names; the user and the agent may touch any. */
function allowed(principal: Principal, id: string): void {
  if (principal.kind === "capture" && principal.correctionId !== id) throw new HttpError(403, "this link is for another correction");
}

const ANY = { allow: ["cookie", "bearer", "capture"] as Principal["kind"][] };

export function registerCorrectionRoutes(router: Router, app: App): void {
  router.get("/api/corrections", async ({ url }) => {
    const state = url.searchParams.get("state");
    if (state && !STATES.has(state as CorrectionState)) throw new HttpError(400, "invalid state");
    return { corrections: await listCorrections(app.db, { course: url.searchParams.get("course") ?? undefined, state: (state as CorrectionState) ?? undefined, exam: url.searchParams.get("exam") ?? undefined }) };
  });

  /** Creates a correction and gives the capture link for the phone (valid a few hours). */
  router.post("/api/corrections", async ({ req }) => {
    const body = await readJson(req);
    let correction;
    try {
      correction = await createCorrection(app.db, {
      title: stringField(body, "title", { optional: true, max: 200 }),
      course: stringField(body, "course", { optional: true, max: 40 }),
      topic: stringField(body, "topic", { optional: true, max: 200 }),
      notes: stringField(body, "notes", { optional: true, max: 4000 }),
      exam: stringField(body, "exam", { optional: true, max: 220 }),
    });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    const token = await app.auth.issueCaptureToken(correction.id);
    return { ...correction, captureUrl: captureUrl(app.config.publicUrl, correction.id, token) };
  });

  router.get("/api/corrections/:id", async ({ params, principal }) => {
    allowed(principal, params.id);
    const correction = await getCorrection(app.db, params.id);
    if (!correction) throw new HttpError(404, "no such correction");
    // The phone only needs to know what to photograph, never the result.
    return principal.kind === "capture" ? { id: correction.id, title: correction.title, course: correction.course, topic: correction.topic, notes: correction.notes, state: correction.state, photos: correction.photos } : correction;
  }, ANY);

  /** A fresh capture link for an existing correction (the first one expired, or the agent lost it). */
  router.post("/api/corrections/:id/capture-link", async ({ params }) => {
    const correction = await getCorrection(app.db, params.id);
    if (!correction) throw new HttpError(404, "no such correction");
    if (correction.state === "corrected") throw new HttpError(409, "this correction is done");
    return { captureUrl: captureUrl(app.config.publicUrl, correction.id, await app.auth.issueCaptureToken(correction.id)) };
  });

  router.patch("/api/corrections/:id", async ({ req, params }) => {
    const body = await readJson(req);
    const nullable = (name: string, max: number) => (body[name] === null ? null : stringField(body, name, { optional: true, max }));
    let correction;
    try {
      correction = await updateCorrection(app.db, params.id, { title: stringField(body, "title", { optional: true, max: 200 }), course: nullable("course", 40), topic: nullable("topic", 200), notes: nullable("notes", 4000), exam: nullable("exam", 220) });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    if (!correction) throw new HttpError(404, "no such correction");
    return correction;
  });

  router.delete("/api/corrections/:id", async ({ params }) => {
    if (!(await deleteCorrection(app.db, params.id))) throw new HttpError(404, "no such correction");
    return undefined;
  });

  router.post("/api/corrections/:id/photos", async ({ req, params, principal }) => {
    allowed(principal, params.id);
    try {
      return await addPhoto(app.db, params.id, await readBody(req, MAX_PHOTO_BYTES));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }, ANY);

  router.get("/api/corrections/:id/photos/:photoId", async ({ req, res, params, principal }) => {
    allowed(principal, params.id);
    const photo = await photoFile(app.db, params.id, intParam(params.photoId, "photo id"));
    if (!photo) throw new HttpError(404, "no such photo");
    sendFile(req, res, photo.file, { contentType: photo.contentType, disposition: "inline", embeddable: true, cacheControl: "private, max-age=86400" });
  }, ANY);

  router.put("/api/corrections/:id/photos/:photoId", async ({ req, params, principal }) => {
    allowed(principal, params.id);
    try {
      const photo = await replacePhoto(app.db, params.id, intParam(params.photoId, "photo id"), await readBody(req, MAX_PHOTO_BYTES));
      if (!photo) throw new HttpError(404, "no such photo");
      return photo;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }, ANY);

  router.delete("/api/corrections/:id/photos/:photoId", async ({ params, principal }) => {
    allowed(principal, params.id);
    if (!(await deletePhoto(app.db, params.id, intParam(params.photoId, "photo id")))) throw new HttpError(404, "no such photo");
    return undefined;
  }, ANY);

  router.post("/api/corrections/:id/photos/order", async ({ req, params, principal }) => {
    allowed(principal, params.id);
    const body = await readJson(req);
    if (!Array.isArray(body.ids) || !body.ids.every((n) => Number.isInteger(n))) throw new HttpError(400, "ids must be integers");
    await reorderPhotos(app.db, params.id, body.ids as number[]);
    return undefined;
  }, ANY);

  /** The student is done photographing. */
  router.post("/api/corrections/:id/send", async ({ params, principal }) => {
    allowed(principal, params.id);
    try {
      const correction = await markSent(app.db, params.id);
      if (!correction) throw new HttpError(404, "no such correction");
      return { state: correction.state, sentAt: correction.sentAt };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }, ANY);

  /** The agent's correction. */
  router.put("/api/corrections/:id/result", async ({ req, params }) => {
    const body = await readJson(req);
    try {
      const correction = await submitResult(app.db, params.id, body.result ?? body);
      if (!correction) throw new HttpError(404, "no such correction");
      return correction;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  });
}
