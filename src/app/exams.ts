/**
 * Mock exams (« TE blancs »): the practice exams of the library, each statement paired with its solutions, with the
 * corrections of the student's attempts and their grade on the Swiss scale (docs/app.md).
 */
import type { Db } from "../rag/db.js";
import { type CorrectedExercise, type Correction, type CorrectionState, listCorrections } from "./corrections.js";
import { type LibraryItem, annotatedLibrary, libraryItemKey } from "./library.js";

export type ExamStatus = "todo" | "pending" | "done";

export interface ExamScore {
  /** Points obtained and total: the agent's points when every exercise has some, otherwise one point per exercise. */
  obtained: number;
  total: number;
  /** Success, 0 to 100. */
  percent: number;
  /** Swiss grade, 1 to 6, to a tenth. */
  grade: number;
}

export interface ExamAttempt {
  id: string;
  title: string;
  state: CorrectionState;
  createdAt: Date;
  correctedAt?: Date;
  score?: ExamScore;
}

export interface MockExam {
  /** The statement's item key (`document:<name>`), what a correction's `exam` names. */
  key: string;
  course?: string;
  title: string;
  statement?: LibraryItem;
  solutions?: LibraryItem;
  /** Every library item of the exam (statement, solutions, other renderings). */
  items: LibraryItem[];
  createdAt: Date;
  attempts: ExamAttempt[];
  status: ExamStatus;
  /** The most recent corrected attempt. */
  last?: ExamAttempt;
  /** The best grade among the corrected attempts. */
  best?: ExamScore;
}

export const EXAM_TAG = "te blanc";
const SOLUTION_TAG = "corrigé";
const SOLUTION_WORDS = /corrig|solution|bareme|reponse/;
const STATEMENT_WORDS = /enonce|sujet|questions/;

const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** The credit of an exercise, 0 to 1: its points when given, otherwise 1 for correct, 0.5 for partial, 0 otherwise. */
export function exerciseCredit(e: CorrectedExercise): number {
  if (e.points && e.points.total > 0) return Math.max(0, Math.min(1, e.points.obtained / e.points.total));
  return e.verdict === "correct" ? 1 : e.verdict === "partial" ? 0.5 : 0;
}

/** The Swiss federal grade of a success ratio: 1 + 5 × ratio, to a tenth, between 1 and 6. */
export function swissGrade(ratio: number): number {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return Math.round((1 + 5 * bounded) * 10) / 10;
}

/** The score of a corrected piece of work; undefined without exercises. */
export function examScore(correction: Pick<Correction, "result">): ExamScore | undefined {
  const exercises = correction.result?.exercises ?? [];
  if (exercises.length === 0) return undefined;
  const pointed = exercises.every((e) => e.points && e.points.total > 0);
  const obtained = pointed ? exercises.reduce((s, e) => s + Math.max(0, Math.min(e.points!.total, e.points!.obtained)), 0) : exercises.reduce((s, e) => s + exerciseCredit(e), 0);
  const total = pointed ? exercises.reduce((s, e) => s + e.points!.total, 0) : exercises.length;
  const ratio = total > 0 ? obtained / total : 0;
  return { obtained: Math.round(obtained * 100) / 100, total, percent: Math.round(ratio * 100), grade: swissGrade(ratio) };
}

/**
 * What groups the statement and the solutions of one exam: its name without the words that tell them apart
 * (`MAD-TE-blanc-ch1-3-enonce` and `MAD-TE-blanc-ch1-3-corrige` share `mad-te-blanc-ch1-3`).
 */
