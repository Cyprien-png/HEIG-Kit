/**
 * The complete HEIG-Kit MCP server, run on the user's computer (it uses the saved login, the local programs and opens
 * files): timetables, GAPS, Cyberlearn, the course knowledge base, documents and animations, for any MCP client.
 *
 *   npm run -s mcp                 stdio (Claude Desktop, Claude Code, mcpo for Open WebUI…)
 *   npm run -s mcp -- --http       Streamable HTTP on http://127.0.0.1:8766/mcp, with the token of data/mcp-token
 *   npm run -s server              shared remote server: accounts (npm run users), isolated rendering, downloads (docs/server.md)
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DATA_DIR } from "../paths.js";
import { type User, identityOf, listUsers } from "../accounts/users.js";
import { type HeigApi, LocalApi, RemoteApi } from "../app/api.js";
import { adoptLibrary } from "../app/library.js";
import { LOCAL_OWNER, requireIdentity } from "../identity.js";
import { captureUrl } from "../app/corrections.js";
import { type KnowledgeBase, LocalKnowledge, RemoteKnowledge } from "../app/knowledge.js";
import { type CourseRepos, RemoteRepos } from "../app/repos.js";
import { migrate, openDb } from "../rag/db.js";
import { RemoteClient } from "../remote/client.js";
import { createApp } from "../server/app.js";
import { loadServerConfig } from "../server/config.js";
import { createRemoteServer } from "../server/http.js";
import { JobQueue } from "../server/jobs.js";
import { bindTools, serveHttp } from "./common.js";
import { registerCampusTools } from "./tools/campus.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerOutputTools } from "./tools/output.js";
import { registerRemoteOutputTools } from "./tools/remote.js";
import { localRepos, registerRepoTools } from "./tools/repos.js";
import { registerQuizTools } from "./tools/quiz.js";
import { registerStudyPrompts, registerStudyTools } from "./tools/study.js";

// With stdio, stdout carries the protocol: everything the services log goes to stderr.
console.log = console.error;

const INSTRUCTIONS = `HEIG-Kit gives access to a HEIG-VD student's school information and course material.
- Timetables, study plan, unit and module sheets, grades and absences come from GAPS; deadlines and course pages from
  Cyberlearn. Grades and absences are personal: use them only when the user asks.
- If a tool says edu-ID asks for a two-step login code, ask the user for the current 6-digit code of their authenticator
  app and call the tool again with mfa_code.
- As a teacher, answer directly and completely, grounded in the course material (search_course_material, get_exercise,
  get_document; course material is mostly in French), following the course's notation, with concrete examples, and cite
  the documents (title, course, pages, link). Say when something does not come from the course.
- Some courses keep their material on GitHub: add_course_repo indexes a repository (read with git: the user's account
  on this computer, the server's token on a remote server), update_course_repos refreshes it; it is then searched like
  any other course material.
- Every text shown on the web app (cards, quiz statements, corrections) is Markdown: LaTeX between $…$, GFM tables,
  \`\`\`mermaid diagrams and charts, \`\`\`svg drawings. Use them for anything visual: a Hasse diagram, an automaton, a graph,
  a table of values, a sketch.
- Before creating a document or an animation, call list_generated and reuse what exists (open_generated).
- Documents (render_document) are Markdown with LaTeX math and Mermaid diagrams; animations (render_animation) are
  ManimGL 1.7 scenes (from manimlib import *; ShowCreation, Write, Tex(r"...")).
- Videos come in two kinds: normal (render_animation, manim: curves, formulas, geometry) and High quality
  (render_hq_video: React and SVG scenes rendered by Remotion, polished look, natural voice). When the user asks for a
  video without saying which kind or whether they want sound, ask them both questions first: normal or High quality,
  with or without audio.
- The library (list_library) classifies every generated document and video by course and tags: a type among
  explication, révision, exercices, corrigé, te blanc, vidéo, and topics such as « calcul matriciel ». Items not tagged
  yet are guessed from their name: when the user asks to tag the library, set them with tag_library_item.
- Mock exams (TE blancs) are library documents tagged « te blanc », a statement and its solutions (names ending in
  -enonce and -corrige): list_mock_exams says which were done and with what grade; when correcting one, pass its id as
  "exam" to create_correction so that the Tests blancs page counts it.
- Past written tests of former years (anciens TE, scans filled by students) are filed by branch and year: list_past_exams,
  get_past_exam (page images to transcribe the printed statement only), save_past_exam_text (énoncé, corrigé); correcting
  the student's own attempt of one goes through create_correction with exam set to exam:<id>.
- The calendar (get_calendar, set_calendar_event) merges GAPS, Cyberlearn and manual events; flashcards (create_deck) and
  corrections of photographed work (create_correction, get_correction, submit_correction, prompt correct_exercises) feed
  the student's profile (get_profile, add_profile_notes): read it before preparing revisions.`;

const REMOTE_INSTRUCTIONS = `${INSTRUCTIONS.replace("reuse what exists (open_generated)", "reuse what exists (get_download_link)")}
- This server is remote: render_document, render_animation and render_hq_video queue a job, followed with get_job, which gives download
  links valid a few minutes. Give these links to the user; nothing opens on their computer.`;

/** How the server exposes files and rendering: on this computer by default. */
let registerOutputs: (server: McpServer) => void = (server) => registerOutputTools(server, study);
let instructions = INSTRUCTIONS;
/** Where the GitHub repositories of courses are listed and indexed: here, on the remote server, or the server itself. */
let repos: { store: CourseRepos; where: "this computer" | "the server" } = { store: localRepos(), where: "this computer" };

