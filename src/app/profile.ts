/**
 * The student's profile: what the agent observed while correcting (mistakes, weak and strong topics) and what the
 * student said, per course and topic, searchable by meaning so that later revisions target what matters.
 */
import type { Db } from "../rag/db.js";
import { toVector } from "../rag/db.js";
import { embed } from "../rag/embed.js";
import { verdictStats } from "./corrections.js";

export type NoteKind = "weakness" | "strength" | "mistake" | "note";

export interface NoteInput {
  course?: string;
  /** Chapter of the course the topic belongs to (title or number of a course chapter). */
  chapter?: string;
  topic: string;
  kind: NoteKind;
  text: string;
  /** 1 minor, 2 notable, 3 recurring or blocking. */
  severity?: 1 | 2 | 3;
  correctionId?: string;
  exercise?: string;
}

export interface ProfileNote extends NoteInput {
  id: number;
  severity: 1 | 2 | 3;
  createdAt: Date;
  resolvedAt?: Date;
}

export const NOTE_KINDS: NoteKind[] = ["weakness", "strength", "mistake", "note"];

function row(r: Record<string, unknown>): ProfileNote {
  return {
    id: Number(r.id),
    course: (r.course as string | null) ?? undefined,
    chapter: (r.chapter as string | null) ?? undefined,
    topic: r.topic as string,
    kind: r.kind as NoteKind,
    text: r.text as string,
    severity: r.severity as 1 | 2 | 3,
    correctionId: (r.correction_id as string | null) ?? undefined,
    exercise: (r.exercise as string | null) ?? undefined,
    createdAt: r.created_at as Date,
    resolvedAt: (r.resolved_at as Date | null) ?? undefined,
  };
}

/** Embeds the notes when the embedding service answers; notes are kept anyway. */
async function vectors(notes: NoteInput[]): Promise<(string | null)[]> {
  try {
    return (await embed(notes.map((n) => `${n.course ?? ""} ${n.topic}: ${n.text}`))).map(toVector);
  } catch {
    return notes.map(() => null);
  }
}

export async function addNotes(db: Db, notes: NoteInput[]): Promise<ProfileNote[]> {
  if (notes.length === 0) return [];
  for (const n of notes) {
    if (!NOTE_KINDS.includes(n.kind)) throw new Error(`kind must be one of ${NOTE_KINDS.join(", ")}`);
    if (!n.topic?.trim() || !n.text?.trim()) throw new Error("topic and text are required");
  }
  const embeddings = await vectors(notes);
  const out: ProfileNote[] = [];
  for (const [i, n] of notes.entries()) {
    const { rows } = await db.query(
      `INSERT INTO profile_notes (course, chapter, topic, kind, text, severity, correction_id, exercise, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector) RETURNING *`,
      [n.course ?? null, n.chapter?.trim() || null, n.topic.trim(), n.kind, n.text.trim(), n.severity ?? 2, n.correctionId ?? null, n.exercise ?? null, embeddings[i]],
    );
    out.push(row(rows[0]));
  }
  return out;
}

export async function listNotes(db: Db, options: { course?: string; kind?: NoteKind; topic?: string; resolved?: boolean; limit?: number } = {}): Promise<ProfileNote[]> {
  const { rows } = await db.query(
    `SELECT * FROM profile_notes
     WHERE ($1::text IS NULL OR lower(course) = lower($1)) AND ($2::text IS NULL OR kind = $2)
       AND ($3::text IS NULL OR lower(topic) = lower($3)) AND ($4::boolean OR resolved_at IS NULL)
     ORDER BY created_at DESC LIMIT $5`,
    [options.course ?? null, options.kind ?? null, options.topic ?? null, options.resolved ?? false, options.limit ?? 200],
  );
  return rows.map(row);
}

export async function resolveNote(db: Db, id: number, resolved = true): Promise<ProfileNote | undefined> {
  const { rows } = await db.query("UPDATE profile_notes SET resolved_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1 RETURNING *", [id, resolved]);
  return rows[0] ? row(rows[0]) : undefined;
}

