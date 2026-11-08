/**
 * Quizzes of true/false statements and multiple-choice questions (QCM), freely mixed: the agent writes them from the
 * course material, the student answers them one by one (a swipe or a form on the web app, a word or a letter aloud
 * with a voice assistant through the MCP tools, the keyboard in the terminal) and gets a score and the list of
 * mistakes at the end. Each attempt keeps its answers, so a quiz can be redone.
 */
import type { Db } from "../rag/db.js";

export type AttemptMode = "web" | "voice" | "cli";

/** What a quiz is made of: only true/false statements, only multiple-choice questions, or both. */
export type QuizKind = "truefalse" | "mcq" | "mixed";

export interface QuizSummary {
  id: number;
  kind: QuizKind;
  course?: string;
  title: string;
  description?: string;
  createdAt: Date;
  questions: number;
  attempts: number;
  /** The last finished attempt, if any. */
  last?: { attemptId: number; score: number; total: number; finishedAt: Date };
  best?: { score: number; total: number };
}

export interface QuestionInput {
  /** A statement that is true or false, or the question of a QCM; written to be read aloud (no formula the voice cannot say). */
  statement: string;
  /** True/false question: whether the statement is true. */
  answer?: boolean;
  /** Multiple-choice question: the options (2 to 8), shown and read with the letters A, B, C… */
  options?: string[];
  /** Multiple-choice question: the indexes of the right options (from 0), one or several. */
  correct?: number[];
  /** Why, in one or two sentences, with the course's words. */
  explanation?: string;
  source?: string;
  topic?: string;
  /** Chapter of the course (title or number), so the answer counts in the profile's chapter status. */
  chapter?: string;
  /** Section of that chapter (title or number). */
  section?: string;
}

export interface Question extends QuestionInput {
  id: number;
  quizId: number;
  position: number;
}

/** A question as shown while answering: without its answer; for a QCM, its options and whether several are right. */
export type AskedQuestion = Pick<Question, "id" | "position" | "statement" | "topic" | "options"> & { multiple?: boolean };

/** The answer to a question: true or false, or the indexes of the chosen options of a QCM. */
export type QuizAnswerValue = boolean | number[];

