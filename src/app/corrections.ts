/**
 * Corrections of the student's handwritten work: a correction is created by the agent, photographed from a phone
 * (capture link), then transcribed and corrected by the agent into a structured result shown on the web (docs/app.md).
 */
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../paths.js";
import type { Db } from "../rag/db.js";

export type CorrectionState = "capture" | "received" | "corrected";
export type Verdict = "correct" | "partial" | "wrong" | "missing";

export interface CorrectedExercise {
  /** As numbered on the sheet, e.g. "2" or "3b". */
  number: string;
  title?: string;
  /** The statement, when the agent knows it (from the course material). */
  statement?: string;
  /** The student's answer, transcribed as written (Markdown, LaTeX). */
  answer: string;
  verdict: Verdict;
  points?: { obtained: number; total: number };
  /** What is wrong and how it should have been done; the full correction. */
  feedback: string;
  /** The correct solution, step by step. */
  solution?: string;
  /** Probable cause of the mistake, e.g. "confusion entre ⊆ et ∈". */
  cause?: string;
  topics: string[];
  /** Photos (1-based, as numbered on the page) where the student wrote this exercise; all of them when absent. */
  pages?: number[];
  /** The zones of the photos holding the exercise, as fractions (0 to 1) of the photo: x, y = top left corner, w, h = size. */
  regions?: { page: number; x: number; y: number; w: number; h: number }[];
}

export interface CorrectionResult {
  summary: string;
  exercises: CorrectedExercise[];
  /** Topics to revise, in order of priority. */
  toRevise?: string[];
}

export interface Correction {
  id: string;
  title: string;
  course?: string;
  topic?: string;
  state: CorrectionState;
  notes?: string;
  /** The exam this work answers: a mock exam's statement (`document:<name>`, src/app/exams.ts) or a past exam (`exam:<id>`, src/app/pastexams.ts). */
  exam?: string;
  /** Whether it counts in the profile (course grade, weaknesses, chapters); true unless the student leaves it out. */
  affectsProfile: boolean;
  result?: CorrectionResult;
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date;
  correctedAt?: Date;
  photos: PhotoMeta[];
}

export interface PhotoMeta {
  id: number;
  position: number;
  contentType: string;
  bytes: number;
  createdAt: Date;
}

const VERDICTS = new Set<Verdict>(["correct", "partial", "wrong", "missing"]);
const MAX_PHOTO_BYTES = 20 * 1024 ** 2;
const MAX_PHOTOS = 40;
const TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

export const correctionsDir = (id: string) => path.join(DATA_DIR, "corrections", id);

/** The image type from the first bytes: phones and browsers send JPEG, PNG or WebP. */
export function sniffImage(bytes: Buffer): string | undefined {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return undefined;
}

function row(r: Record<string, unknown>, photos: PhotoMeta[] = []): Correction {
  return {
    id: r.id as string,
    title: r.title as string,
    course: (r.course as string | null) ?? undefined,
    topic: (r.topic as string | null) ?? undefined,
    state: r.state as CorrectionState,
    notes: (r.notes as string | null) ?? undefined,
    exam: (r.exam as string | null) ?? undefined,
    affectsProfile: r.affects_profile !== false,
    result: (r.result as CorrectionResult | null) ?? undefined,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    sentAt: (r.sent_at as Date | null) ?? undefined,
    correctedAt: (r.corrected_at as Date | null) ?? undefined,
    photos,
  };
}

async function photosOf(db: Db, id: string): Promise<PhotoMeta[]> {
  const { rows } = await db.query("SELECT id, position, content_type, bytes, created_at FROM correction_photos WHERE correction_id = $1 ORDER BY position, id", [id]);
  return rows.map((p) => ({ id: Number(p.id), position: p.position, contentType: p.content_type, bytes: p.bytes, createdAt: p.created_at }));
}

/** Title of a correction created before the agent has named it (it names it while the student photographs). */
export const PENDING_TITLE = "Correction en cours";

export interface CorrectionInput {
  title?: string;
  course?: string;
  topic?: string;
  notes?: string;
  /** The exam being corrected: `document:<name>` (mock exam) or `exam:<id>` (past exam). */
  exam?: string;
  /** Default true: set false for work that must not change the profile. */
  affectsProfile?: boolean;
}

export interface CorrectionPatch {
  title?: string;
  course?: string | null;
  topic?: string | null;
  notes?: string | null;
  exam?: string | null;
  affectsProfile?: boolean;
}

const EXAM_KEY = /^(document:[^/\\]{1,200}|exam:[^\\]{1,300})$/;