export async function deleteNote(db: Db, id: number): Promise<boolean> {
  return (await db.query("DELETE FROM profile_notes WHERE id = $1", [id])).rowCount === 1;
}

/** Notes close in meaning to a question such as "ensembles, cardinal, inclusion-exclusion". */
export async function searchNotes(db: Db, query: string, course?: string, limit = 10): Promise<ProfileNote[]> {
  let vector: string | undefined;
  try {
    vector = toVector((await embed([query]))[0]);
  } catch {
    vector = undefined;
  }
  const { rows } = await db.query(
    vector
      ? `SELECT * FROM profile_notes WHERE resolved_at IS NULL AND ($2::text IS NULL OR lower(course) = lower($2)) AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector LIMIT $3`
      : `SELECT * FROM profile_notes WHERE resolved_at IS NULL AND ($2::text IS NULL OR lower(course) = lower($2))
         AND (topic ILIKE '%' || $1 || '%' OR text ILIKE '%' || $1 || '%') ORDER BY created_at DESC LIMIT $3`,
    [vector ?? query, course ?? null, limit],
  );
  return rows.map(row);
}

// Chapters

export interface ChapterInput {
  title: string;
  /** Topics of the chapter, as the notes name them. */
  keywords?: string[];
}

export interface Chapter extends ChapterInput {
  id: number;
  course: string;
  position: number;
  keywords: string[];
}

/** The four states of a chapter: from the open notes filed under it, or none yet. */
export type ChapterStatus = "mastered" | "fragile" | "struggling" | "unassessed";

export interface ChapterSummary extends Chapter {
  status: ChapterStatus;
  /** Share of positive observations, 0 to 1 (0.5 when unassessed, for the drawing). */
  level: number;
  strengths: number;
  weaknesses: number;
  mistakes: number;
  topics: string[];
}

export const CHAPTER_STATUSES: ChapterStatus[] = ["mastered", "fragile", "struggling", "unassessed"];

export async function listChapters(db: Db, course?: string): Promise<Chapter[]> {
  const { rows } = await db.query("SELECT * FROM course_chapters WHERE ($1::text IS NULL OR lower(course) = lower($1)) ORDER BY course, position", [course ?? null]);
  return rows.map((r) => ({ id: Number(r.id), course: r.course as string, position: r.position as number, title: r.title as string, keywords: r.keywords as string[] }));
}

/** Replaces the chapters of a course, in the given order (an empty list removes them). */
export async function setChapters(db: Db, course: string, chapters: ChapterInput[]): Promise<Chapter[]> {
  const code = course.trim().toUpperCase();
  if (!code) throw new Error("A course code is required");
  const clean = chapters.map((c) => ({ title: c.title.trim(), keywords: [...new Set((c.keywords ?? []).map((k) => k.trim()).filter(Boolean))] })).filter((c) => c.title);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM course_chapters WHERE lower(course) = lower($1)", [code]);
    for (const [i, c] of clean.entries()) await client.query("INSERT INTO course_chapters (course, position, title, keywords) VALUES ($1, $2, $3, $4)", [code, i + 1, c.title, c.keywords]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return listChapters(db, code);
}

const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** The chapter a note belongs to: the one it names (title, number or start of the title), else the one whose keywords match its topic. */
export function chapterOf(note: Pick<NoteInput, "chapter" | "topic">, chapters: Chapter[]): Chapter | undefined {
  const named = note.chapter && fold(note.chapter);
  if (named) {
    const byName = chapters.find((c) => fold(c.title) === named || String(c.position) === named || fold(c.title).startsWith(named) || fold(c.title).replace(/^\d+[.:)\s-]*/, "") === named);
    if (byName) return byName;
  }
  const topic = fold(note.topic);
  return chapters.find((c) => c.keywords.some((k) => fold(k) === topic)) ?? chapters.find((c) => c.keywords.some((k) => topic.includes(fold(k)) || fold(k).includes(topic)));
}

