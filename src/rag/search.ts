import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../paths.js";
import { type Db, toVector } from "./db.js";
import { embed } from "./embed.js";
import { PAGE_BREAK } from "./extract.js";

export interface SearchFilters {
  /** Timetable course code, e.g. MAD. */
  course?: string;
  docType?: string;
  limit?: number;
}

export interface SearchResult {
  score: number;
  documentId: number;
  title: string;
  course: string | null;
  chapter: string | null;
  docType: string;
  teachers: string[];
  pages: string;
  headingPath: string | null;
  exercise: string | null;
  url: string | null;
  text: string;
}

/** Candidates taken from each ranking before fusion. */
const CANDIDATES = 50;
/** Reciprocal rank fusion constant: dampens the weight of top ranks. */
const RRF_K = 60;
const EXERCISE_NUMBER = /\b\d{1,2}\.\d{1,3}\b/g;
/** An exact exercise number in the query outweighs similar meaning or shared words. */
const EXERCISE_WEIGHT = 2;

/**
 * Hybrid search: meaning (vector similarity), words (French full-text search, any word may match) and exact
 * exercise numbers, merged by reciprocal rank fusion. Removed documents are excluded.
 */
export async function search(db: Db, query: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const [vector] = await embed([query]);
  const exercises = query.match(EXERCISE_NUMBER) ?? [];
  const { rows } = await db.query(
    `WITH active AS (
       SELECT DISTINCT ON (content_hash) *
       FROM documents
       WHERE removed_at IS NULL AND content_hash IS NOT NULL
         AND ($2::text IS NULL OR lower(course_code) = lower($2))
         AND ($3::text IS NULL OR doc_type = $3)
       ORDER BY content_hash, uploaded_at DESC NULLS LAST
     ),
     vec AS (
       SELECT c.id, row_number() OVER (ORDER BY c.embedding <=> $1::vector) AS r
       FROM chunks c JOIN active a USING (content_hash)
       ORDER BY c.embedding <=> $1::vector LIMIT ${CANDIDATES}
     ),
     words AS (
       SELECT c.id, row_number() OVER (ORDER BY ts_rank_cd(c.tsv, q) DESC) AS r
       FROM chunks c JOIN active a USING (content_hash),
            (SELECT replace(plainto_tsquery('french', $4)::text, '&', '|')::tsquery AS q) AS query
       WHERE q::text <> '' AND c.tsv @@ q
       ORDER BY ts_rank_cd(c.tsv, q) DESC LIMIT ${CANDIDATES}
     ),
     numbered AS (
       SELECT c.id, row_number() OVER (ORDER BY c.heading_path ILIKE '%solution%', c.ordinal) AS r
       FROM chunks c JOIN active a USING (content_hash)
       WHERE c.exercise = ANY($5::text[])
       LIMIT ${CANDIDATES}
     ),
     fused AS (
       SELECT id, sum(w / (${RRF_K} + r)) AS score
       FROM (SELECT *, 1.0 AS w FROM vec UNION ALL SELECT *, 1.0 FROM words
             UNION ALL SELECT *, ${EXERCISE_WEIGHT}.0 FROM numbered) AS ranks
       GROUP BY id
     )
     SELECT f.score, a.id AS document_id, a.title, a.course_code, a.chapter, a.doc_type, a.teachers, a.url,
            c.page_from, c.page_to, c.heading_path, c.exercise, c.text
     FROM fused f JOIN chunks c ON c.id = f.id JOIN active a USING (content_hash)
     ORDER BY f.score DESC
     LIMIT $6`,
    [toVector(vector), filters.course ?? null, filters.docType ?? null, query, exercises, filters.limit ?? 8],
  );
  return rows.map((row) => ({
    score: Number(row.score),
    documentId: Number(row.document_id),
    title: row.title,
    course: row.course_code,
    chapter: row.chapter,
    docType: row.doc_type,
    teachers: row.teachers,
    pages: pageRange(row.page_from, row.page_to),
    headingPath: row.heading_path,
    exercise: row.exercise,
    url: row.url,
    text: row.text,
  }));
}

