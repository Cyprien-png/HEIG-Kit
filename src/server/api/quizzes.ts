import { type AttemptMode, type QuestionInput, answerQuestion, attemptResult, createQuiz, deleteQuiz, finishAttempt, getQuiz, listAttempts, listQuizzes, startAttempt } from "../../app/quizzes.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { HttpError, intParam, readJson, stringField } from "./util.js";

const MAX_QUESTIONS = 200;
const MODES: AttemptMode[] = ["web", "voice", "cli"];

function questionFrom(value: unknown, index: number): QuestionInput {
  if (!value || typeof value !== "object") throw new HttpError(400, `question ${index + 1} must be an object`);
  const body = value as Record<string, unknown>;
  if (typeof body.answer !== "boolean") throw new HttpError(400, `question ${index + 1}: answer must be true or false`);
  return {
    statement: stringField(body, "statement", { max: 1000 })!,
    answer: body.answer,
    explanation: stringField(body, "explanation", { optional: true, max: 2000 }),
    source: stringField(body, "source", { optional: true, max: 300 }),
    topic: stringField(body, "topic", { optional: true, max: 100 }),
    chapter: stringField(body, "chapter", { optional: true, max: 200 }),
    section: stringField(body, "section", { optional: true, max: 200 }),
  };
}

/** Domain errors as HTTP answers. */
async function domain<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(/^No (quiz|attempt|question)/.test(message) ? 404 : 400, message);
  }
}

export function registerQuizRoutes(router: Router, app: App): void {
  router.get("/api/quizzes", async ({ url }) => ({ quizzes: await listQuizzes(app.db, url.searchParams.get("course") ?? undefined) }));

  router.post("/api/quizzes", async ({ req }) => {
    const body = await readJson(req);
    const questions = Array.isArray(body.questions) ? body.questions : [];
    if (questions.length === 0 || questions.length > MAX_QUESTIONS) throw new HttpError(400, `between 1 and ${MAX_QUESTIONS} questions`);
    return domain(() =>
      createQuiz(
        app.db,
        { title: stringField(body, "title", { max: 200 })!, course: stringField(body, "course", { optional: true, max: 40 }), description: stringField(body, "description", { optional: true, max: 2000 }) },
        questions.map(questionFrom),
      ),
    );
  });

  router.get("/api/quizzes/:id", async ({ params }) => {
    const quiz = await getQuiz(app.db, intParam(params.id, "id"));
    if (!quiz) throw new HttpError(404, "no such quiz");
    return quiz;
  });

  router.delete("/api/quizzes/:id", async ({ params }) => {
    if (!(await deleteQuiz(app.db, intParam(params.id, "id")))) throw new HttpError(404, "no such quiz");
    return undefined;
  });

  router.get("/api/quizzes/:id/attempts", async ({ params }) => ({ attempts: await listAttempts(app.db, intParam(params.id, "id")) }));

  router.post("/api/quizzes/:id/attempts", async ({ req, params }) => {
    const body = await readJson(req);
    const mode = stringField(body, "mode", { optional: true }) ?? "web";
    if (!MODES.includes(mode as AttemptMode)) throw new HttpError(400, `mode must be one of ${MODES.join(", ")}`);
    if (body.shuffle !== undefined && typeof body.shuffle !== "boolean") throw new HttpError(400, "shuffle must be true or false");
    return domain(() => startAttempt(app.db, intParam(params.id, "id"), mode as AttemptMode, { shuffle: body.shuffle === true }));
  });

  router.get("/api/quiz-attempts/:id", async ({ params }) => {
    const result = await attemptResult(app.db, intParam(params.id, "id"));
    if (!result) throw new HttpError(404, "no such attempt");
    return result;
  });

  router.post("/api/quiz-attempts/:id/answers", async ({ req, params }) => {
    const body = await readJson(req);
    if (typeof body.answer !== "boolean") throw new HttpError(400, "answer must be true or false");
    const questionId = body.questionId === undefined ? undefined : intParam(String(body.questionId), "questionId");
    return domain(() => answerQuestion(app.db, intParam(params.id, "id"), body.answer as boolean, questionId));
  });

  router.post("/api/quiz-attempts/:id/finish", async ({ params }) => domain(() => finishAttempt(app.db, intParam(params.id, "id"))));
}
