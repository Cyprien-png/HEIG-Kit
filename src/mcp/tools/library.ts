/**
 * Library tools (docs/app.md): the generated documents and videos classified by course and tags, over the local
 * database or a remote server.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HeigApi, LibraryItem } from "../../app/api.js";
import { TYPE_TAGS } from "../../app/library.js";
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
}