/** Statement and solutions of an exercise, e.g. ("MAD", "2.22"). */
export async function findExercise(db: Db, course: string | undefined, number: string): Promise<SearchResult[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (c.id) d.id AS document_id, d.title, d.course_code, d.chapter, d.doc_type, d.teachers, d.url,
            c.page_from, c.page_to, c.heading_path, c.exercise, c.text, c.ordinal
     FROM chunks c JOIN documents d USING (content_hash)
     WHERE d.removed_at IS NULL AND c.exercise = $2 AND ($1::text IS NULL OR lower(d.course_code) = lower($1))
     ORDER BY c.id, d.id`,
    [course ?? null, number],
  );
  return rows
    .sort((a, b) => Number(a.heading_path?.match(/solution|corrig/i) != null) - Number(b.heading_path?.match(/solution|corrig/i) != null))
    .map((row) => ({
      score: 1,
      documentId: Number(row.document_id),
      title: row.title,
      course: row.course_code,
      chapter: row.chapter,
      docType: row.doc_type,
      teachers: row.teachers,
      pages: pageRange(row.page_from, row.page_to),
      headingPath: row.heading_path,
      exercise: row.exercise,
      url: row.url,
      text: row.text,
    }));
}

export interface DocumentText {
  id: number;
  title: string;
  course: string | null;
  chapter: string | null;
  docType: string;
  url: string | null;
  pageCount: number;
  text: string;
}

/** Extracted text of a document, optionally limited to a page range (1-based, inclusive). */
export async function documentText(db: Db, id: number, pageFrom?: number, pageTo?: number): Promise<DocumentText | undefined> {
  const { rows } = await db.query(
    "SELECT id, title, course_code, chapter, doc_type, url, content_hash FROM documents WHERE id = $1 AND removed_at IS NULL",
    [id],
  );
  const doc = rows[0];
  if (!doc) return undefined;
  const pages = (await readFile(path.join(ROOT, "data", "extracted", `${doc.content_hash}.md`), "utf-8")).split(PAGE_BREAK);
  const from = Math.max(1, pageFrom ?? 1);
  const to = Math.min(pages.length, pageTo ?? pages.length);
  return {
    id: Number(doc.id),
    title: doc.title,
    course: doc.course_code,
    chapter: doc.chapter,
    docType: doc.doc_type,
    url: doc.url,
    pageCount: pages.length,
    text: pages
      .slice(from - 1, to)
      .map((page, i) => `--- page ${from + i} ---\n${page.replace(/<!-- image -->\n*/g, "").trim()}`)
      .join("\n\n"),
  };
}

export async function listCourses(db: Db) {
  const { rows } = await db.query(
    `SELECT course_code, max(course_name) AS course_name, max(teachers) AS teachers, count(*)::int AS documents,
            array_agg(DISTINCT doc_type) AS doc_types
     FROM documents WHERE removed_at IS NULL GROUP BY course_code ORDER BY course_code`,
  );
  return rows.map((r) => ({ course: r.course_code, name: r.course_name, teachers: r.teachers, documents: r.documents, docTypes: r.doc_types }));
}

export async function listDocuments(db: Db, course: string, docType?: string) {
  const { rows } = await db.query(
    `SELECT id, title, doc_type, chapter, uploaded_at, url FROM documents
     WHERE removed_at IS NULL AND lower(course_code) = lower($1) AND ($2::text IS NULL OR doc_type = $2)
     ORDER BY chapter NULLS FIRST, title`,
    [course, docType ?? null],
  );
  return rows.map((r) => ({ id: Number(r.id), title: r.title, docType: r.doc_type, chapter: r.chapter, uploadedAt: r.uploaded_at, url: r.url }));
}

function pageRange(from: number | null, to: number | null): string {
  if (!from) return "";
  return to && to !== from ? `${from}-${to}` : String(from);
}
