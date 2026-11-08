/**
 * The student's profile: what the agent observed while correcting (mistakes, weak and strong topics) and what the
 * student said, per course and topic, searchable by meaning so that later revisions target what matters.
 */
import type { Db } from "../rag/db.js";
import { toVector } from "../rag/db.js";
import { embed } from "../rag/embed.js";
import { verdictStats } from "./corrections.js";
import { swissGrade } from "./exams.js";
import { type QuizAnswer, latestQuizAnswers } from "./quizzes.js";

export type NoteKind = "weakness" | "strength" | "mistake" | "note";

export interface NoteInput {
  course?: string;
  /** Chapter of the course the topic belongs to (title or number of a course chapter). */
  chapter?: string;
  /** Section of that chapter (title or number), when known. */
  section?: string;
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
    section: (r.section as string | null) ?? undefined,
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
      `INSERT INTO profile_notes (course, chapter, section, topic, kind, text, severity, correction_id, exercise, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector) RETURNING *`,
      [n.course ?? null, n.chapter?.trim() || null, n.section?.trim() || null, n.topic.trim(), n.kind, n.text.trim(), n.severity ?? 2, n.correctionId ?? null, n.exercise ?? null, embeddings[i]],
    );
    out.push(row(rows[0]));
  }
  return out;
}

export async function listNotes(db: Db, options: { course?: string; kind?: NoteKind; topic?: string; resolved?: boolean; limit?: number } = {}): Promise<ProfileNote[]> {
  const { rows } = await db.query(
    `SELECT * FROM profile_notes
     WHERE ($1::text IS NULL OR lower(course) = lower($1)) AND ($2::text IS NULL OR kind = $2)
       AND ($3::text IS NULL OR lower(topic) = lower($3)) AND ($4::boolean OR resolved_at IS NULL) AND NOT EXISTS (SELECT 1 FROM corrections x WHERE x.id = profile_notes.correction_id AND NOT x.affects_profile)
     ORDER BY created_at DESC LIMIT $5`,
    [options.course ?? null, options.kind ?? null, options.topic ?? null, options.resolved ?? false, options.limit ?? 200],
  );
  return rows.map(row);
}

export async function resolveNote(db: Db, id: number, resolved = true): Promise<ProfileNote | undefined> {
  const { rows } = await db.query("UPDATE profile_notes SET resolved_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1 RETURNING *", [id, resolved]);
  return rows[0] ? row(rows[0]) : undefined;
}

/** Changes the chapter, the section (title or number, null to clear) or the topic of a note. */
export async function updateNote(db: Db, id: number, patch: { chapter?: string | null; section?: string | null; topic?: string }): Promise<ProfileNote | undefined> {
  if (patch.topic !== undefined && !patch.topic.trim()) throw new Error("topic cannot be empty");
  const current = (await db.query("SELECT course, chapter FROM profile_notes WHERE id = $1", [id])).rows[0] as { course: string | null; chapter: string | null } | undefined;
  if (!current) return undefined;
  const chapters = current.course ? await listChapters(db, current.course) : [];
  let chapter = patch.chapter === undefined ? current.chapter : patch.chapter?.trim() || null;
  const named = chapter ? chapterNamed(chapter, chapters) : undefined;
  if (named) chapter = named.title;
  let section = patch.section?.trim() || null;
  if (section && named) section = sectionNamed(section, named)?.title ?? section;
  const { rows } = await db.query(
    `UPDATE profile_notes SET chapter = $2, section = CASE WHEN $3 THEN $4 ELSE section END, topic = COALESCE($5, topic) WHERE id = $1 RETURNING *`,
    [id, chapter, patch.section !== undefined || patch.chapter !== undefined, section, patch.topic?.trim() ?? null],
  );
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
      ? `SELECT * FROM profile_notes WHERE resolved_at IS NULL AND ($2::text IS NULL OR lower(course) = lower($2)) AND embedding IS NOT NULL AND NOT EXISTS (SELECT 1 FROM corrections x WHERE x.id = profile_notes.correction_id AND NOT x.affects_profile)
         ORDER BY embedding <=> $1::vector LIMIT $3`
      : `SELECT * FROM profile_notes WHERE resolved_at IS NULL AND ($2::text IS NULL OR lower(course) = lower($2)) AND NOT EXISTS (SELECT 1 FROM corrections x WHERE x.id = profile_notes.correction_id AND NOT x.affects_profile)
         AND (topic ILIKE '%' || $1 || '%' OR text ILIKE '%' || $1 || '%') ORDER BY created_at DESC LIMIT $3`,
    [vector ?? query, course ?? null, limit],
  );
  return rows.map(row);
}

