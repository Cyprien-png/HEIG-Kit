import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ROOT } from "../../paths.js";
import { addCourseRepo, formatCourseRepos, readCourseRepos, removeCourseRepo } from "../../rag/sources/github.js";
import { respond } from "../common.js";

const run = promisify(execFile);
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

/** GitHub repositories of courses: which ones are indexed, with the user's local git account. */
export function registerRepoTools(server: McpServer): void {
  server.registerTool(
    "list_course_repos",
    {
      title: "Indexed GitHub repositories",
      description: "GitHub repositories indexed in the knowledge base as course material, with their course.",
      annotations: { readOnlyHint: true },
    },
    async () => respond(async () => formatCourseRepos(await readCourseRepos())),
  );

  server.registerTool(
    "add_course_repo",
    {
      title: "Index a GitHub repository",
      description: "Adds a GitHub repository as material of a course, read with the user's local git account. Then call update_course_repos.",
      inputSchema: {
        url: z.string().describe("https://github.com/owner/repo, or …/tree/branch/folder for one folder"),
        course: z.string().describe("Timetable course code, e.g. PRG"),
        branch: z.string().optional().describe("Default branch of the repository when absent"),
        exclude: z.array(z.string()).optional().describe("Folders left out, e.g. those of other classes"),
      },
    },
    async (a) => respond(() => addCourseRepo(a.url, a.course, a.branch, a.exclude)),
  );

  server.registerTool(
    "remove_course_repo",
    {
      title: "Stop indexing a GitHub repository",
      description: "Removes a GitHub repository from the indexed ones; its documents leave the index at the next update_course_repos.",
      inputSchema: { url: z.string() },
      annotations: { destructiveHint: true },
    },
    async (a) => respond(() => removeCourseRepo(a.url)),
  );

  server.registerTool(
    "update_course_repos",
    {
      title: "Update the GitHub repositories now",
      description: "Fetches the indexed GitHub repositories and indexes what is new or changed (the daily update does it too). May take minutes.",
    },
    async () =>
      respond(async () => {
        const { stdout } = await run(process.execPath, [TSX, path.join(ROOT, "src", "cli.ts"), "ingest", "--source", "github"], {
          cwd: ROOT,
          maxBuffer: 16 * 1024 * 1024,
        });
        return stdout.trim().split("\n").slice(-30).join("\n");
      }),
  );
}
