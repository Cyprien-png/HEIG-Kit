/**
 * The GitHub repositories indexed as course material, behind one interface: the list of this installation
 * (`data/github-repos.json`, indexed here) or the server's list over its API (HEIG_REMOTE_URL), so that a laptop manages
 * the repositories the server indexes with its own git token (docs/knowledge.md).
 */
import { type CourseRepo, addCourseRepo, formatCourseRepos, readCourseRepos, removeCourseRepo } from "../rag/sources/github.js";
import type { RemoteClient } from "../remote/client.js";
import type { SyncRun } from "./sync.js";

export interface CourseRepos {
  list(): Promise<CourseRepo[]>;
  /** Adds a repository, or changes its course; the description of the result. */
  add(url: string, course: string, branch?: string, exclude?: string[]): Promise<string>;
  remove(url: string): Promise<string>;
  /** Fetches the repositories and indexes what changed; the summary of the run. */
  update(): Promise<string>;
}

export class LocalRepos implements CourseRepos {
  constructor(
    private readonly runUpdate: () => Promise<string>,
    private readonly file?: string,
  ) {}

  list() {
    return readCourseRepos(this.file);
  }
  add(url: string, course: string, branch?: string, exclude: string[] = []) {
    return addCourseRepo(url, course, branch, exclude, this.file);
  }
  remove(url: string) {
    return removeCourseRepo(url, this.file);
  }
  update() {
    return this.runUpdate();
  }
}

export class RemoteRepos implements CourseRepos {
  constructor(private readonly client: RemoteClient) {}

  async list() {
    return (await this.client.get<{ repos: CourseRepo[] }>("/api/kb/repos")).repos;
  }
  async add(url: string, course: string, branch?: string, exclude: string[] = []) {
    return (await this.client.post<{ message: string }>("/api/kb/repos", { url, course, branch, exclude })).message;
  }
  async remove(url: string) {
    return (await this.client.delete<{ message: string }>(`/api/kb/repos?url=${encodeURIComponent(url)}`)).message;
  }
  async update() {
    return (await this.client.post<{ message: string }>("/api/kb/repos/update")).message;
  }
}

/** The result of a server-side GitHub run as one readable line (or an error when it failed). */
export function describeGithubRun(run: SyncRun): string {
  if (!run.ok) throw new Error(run.message ?? "the GitHub update failed");
  const s = (run.stats ?? {}) as Record<string, number | string[] | boolean | undefined>;
  const n = (key: string) => Number(s[key] ?? 0);
  const parts = [
    `${n("repos")} repositories, ${n("listed")} documents listed`,
    `${n("indexed")} indexed (${n("chunks")} chunks)`,
    `${n("unchanged")} unchanged`,
    `${n("removed")} removed`,
    `${n("failed")} failed`,
  ];
  if (n("skipped") > 0) parts.push(`${n("skipped")} PDF/DOCX left for the daily indexing (the extraction service is off)`);
  const unreachable = (s.unreachable as string[] | undefined) ?? [];
  const lines = [`GitHub: ${parts.join(", ")}`];
  if (unreachable.length > 0) lines.push(`Could not fetch ${unreachable.join(", ")}: their documents are kept as they were`);
  return lines.join("\n");
}

export { formatCourseRepos };