// Chapters

export interface SectionInput {
  title: string;
  /** Topics of the section, as the notes name them. */
  keywords?: string[];
}

export interface Section extends SectionInput {
  /** 1-based, within the chapter. */
  position: number;
  keywords: string[];
}

export interface ChapterInput {
  title: string;
  /** Topics of the chapter, as the notes name them. */
  keywords?: string[];
  /** Its sub-chapters, in order. */
  sections?: SectionInput[];
}

export interface Chapter extends ChapterInput {
  id: number;
  course: string;
  position: number;
  keywords: string[];
  sections: Section[];
}

/** The four states of a chapter: from the open notes filed under it, or none yet. */
export type ChapterStatus = "mastered" | "fragile" | "struggling" | "unassessed";

/** What the notes and quiz answers filed under a chapter or a section say about it. */
export interface Assessment {
  status: ChapterStatus;
  /** Share of positive observations, 0 to 1 (0.5 when unassessed, for the drawing). */
  level: number;
  strengths: number;
  weaknesses: number;
  mistakes: number;
  /** Answers of the last attempt of each quiz that fell here. */
  quizCorrect: number;
  quizWrong: number;
  topics: string[];
}

export interface SectionSummary extends Section, Assessment {}

export interface ChapterSummary extends Chapter, Assessment {
  sections: SectionSummary[];
  /** Topics of the chapter's notes that fell in no section. */
  unsectioned: string[];
}

export const CHAPTER_STATUSES: ChapterStatus[] = ["mastered", "fragile", "struggling", "unassessed"];

export async function listChapters(db: Db, course?: string): Promise<Chapter[]> {
  const { rows } = await db.query("SELECT * FROM course_chapters WHERE ($1::text IS NULL OR lower(course) = lower($1)) ORDER BY course, position", [course ?? null]);
  return rows.map((r) => ({
    id: Number(r.id),
    course: r.course as string,
    position: r.position as number,
    title: r.title as string,
    keywords: r.keywords as string[],
    sections: ((r.sections as SectionInput[] | null) ?? []).map((x, i) => ({ position: i + 1, title: x.title, keywords: x.keywords ?? [] })),
  }));
}

const cleanKeywords = (keywords: string[] | undefined) => [...new Set((keywords ?? []).map((k) => k.trim()).filter(Boolean))];