/** The status of each chapter of a course from its open notes, severity-weighted; chapters without notes are unassessed. */
export function chapterSummaries(chapters: Chapter[], notes: Pick<NoteInput, "chapter" | "topic" | "kind" | "severity">[]): { chapters: ChapterSummary[]; unassigned: string[] } {
  const tally = new Map(chapters.map((c) => [c.id, { pos: 0, neg: 0, strengths: 0, weaknesses: 0, mistakes: 0, topics: new Set<string>() }]));
  const unassigned = new Set<string>();
  for (const n of notes) {
    if (n.kind === "note") continue;
    const chapter = chapterOf(n, chapters);
    if (!chapter) {
      unassigned.add(n.topic);
      continue;
    }
    const t = tally.get(chapter.id)!;
    const weight = Math.max(1, n.severity ?? 2);
    if (n.kind === "strength") {
      t.pos += weight;
      t.strengths++;
    } else {
      t.neg += weight;
      if (n.kind === "weakness") t.weaknesses++;
      else t.mistakes++;
    }
    t.topics.add(n.topic);
  }
  return {
    chapters: chapters.map((c) => {
      const t = tally.get(c.id)!;
      const total = t.pos + t.neg;
      const level = total === 0 ? 0.5 : t.pos / total;
      const status: ChapterStatus = total === 0 ? "unassessed" : level >= 0.7 ? "mastered" : level >= 0.4 ? "fragile" : "struggling";
      return { ...c, status, level, strengths: t.strengths, weaknesses: t.weaknesses, mistakes: t.mistakes, topics: [...t.topics] };
    }),
    unassigned: [...unassigned],
  };
}

export interface TopicSummary {
  course: string | null;
  topic: string;
  /** Open notes of this kind on the topic. */
  count: number;
  severity: number;
  /** A Date in the server, an ISO string once it went through JSON. */
  lastAt: Date | string;
  examples: string[];
}

export interface ProfileSummary {
  courses: {
    course: string | null;
    weaknesses: TopicSummary[];
    strengths: TopicSummary[];
    mistakes: TopicSummary[];
    verdicts?: { corrections: number; correct: number; partial: number; wrong: number; missing: number };
    /** The chapters of the course with their status; empty until they are set. */
    chapters: ChapterSummary[];
    /** Topics of open notes that no chapter claims. */
    unassigned: string[];
  }[];
  /** Topics to revise first, across courses: weak topics and repeated mistakes, worst first. */
  toRevise: (TopicSummary & { score: number })[];
  openNotes: number;
}

async function topics(db: Db, kind: NoteKind, course?: string): Promise<TopicSummary[]> {
  const { rows } = await db.query(
    `SELECT course, topic, count(*)::int AS count, max(severity)::int AS severity, max(created_at) AS last_at,
            (array_agg(text ORDER BY severity DESC, created_at DESC))[1:3] AS examples
     FROM profile_notes WHERE kind = $1 AND resolved_at IS NULL AND ($2::text IS NULL OR lower(course) = lower($2))
     GROUP BY course, topic ORDER BY severity DESC, count DESC, last_at DESC`,
    [kind, course ?? null],
  );
  return rows.map((r) => ({ course: r.course, topic: r.topic, count: r.count, severity: r.severity, lastAt: r.last_at, examples: r.examples }));
}

