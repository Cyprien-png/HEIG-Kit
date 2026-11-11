/**
 * Quiz tools (docs/app.md), true/false statements and multiple-choice questions (QCM): the agent writes a quiz from the
 * course material, then runs it with the student one question at a time. Designed for a voice assistant: short answers, one question per call, the next question
 * comes back with the record of the previous answer, and the final result is a few spoken lines.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HeigApi } from "../../app/api.js";
import { LETTERS, lettersOf, parseChoice, speakResult } from "../../app/quizzes.js";
import { respond, REUSE_RULE, reuseInput, reuseOf } from "../common.js";

const questionSchema = z.object({
  statement: z.string().describe("A statement that is true or false, or the question of a QCM; written to be read aloud: no formula, no symbol the voice cannot say"),
  answer: z.boolean().optional().describe("True/false question: whether the statement is true"),
  options: z.array(z.string()).min(2).max(8).optional().describe("QCM: the options, 3 or 4 in general, short, read with their letters A, B, C…; plausible wrong ones taken from the course's real pitfalls"),
  correct: z.array(z.string()).min(1).optional().describe("QCM: the letters of the right options, e.g. ['B'] or ['A', 'D'] (several only when the question says so)"),
  explanation: z.string().optional().describe("Why, in one or two sentences, with the course's words"),
  source: z.string().optional().describe("e.g. 'Cours RXI ch. 4 p. 12'"),
  topic: z.string().optional().describe("Short reusable topic, e.g. 'trame Ethernet'"),
  chapter: z.string().optional().describe("Chapter of the course as set_course_chapters names it (title or number, e.g. '2. Relations' or '2'): the answer then counts in the profile's chapter status"),
  section: z.string().optional().describe("Section of that chapter (title or number, e.g. 'Relation d'ordre' or '2.3')"),
});

const VOICE_RULES =
  "Voice protocol: read the statement exactly as returned; for a QCM, then read each option with its letter (« A : … ») and say " +
  "whether one or several answers are expected. Wait for the student's answer (vrai/faux, oui/non for a statement; the letter or letters for a QCM). " +
  "Never reveal or hint at the answer before the end. Do not comment between questions beyond a short acknowledgement. " +
  "When the result comes back, read the score, then every mistake one by one with its explanation.";


const question = (q: { id: number; position: number; statement: string; options?: string[]; multiple?: boolean }, total: number) =>
  q.options
    ? `Question ${q.position}/${total} (id ${q.id}), QCM, ${q.multiple ? "plusieurs réponses possibles" : "une seule réponse"} : ${q.statement}\n${q.options.map((o, i) => `${LETTERS[i]} : ${o}`).join("\n")}`
    : `Question ${q.position}/${total} (id ${q.id}), vrai ou faux : ${q.statement}`;

export function registerQuizTools(server: McpServer, api: HeigApi): void {
  server.registerTool(
    "list_quizzes",
    {
      title: "Quizzes",
      description:
        "The quizzes of the server (true/false, QCM or both), shared by every account (each says who made it), with their number of questions and the student's own last score; " +
        "with quiz_id, the full quiz with its answers (never read those aloud during a quiz). Call it before creating a quiz.",
      inputSchema: { course: z.string().optional(), quiz_id: z.number().int().optional(), mine: z.boolean().optional().describe("Only the quizzes this account created") },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      respond(async () => {
        if (a.quiz_id !== undefined) {
          const quiz = await api.quiz(a.quiz_id);
          if (!quiz) return `No quiz ${a.quiz_id}`;
          return `[${quiz.id}] ${quiz.course ? `${quiz.course} · ` : ""}${quiz.title}\n${quiz.questionList
            .map((q) => `${q.position}. ${q.statement}${q.options ? `\n${q.options.map((o, i) => `   ${LETTERS[i]}. ${o}`).join("\n")}\n   → ${lettersOf(q.correct ?? [])}` : ` → ${q.answer ? "VRAI" : "FAUX"}`}${q.explanation ? ` · ${q.explanation}` : ""}${q.source ? ` (${q.source})` : ""}`)
            .join("\n")}`;
        }
        const quizzes = (await api.quizzes(a.course)).filter((q) => !a.mine || q.mine);
        if (quizzes.length === 0) return "No quizzes yet. Create one with create_quiz from the course material.";
        return quizzes.map((q) => `[${q.id}] ${q.course ? `${q.course} · ` : ""}${q.title}${q.mine ? "" : q.author ? ` — by ${q.author}` : ""} (${q.kind === "mcq" ? "QCM" : q.kind === "mixed" ? "vrai/faux et QCM" : "vrai/faux"}): ${q.questions} questions, ${q.attempts} attempt${q.attempts === 1 ? "" : "s"}${q.last ? `, last ${q.last.score}/${q.last.total}` : ""}${q.best ? `, best ${q.best.score}/${q.best.total}` : ""}`).join("\n");
      }),
  );

  server.registerTool(
    "create_quiz",
    {
      title: "Create a quiz (true/false or QCM)",
      description:
        "Creates a quiz from the course material (search it first): as many questions as the material calls for (10 at least, a hundred or more for several chapters). " +
        "A true/false question has `answer`; about half true and half false, false ones built on the real pitfalls of the course (swapped definitions, off-by-one values, inverted conditions). " +
        "A QCM question (when the student asks for a QCM, or to vary) has `options` (3 or 4, short) and `correct` (the letters of the right ones; " +
        "several only if the statement says « plusieurs réponses »); wrong options are the course's real pitfalls and the right letter changes from one question to the next. " +
        "Both kinds can be mixed in one quiz. Each question has an explanation and a source. Statements must read well aloud: spell units and symbols out, no LaTeX; a quiz meant for the " +
        `screen only may use LaTeX, a Markdown table or a small \`\`\`mermaid / \`\`\`svg figure in a statement. Quizzes are shared: call list_quizzes first. ${REUSE_RULE}`,
      inputSchema: {
        title: z.string(),
        course: z.string().optional().describe("Course code, e.g. RXI"),
        description: z.string().optional().describe("What it covers, e.g. 'Chapitres 2 à 4, quiz de classe'"),
        questions: z.array(questionSchema).min(1),
        ...reuseInput,
      },
    },
    async (a) =>
      respond(async () => {
        const questions = a.questions.map((q, i) => {
          if (!q.options) return { ...q, correct: undefined };
          const correct = (q.correct ?? []).map((l) => LETTERS.indexOf(l.trim().toUpperCase()));
          if (correct.length === 0 || correct.some((c) => c < 0 || c >= q.options!.length)) throw new Error(`question ${i + 1}: correct must be letters among ${lettersOf(q.options.map((_, j) => j))}`);
          return { ...q, correct };
        });
        const quiz = await api.createQuiz({ title: a.title, course: a.course, description: a.description, reuse: reuseOf(a) }, questions);
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
        answer: z.boolean().optional().describe("True/false question: true for vrai/oui, false for faux/non"),
        choice: z.string().optional().describe("QCM: the letter or letters the student said, e.g. 'B' or 'A et C'"),
        question_id: z.number().int().optional().describe("Defaults to the current question; pass it to be safe when the student skipped back"),
      },
    },
    async (a) =>
      respond(async () => {
        let value: boolean | number[];
        if (a.choice !== undefined) {
          const choice = parseChoice(a.choice, 8);
          if (!choice) throw new Error(`No option letter in « ${a.choice} »: ask the student again`);
          value = choice;
        } else if (a.answer !== undefined) value = a.answer;
        else throw new Error("Give answer (true/false) or choice (QCM letters)");
        const r = await api.answerQuiz(a.attempt_id, value, a.question_id);
        const silent = `(recorded: ${r.correct ? "correct" : "wrong"}, keep it for the end)`;
        if (r.result) return `Last answer ${silent}. The quiz is finished.\n${speakResult(r.result)}`;
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
        return speakResult(result);
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
      description: "Run a quiz (true/false or QCM) with the student by voice, in the car or away from a screen.",
      argsSchema: { quiz: z.string().describe("Quiz id or title; or a course to make a new quiz on").optional() },
    },
    ({ quiz }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Fais-moi passer un quiz à l'oral${quiz ? ` : ${quiz}` : ""}. Si le quiz n'existe pas encore, crée-le avec create_quiz à partir de mon matériel de cours (search_course_material), ` +
              "puis start_quiz. Lis chaque question telle quelle (pour un QCM, chaque option avec sa lettre), attends ma réponse (vrai ou faux, ou la lettre), enregistre-la avec answer_quiz et enchaîne sans commenter. " +
              "Ne révèle jamais une réponse avant la fin. À la fin, donne-moi ma note, puis reprends mes erreurs une par une : l'affirmation, la bonne réponse, et pourquoi.",
          },
        },
      ],
    }),
  );
}
