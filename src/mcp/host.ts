/**
 * The complete HEIG-Kit MCP server, run on the user's computer (it uses the saved login, the local programs and opens
 * files): timetables, GAPS, Cyberlearn, the course knowledge base, documents and animations, for any MCP client.
 *
 *   npm run -s mcp                 stdio (Claude Desktop, Claude Code, mcpo for Open WebUI…)
 *   npm run -s mcp -- --http       Streamable HTTP on http://127.0.0.1:8766/mcp, with the token of data/mcp-token
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ROOT } from "../paths.js";
import { openDb } from "../rag/db.js";
import { serveHttp } from "./common.js";
import { registerCampusTools } from "./tools/campus.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerOutputTools } from "./tools/output.js";

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
- Before creating a document or an animation, call list_generated and reuse what exists (open_generated).
- Documents (render_document) are Markdown with LaTeX math and Mermaid diagrams; animations (render_animation) are
  ManimGL 1.7 scenes (from manimlib import *; ShowCreation, Write, Tex(r"...")).`;

async function buildServer(): Promise<McpServer> {
  const server = new McpServer({ name: "heig-kit", version: "0.4.0" }, { instructions: INSTRUCTIONS });
  registerCampusTools(server);
  await registerKnowledgeTools(server, db);
  registerOutputTools(server);

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
const { values } = parseArgs({ options: { http: { type: "boolean", default: false }, port: { type: "string", default: "8766" } } });

if (values.http) {
  const tokenFile = path.join(ROOT, "data", "mcp-token");
  if (!existsSync(tokenFile)) {
    mkdirSync(path.dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  serveHttp(buildServer, Number(values.port), readFileSync(tokenFile, "utf-8").trim(), "127.0.0.1");
} else {
  await (await buildServer()).connect(new StdioServerTransport());
}