/** Replaces the chapters of a course, in the given order (an empty list removes them). */
export async function setChapters(db: Db, course: string, chapters: ChapterInput[]): Promise<Chapter[]> {
  const code = course.trim().toUpperCase();
  if (!code) throw new Error("A course code is required");
  const clean = chapters
    .map((c) => ({
      title: c.title.trim(),
      keywords: cleanKeywords(c.keywords),
      sections: (c.sections ?? []).map((x) => ({ title: x.title.trim(), keywords: cleanKeywords(x.keywords) })).filter((x) => x.title),
    }))
    .filter((c) => c.title);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM course_chapters WHERE lower(course) = lower($1)", [code]);
    for (const [i, c] of clean.entries()) await client.query("INSERT INTO course_chapters (course, position, title, keywords, sections) VALUES ($1, $2, $3, $4, $5)", [code, i + 1, c.title, c.keywords, JSON.stringify(c.sections)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const saved = await listChapters(db, code);
  if (saved.length > 0) await fileNotes(db, code);
  return saved;
}

/**
 * Writes on each note of a course the chapter it belongs to (the one its topic matches by keyword, or the one it already
 * names), so the notes keep their chapter when the keywords change. Notes without a chapter only, or every note with `all`.
 */
export async function fileNotes(db: Db, course: string, all = false): Promise<{ filed: number; unassigned: string[] }> {
  const chapters = await listChapters(db, course);
  const notes = await listNotes(db, { course, resolved: true, limit: 5000 });
  let filed = 0;
  const unassigned = new Set<string>();
  for (const n of notes) {
    if (n.kind === "note") continue;
    const named = n.chapter ? chapterNamed(n.chapter, chapters) : undefined;
    if (named && !all) continue;
    const chapter = chapterOf({ topic: n.topic }, chapters) ?? named;
    if (!chapter) {
      unassigned.add(n.topic);
      continue;
    }
    const section = sectionOf({ topic: n.topic, section: all ? undefined : n.section }, chapter);
    if (n.chapter === chapter.title && (n.section ?? null) === (section?.title ?? null)) continue;
    await db.query("UPDATE profile_notes SET chapter = $2, section = $3 WHERE id = $1", [n.id, chapter.title, section?.title ?? null]);
    filed++;
  }
  return { filed, unassigned: [...unassigned].sort() };
}

/** Lowercase, without accents, apostrophes as spaces: « Relation d’ordre » and « relation d ordre » compare equal. */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The chapter a name designates: its title, its number, the start of its title or its title without the number. */
export function chapterNamed(name: string, chapters: Chapter[]): Chapter | undefined {
  const named = fold(name);
  if (!named) return undefined;
  return chapters.find((c) => fold(c.title) === named || String(c.position) === named || fold(c.title).startsWith(named) || fold(c.title).replace(/^\d+[.:)\s-]*/, "") === named);
}

/** The keywords of a chapter and of all its sections. */
const allKeywords = (c: Chapter) => [...c.keywords, ...c.sections.flatMap((x) => x.keywords)];

/** The item whose keyword equals the topic, else the one with the longest keyword that is part of the topic or the reverse. */
function byKeywords<T>(items: T[], keywordsOf: (item: T) => string[], topic: string): T | undefined {
  if (!topic) return undefined;
  const exact = items.find((c) => keywordsOf(c).some((k) => fold(k) === topic));
  if (exact) return exact;
  let best: { item: T; length: number } | undefined;
  for (const item of items) {
    for (const k of keywordsOf(item)) {
      const key = fold(k);
      if (key && (topic.includes(key) || key.includes(topic)) && key.length > (best?.length ?? 0)) best = { item, length: key.length };
    }
  }
  return best?.item;
}

/** The chapter a note belongs to: the one it names (title, number or start of the title), else the one whose keywords match its topic. */
export function chapterOf(note: Pick<NoteInput, "chapter" | "topic">, chapters: Chapter[]): Chapter | undefined {
  const byName = note.chapter ? chapterNamed(note.chapter, chapters) : undefined;
  if (byName) return byName;
  return byKeywords(chapters, allKeywords, fold(note.topic));
}

/** The section a name designates within a chapter: its title, its number (« 3 » or « 2.3 »), the start of its title, or a word of it (« équivalence »). */
export function sectionNamed(name: string, chapter: Chapter): Section | undefined {
  const named = fold(name).replace(new RegExp(`^${chapter.position}\\.`), "");
  if (!named) return undefined;
  return (
    chapter.sections.find((x) => fold(x.title) === named || String(x.position) === named || fold(x.title).startsWith(named) || fold(x.title).replace(/^\d+(\.\d+)*[.:)\s-]*/, "") === named) ??
    (named.length >= 4 ? chapter.sections.find((x) => words(x.title).includes(` ${named} `)) : undefined)
  );
}

