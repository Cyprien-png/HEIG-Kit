/**
 * True/false quizzes: the agent writes the statements from the course material, the student answers them one by one
 * (a swipe on the web app, a word aloud with a voice assistant through the MCP tools, y/n in the terminal) and gets
 * a score and the list of mistakes at the end. Each attempt keeps its answers, so a quiz can be redone.
 */
import type { Db } from "../rag/db.js";

export type AttemptMode = "web" | "voice" | "cli";

export interface QuizSummary {
  id: number;
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
  /** A statement that is true or false, written to be read aloud (no formula the voice cannot say). */
  statement: string;
  answer: boolean;
  /** Why, in one or two sentences, with the course's words. */
  explanation?: string;
  source?: string;
  topic?: string;
}

export interface Question extends QuestionInput {
  id: number;
  quizId: number;
  position: number;
}

/** A question as shown while answering: without its answer. */
export type AskedQuestion = Pick<Question, "id" | "position" | "statement" | "topic">;

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
  expected: boolean;
  /** The student's answer; absent when the attempt was finished without answering. */
  answer?: boolean;
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
  answer: Boolean(r.answer),
  explanation: (r.explanation as string | null) ?? undefined,
  source: (r.source as string | null) ?? undefined,
  topic: (r.topic as string | null) ?? undefined,
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

export const asked = (q: Question): AskedQuestion => ({ id: q.id, position: q.position, statement: q.statement, topic: q.topic });

const SUMMARY_COLUMNS = `q.*,
  (SELECT count(*) FROM quiz_questions x WHERE x.quiz_id = q.id)::int AS questions,
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
  const statement = q.statement?.trim();
  if (!statement || statement.length > 1000) throw new Error(`question ${index + 1}: statement must be 1 to 1000 characters`);
  if (typeof q.answer !== "boolean") throw new Error(`question ${index + 1}: answer must be true or false`);
  return { statement, answer: q.answer, explanation: q.explanation?.trim() || undefined, source: q.source?.trim() || undefined, topic: q.topic?.trim() || undefined };
}

export async function createQuiz(db: Db, input: { title: string; course?: string; description?: string }, questions: QuestionInput[]): Promise<QuizSummary & { questionList: Question[] }> {
  if (!input.title.trim()) throw new Error("title is required");
  if (questions.length === 0) throw new Error("a quiz needs at least one question");
  const checked = questions.map(checkQuestion);
  const { rows } = await db.query("INSERT INTO quizzes (title, course, description) VALUES ($1, $2, $3) RETURNING id", [input.title.trim(), input.course?.trim() || null, input.description?.trim() || null]);
  const id = Number(rows[0].id);
  for (const [i, q] of checked.entries()) {
    await db.query("INSERT INTO quiz_questions (quiz_id, position, statement, answer, explanation, source, topic) VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, i + 1, q.statement, q.answer, q.explanation ?? null, q.source ?? null, q.topic ?? null]);
  }
  return (await getQuiz(db, id))!;
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

/** Records an answer; `questionId` defaults to the next unanswered question (the voice flow never repeats ids). */
export async function answerQuestion(db: Db, attemptId: number, answer: boolean, questionId?: number): Promise<Progress & { correct: boolean; expected: boolean; explanation?: string }> {
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
  const correct = question.answer === answer;
  const { rowCount } = await db.query("INSERT INTO quiz_answers (attempt_id, question_id, answer, correct) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [attemptId, question.id, answer, correct]);
  if ((rowCount ?? 0) === 0) throw new Error(`Question ${question.id} is already answered in this attempt`);
  const next = await nextQuestion(db, attemptId);
  const progress: Progress = { attempt: (await getAttempt(db, attemptId))!, next: next ? asked(next) : undefined };
  if (!next) progress.result = await finishAttempt(db, attemptId);
  return { ...progress, correct, expected: question.answer, explanation: question.explanation };
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
    `SELECT q.id, ${ASKED_POSITION} AS position, q.statement, q.answer AS expected, q.explanation, q.source, q.topic, x.answer, x.correct
     FROM quiz_questions q JOIN quiz_attempts a ON a.id = $1 LEFT JOIN quiz_answers x ON x.question_id = q.id AND x.attempt_id = a.id
     WHERE q.quiz_id = a.quiz_id ORDER BY ${ASKED_POSITION}, q.id`,
    [attemptId],
  );
  const answers: AnswerRecord[] = rows.map((r) => ({
    questionId: Number(r.id),
    position: Number(r.position),
    statement: r.statement as string,
    expected: Boolean(r.expected),
    answer: r.answer === null || r.answer === undefined ? undefined : Boolean(r.answer),
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

/** A result as a few spoken lines: the score, then each mistake with the right answer and why. */
export function speakResult(result: AttemptResult): string {
  const { attempt, mistakes } = result;
  const lines = [`Score : ${attempt.score} sur ${attempt.total}.`];
  if (mistakes.length === 0) lines.push("Aucune erreur.");
  else {
    lines.push(`${mistakes.length} erreur${mistakes.length > 1 ? "s" : ""} :`);
    for (const m of mistakes) lines.push(`${m.position}. « ${m.statement} » est ${m.expected ? "vrai" : "faux"}${m.answer === undefined ? " (sans réponse)" : ""}.${m.explanation ? ` ${m.explanation}` : ""}${m.source ? ` (${m.source})` : ""}`);
  }
  return lines.join("\n");
}