export async function profileSummary(db: Db, course?: string): Promise<ProfileSummary> {
  const [weaknesses, strengths, mistakes, verdicts, chapters, openNotes] = await Promise.all([
    topics(db, "weakness", course),
    topics(db, "strength", course),
    topics(db, "mistake", course),
    verdictStats(db, course),
    listChapters(db, course),
    listNotes(db, { course, limit: 5000 }),
  ]);
  const courseKeys = [...new Set([...[...weaknesses, ...strengths, ...mistakes].map((t) => t.course ?? ""), ...verdicts.map((v) => v.course ?? ""), ...chapters.map((c) => c.course)])].sort();
  const courses = courseKeys.map((key) => {
    const c = key || null;
    const v = verdicts.find((x) => (x.course ?? null) === c);
    const own = chapters.filter((x) => x.course.toLowerCase() === (c ?? "").toLowerCase());
    const perChapter = chapterSummaries(own, openNotes.filter((n) => (n.course ?? null)?.toLowerCase() === (c ?? "").toLowerCase() || (!n.course && c === null)));
    return {
      course: c,
      weaknesses: weaknesses.filter((t) => (t.course ?? null) === c),
      strengths: strengths.filter((t) => (t.course ?? null) === c),
      mistakes: mistakes.filter((t) => (t.course ?? null) === c),
      verdicts: v ? { corrections: v.corrections, correct: v.correct, partial: v.partial, wrong: v.wrong, missing: v.missing } : undefined,
      chapters: perChapter.chapters,
      unassigned: own.length > 0 ? perChapter.unassigned : [],
    };
  });
  const scored = new Map<string, TopicSummary & { score: number }>();
  for (const t of [...weaknesses, ...mistakes]) {
    const key = `${t.course ?? ""}|${t.topic.toLowerCase()}`;
    const ageDays = (Date.now() - new Date(t.lastAt).getTime()) / 86_400_000;
    const score = t.severity * t.count * (ageDays < 14 ? 1.5 : ageDays < 60 ? 1 : 0.6);
    const existing = scored.get(key);
    scored.set(key, existing ? { ...existing, count: existing.count + t.count, score: existing.score + score, examples: [...existing.examples, ...t.examples].slice(0, 3) } : { ...t, score });
  }
  const { rows } = await db.query("SELECT count(*)::int AS open FROM profile_notes WHERE resolved_at IS NULL AND ($1::text IS NULL OR lower(course) = lower($1))", [course ?? null]);
  return { courses, toRevise: [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 12), openNotes: rows[0].open };
}

/** The profile as text, for the agent and the terminal. */
export function formatProfile(summary: ProfileSummary): string {
  if (summary.courses.length === 0) return "No observations yet: correct some work (heig:correct) or add notes.";
  const lines: string[] = [];
  for (const c of summary.courses) {
    lines.push(`## ${c.course ?? "General"}`);
    if (c.verdicts) lines.push(`Corrected exercises: ${c.verdicts.correct} correct, ${c.verdicts.partial} partial, ${c.verdicts.wrong} wrong, ${c.verdicts.missing} missing (${c.verdicts.corrections} corrections)`);
    if (c.chapters.length > 0) {
      lines.push("Chapters:");
      for (const ch of c.chapters) lines.push(`- ${ch.position}. ${ch.title}: ${ch.status}${ch.status === "unassessed" ? "" : ` (${Math.round(ch.level * 100)} %, ${ch.strengths} strengths, ${ch.weaknesses} weaknesses, ${ch.mistakes} mistakes)`}${ch.keywords.length > 0 ? ` · keywords: ${ch.keywords.join(", ")}` : ""}`);
      if (c.unassigned.length > 0) lines.push(`- Topics under no chapter: ${c.unassigned.join(", ")} (add them to a chapter's keywords with set_course_chapters)`);
    } else if (c.course) {
      lines.push("Chapters: none set yet (set_course_chapters, from the unit sheet or the course page)");
    }
    const block = (title: string, list: TopicSummary[]) => {
      if (list.length === 0) return;
      lines.push(`${title}:`);
      for (const t of list) lines.push(`- ${t.topic} (×${t.count}, severity ${t.severity}): ${t.examples[0]}`);
    };
    block("Weaknesses", c.weaknesses);
    block("Frequent mistakes", c.mistakes);
    block("Strengths", c.strengths);
    lines.push("");
  }
  if (summary.toRevise.length > 0) {
    lines.push("## To revise first");
    for (const t of summary.toRevise) lines.push(`- ${t.course ? `${t.course} · ` : ""}${t.topic} (score ${t.score.toFixed(1)})`);
  }
  return lines.join("\n");
}
