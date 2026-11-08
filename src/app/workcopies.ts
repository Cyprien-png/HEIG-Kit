/**
 * Work copies: a PDF (test, exercise sheet) the student fills in on the web app, from a computer or a phone, with pen,
 * text and shapes. The PDF is a file of the data folder, the annotations live in the database by page, in coordinates
 * relative to the page (0 to 1) so that they do not depend on the zoom or the screen. Submitting a copy turns its pages
 * into the photos of a correction (src/app/corrections.ts), done by the web app which renders the pages.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../paths.js";
import type { Db } from "../rag/db.js";
import { checkExam } from "./corrections.js";

export const MAX_SOURCE_BYTES = 60 * 1024 ** 2;
export const MAX_PAGES = 200;
const MAX_OPS_PER_PAGE = 5000;
const MAX_POINTS = 4000;
const MAX_TEXT = 4000;

export type Op =
  | { t: "pen" | "hl"; c: string; w: number; p: number[] }
  | { t: "line" | "arrow" | "rect" | "ellipse"; c: string; w: number; a: [number, number]; b: [number, number] }
  | { t: "text"; c: string; s: number; x: number; y: number; v: string };

/** Annotations by page number (1-based, as keys). */
export type Annotations = Record<string, Op[]>;

export interface Workcopy {
  id: string;
  title: string;
  course?: string;
  exam?: string;
  sourceLabel?: string;
  pageCount: number;
  rev: number;
  hasSource: boolean;
  correctionId?: string;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  /** Number of pages with at least one annotation. */
  annotatedPages: number;
  /** Only in `getWorkcopy`. */
  annotations?: Annotations;
}

export const workcopyDir = (id: string) => path.join(DATA_DIR, "workcopies", id);
export const sourcePath = (id: string) => path.join(workcopyDir(id), "source.pdf");

const COLOR = /^#[0-9a-fA-F]{6}$/;
const finite = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;

function checkOp(op: unknown): Op {
  if (typeof op !== "object" || op === null) throw new Error("an annotation must be an object");
  const o = op as Record<string, unknown>;
  if (typeof o.c !== "string" || !COLOR.test(o.c)) throw new Error("annotation color must be #rrggbb");
  const point = (v: unknown): [number, number] => {
    if (!Array.isArray(v) || v.length !== 2 || !finite(v[0], -0.5, 1.5) || !finite(v[1], -0.5, 1.5)) throw new Error("a point must be two numbers around 0 to 1");
    return [v[0], v[1]];
  };
  switch (o.t) {
    case "pen":
    case "hl": {
      if (!finite(o.w, 0.0002, 0.2)) throw new Error("invalid stroke width");
      if (!Array.isArray(o.p) || o.p.length < 2 || o.p.length % 2 !== 0 || o.p.length > MAX_POINTS * 2 || !o.p.every((n) => finite(n, -0.5, 1.5))) throw new Error("invalid stroke points");
      return { t: o.t, c: o.c, w: o.w, p: o.p as number[] };
    }
    case "line":
    case "arrow":
    case "rect":
    case "ellipse":
      if (!finite(o.w, 0.0002, 0.2)) throw new Error("invalid stroke width");
      return { t: o.t, c: o.c, w: o.w, a: point(o.a), b: point(o.b) };
    case "text":
      if (!finite(o.s, 0.004, 0.2) || !finite(o.x, -0.5, 1.5) || !finite(o.y, -0.5, 1.5)) throw new Error("invalid text position or size");
      if (typeof o.v !== "string" || o.v.length === 0 || o.v.length > MAX_TEXT) throw new Error("invalid text");
      return { t: "text", c: o.c, s: o.s, x: o.x, y: o.y, v: o.v };
    default:
      throw new Error("unknown annotation type");
  }
}

/** Validates (and strips) annotations coming from a browser: page keys, kinds, ranges, sizes. */
export function checkAnnotations(value: unknown): Annotations {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("annotations must be an object keyed by page");
  const out: Annotations = {};
  for (const [page, ops] of Object.entries(value)) {
    if (!/^[1-9]\d{0,3}$/.test(page) || Number(page) > MAX_PAGES) throw new Error(`invalid page ${page}`);
    if (!Array.isArray(ops) || ops.length > MAX_OPS_PER_PAGE) throw new Error(`page ${page}: too many annotations`);
    if (ops.length > 0) out[page] = ops.map(checkOp);
  }
  return out;
}

function row(r: Record<string, unknown>, withAnnotations = false): Workcopy {
  const annotations = (r.annotations as Annotations | null) ?? {};
  return {
    id: r.id as string,
    title: r.title as string,
    course: (r.course as string | null) ?? undefined,
    exam: (r.exam as string | null) ?? undefined,
    sourceLabel: (r.source_label as string | null) ?? undefined,
    pageCount: r.page_count as number,
    rev: r.rev as number,
    hasSource: r.has_source as boolean,
    correctionId: (r.correction_id as string | null) ?? undefined,
    submittedAt: (r.submitted_at as Date | null) ?? undefined,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    annotatedPages: Object.values(annotations).filter((ops) => ops.length > 0).length,
    ...(withAnnotations ? { annotations } : {}),
  };
}

