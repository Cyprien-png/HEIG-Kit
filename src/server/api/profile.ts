import { NOTE_KINDS, type NoteInput, type NoteKind, addNotes, deleteNote, listNotes, profileSummary, resolveNote, searchNotes } from "../../app/profile.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { HttpError, intParam, readJson, stringField } from "./util.js";

export function noteFrom(value: unknown, index: number): NoteInput {
  if (!value || typeof value !== "object") throw new HttpError(400, `note ${index + 1} must be an object`);
  const body = value as Record<string, unknown>;
  const kind = stringField(body, "kind")!;
  if (!NOTE_KINDS.includes(kind as NoteKind)) throw new HttpError(400, `note ${index + 1}: kind must be one of ${NOTE_KINDS.join(", ")}`);
  const severity = body.severity ?? 2;
  if (severity !== 1 && severity !== 2 && severity !== 3) throw new HttpError(400, `note ${index + 1}: severity must be 1, 2 or 3`);
  return {
    course: stringField(body, "course", { optional: true, max: 40 }),
    topic: stringField(body, "topic", { max: 200 })!,
    kind: kind as NoteKind,
    text: stringField(body, "text", { max: 2000 })!,
    severity: severity as 1 | 2 | 3,
    correctionId: stringField(body, "correctionId", { optional: true, max: 36 }),
    exercise: stringField(body, "exercise", { optional: true, max: 40 }),
  };
}

export function registerProfileRoutes(router: Router, app: App): void {
  router.get("/api/profile", async ({ url }) => profileSummary(app.db, url.searchParams.get("course") ?? undefined));

  router.get("/api/profile/notes", async ({ url }) => {
    const kind = url.searchParams.get("kind");
    if (kind && !NOTE_KINDS.includes(kind as NoteKind)) throw new HttpError(400, "invalid kind");
    const q = url.searchParams.get("q");
    const course = url.searchParams.get("course") ?? undefined;
    if (q) return { notes: await searchNotes(app.db, q, course) };
    return { notes: await listNotes(app.db, { course, kind: (kind as NoteKind) ?? undefined, topic: url.searchParams.get("topic") ?? undefined, resolved: url.searchParams.get("resolved") === "1" }) };
  });

  router.post("/api/profile/notes", async ({ req }) => {
    const body = await readJson(req);
    const notes = Array.isArray(body.notes) ? body.notes : [body];
    if (notes.length === 0 || notes.length > 100) throw new HttpError(400, "between 1 and 100 notes per call");
    return { notes: await addNotes(app.db, notes.map(noteFrom)) };
  });

  router.post("/api/profile/notes/:id/resolve", async ({ req, params }) => {
    const body = await readJson(req);
    const note = await resolveNote(app.db, intParam(params.id, "id"), body.resolved !== false);
    if (!note) throw new HttpError(404, "no such note");
    return note;
  });

  router.delete("/api/profile/notes/:id", async ({ params }) => {
    if (!(await deleteNote(app.db, intParam(params.id, "id")))) throw new HttpError(404, "no such note");
    return undefined;
  });
}
