/**
 * True/false quiz tools (docs/app.md): the agent writes a quiz from the course material, then runs it with the student
 * one statement at a time. Designed for a voice assistant: short answers, one question per call, the next question
 * comes back with the record of the previous answer, and the final result is a few spoken lines.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HeigApi, QuizResult } from "../../app/api.js";
import { respond } from "../common.js";

const questionSchema = z.object({
  statement: z.string().describe("A statement that is true or false, written to be read aloud: no formula, no symbol the voice cannot say"),
  answer: z.boolean(),
  explanation: z.string().optional().describe("Why, in one or two sentences, with the course's words"),
  source: z.string().optional().describe("e.g. 'Cours RXI ch. 4 p. 12'"),
  topic: z.string().optional().describe("Short reusable topic, e.g. 'trame Ethernet'"),
});

const VOICE_RULES =
  "Voice protocol: read the statement exactly as returned, then wait for the student's answer (vrai/faux, oui/non, true/false). " +
  "Never reveal or hint at the answer before the end. Do not comment between questions beyond a short acknowledgement. " +
  "When the result comes back, read the score, then every mistake one by one with its explanation.";

function speak(result: QuizResult): string {
  const { attempt, mistakes } = result;
  const lines = [`Score : ${attempt.score} sur ${attempt.total}.`];
  if (mistakes.length === 0) lines.push("Aucune erreur.");
  else {
    lines.push(`${mistakes.length} erreur${mistakes.length > 1 ? "s" : ""} :`);
    for (const m of mistakes) lines.push(`${m.position}. « ${m.statement} » est ${m.expected ? "vrai" : "faux"}${m.answer === undefined ? " (sans réponse)" : ""}.${m.explanation ? ` ${m.explanation}` : ""}${m.source ? ` (${m.source})` : ""}`);
  }
  return lines.join("\n");
}

const question = (q: { id: number; position: number; statement: string }, total: number) => `Question ${q.position}/${total} (id ${q.id}) : ${q.statement}`;

export function registerQuizTools(server: McpServer, api: HeigApi): void {
  server.registerTool(
    "list_quizzes",
    {
      title: "True/false quizzes",
      description: "The student's true/false quizzes with their number of questions and last score; with quiz_id, the full quiz with its answers (never read those aloud during a quiz).",
      inputSchema: { course: z.string().optional(), quiz_id: z.number().int().optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      respond(async () => {
        if (a.quiz_id !== undefined) {
          const quiz = await api.quiz(a.quiz_id);
          if (!quiz) return `No quiz ${a.quiz_id}`;
          return `[${quiz.id}] ${quiz.course ? `${quiz.course} · ` : ""}${quiz.title}\n${quiz.questionList.map((q) => `${q.position}. ${q.statement} → ${q.answer ? "VRAI" : "FAUX"}${q.explanation ? ` · ${q.explanation}` : ""}${q.source ? ` (${q.source})` : ""}`).join("\n")}`;
        }
        const quizzes = await api.quizzes(a.course);
        if (quizzes.length === 0) return "No quizzes yet. Create one with create_quiz from the course material.";
        return quizzes.map((q) => `[${q.id}] ${q.course ? `${q.course} · ` : ""}${q.title}: ${q.questions} questions, ${q.attempts} attempt${q.attempts === 1 ? "" : "s"}${q.last ? `, last ${q.last.score}/${q.last.total}` : ""}${q.best ? `, best ${q.best.score}/${q.best.total}` : ""}`).join("\n");
      }),
  );

  server.registerTool(
    "create_quiz",
    {
      title: "Create a true/false quiz",
      description:
        "Creates a true/false quiz from the course material (search it first): as many statements as the material calls for (10 at least, a hundred or more for several chapters), about half true and half false, " +
        "false ones built on the real pitfalls of the course (swapped definitions, off-by-one values, inverted conditions), each with " +
        "an explanation and a source. Statements must read well aloud: spell units and symbols out, no LaTeX; a quiz meant for the " +
        "screen only may use LaTeX, a Markdown table or a small ```mermaid / ```svg figure in a statement.",
      inputSchema: {
        title: z.string(),
        course: z.string().optional().describe("Course code, e.g. RXI"),
        description: z.string().optional().describe("What it covers, e.g. 'Chapitres 2 à 4, quiz de classe'"),
        questions: z.array(questionSchema).min(1),
      },
    },
    async (a) =>
      respond(async () => {
        const quiz = await api.createQuiz({ title: a.title, course: a.course, description: a.description }, a.questions);
        return `Quiz ${quiz.id} "${quiz.title}" created with ${quiz.questionList.length} questions. Start it with start_quiz, or on the web app's Quiz page.`;
      }),
  );

  server.registerTool(
    "start_quiz",
    {
      title: "Start a quiz",
      description: `Starts an attempt of a quiz and returns its first question. ${VOICE_RULES}`,
      inputSchema: {
        quiz_id: z.number().int(),
        mode: z.enum(["voice", "cli", "web"]).optional().describe("How the student answers; default voice"),
        shuffle: z.boolean().optional().describe("Ask the questions in a random order (for a quiz already done once)"),
      },
    },
    async (a) =>
      respond(async () => {
        const progress = await api.startQuiz(a.quiz_id, a.mode ?? "voice", a.shuffle ?? false);
        if (!progress.next) return `Attempt ${progress.attempt.id} started, but the quiz has no question.`;
        return `Attempt ${progress.attempt.id} started (${progress.attempt.total} questions). Answer each one with answer_quiz.\n${question(progress.next, progress.attempt.total)}`;
      }),
  );

  server.registerTool(
    "answer_quiz",
    {
      title: "Answer the current question",
      description:
        "Records the student's answer to the current question of an attempt and returns the next question, or the final result " +
        "after the last one (score, then each mistake with the right answer and its explanation). The answer's correctness is " +
        `returned but must not be read before the end. ${VOICE_RULES}`,
      inputSchema: {
        attempt_id: z.number().int(),
        answer: z.boolean().describe("true for vrai/oui, false for faux/non"),
        question_id: z.number().int().optional().describe("Defaults to the current question; pass it to be safe when the student skipped back"),
      },
    },
    async (a) =>
      respond(async () => {
        const r = await api.answerQuiz(a.attempt_id, a.answer, a.question_id);
        const silent = `(recorded: ${r.correct ? "correct" : "wrong"}, keep it for the end)`;
        if (r.result) return `Last answer ${silent}. The quiz is finished.\n${speak(r.result)}`;
        return `Answer ${silent}. ${r.attempt.answered}/${r.attempt.total} done.\n${question(r.next!, r.attempt.total)}`;
      }),
  );

  server.registerTool(
    "get_quiz_result",
    {
      title: "Result of a quiz attempt",
      description: "The score and mistakes of an attempt (finishes it first if questions remain, counting them as wrong), as lines to read aloud.",
      inputSchema: { attempt_id: z.number().int(), finish: z.boolean().optional().describe("Close the attempt even if questions remain (default true)") },
    },
    async (a) =>
      respond(async () => {
        const current = await api.quizResult(a.attempt_id);
        if (!current) return `No attempt ${a.attempt_id}`;
        const result = current.attempt.finishedAt || a.finish === false ? current : await api.finishQuiz(a.attempt_id);
        return speak(result);
      }),
  );

  server.registerTool(
    "delete_quiz",
    {
      title: "Delete a quiz",
      description: "Deletes a quiz with its attempts.",
      inputSchema: { quiz_id: z.number().int() },
      annotations: { destructiveHint: true },
    },
    async (a) => respond(async () => ((await api.deleteQuiz(a.quiz_id)) ? `Quiz ${a.quiz_id} deleted.` : `No quiz ${a.quiz_id}`)),
  );

  server.registerPrompt(
    "voice_quiz",
    {
      title: "Run a quiz aloud",
      description: "Run a true/false quiz with the student by voice, in the car or away from a screen.",
      argsSchema: { quiz: z.string().describe("Quiz id or title; or a course to make a new quiz on").optional() },
    },
    ({ quiz }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Fais-moi passer un quiz vrai/faux à l'oral${quiz ? ` : ${quiz}` : ""}. Si le quiz n'existe pas encore, crée-le avec create_quiz à partir de mon matériel de cours (search_course_material), ` +
              "puis start_quiz. Lis chaque affirmation telle quelle, attends ma réponse (vrai ou faux), enregistre-la avec answer_quiz et enchaîne sans commenter. " +
              "Ne révèle jamais une réponse avant la fin. À la fin, donne-moi ma note, puis reprends mes erreurs une par une : l'affirmation, la bonne réponse, et pourquoi.",
          },
        },
      ],
    }),
  );
}
