import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type CourseRepos, LocalRepos, formatCourseRepos } from "../../app/repos.js";
import { ROOT } from "../../paths.js";
import { respond } from "../common.js";

const run = promisify(execFile);
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

/** This computer's repositories, updated by `npm run ingest -- --source github` in its own process (it may start Docker services). */
export function localRepos(): CourseRepos {
  return new LocalRepos(async () => {
    const { stdout } = await run(process.execPath, [TSX, path.join(ROOT, "src", "cli.ts"), "ingest", "--source", "github"], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim().split("\n").slice(-30).join("\n");
  });
}

/** GitHub repositories of courses: which ones are indexed, here or on the server (`repos` says where). */
export function registerRepoTools(server: McpServer, repos: CourseRepos, where: "this computer" | "the server"): void {
  server.registerTool(
    "list_course_repos",
    {
      title: "Indexed GitHub repositories",
      description: `GitHub repositories indexed in the knowledge base of ${where} as course material, with their course.`,
      annotations: { readOnlyHint: true },
    },
    async () => respond(async () => formatCourseRepos(await repos.list())),
  );

  server.registerTool(
    "add_course_repo",
    {
      title: "Index a GitHub repository",
      description: `Adds a GitHub repository as material of a course, read by ${where === "the server" ? "the server with its git token" : "the user's local git account"}. Then call update_course_repos. On a shared server only an administrator may; anyone else is refused and must not retry.`,
      inputSchema: {
        url: z.string().describe("https://github.com/owner/repo, or …/tree/branch/folder for one folder"),
        course: z.string().describe("Timetable course code, e.g. PRG"),
        branch: z.string().optional().describe("Default branch of the repository when absent"),
        exclude: z.array(z.string()).optional().describe("Folders left out, e.g. those of other classes"),
      },
    },
    async (a) => respond(() => repos.add(a.url, a.course, a.branch, a.exclude)),
  );

  server.registerTool(
    "remove_course_repo",
    {
      title: "Stop indexing a GitHub repository",
      description: "Removes a GitHub repository from the indexed ones; its documents leave the index at the next update_course_repos. On a shared server only an administrator may.",
      inputSchema: { url: z.string() },
      annotations: { destructiveHint: true },
    },
    async (a) => respond(() => repos.remove(a.url)),
  );

  server.registerTool(
    "update_course_repos",
    {
      title: "Update the GitHub repositories now",
      description: `Fetches the indexed GitHub repositories and indexes what is new or changed on ${where} (the daily update does it too). May take minutes. On a shared server only an administrator may.`,
    },
    async () => respond(() => repos.update()),
  );
}
