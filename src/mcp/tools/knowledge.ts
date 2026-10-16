import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../../rag/db.js";
import {
  documentText,
  figureFile,
  findExercise,
  formatDocuments,
  formatResults,
  listCourses,
  listDocuments,
  search,
} from "../../rag/search.js";

const MAX_DOCUMENT_CHARS = 60_000;
const DOC_TYPES = ["lecture", "exercises", "solutions", "exam", "lab", "planning", "other"] as const;

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

/** Indexed courses as "MAD (name), SYL (name)…", or undefined when the knowledge base is unreachable. */
async function courseList(db: Db): Promise<{ codes: string; names: string } | undefined> {
  try {
    const courses = (await listCourses(db)).filter((c) => c.course);
    if (courses.length === 0) return undefined;
    return { codes: courses.map((c) => c.course).join(", "), names: courses.map((c) => `${c.course} (${c.name})`).join(", ") };
  } catch {
    return undefined;
  }
}

/**
 * Search and reading tools over the course knowledge base (indexed course documents). The indexed courses are written in
 * the search tool's description, so the model knows their codes without an extra call.
 */
export async function registerKnowledgeTools(server: McpServer, db: Db): Promise<void> {
  const courses = await courseList(db);
  server.registerTool(
    "search_course_material",
    {
      title: "Search course material",
      description:
        "Searches the student's course material (lectures, exercise sheets, solutions, past exams 'TE', labs, plannings) " +
        "by meaning and keywords, including exercise numbers such as 2.22. Results are grouped by document, each passage " +
        "with its pages; the header gives the document id and link to cite. " +
        (courses ? `Courses: ${courses.names}. ` : "") +
        "Material is in French: search in French. Independent searches can be sent in parallel.",
      inputSchema: {
        query: z.string().describe("What to look for, e.g. 'diagramme de Hasse' or 'TE 1 2024-2025 problème 3'"),
        course: z.string().optional().describe(`Course code${courses ? `: ${courses.codes}` : ", e.g. MAD"}`),
        doc_type: z.enum(DOC_TYPES).optional().describe("Only this kind of document"),
        limit: z.number().int().min(1).max(20).optional().describe("Number of passages (default 6)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, course, doc_type, limit }) =>
      text(formatResults(await search(db, query, { course, docType: doc_type, limit })) || "No matching material."),
  );

  server.registerTool(
    "get_exercise",
    {
      title: "Get an exercise",
      description: "Statement and, when available, solution of a numbered exercise of an exercise sheet, e.g. 2.22 in MAD.",
      inputSchema: {
        number: z.string().describe("Exercise number, e.g. 2.22"),
        course: z.string().optional().describe("Course code, e.g. MAD"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ number, course }) => text(formatResults(await findExercise(db, course, number)) || `Exercise ${number} not found.`),
  );

  server.registerTool(
    "get_document",
    {
      title: "Read a document",
      description:
        "Text of a document (id from search results or list_documents), optionally only some pages: to read around a " +
        "passage, a whole exam or a chapter. Formulas appear as [formule : …] (raw text, matrices row by row) or " +
        "[formule] when missing: the original is at the document's link. Figures appear as [figure n : labels]: see " +
        "them with get_figure.",
      inputSchema: {
        document_id: z.number().int(),
        page_from: z.number().int().min(1).optional(),
        page_to: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ document_id, page_from, page_to }) => {
      const doc = await documentText(db, document_id, page_from, page_to);
      if (!doc) return text(`Document ${document_id} not found.`);
      const truncated = doc.text.length > MAX_DOCUMENT_CHARS;
      return text(
        [
          `# ${doc.title}`,
          `${[doc.course, doc.chapter, doc.docType].filter(Boolean).join(" · ")} · ${doc.pageCount} pages · ${doc.url ?? ""}`,
          doc.text.slice(0, MAX_DOCUMENT_CHARS),
          truncated ? `\n[truncated: request a narrower page range]` : "",
        ].join("\n\n"),
      );
    },
  );

  server.registerTool(
    "get_figure",
    {
      title: "See a figure",
      description:
        "Image of a figure of an indexed document: diagrams, graphs, drawings and plots are only labels in the text, " +
        "[figure <n> : <labels>] in search results and documents. Look at it before explaining or correcting anything " +
        "that depends on the figure (edges of a graph or of a Hasse diagram, curves, schemas).",
      inputSchema: {
        document_id: z.number().int().describe("Document id, from search results or list_documents"),
        number: z.number().int().min(1).describe("Figure number n of [figure n …]"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ document_id, number }) => {
      const file = await figureFile(db, document_id, number);
      if (!file) return text(`Figure ${number} of document ${document_id} not found.`);
      return {
        content: [
          { type: "image" as const, data: (await readFile(file)).toString("base64"), mimeType: "image/png" },
          { type: "text" as const, text: `Figure ${number} of document ${document_id}` },
        ],
      };
    },
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents of a course",
      description: "Documents of a course, one per line: id, kind, chapter, title. Use it to find an exam or a sheet by name.",
      inputSchema: {
        course: z.string().describe("Timetable course code, e.g. MAD"),
        doc_type: z.enum(DOC_TYPES).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ course, doc_type }) => text(formatDocuments(await listDocuments(db, course, doc_type)) || `No documents for ${course}.`),
  );

}