/** The section of its chapter a note belongs to: the one it names, else the one whose keywords match its topic. */
export function sectionOf(note: Pick<NoteInput, "section" | "topic">, chapter: Chapter): Section | undefined {
  const byName = note.section ? sectionNamed(note.section, chapter) : undefined;
  if (byName) return byName;
  return byKeywords(chapter.sections, (x) => x.keywords, fold(note.topic));
}

/** "3. Fonctions" when the title already starts with its number, else built from the position. */
export const chapterLabel = (c: Pick<Chapter, "position" | "title">) => (/^\d+[.:)\s-]/.test(c.title) ? c.title : `${c.position}. ${c.title}`);

/**
 * The chapter a quiz question belongs to: the one it names, the one a keyword names exactly as its topic, the one its
 * source numbers (« Cours MAD ch. 2 p. 53 »), the one a keyword of which is part of its topic, else the one whose keyword
 * appears as a word in the statement.
 */
export function chapterOfAnswer(answer: Pick<QuizAnswer, "chapter" | "topic" | "statement" | "source">, chapters: Chapter[]): Chapter | undefined {
  const named = answer.chapter ? chapterNamed(answer.chapter, chapters) : undefined;
  if (named) return named;
  const topic = answer.topic ? fold(answer.topic) : "";
  const exact = topic ? chapters.find((c) => allKeywords(c).some((k) => fold(k) === topic)) : undefined;
  if (exact) return exact;
  const numbered = answer.source && /\b(?:ch(?:ap(?:itre)?)?\.?|chapter)\s*(\d+)/i.exec(answer.source);
  const byNumber = numbered ? chapters.find((c) => c.position === Number(numbered[1])) : undefined;
  if (byNumber) return byNumber;
  const byTopic = topic ? chapterOf({ topic }, chapters) : undefined;
  if (byTopic) return byTopic;
  const statement = words(answer.statement);
  return chapters.find((c) => allKeywords(c).some((k) => statement.includes(words(k))));
}

const words = (text: string) => ` ${fold(text).replace(/[^\p{L}\p{N}]+/gu, " ")} `;

/** The section of its chapter a quiz question belongs to: named, by topic keywords, else by a keyword in the statement. */
export function sectionOfAnswer(answer: Pick<QuizAnswer, "section" | "topic" | "statement">, chapter: Chapter): Section | undefined {
  const bySection = sectionOf({ section: answer.section, topic: answer.topic ?? "" }, chapter);
  if (bySection) return bySection;
  const statement = words(answer.statement);
  return chapter.sections.find((x) => x.keywords.some((k) => statement.includes(words(k))));
}

/**
 * The status of each chapter of a course from its open notes, severity-weighted, and from the last attempt of each quiz
 * (one point for or against the chapter per answer); chapters without any are unassessed.
 */