/** Checks an exam reference (`document:<name>` for a mock exam, `exam:<id>` for a past exam); throws a readable message otherwise. */
export function checkExam(exam: string | null | undefined): string | null | undefined {
  if (exam === undefined || exam === null) return exam;
  const text = exam.trim();
  if (!EXAM_KEY.test(text)) throw new Error("exam must be the library item of a mock exam (document:<name>) or a past exam (exam:<id>)");
  return text;
}

export async function createCorrection(db: Db, input: CorrectionInput = {}): Promise<Correction> {
  const id = randomUUID();
  await db.query("INSERT INTO corrections (id, title, course, topic, notes, exam, affects_profile) VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, input.title?.trim() || PENDING_TITLE, input.course ?? null, input.topic ?? null, input.notes ?? null, checkExam(input.exam) ?? null, input.affectsProfile !== false]);
  return (await getCorrection(db, id))!;
}

export async function listCorrections(db: Db, options: { course?: string; state?: CorrectionState; exam?: string; limit?: number } = {}): Promise<Correction[]> {
  const { rows } = await db.query(
    `SELECT c.*, coalesce(json_agg(json_build_object('id', p.id, 'position', p.position, 'contentType', p.content_type, 'bytes', p.bytes, 'createdAt', p.created_at) ORDER BY p.position) FILTER (WHERE p.id IS NOT NULL), '[]') AS photos
     FROM corrections c LEFT JOIN correction_photos p ON p.correction_id = c.id
     WHERE ($1::text IS NULL OR lower(c.course) = lower($1)) AND ($2::text IS NULL OR c.state = $2) AND ($4::text IS NULL OR c.exam = $4)
     GROUP BY c.id ORDER BY c.updated_at DESC, c.created_at DESC LIMIT $3`,
    [options.course ?? null, options.state ?? null, options.limit ?? 100, options.exam ?? null],
  );
  return rows.map((r) => row(r, (r.photos as PhotoMeta[]).map((p) => ({ ...p, id: Number(p.id), createdAt: new Date(p.createdAt) }))));
}

export async function getCorrection(db: Db, id: string): Promise<Correction | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  const { rows } = await db.query("SELECT * FROM corrections WHERE id = $1", [id]);
  return rows[0] ? row(rows[0], await photosOf(db, id)) : undefined;
}

export async function updateCorrection(db: Db, id: string, patch: CorrectionPatch): Promise<Correction | undefined> {
  const exam = checkExam(patch.exam);
  await db.query(
    `UPDATE corrections SET title = coalesce($2, title),
       course = CASE WHEN $3::boolean THEN $4 ELSE course END,
       topic = CASE WHEN $5::boolean THEN $6 ELSE topic END,
       notes = CASE WHEN $7::boolean THEN $8 ELSE notes END,
       exam = CASE WHEN $9::boolean THEN $10 ELSE exam END,
       affects_profile = coalesce($11::boolean, affects_profile),
       updated_at = now() WHERE id = $1`,
    [id, patch.title ?? null, patch.course !== undefined, patch.course ?? null, patch.topic !== undefined, patch.topic ?? null, patch.notes !== undefined, patch.notes ?? null, exam !== undefined, exam ?? null, patch.affectsProfile ?? null],
  );
  return getCorrection(db, id);
}

export async function deleteCorrection(db: Db, id: string): Promise<boolean> {
  const deleted = (await db.query("DELETE FROM corrections WHERE id = $1", [id])).rowCount === 1;
  if (deleted) rmSync(correctionsDir(id), { recursive: true, force: true });
  return deleted;
}