export const LETTERS = "ABCDEFGH";
/** « B » or « A et C ». */
export const lettersOf = (choice: number[]) => {
  const l = choice.map((i) => LETTERS[i] ?? "?");
  return l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} et ${l[l.length - 1]}`;
};

/**
 * The options a student named, as indexes: letters (« B », « a et c », « réponse D ») or numbers from 1 (« 2 »);
 * undefined when nothing in range was found.
 */
export function parseChoice(text: string, count: number): number[] | undefined {
  const found = new Set<number>();
  // An elided letter (« c'est », « d'accord ») is not an option.
  const plain = text.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b[A-Z]['’]/g, " ");
  for (const token of plain.split(/[^A-Z0-9]+/)) {
    if (/^[A-H]$/.test(token)) found.add(LETTERS.indexOf(token));
    else if (/^[1-8]$/.test(token)) found.add(Number(token) - 1);
  }
  const choice = [...found].filter((i) => i >= 0 && i < count).sort((a, b) => a - b);
  return choice.length > 0 ? choice : undefined;
}

export interface Attempt {
  id: number;
  quizId: number;
  mode: AttemptMode;
  startedAt: Date;
  finishedAt?: Date;
  total: number;
  answered: number;
  score: number;
}

export interface AnswerRecord {
  questionId: number;
  position: number;
  statement: string;
  /** True/false question: the right answer. */
  expected?: boolean;
  /** True/false question: the student's answer; absent when the attempt was finished without answering. */
  answer?: boolean;
  /** Multiple-choice question: the options, the right ones and the student's choice (absent when not answered). */
  options?: string[];
  expectedChoice?: number[];
  choice?: number[];
  correct: boolean;
  explanation?: string;
  source?: string;
  topic?: string;
}

export interface AttemptResult {
  attempt: Attempt;
  quiz: { id: number; title: string; course?: string };
  answers: AnswerRecord[];
  mistakes: AnswerRecord[];
}

const toSummary = (r: Record<string, unknown>): QuizSummary => ({
  id: Number(r.id),
  kind: Number(r.mcq_questions ?? 0) === 0 ? "truefalse" : Number(r.mcq_questions) === Number(r.questions ?? 0) ? "mcq" : "mixed",
  course: (r.course as string | null) ?? undefined,
  title: r.title as string,
  description: (r.description as string | null) ?? undefined,
  createdAt: r.created_at as Date,
  questions: Number(r.questions ?? 0),
  attempts: Number(r.attempts ?? 0),
  last: r.last_attempt_id ? { attemptId: Number(r.last_attempt_id), score: Number(r.last_score), total: Number(r.last_total), finishedAt: r.last_finished_at as Date } : undefined,
  best: r.best_score === null || r.best_score === undefined ? undefined : { score: Number(r.best_score), total: Number(r.best_total) },
});

/** The rank of a question in an attempt: its place in the shuffled order of the attempt, else its place in the quiz. */
const ASKED_POSITION = "coalesce(array_position(a.question_order, q.id), q.position)";

const toQuestion = (r: Record<string, unknown>): Question => ({
  id: Number(r.id),
  quizId: Number(r.quiz_id),
  position: Number(r.asked_position ?? r.position),
  statement: r.statement as string,
  ...(r.options ? { options: r.options as string[], correct: (r.correct as number[] | null) ?? [] } : { answer: Boolean(r.answer) }),
  explanation: (r.explanation as string | null) ?? undefined,
  source: (r.source as string | null) ?? undefined,
  topic: (r.topic as string | null) ?? undefined,
  chapter: (r.chapter as string | null) ?? undefined,
  section: (r.section as string | null) ?? undefined,
});

const toAttempt = (r: Record<string, unknown>): Attempt => ({
  id: Number(r.id),
  quizId: Number(r.quiz_id),
  mode: r.mode as AttemptMode,
  startedAt: r.started_at as Date,
  finishedAt: (r.finished_at as Date | null) ?? undefined,
  total: Number(r.total),
  answered: Number(r.answered ?? 0),
  score: Number(r.score ?? r.correct_count ?? 0),
});

export const asked = (q: Question): AskedQuestion => ({
  id: q.id,
  position: q.position,
  statement: q.statement,
  topic: q.topic,
  ...(q.options ? { options: q.options, multiple: (q.correct?.length ?? 0) > 1 } : {}),
});

const SUMMARY_COLUMNS = `q.*,
  (SELECT count(*) FROM quiz_questions x WHERE x.quiz_id = q.id)::int AS questions,
  (SELECT count(*) FROM quiz_questions x WHERE x.quiz_id = q.id AND x.options IS NOT NULL)::int AS mcq_questions,
  (SELECT count(*) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.finished_at IS NOT NULL)::int AS attempts,
  l.id AS last_attempt_id, l.score AS last_score, l.total AS last_total, l.finished_at AS last_finished_at,
  b.score AS best_score, b.total AS best_total`;
const SUMMARY_JOINS = `
  LEFT JOIN LATERAL (SELECT id, score, total, finished_at FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1) l ON true
  LEFT JOIN LATERAL (SELECT score, total FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.finished_at IS NOT NULL ORDER BY score::float / greatest(total, 1) DESC, finished_at DESC LIMIT 1) b ON true`;

export async function listQuizzes(db: Db, course?: string): Promise<QuizSummary[]> {
  const { rows } = await db.query(`SELECT ${SUMMARY_COLUMNS} FROM quizzes q ${SUMMARY_JOINS} WHERE $1::text IS NULL OR lower(q.course) = lower($1) ORDER BY q.created_at DESC`, [course ?? null]);
  return rows.map(toSummary);
}

export async function getQuiz(db: Db, id: number): Promise<(QuizSummary & { questionList: Question[] }) | undefined> {
  const { rows } = await db.query(`SELECT ${SUMMARY_COLUMNS} FROM quizzes q ${SUMMARY_JOINS} WHERE q.id = $1`, [id]);
  if (!rows[0]) return undefined;
  const questions = await db.query("SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY position, id", [id]);
  return { ...toSummary(rows[0]), questionList: questions.rows.map(toQuestion) };
}

function checkQuestion(q: QuestionInput, index: number): QuestionInput {
  const where = `question ${index + 1}`;
  const statement = q.statement?.trim();
  if (!statement || statement.length > 1000) throw new Error(`${where}: statement must be 1 to 1000 characters`);
  const common = { statement, explanation: q.explanation?.trim() || undefined, source: q.source?.trim() || undefined, topic: q.topic?.trim() || undefined, chapter: q.chapter?.trim() || undefined, section: q.section?.trim() || undefined };
  if (q.options !== undefined) {
    const options = q.options.map((o) => (typeof o === "string" ? o.trim() : ""));
    if (options.length < 2 || options.length > LETTERS.length) throw new Error(`${where}: a QCM has 2 to ${LETTERS.length} options`);
    if (options.some((o) => !o || o.length > 500)) throw new Error(`${where}: every option must be 1 to 500 characters`);
    // Letters (« B ») are accepted too, as in a JSON file written by hand or by the agent.
    const correct = [...new Set((q.correct ?? []).map((c) => (typeof c === "string" ? LETTERS.indexOf((c as string).trim().toUpperCase()) : c)))].sort((a, b) => a - b);
    if (correct.length === 0 || correct.some((i) => !Number.isInteger(i) || i < 0 || i >= options.length)) throw new Error(`${where}: correct must list the indexes (from 0) of the right options`);
    return { ...common, options, correct };
  }
  if (typeof q.answer !== "boolean") throw new Error(`${where}: answer must be true or false, or give options and correct for a QCM`);
  return { ...common, answer: q.answer };
}

export async function createQuiz(db: Db, input: { title: string; course?: string; description?: string }, questions: QuestionInput[]): Promise<QuizSummary & { questionList: Question[] }> {
  if (!input.title.trim()) throw new Error("title is required");
  if (questions.length === 0) throw new Error("a quiz needs at least one question");
  const checked = questions.map(checkQuestion);
  const { rows } = await db.query("INSERT INTO quizzes (title, course, description) VALUES ($1, $2, $3) RETURNING id", [input.title.trim(), input.course?.trim() || null, input.description?.trim() || null]);
  const id = Number(rows[0].id);
  for (const [i, q] of checked.entries()) {
    await db.query("INSERT INTO quiz_questions (quiz_id, position, statement, answer, explanation, source, topic, chapter, section, options, correct) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", [
      id,
      i + 1,
      q.statement,
      q.answer ?? null,
      q.explanation ?? null,
      q.source ?? null,
      q.topic ?? null,
      q.chapter ?? null,
      q.section ?? null,
      q.options ?? null,
      q.correct ?? null,
    ]);
  }
  return (await getQuiz(db, id))!;
}

/** An answer of the last finished attempt of a quiz, with what the question says about its chapter: the profile's input. */
export interface QuizAnswer {
  course?: string;
  quizId: number;
  chapter?: string;
  section?: string;
  topic?: string;
  statement: string;
  source?: string;
  correct: boolean;
}

/** The answers of the last finished attempt of every quiz (of a course), so that retaking a quiz replaces its weight in the profile. */
export async function latestQuizAnswers(db: Db, course?: string): Promise<QuizAnswer[]> {
  const { rows } = await db.query(
    `SELECT z.course, z.id AS quiz_id, q.chapter, q.section, q.topic, q.statement, q.source, x.correct
     FROM quizzes z
     JOIN LATERAL (SELECT id FROM quiz_attempts a WHERE a.quiz_id = z.id AND a.finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1) l ON true
     JOIN quiz_answers x ON x.attempt_id = l.id
     JOIN quiz_questions q ON q.id = x.question_id
     WHERE $1::text IS NULL OR lower(z.course) = lower($1)`,
    [course ?? null],
  );
  return rows.map((r) => ({
    course: (r.course as string | null) ?? undefined,
    quizId: Number(r.quiz_id),
    chapter: (r.chapter as string | null) ?? undefined,
    section: (r.section as string | null) ?? undefined,
    topic: (r.topic as string | null) ?? undefined,
    statement: r.statement as string,
    source: (r.source as string | null) ?? undefined,
    correct: Boolean(r.correct),
  }));
}

export async function deleteQuiz(db: Db, id: number): Promise<boolean> {
  const { rowCount } = await db.query("DELETE FROM quizzes WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

const ATTEMPT_COLUMNS = `a.*, (SELECT count(*) FROM quiz_answers x WHERE x.attempt_id = a.id)::int AS answered,
  (SELECT count(*) FROM quiz_answers x WHERE x.attempt_id = a.id AND x.correct)::int AS correct_count`;

export async function getAttempt(db: Db, id: number): Promise<Attempt | undefined> {
  const { rows } = await db.query(`SELECT ${ATTEMPT_COLUMNS} FROM quiz_attempts a WHERE a.id = $1`, [id]);
  return rows[0] ? toAttempt(rows[0]) : undefined;
}

/** The first question of the attempt not answered yet, in the order of the attempt. */
async function nextQuestion(db: Db, attemptId: number): Promise<Question | undefined> {
  const { rows } = await db.query(
    `SELECT q.*, ${ASKED_POSITION} AS asked_position FROM quiz_questions q JOIN quiz_attempts a ON a.quiz_id = q.quiz_id
     WHERE a.id = $1 AND NOT EXISTS (SELECT 1 FROM quiz_answers x WHERE x.attempt_id = a.id AND x.question_id = q.id)
     ORDER BY ${ASKED_POSITION}, q.id LIMIT 1`,
    [attemptId],
  );
  return rows[0] ? toQuestion(rows[0]) : undefined;
}

export interface Progress {
  attempt: Attempt;
  next?: AskedQuestion;
  /** Present once the last question is answered: the attempt is finished. */
  result?: AttemptResult;
}

/** A copy of the list in a random order (Fisher-Yates). */
function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Starts an attempt, asking the questions in the quiz order or, with `shuffle`, in a random order kept for the attempt. */
export async function startAttempt(db: Db, quizId: number, mode: AttemptMode = "web", options: { shuffle?: boolean } = {}): Promise<Progress> {
  const quiz = await getQuiz(db, quizId);
  if (!quiz) throw new Error(`No quiz ${quizId}`);
  const questions = options.shuffle ? shuffled(quiz.questionList) : quiz.questionList;
  const { rows } = await db.query("INSERT INTO quiz_attempts (quiz_id, mode, total, question_order) VALUES ($1, $2, $3, $4) RETURNING id", [
    quizId,
    mode,
    questions.length,
    options.shuffle ? questions.map((q) => q.id) : null,
  ]);
  const attempt = (await getAttempt(db, Number(rows[0].id)))!;
  return { attempt, next: asked({ ...questions[0], position: 1 }) };
}

/**
 * Records an answer, true/false or the chosen options of a QCM (right when exactly the right options are chosen);
 * `questionId` defaults to the next unanswered question (the voice flow never repeats ids).
 */
export async function answerQuestion(
  db: Db,
  attemptId: number,
  answer: QuizAnswerValue,
  questionId?: number,
): Promise<Progress & { correct: boolean; expected?: boolean; expectedChoice?: number[]; explanation?: string }> {
  const attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new Error(`No attempt ${attemptId}`);
  if (attempt.finishedAt) throw new Error("This attempt is finished");
  let question: Question | undefined;
  if (questionId === undefined) question = await nextQuestion(db, attemptId);
  else {
    const { rows } = await db.query(`SELECT q.*, ${ASKED_POSITION} AS asked_position FROM quiz_questions q JOIN quiz_attempts a ON a.quiz_id = q.quiz_id WHERE a.id = $1 AND q.id = $2`, [attemptId, questionId]);
    question = rows[0] ? toQuestion(rows[0]) : undefined;
  }
  if (!question) throw new Error(questionId === undefined ? "Every question is answered" : `No question ${questionId} in this quiz`);
  let correct: boolean;
  let choice: number[] | null = null;
  if (question.options) {
    if (!Array.isArray(answer)) throw new Error(`Question ${question.id} is a QCM: answer with the chosen options`);
    choice = [...new Set(answer)].sort((a, b) => a - b);
    if (choice.length === 0 || choice.some((i) => !Number.isInteger(i) || i < 0 || i >= question.options!.length)) throw new Error(`Question ${question.id} has options ${lettersOf(question.options.map((_, i) => i))}`);
    const expected = question.correct ?? [];
    correct = choice.length === expected.length && choice.every((c, i) => c === expected[i]);
  } else {
    if (typeof answer !== "boolean") throw new Error(`Question ${question.id} is true or false`);
    correct = question.answer === answer;
  }
  const { rowCount } = await db.query("INSERT INTO quiz_answers (attempt_id, question_id, answer, choice, correct) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING", [
    attemptId,
    question.id,
    typeof answer === "boolean" ? answer : null,
    choice,
    correct,
  ]);
  if ((rowCount ?? 0) === 0) throw new Error(`Question ${question.id} is already answered in this attempt`);
  const next = await nextQuestion(db, attemptId);
  const progress: Progress = { attempt: (await getAttempt(db, attemptId))!, next: next ? asked(next) : undefined };
  if (!next) progress.result = await finishAttempt(db, attemptId);
  return { ...progress, correct, expected: question.answer, expectedChoice: question.correct, explanation: question.explanation };
}

/** Closes an attempt (unanswered questions count as wrong) and gives the result. */
export async function finishAttempt(db: Db, attemptId: number): Promise<AttemptResult> {
  await db.query(
    `UPDATE quiz_attempts SET finished_at = coalesce(finished_at, now()), score = (SELECT count(*) FROM quiz_answers x WHERE x.attempt_id = $1 AND x.correct) WHERE id = $1`,
    [attemptId],
  );
  const result = await attemptResult(db, attemptId);
  if (!result) throw new Error(`No attempt ${attemptId}`);
  return result;
}

export async function attemptResult(db: Db, attemptId: number): Promise<AttemptResult | undefined> {
  const attempt = await getAttempt(db, attemptId);
  if (!attempt) return undefined;
  const { rows: quizRows } = await db.query("SELECT id, title, course FROM quizzes WHERE id = $1", [attempt.quizId]);
  const { rows } = await db.query(
    `SELECT q.id, ${ASKED_POSITION} AS position, q.statement, q.answer AS expected, q.options, q.correct AS expected_choice, q.explanation, q.source, q.topic,
            x.answer, x.choice, x.correct, x.attempt_id IS NOT NULL AS answered
     FROM quiz_questions q JOIN quiz_attempts a ON a.id = $1 LEFT JOIN quiz_answers x ON x.question_id = q.id AND x.attempt_id = a.id
     WHERE q.quiz_id = a.quiz_id ORDER BY ${ASKED_POSITION}, q.id`,
    [attemptId],
  );
  const answers: AnswerRecord[] = rows.map((r) => ({
    questionId: Number(r.id),
    position: Number(r.position),
    statement: r.statement as string,
    ...(r.options
      ? { options: r.options as string[], expectedChoice: (r.expected_choice as number[] | null) ?? [], choice: r.answered ? ((r.choice as number[] | null) ?? []) : undefined }
      : { expected: Boolean(r.expected), answer: r.answer === null || r.answer === undefined ? undefined : Boolean(r.answer) }),
    correct: Boolean(r.correct),
    explanation: (r.explanation as string | null) ?? undefined,
    source: (r.source as string | null) ?? undefined,
    topic: (r.topic as string | null) ?? undefined,
  }));
  return {
    attempt,
    quiz: { id: Number(quizRows[0].id), title: quizRows[0].title as string, course: (quizRows[0].course as string | null) ?? undefined },
    answers,
    mistakes: answers.filter((a) => !a.correct),
  };
}

export async function listAttempts(db: Db, quizId: number): Promise<Attempt[]> {
  const { rows } = await db.query(`SELECT ${ATTEMPT_COLUMNS} FROM quiz_attempts a WHERE a.quiz_id = $1 ORDER BY a.started_at DESC`, [quizId]);
  return rows.map(toAttempt);
}

type SpokenAnswer = Pick<AnswerRecord, "position" | "statement" | "expected" | "answer" | "options" | "expectedChoice" | "choice" | "explanation" | "source">;

/** The right answer of a mistake as a sentence: « est faux », or « la bonne réponse est B : … ». */
export function rightAnswer(m: SpokenAnswer): string {
  if (!m.options) return `« ${m.statement} » est ${m.expected ? "vrai" : "faux"}${m.answer === undefined ? " (sans réponse)" : ""}.`;
  const right = m.expectedChoice ?? [];
  const said = m.choice === undefined ? "sans réponse" : `répondu ${lettersOf(m.choice)}`;
  return `« ${m.statement} » : ${right.length > 1 ? "les bonnes réponses sont" : "la bonne réponse est"} ${right.map((i) => `${LETTERS[i]}, « ${m.options![i]} »`).join(", et ")} (${said}).`;
}

/** A result as a few spoken lines: the score, then each mistake with the right answer and why. */
export function speakResult(result: { attempt: { score: number; total: number }; mistakes: SpokenAnswer[] }): string {
  const { attempt, mistakes } = result;
  const lines = [`Score : ${attempt.score} sur ${attempt.total}.`];
  if (mistakes.length === 0) lines.push("Aucune erreur.");
  else {
    lines.push(`${mistakes.length} erreur${mistakes.length > 1 ? "s" : ""} :`);
    for (const m of mistakes) lines.push(`${m.position}. ${rightAnswer(m)}${m.explanation ? ` ${m.explanation}` : ""}${m.source ? ` (${m.source})` : ""}`);
  }
  return lines.join("\n");
}
