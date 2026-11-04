/**
 * The complete HEIG-Kit MCP server, run on the user's computer (it uses the saved login, the local programs and opens
 * files): timetables, GAPS, Cyberlearn, the course knowledge base, documents and animations, for any MCP client.
 *
 *   npm run -s mcp                 stdio (Claude Desktop, Claude Code, mcpo for Open WebUI…)
 *   npm run -s mcp -- --http       Streamable HTTP on http://127.0.0.1:8766/mcp, with the token of data/mcp-token
 *   npm run -s server              remote server: account and tokens from .env, isolated rendering, downloads (docs/server.md)
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DATA_DIR } from "../paths.js";
import { type HeigApi, LocalApi, RemoteApi } from "../app/api.js";
import { captureUrl } from "../app/corrections.js";
import { type KnowledgeBase, LocalKnowledge, RemoteKnowledge } from "../app/knowledge.js";
import { migrate, openDb } from "../rag/db.js";
import { RemoteClient } from "../remote/client.js";
import { createApp } from "../server/app.js";
import { loadServerConfig } from "../server/config.js";
import { createRemoteServer } from "../server/http.js";
import { JobQueue } from "../server/jobs.js";
import { serveHttp } from "./common.js";
import { registerCampusTools } from "./tools/campus.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerOutputTools } from "./tools/output.js";
import { registerRemoteOutputTools } from "./tools/remote.js";
import { registerRepoTools } from "./tools/repos.js";
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
- Some courses keep their material on GitHub: add_course_repo indexes a repository with the user's local git account,
  update_course_repos refreshes it; it is then searched like any other course material.
- Before creating a document or an animation, call list_generated and reuse what exists (open_generated).
- Documents (render_document) are Markdown with LaTeX math and Mermaid diagrams; animations (render_animation) are
  ManimGL 1.7 scenes (from manimlib import *; ShowCreation, Write, Tex(r"...")).
- The calendar (get_calendar, set_calendar_event) merges GAPS, Cyberlearn and manual events; flashcards (create_deck) and
  corrections of photographed work (create_correction, get_correction, submit_correction, prompt correct_exercises) feed
  the student's profile (get_profile, add_profile_notes): read it before preparing revisions.`;

const REMOTE_INSTRUCTIONS = `${INSTRUCTIONS.replace(/- Some courses keep[\s\S]*?course material\.\n/, "").replace("reuse what exists (open_generated)", "reuse what exists (get_download_link)")}
- This server is remote: render_document and render_animation queue a job, followed with get_job, which gives download
  links valid a few minutes. Give these links to the user; nothing opens on their computer.`;

/** How the server exposes files and rendering: on this computer by default. */
let registerOutputs: (server: McpServer) => void = registerOutputTools;
let instructions = INSTRUCTIONS;

async function buildServer(): Promise<McpServer> {
  const server = new McpServer({ name: "heig-kit", version: "0.4.0" }, { instructions });
  registerCampusTools(server);
  await registerKnowledgeTools(server, knowledge);
  registerOutputs(server);
  registerStudyTools(server, study);
  registerQuizTools(server, study);
  registerStudyPrompts(server);
  // Not on a remote server: repositories are read with the git account of the computer, and indexed from it.
  if (registerOutputs === registerOutputTools) registerRepoTools(server);

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
  study = new LocalApi(db, { captureUrl: async (id) => captureUrl(config.publicUrl, id, await app.auth.issueCaptureToken(id)) });
  if (config.syncMinutes > 0) app.syncer.start();
  instructions = REMOTE_INSTRUCTIONS;
  registerOutputs = (server) => registerRemoteOutputTools(server, app.auth, config.publicUrl, queue, config.linkMinutes);
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