export interface WorkcopyInput {
  title: string;
  course?: string;
  exam?: string;
  sourceLabel?: string;
  pageCount?: number;
}

export async function createWorkcopy(db: Db, input: WorkcopyInput): Promise<Workcopy> {
  const title = input.title.trim();
  if (!title) throw new Error("title is required");
  const pages = input.pageCount ?? 0;
  if (!Number.isInteger(pages) || pages < 0 || pages > MAX_PAGES) throw new Error(`page count must be between 0 and ${MAX_PAGES}`);
  const id = randomUUID();
  await db.query("INSERT INTO workcopies (id, title, course, exam, source_label, page_count) VALUES ($1, $2, $3, $4, $5, $6)", [id, title, input.course ?? null, checkExam(input.exam) ?? null, input.sourceLabel ?? null, pages]);
  return (await getWorkcopy(db, id))!;
}

export async function getWorkcopy(db: Db, id: string): Promise<Workcopy | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  const { rows } = await db.query("SELECT * FROM workcopies WHERE id = $1", [id]);
  return rows[0] ? row(rows[0], true) : undefined;
}

export async function listWorkcopies(db: Db): Promise<Workcopy[]> {
  const { rows } = await db.query("SELECT * FROM workcopies ORDER BY updated_at DESC LIMIT 500");
  return rows.map((r) => row(r));
}

export interface WorkcopyPatch {
  title?: string;
  course?: string | null;
  exam?: string | null;
  annotations?: Annotations;
  pageCount?: number;
  correctionId?: string | null;
  submitted?: boolean;
}

/** Thrown when the copy changed (another device) since the revision the caller started from. */
export class RevisionConflict extends Error {
  constructor(public current: Workcopy) {
    super("this copy was modified elsewhere");
  }
}

/** Updates a copy. `baseRev` (what the caller last saw) is required to replace the annotations: a stale one is refused. */
export async function updateWorkcopy(db: Db, id: string, patch: WorkcopyPatch, baseRev?: number): Promise<Workcopy | undefined> {
  const exam = checkExam(patch.exam);
  const title = patch.title?.trim();
  if (patch.title !== undefined && !title) throw new Error("title cannot be empty");
  if (patch.pageCount !== undefined && (!Number.isInteger(patch.pageCount) || patch.pageCount < 0 || patch.pageCount > MAX_PAGES)) throw new Error(`page count must be between 0 and ${MAX_PAGES}`);
  const replace = patch.annotations !== undefined;
  const { rows } = await db.query(
    `UPDATE workcopies SET title = coalesce($2, title),
       course = CASE WHEN $3::boolean THEN $4 ELSE course END,
       exam = CASE WHEN $5::boolean THEN $6 ELSE exam END,
       annotations = CASE WHEN $7::boolean THEN $8::jsonb ELSE annotations END,
       page_count = coalesce($9, page_count),
       correction_id = CASE WHEN $10::boolean THEN $11::uuid ELSE correction_id END,
       submitted_at = CASE WHEN $12::boolean THEN now() ELSE submitted_at END,
       rev = rev + CASE WHEN $7::boolean THEN 1 ELSE 0 END,
       updated_at = now()
     WHERE id = $1 AND (NOT $7::boolean OR rev = $13)
     RETURNING *`,
    [
      id, title ?? null,
      patch.course !== undefined, patch.course ?? null,
      exam !== undefined, exam ?? null,
      replace, replace ? JSON.stringify(patch.annotations) : null,
      patch.pageCount ?? null,
      patch.correctionId !== undefined, patch.correctionId ?? null,
      patch.submitted === true,
      baseRev ?? -1,
    ],
  );
  if (rows[0]) return row(rows[0], true);
  const current = await getWorkcopy(db, id);
  if (current && replace) throw new RevisionConflict(current);
  return undefined;
}

/** Stores the PDF of a copy (checked from its first bytes). */
export async function saveSource(db: Db, id: string, bytes: Buffer): Promise<Workcopy | undefined> {
  if (!(await getWorkcopy(db, id))) return undefined;
  if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) throw new Error(`The PDF must be between 1 byte and ${MAX_SOURCE_BYTES / 1024 ** 2} MB`);
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Not a PDF file");
  const dir = workcopyDir(id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const partial = path.join(dir, ".source.pdf.partial");
  writeFileSync(partial, bytes, { mode: 0o600 });
  renameSync(partial, sourcePath(id));
  await db.query("UPDATE workcopies SET has_source = true, updated_at = now() WHERE id = $1", [id]);
  return getWorkcopy(db, id);
}

export function sourceFile(id: string): string | undefined {
  return /^[0-9a-f-]{36}$/.test(id) && existsSync(sourcePath(id)) ? sourcePath(id) : undefined;
}

export async function deleteWorkcopy(db: Db, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  const deleted = (await db.query("DELETE FROM workcopies WHERE id = $1", [id])).rowCount === 1;
  if (deleted) rmSync(workcopyDir(id), { recursive: true, force: true });
  return deleted;
}
