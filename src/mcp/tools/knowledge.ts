import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../../rag/db.js";
import { documentText, findExercise, formatResults, listCourses, listDocuments, search } from "../../rag/search.js";

const MAX_DOCUMENT_CHARS = 60_000;
const DOC_TYPES = ["lecture", "exercises", "solutions", "exam", "lab", "planning", "other"] as const;

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

/** Search and reading tools over the course knowledge base (indexed course documents). */
export function registerKnowledgeTools(server: McpServer, db: Db): void {
  server.registerTool(
    "search_course_material",
    {
      title: "Search course material",
      description:
        "Searches the student's indexed course material (lecture notes, exercise sheets, solutions, past exams, labs, " +
        "plannings) by meaning and keywords, including exercise numbers such as 2.22. Returns passages with their " +
        "course, chapter, document, pages and link. Course material is mostly in French: French queries work best.",
      inputSchema: {
        query: z.string().describe("What to look for, e.g. 'diagramme de Hasse' or 'exercice 2.22'"),
        course: z.string().optional().describe("Timetable course code, e.g. MAD (see list_courses)"),
        doc_type: z.enum(DOC_TYPES).optional().describe("Only this kind of document"),
        limit: z.number().int().min(1).max(20).optional().describe("Number of passages (default 8)"),
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
      description: "Statement and, when available, solution of a numbered exercise, e.g. number 2.22 in course MAD.",
      inputSchema: {
        number: z.string().describe("Exercise number, e.g. 2.22"),
        course: z.string().optional().describe("Timetable course code, e.g. MAD"),
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
        "Extracted text of an indexed document (id from search results or list_documents), optionally limited to pages. " +
        "Use it to read a whole chapter before writing exercises or an exam. Formulas that could not be extracted " +
        "appear as [formule] or are missing: the original is at the document's link.",
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
    "list_courses",
    {
      title: "List courses",
      description: "Indexed courses with their code, name, teachers and number of documents.",
      annotations: { readOnlyHint: true },
    },
    async () => text(JSON.stringify(await listCourses(db), null, 2)),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents of a course",
      description: "Indexed documents of a course (id, title, kind, chapter, upload date, link).",
      inputSchema: {
        course: z.string().describe("Timetable course code, e.g. MAD"),
        doc_type: z.enum(DOC_TYPES).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ course, doc_type }) => text(JSON.stringify(await listDocuments(db, course, doc_type), null, 2)),
  );

}