/** The server of one MCP session; on the shared server, of one request and of the account of its token. */
async function buildServer(user?: User): Promise<McpServer> {
  const server = new McpServer({ name: "heig-kit", version: "0.4.0" }, { instructions });
  if (user) bindTools(server, identityOf(user));
  registerCampusTools(server);
  await registerKnowledgeTools(server, knowledge);
  registerOutputs(server);
  registerStudyTools(server, study);
  registerQuizTools(server, study);
  registerLibraryTools(server, study);
  registerStudyPrompts(server);
  registerRepoTools(server, repos.store, repos.where);

  server.registerPrompt(
    "teacher",
    {
      title: "Explain a course topic",
      description: "Explanation of a topic from the student's own course material, with examples and sources",
      argsSchema: { topic: z.string(), course: z.string().optional() },
    },
    ({ topic, course }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Explique-moi « ${topic} »${course ? ` (cours ${course})` : ""} à partir de mes supports de cours : cherche-les ` +
              "avec search_course_material, suis leurs notations, donne une image concrète, un exemple chiffré, puis la " +
              "définition formelle, et cite tes sources (document, pages, lien). Termine par un exercice pour vérifier.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "practice_exam",
    {
      title: "Practice exam",
      description: "A practice written exam (TE blanc) in the style of the course's past exams, with solutions, as PDF",
      argsSchema: { course: z.string(), chapters: z.string().optional() },
    },
    ({ course, chapters }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Prépare-moi un TE blanc de ${course}${chapters ? ` sur ${chapters}` : ""}. Regarde d'abord list_generated, ` +
              `puis lis les TE passés du cours et leurs corrigés (list_documents ${course} type exam/solutions, ` +
              "get_document) pour reproduire leur format (durée, barème, matériel autorisé, voir get_unit_sheet). Écris " +
              "des exercices nouveaux, puis crée deux PDF avec render_document : l'énoncé et le corrigé avec barème.",
          },
        },
      ],
    }),
  );
  return server;
}

const db = openDb();
// A laptop with HEIG_REMOTE_URL searches the courses indexed on the server instead of a local database.
const remote = await RemoteClient.fromEnv().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  return undefined;
});
let knowledge: KnowledgeBase = remote ? new RemoteKnowledge(remote) : new LocalKnowledge(db);
let study: HeigApi = remote ? new RemoteApi(remote) : new LocalApi(db);
if (remote) repos = { store: new RemoteRepos(remote), where: "the server" };
// The study tables, for a stand-alone computer; a database that is down only disables the knowledge and study tools.
if (!remote) await migrate(db).catch(() => undefined);
const { values } = parseArgs({ options: { http: { type: "boolean", default: false }, server: { type: "boolean", default: false }, port: { type: "string", default: "8766" } } });

if (values.server) {
  const config = loadServerConfig();
  const queue = config.jobsDir ? new JobQueue(config.jobsDir) : undefined;
  if (queue) setInterval(() => queue.collect(), 5000).unref();
  else console.error("HEIG_JOBS_DIR is not set: rendering is disabled, since it must not run next to the secrets.");
  const applied = await migrate(db);
  if (applied.length > 0) console.error(`Database migrations applied: ${applied.join(", ")}`);
  const app = createApp(config, db, queue);
  knowledge = new LocalKnowledge(db);
  // One API for every account: each call works on the rows of the account its request runs as (src/rag/db.ts).
  study = new LocalApi(db, { captureUrl: async (id) => captureUrl(config.publicUrl, id, await app.auth.issueCaptureToken(id, requireIdentity().id)) });
  if (process.env.HEIG_AUTH_USERNAME || process.env.HEIG_AUTH_PASSWORD) console.error("HEIG_AUTH_USERNAME and HEIG_AUTH_PASSWORD are no longer used: remove them from .env. Accounts are created with `npm run users -- add <email>`.");
  if ((await listUsers(db)).length === 0) console.error("No account yet: nobody can log in. Create the first one (an administrator) with `npm run users -- add prenom.nom@heig-vd.ch`.");
  // What was generated before the accounts existed belongs to the account that took the installation over.
  const adopted = await adoptLibrary(db, LOCAL_OWNER.id);
  if (adopted > 0) console.error(`${adopted} library items without a known author now belong to the first account.`);
  if (config.syncMinutes > 0) app.syncer.start();
  repos = { store: app.repos, where: "the server" };
  instructions = REMOTE_INSTRUCTIONS;
  registerOutputs = (server) => registerRemoteOutputTools(server, app.auth, config.publicUrl, queue, config.linkMinutes, db);
  createRemoteServer(app, buildServer).listen(config.port, config.host, () => console.error(`HEIG-Kit server on ${config.host}:${config.port}, public address ${config.publicUrl.origin}`));
} else if (values.http) {
  const tokenFile = path.join(DATA_DIR, "mcp-token");
  if (!existsSync(tokenFile)) {
    mkdirSync(path.dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  serveHttp(buildServer, Number(values.port), readFileSync(tokenFile, "utf-8").trim(), "127.0.0.1");
} else {
  await (await buildServer()).connect(new StdioServerTransport());
}