export function examBase(name: string): string {
  return plain(name)
    .replace(/(^|[^a-z0-9])(enonce|sujet|questions|corrige|corriges|correction|solution|solutions|bareme|reponses?)(?=$|[^a-z0-9])/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The title of an exam from the title of its statement: without « (énoncé) » and the like. */
export function examTitle(title: string): string {
  return title
    .replace(/\s*[(\[][^()[\]]*(énoncé|enonce|corrigé|corrige|solutions?|barème|bareme)[^()[\]]*[)\]]\s*/gi, " ")
    .replace(/\s*[:·,-]\s*(énoncé|enonce|corrigé( et barème)?|corrige|solutions?)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const isSolutions = (item: LibraryItem) => item.tags.includes(SOLUTION_TAG) || SOLUTION_WORDS.test(plain(item.name));
const isStatement = (item: LibraryItem) => !isSolutions(item) || STATEMENT_WORDS.test(plain(item.name));

const attemptOf = (c: Correction): ExamAttempt => ({ id: c.id, title: c.title, state: c.state, createdAt: c.createdAt, correctedAt: c.correctedAt, score: c.state === "corrected" ? examScore(c) : undefined });

/** The mock exams of the library (documents tagged « te blanc »), with the corrections that name them. */
export function mockExams(items: LibraryItem[], corrections: Correction[]): MockExam[] {
  const groups = new Map<string, LibraryItem[]>();
  for (const item of items) {
    if (item.kind !== "document" || !item.tags.includes(EXAM_TAG)) continue;
    const base = `${item.course ?? ""}:${examBase(item.name) || plain(item.name)}`;
    groups.set(base, [...(groups.get(base) ?? []), item]);
  }
  const exams: MockExam[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.name.localeCompare(b.name));
    const statement = sorted.find(isStatement) ?? sorted[0];
    const solutions = sorted.find((i) => i !== statement && isSolutions(i)) ?? sorted.find((i) => i !== statement);
    const keys = new Set(sorted.map(libraryItemKey));
    const attempts = corrections
      .filter((c) => c.exam && keys.has(c.exam))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(attemptOf);
    const corrected = attempts.filter((a) => a.state === "corrected" && a.score);
    const last = corrected.at(-1);
    const best = corrected.reduce<ExamScore | undefined>((top, a) => (!top || a.score!.grade > top.grade ? a.score : top), undefined);
    exams.push({
      key: libraryItemKey(statement),
      course: statement.course,
      title: examTitle(statement.title) || statement.title,
      statement,
      solutions,
      items: sorted,
      createdAt: new Date(Math.min(...sorted.map((i) => Date.parse(i.modifiedAt)))),
      attempts,
      status: corrected.length > 0 ? "done" : attempts.length > 0 ? "pending" : "todo",
      last,
      best,
    });
  }
  return exams.sort((a, b) => (a.course ?? "~").localeCompare(b.course ?? "~") || b.createdAt.getTime() - a.createdAt.getTime());
}

/** The mock exams with their attempts, the entry point of the API, the MCP tools and the CLI. */
export async function listMockExams(db: Db, course?: string): Promise<MockExam[]> {
  const [items, corrections] = await Promise.all([annotatedLibrary(db), listCorrections(db, { limit: 1000 })]);
  const code = course?.trim().toUpperCase();
  return mockExams(items, corrections).filter((e) => !code || e.course === code);
}

type Dated<T> = T extends Date ? Date | string : T extends (infer U)[] ? Dated<U>[] : T extends object ? { [K in keyof T]: Dated<T[K]> } : T;
const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString());

/** One line per exam, for the terminal and the MCP tools (dates as Date or as their JSON strings). */
export function formatMockExams(exams: Dated<MockExam>[]): string {
  if (exams.length === 0) return "No mock exam in the library (documents tagged « te blanc »).";
  const status = (e: Dated<MockExam>) => (e.status === "done" ? `done · ${e.last!.score!.grade.toFixed(1)}/6 (${e.last!.score!.percent} %)${e.best && e.best.grade !== e.last!.score!.grade ? `, best ${e.best.grade.toFixed(1)}` : ""}` : e.status === "pending" ? "correction pending" : "to do");
  return exams
    .map((e) => `${(e.course ?? "-").padEnd(6)} ${iso(e.createdAt).slice(0, 10)}  ${status(e)}\n  ${e.title}\n  id: ${e.key}${e.solutions ? ` (solutions: ${libraryItemKey(e.solutions)})` : ""}${e.attempts.length ? `\n  corrections: ${e.attempts.map((a) => `${a.id} (${a.state}${a.score ? `, ${a.score.grade.toFixed(1)}` : ""})`).join(", ")}` : ""}`)
    .join("\n");
}
