/**
 * Library tools (docs/app.md): the generated documents and videos classified by course and tags, over the local
 * database or a remote server.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HeigApi, LibraryItem } from "../../app/api.js";
import { TYPE_TAGS } from "../../app/library.js";
import { type PastExam, findPastExam, formatPastExams } from "../../app/pastexams.js";
import { respond } from "../common.js";

function formatItem(item: LibraryItem): string {
  const files = item.files.map((f) => f.ext.slice(1)).join(", ");
  const tags = [item.course ?? "(no course)", ...item.tags].join(" · ");
  return `${item.kind.padEnd(8)} ${item.modifiedAt.slice(0, 10)}  ${tags}${item.tagged ? "" : "  (guessed)"}\n  ${item.title}\n  id: ${item.kind}:${item.name} (${files})`;
}

export function registerLibraryTools(server: McpServer, api: HeigApi): void {
  server.registerTool(
    "list_library",
    {
      title: "The library, by course and tags",
      description:
        "Lists the generated documents and videos with their course and tags, grouped by course. Tags not set yet are " +
        `guessed from the name (marked “guessed”). Types: ${TYPE_TAGS.join(", ")}; topics are free (« calcul matriciel »).`,
      inputSchema: {
        course: z.string().optional().describe("Only this course code"),
        tag: z.string().optional().describe("Only items with this tag"),
        keywords: z.string().optional().describe("Topic words searched in names, titles and texts"),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      respond(async () => {
        const words = (a.keywords ?? "").split(/\s+/).filter(Boolean);
        const tag = a.tag?.trim().toLowerCase();
        const course = a.course?.trim().toUpperCase();
        const items = (await api.library(words)).filter((i) => (!course || i.course === course) && (!tag || i.tags.includes(tag)));
        if (items.length === 0) return "Nothing in the library matches.";
        const byCourse = new Map<string, LibraryItem[]>();
        for (const item of items) byCourse.set(item.course ?? "", [...(byCourse.get(item.course ?? "") ?? []), item]);
        return [...byCourse.entries()]
          .sort(([x], [y]) => (x === "" ? 1 : y === "" ? -1 : x.localeCompare(y)))
          .map(([code, list]) => `## ${code || "Without course"}\n${list.map(formatItem).join("\n")}`)
          .join("\n\n");
      }),
  );

  server.registerTool(
    "tag_library_item",
    {
      title: "Tag a library item",
      description:
        "Sets the course and tags of a generated document or video. `tags` replaces every tag; `add` and `remove` adjust " +
        `them. Use one type among ${TYPE_TAGS.join(", ")} plus short topic tags in French, the same words as the flashcards and the profile.`,
      inputSchema: {
        item: z.string().describe("Id from list_library (document:name), a file such as documents/name.pdf, or the title"),
        course: z.string().nullable().optional().describe("Course code such as MAD; null removes it"),
        tags: z.array(z.string()).optional().describe("Every tag of the item, replacing the current ones"),
        add: z.array(z.string()).optional(),
        remove: z.array(z.string()).optional(),
      },
    },
    async (a) =>
      respond(async () => {
        const item = await api.tagLibraryItem(a.item, { course: a.course, tags: a.tags, add: a.add, remove: a.remove });
        return `Tagged:\n${formatItem(item)}`;
      }),
  );

  // Past exams (« anciens TE »)
  const dated = (exams: Awaited<ReturnType<HeigApi["pastExams"]>>): PastExam[] =>
    exams.map((e) => ({ ...e, attempts: e.attempts.map((a) => ({ ...a, createdAt: new Date(a.createdAt), correctedAt: a.correctedAt ? new Date(a.correctedAt) : undefined })), last: e.last ? { ...e.last, createdAt: new Date(e.last.createdAt), correctedAt: e.last.correctedAt ? new Date(e.last.correctedAt) : undefined } : undefined }));

  server.registerTool(
    "list_past_exams",
    {
      title: "The past written tests (anciens TE) by branch and year",
      description:
        "Lists the scanned written tests of former years filed on the server (branch, year, TE number, teacher), what each " +
        "one has (the scan, an unfilled copy, the teacher's solutions, the énoncé and corrigé written by the agent) and the " +
        "student's attempts with their grade. Ids are exam:<branch>/<year>/<slug>, to pass as `exam` to create_correction " +
        "when correcting the student's own attempt, or to get_past_exam.",
      inputSchema: { branch: z.string().optional().describe("Top folder such as MAD or PRG1"), course: z.string().optional().describe("Course code of the file names, e.g. INF1") },
      annotations: { readOnlyHint: true },
    },
    async (a) => respond(async () => formatPastExams(dated(await api.pastExams({ branch: a.branch, course: a.course })))),
  );

  server.registerTool(
    "get_past_exam",
    {
      title: "Read a past written test: its énoncé and corrigé, and the pages of the scan",
      description:
        "One past exam: its files, the énoncé and corrigé texts when they exist, and the page images of the scan (rendered " +
        "beforehand with `npm run exams -- pages <id>` on the computer holding the files) to transcribe the statement. " +
        "The scans were filled by a student: when writing the énoncé, keep only the printed statement, never what was " +
        "written by hand, nor the name, the marks or the teacher's annotations.",
      inputSchema: { id: z.string().describe("exam:<id> from list_past_exams, or words of its title"), with_pages: z.boolean().optional().describe("Include the page images (default true)") },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        const exam = findPastExam(dated(await api.pastExams()), a.id);
        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
        const pieces = exam.files.map((f) => f.name).join(", ");
        content.push({ type: "text", text: `${exam.meta.title}\nid: exam:${exam.id}\nfiles: ${pieces}\nstatus: ${exam.status}${exam.attempts.length ? `, attempts: ${exam.attempts.map((x) => `${x.id} (${x.state}${x.score ? `, ${x.score.grade.toFixed(1)}/6` : ""})`).join(", ")}` : ""}` });
        for (const name of ["enonce.md", "corrige.md"]) {
          const text = exam.has[name === "enonce.md" ? "statement" : "solutions"] ? await api.readPastExamFile(`${exam.id}/${name}`) : undefined;
          if (text) content.push({ type: "text", text: `--- ${name} ---\n${text.toString("utf-8")}` });
        }
        if (a.with_pages !== false) {
          const pages = exam.files.filter((f) => f.name.startsWith("pages/") && f.name.endsWith(".png")).map((f) => f.name).sort();
          if (pages.length === 0) content.push({ type: "text", text: "No page images yet: run `npm run exams -- pages <id>` on the computer holding the files, then `npm run exams -- push`." });
          for (const page of pages) {
            const png = await api.readPastExamFile(`${exam.id}/${page}`);
            if (!png) continue;
            content.push({ type: "text", text: page });
            content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
          }
        }
        return { content };
      } catch (error) {
        return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    },
  );

  server.registerTool(
    "save_past_exam_text",
    {
      title: "Save the énoncé or the corrigé of a past written test",
      description:
        "Writes enonce.md (the statement alone, as the teacher printed it: header, instructions, every question with its " +
        "points, no student writing) or corrige.md (full solutions with the barème) of a past exam, in Markdown with LaTeX " +
        "math. The PDF is rendered by `npm run exams -- render <id>` on the computer holding the files.",
      inputSchema: { id: z.string().describe("exam:<id> from list_past_exams"), kind: z.enum(["enonce", "corrige"]), markdown: z.string().min(20) },
    },
    async (a) =>
      respond(async () => {
        const exam = findPastExam(dated(await api.pastExams()), a.id);
        const saved = await api.writePastExamFile(`${exam.id}/${a.kind}.md`, Buffer.from(a.markdown, "utf-8"));
        return `Saved ${saved.id} (${saved.size} bytes). Render the PDF with: npm run exams -- render ${exam.id}`;
      }),
  );
}