/** Stores a photo (JPEG, PNG or WebP, checked from its bytes) at the end of the correction's pages. */
export async function addPhoto(db: Db, id: string, bytes: Buffer): Promise<PhotoMeta> {
  const correction = await getCorrection(db, id);
  if (!correction) throw new Error("No such correction");
  if (correction.state === "corrected") throw new Error("This correction is done: photos can no longer be added");
  if (correction.photos.length >= MAX_PHOTOS) throw new Error(`At most ${MAX_PHOTOS} photos per correction`);
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error("Photo too large (20 MB at most)");
  const type = sniffImage(bytes);
  if (!type) throw new Error("Not a JPEG, PNG or WebP image");
  const position = (correction.photos.at(-1)?.position ?? -1) + 1;
  const { rows } = await db.query("INSERT INTO correction_photos (correction_id, position, file, content_type, bytes) VALUES ($1, $2, '', $3, $4) RETURNING id, created_at", [id, position, type, bytes.length]);
  const photoId = Number(rows[0].id);
  const dir = correctionsDir(id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `${photoId}${TYPES[type]}`;
  const partial = path.join(dir, `.${name}.partial`);
  writeFileSync(partial, bytes, { mode: 0o600 });
  renameSync(partial, path.join(dir, name));
  await db.query("UPDATE correction_photos SET file = $2 WHERE id = $1", [photoId, name]);
  await db.query("UPDATE corrections SET updated_at = now() WHERE id = $1", [id]);
  return { id: photoId, position, contentType: type, bytes: bytes.length, createdAt: rows[0].created_at };
}

/** The file of a photo, if it belongs to the correction. */
export async function photoFile(db: Db, id: string, photoId: number): Promise<{ file: string; contentType: string } | undefined> {
  const { rows } = await db.query("SELECT file, content_type FROM correction_photos WHERE id = $1 AND correction_id = $2", [photoId, id]);
  if (!rows[0]?.file) return undefined;
  const file = path.join(correctionsDir(id), path.basename(rows[0].file));
  if (!existsSync(file) || !lstatSync(file).isFile()) return undefined;
  return { file, contentType: rows[0].content_type };
}

/** The photos with their bytes, for the agent. */
export async function photosWithData(db: Db, id: string): Promise<(PhotoMeta & { data: Buffer })[]> {
  const photos = await photosOf(db, id);
  const out: (PhotoMeta & { data: Buffer })[] = [];
  for (const photo of photos) {
    const found = await photoFile(db, id, photo.id);
    if (found) out.push({ ...photo, data: readFileSync(found.file) });
  }
  return out;
}

export async function deletePhoto(db: Db, id: string, photoId: number): Promise<boolean> {
  const found = await photoFile(db, id, photoId);
  const deleted = (await db.query("DELETE FROM correction_photos WHERE id = $1 AND correction_id = $2", [photoId, id])).rowCount === 1;
  if (found) rmSync(found.file, { force: true });
  return deleted;
}

/** Replaces a photo's bytes (after a rotation or a crop on the phone). */
export async function replacePhoto(db: Db, id: string, photoId: number, bytes: Buffer): Promise<PhotoMeta | undefined> {
  const found = await photoFile(db, id, photoId);
  if (!found) return undefined;
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error("Photo too large (20 MB at most)");
  const type = sniffImage(bytes);
  if (!type) throw new Error("Not a JPEG, PNG or WebP image");
  const name = `${photoId}${TYPES[type]}`;
  const partial = path.join(correctionsDir(id), `.${name}.partial`);
  writeFileSync(partial, bytes, { mode: 0o600 });
  renameSync(partial, path.join(correctionsDir(id), name));
  if (path.basename(found.file) !== name) rmSync(found.file, { force: true });
  const { rows } = await db.query("UPDATE correction_photos SET file = $3, content_type = $4, bytes = $5 WHERE id = $1 AND correction_id = $2 RETURNING position, created_at", [photoId, id, name, type, bytes.length]);
  return { id: photoId, position: rows[0].position, contentType: type, bytes: bytes.length, createdAt: rows[0].created_at };
}

export async function reorderPhotos(db: Db, id: string, photoIds: number[]): Promise<void> {
  for (const [position, photoId] of photoIds.entries()) {
    await db.query("UPDATE correction_photos SET position = $3 WHERE id = $1 AND correction_id = $2", [photoId, id, position]);
  }
}

/** The student sent their photos: the agent can now correct. */
export async function markSent(db: Db, id: string): Promise<Correction | undefined> {
  const correction = await getCorrection(db, id);
  if (!correction) return undefined;
  if (correction.photos.length === 0) throw new Error("Add at least one photo before sending");
  await db.query("UPDATE corrections SET state = 'received', sent_at = now(), updated_at = now() WHERE id = $1 AND state = 'capture'", [id]);
  return getCorrection(db, id);
}

/** Checks a result written by the agent; throws a readable message on anything missing. */
export function validateResult(value: unknown): CorrectionResult {
  if (!value || typeof value !== "object") throw new Error("result must be an object");
  const r = value as Record<string, unknown>;
  if (typeof r.summary !== "string" || !r.summary.trim()) throw new Error("result.summary is required");
  if (!Array.isArray(r.exercises) || r.exercises.length === 0) throw new Error("result.exercises must list at least one exercise");
  const exercises = r.exercises.map((e, i) => {
    if (!e || typeof e !== "object") throw new Error(`exercise ${i + 1} must be an object`);
    const x = e as Record<string, unknown>;
    const str = (name: string, required = false) => {
      const v = x[name];
      if (v === undefined || v === null) {
        if (required) throw new Error(`exercise ${i + 1}: ${name} is required`);
        return undefined;
      }
      if (typeof v !== "string") throw new Error(`exercise ${i + 1}: ${name} must be a string`);
      return v;
    };
    const verdict = str("verdict", true) as Verdict;
    if (!VERDICTS.has(verdict)) throw new Error(`exercise ${i + 1}: verdict must be correct, partial, wrong or missing`);
    const points = x.points as { obtained?: unknown; total?: unknown } | undefined;
    if (points && (typeof points.obtained !== "number" || typeof points.total !== "number")) throw new Error(`exercise ${i + 1}: points must have numeric obtained and total`);
    return {
      number: str("number", true)!,
      title: str("title"),
      statement: str("statement"),
      answer: str("answer", true)!,
      verdict,
      points: points ? { obtained: points.obtained as number, total: points.total as number } : undefined,
      feedback: str("feedback", true)!,
      solution: str("solution"),
      cause: str("cause"),
      topics: Array.isArray(x.topics) ? x.topics.filter((t): t is string => typeof t === "string") : [],
      regions: parseRegions(x.regions, i),
      pages: Array.isArray(x.pages) ? [...new Set(x.pages.filter((p): p is number => Number.isInteger(p) && p > 0))].sort((a, b) => a - b) : undefined,
    } satisfies CorrectedExercise;
  });
  const toRevise = Array.isArray(r.toRevise) ? r.toRevise.filter((t): t is string => typeof t === "string") : undefined;
  return { summary: r.summary, exercises, toRevise };
}

/** Zones of photos, clamped to the photo: anything else is refused. */
function parseRegions(value: unknown, i: number): CorrectedExercise["regions"] {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`exercise ${i + 1}: regions must be a list`);
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return value.map((r) => {
    const o = r as Record<string, unknown>;
    if (!r || typeof r !== "object" || !Number.isInteger(o.page) || (o.page as number) < 1 || ["x", "y", "w", "h"].some((k) => typeof o[k] !== "number" || !Number.isFinite(o[k] as number))) throw new Error(`exercise ${i + 1}: a region needs page (1 = first photo) and numeric x, y, w, h between 0 and 1`);
    const x = clamp(o.x as number);
    const y = clamp(o.y as number);
    return { page: o.page as number, x, y, w: Math.max(0.05, Math.min(1 - x, clamp(o.w as number))), h: Math.max(0.03, Math.min(1 - y, clamp(o.h as number))) };
  });
}