export function chapterSummaries(chapters: Chapter[], notes: Pick<NoteInput, "chapter" | "section" | "topic" | "kind" | "severity">[], answers: Pick<QuizAnswer, "chapter" | "section" | "topic" | "statement" | "source" | "correct">[] = []): { chapters: ChapterSummary[]; unassigned: string[] } {
  const blank = () => ({ pos: 0, neg: 0, strengths: 0, weaknesses: 0, mistakes: 0, quizCorrect: 0, quizWrong: 0, topics: new Set<string>() });
  type Tally = ReturnType<typeof blank>;
  const tally = new Map(chapters.map((c) => [c.id, { own: blank(), sections: new Map(c.sections.map((x) => [x.position, blank()])), unsectioned: new Set<string>() }]));
  const unassigned = new Set<string>();
  for (const a of answers) {
    const chapter = chapterOfAnswer(a, chapters);
    if (!chapter) continue;
    const t = tally.get(chapter.id)!;
    const section = sectionOfAnswer(a, chapter);
    for (const x of [t.own, section && t.sections.get(section.position)]) {
      if (!x) continue;
      if (a.correct) {
        x.pos += 1;
        x.quizCorrect++;
      } else {
        x.neg += 1;
        x.quizWrong++;
      }
    }
  }
  for (const n of notes) {
    if (n.kind === "note") continue;
    const chapter = chapterOf(n, chapters);
    if (!chapter) {
      unassigned.add(n.topic);
      continue;
    }
    const t = tally.get(chapter.id)!;
    const section = sectionOf(n, chapter);
    if (!section && chapter.sections.length > 0) t.unsectioned.add(n.topic);
    const weight = Math.max(1, n.severity ?? 2);
    for (const x of [t.own, section && t.sections.get(section.position)]) {
      if (!x) continue;
      if (n.kind === "strength") {
        x.pos += weight;
        x.strengths++;
      } else {
        x.neg += weight;
        if (n.kind === "weakness") x.weaknesses++;
        else x.mistakes++;
      }
      x.topics.add(n.topic);
    }
  }
  const assess = (t: Tally): Assessment => {
    const total = t.pos + t.neg;
    const level = total === 0 ? 0.5 : t.pos / total;
    const status: ChapterStatus = total === 0 ? "unassessed" : level >= 0.7 ? "mastered" : level >= 0.4 ? "fragile" : "struggling";
    return { status, level, strengths: t.strengths, weaknesses: t.weaknesses, mistakes: t.mistakes, quizCorrect: t.quizCorrect, quizWrong: t.quizWrong, topics: [...t.topics] };
  };
  return {
    chapters: chapters.map((c) => {
      const t = tally.get(c.id)!;
      return { ...c, ...assess(t.own), sections: c.sections.map((x) => ({ ...x, ...assess(t.sections.get(x.position)!) })), unsectioned: [...t.unsectioned] };
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
    /** The overall grade on the course's exercises: corrected exercises and quiz answers together. */
    score?: CourseScore;
    /** The chapters of the course with their status; empty until they are set. */
    chapters: ChapterSummary[];
    /** Topics of open notes that no chapter claims. */
    unassigned: string[];
  }[];
  /** Topics to revise first, across courses: weak topics and repeated mistakes, worst first. */
  toRevise: (TopicSummary & { score: number })[];
  openNotes: number;
}

export interface CourseScore {
  /** Corrected exercises: one point each, half for a partial one, and how many there are. */
  exercises: { credit: number; total: number };
  /** Quiz answers of the last attempt of each quiz: right ones and how many there are. */
  quiz: { correct: number; total: number };
  /** Success, 0 to 1, over exercises and answers together. */
  ratio: number;
  /** Swiss grade, 1 to 6, to a tenth. */
  grade: number;
}

/** The grade of a course from its corrected exercises (one point each, half for a partial) and its quiz answers (one each); undefined without any. */
export function courseScore(verdicts: { correct: number; partial: number; wrong: number; missing: number } | undefined, answers: Pick<QuizAnswer, "correct">[]): CourseScore | undefined {
  const exercises = verdicts ? { credit: verdicts.correct + verdicts.partial / 2, total: verdicts.correct + verdicts.partial + verdicts.wrong + verdicts.missing } : { credit: 0, total: 0 };
  const quiz = { correct: answers.filter((a) => a.correct).length, total: answers.length };
  const total = exercises.total + quiz.total;
  if (total === 0) return undefined;
  const ratio = (exercises.credit + quiz.correct) / total;
  return { exercises, quiz, ratio, grade: swissGrade(ratio) };
}

async function topics(db: Db, kind: NoteKind, course?: string): Promise<TopicSummary[]> {
  const { rows } = await db.query(
    `SELECT course, topic, count(*)::int AS count, max(severity)::int AS severity, max(created_at) AS last_at,
            (array_agg(text ORDER BY severity DESC, created_at DESC))[1:3] AS examples
     FROM profile_notes WHERE kind = $1 AND resolved_at IS NULL AND NOT EXISTS (SELECT 1 FROM corrections x WHERE x.id = profile_notes.correction_id AND NOT x.affects_profile) AND ($2::text IS NULL OR lower(course) = lower($2))
     GROUP BY course, topic ORDER BY severity DESC, count DESC, last_at DESC`,
    [kind, course ?? null],
  );
  return rows.map((r) => ({ course: r.course, topic: r.topic, count: r.count, severity: r.severity, lastAt: r.last_at, examples: r.examples }));
}

export async function profileSummary(db: Db, course?: string): Promise<ProfileSummary> {
  const [weaknesses, strengths, mistakes, verdicts, chapters, openNotes, answers] = await Promise.all([
    topics(db, "weakness", course),
    topics(db, "strength", course),
    topics(db, "mistake", course),
    verdictStats(db, course),
    listChapters(db, course),
    listNotes(db, { course, limit: 5000 }),
    latestQuizAnswers(db, course),
  ]);
  const courseKeys = [...new Set([...[...weaknesses, ...strengths, ...mistakes].map((t) => t.course ?? ""), ...verdicts.map((v) => v.course ?? ""), ...chapters.map((c) => c.course), ...answers.map((a) => a.course?.toUpperCase() ?? "")])].sort();
  const courses = courseKeys.map((key) => {
    const c = key || null;
    const v = verdicts.find((x) => (x.course ?? null) === c);
    const own = chapters.filter((x) => x.course.toLowerCase() === (c ?? "").toLowerCase());
    const ownAnswers = answers.filter((a) => (a.course ?? "").toLowerCase() === (c ?? "").toLowerCase());
    const perChapter = chapterSummaries(
      own,
      openNotes.filter((n) => (n.course ?? null)?.toLowerCase() === (c ?? "").toLowerCase() || (!n.course && c === null)),
      ownAnswers,
    );
    return {
      course: c,
      weaknesses: weaknesses.filter((t) => (t.course ?? null) === c),
      strengths: strengths.filter((t) => (t.course ?? null) === c),
      mistakes: mistakes.filter((t) => (t.course ?? null) === c),
      verdicts: v ? { corrections: v.corrections, correct: v.correct, partial: v.partial, wrong: v.wrong, missing: v.missing } : undefined,
      score: courseScore(v, ownAnswers),
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
  const { rows } = await db.query("SELECT count(*)::int AS open FROM profile_notes WHERE resolved_at IS NULL AND NOT EXISTS (SELECT 1 FROM corrections x WHERE x.id = profile_notes.correction_id AND NOT x.affects_profile) AND ($1::text IS NULL OR lower(course) = lower($1))", [course ?? null]);
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
      const assessed = (a: Assessment) => (a.status === "unassessed" ? "unassessed" : `${a.status} (${Math.round(a.level * 100)} %, ${a.strengths} strengths, ${a.weaknesses} weaknesses, ${a.mistakes} mistakes${a.quizCorrect + a.quizWrong > 0 ? `, quiz ${a.quizCorrect}/${a.quizCorrect + a.quizWrong}` : ""})`);
      for (const ch of c.chapters) {
        lines.push(`- ${chapterLabel(ch)}: ${assessed(ch)}${ch.keywords.length > 0 ? ` · keywords: ${ch.keywords.join(", ")}` : ""}`);
        for (const x of ch.sections) lines.push(`  - ${ch.position}.${x.position} ${x.title}: ${assessed(x)}${x.keywords.length > 0 ? ` · keywords: ${x.keywords.join(", ")}` : ""}`);
        if (ch.unsectioned.length > 0) lines.push(`  - under no section: ${ch.unsectioned.join(", ")}`);
      }
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
