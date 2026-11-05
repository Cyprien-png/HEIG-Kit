import { NOTE_KINDS, type NoteInput, type NoteKind, addNotes, deleteNote, listChapters, listNotes, profileSummary, resolveNote, searchNotes, setChapters } from "../../app/profile.js";
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
    chapter: stringField(body, "chapter", { optional: true, max: 200 }),
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

  router.get("/api/profile/chapters", async ({ url }) => ({ chapters: await listChapters(app.db, url.searchParams.get("course") ?? undefined) }));

  /** Replaces the chapters of a course: `{"chapters": [{"title", "keywords"?}]}` in order. */
  router.put("/api/profile/chapters/:course", async ({ req, params }) => {
    const body = await readJson(req);
    if (!Array.isArray(body.chapters) || body.chapters.length > 60) throw new HttpError(400, "chapters must be a list of at most 60 chapters");
    const chapters = body.chapters.map((c, i) => {
      if (!c || typeof c !== "object") throw new HttpError(400, `chapter ${i + 1} must be an object`);
      const item = c as Record<string, unknown>;
      const keywords = item.keywords ?? [];
      if (!Array.isArray(keywords) || keywords.some((k) => typeof k !== "string")) throw new HttpError(400, `chapter ${i + 1}: keywords must be a list of strings`);
      return { title: stringField(item, "title", { max: 200 })!, keywords: keywords as string[] };
    });
    return { chapters: await setChapters(app.db, params.course, chapters) };
  });

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