export async function submitResult(db: Db, id: string, value: unknown): Promise<Correction | undefined> {
  const result = validateResult(value);
  const { rowCount } = await db.query("UPDATE corrections SET result = $2, state = 'corrected', corrected_at = now(), updated_at = now() WHERE id = $1", [id, JSON.stringify(result)]);
  return rowCount === 1 ? getCorrection(db, id) : undefined;
}

/** Share of correct, partial and wrong exercises over corrected work, per course. */
/** The verdicts of the corrected work of a course; with since, only work corrected from then on. */
export async function verdictStats(db: Db, course?: string, since?: Date): Promise<{ course: string | null; corrections: number; correct: number; partial: number; wrong: number; missing: number }[]> {
  const { rows } = await db.query(
    `SELECT c.course, count(DISTINCT c.id)::int AS corrections,
            count(*) FILTER (WHERE e->>'verdict' = 'correct')::int AS correct,
            count(*) FILTER (WHERE e->>'verdict' = 'partial')::int AS partial,
            count(*) FILTER (WHERE e->>'verdict' = 'wrong')::int AS wrong,
            count(*) FILTER (WHERE e->>'verdict' = 'missing')::int AS missing
     FROM corrections c, jsonb_array_elements(c.result->'exercises') e
     WHERE c.state = 'corrected' AND c.affects_profile AND ($1::text IS NULL OR lower(c.course) = lower($1))
       AND ($2::timestamptz IS NULL OR coalesce(c.corrected_at, c.updated_at) >= $2)
     GROUP BY c.course ORDER BY c.course`,
    [course ?? null, since ?? null],
  );
  return rows;
}

/** The capture link opened by the phone; the token travels in the fragment, which never reaches server logs. */
export function captureUrl(publicUrl: URL, id: string, token: string): string {
  return `${publicUrl.origin}/capture/${id}#t=${token}`;
}
