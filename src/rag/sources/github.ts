import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR } from "../../paths.js";
import { EXTRACTABLE } from "../extract.js";
import { type Source, type SourceDocument, guessDocType, safeName } from "./source.js";

const run = promisify(execFile);

const CONFIG_FILE = path.join(DATA_DIR, "github-repos.json");
const MIRRORS_DIR = path.join(DATA_DIR, "repos");
const TIP = "refs/heig/tip";
const MAX_BYTES = 64 * 1024 * 1024;
/** Larger source files are data or generated code, not course material. */
const MAX_CODE_BYTES = 1024 * 1024;

/** Code is indexed as Markdown, in a fenced block named after the language. */
const CODE: Record<string, string> = {
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hh": "cpp", ".hpp": "cpp",
  ".java": "java", ".kt": "kotlin", ".py": "python", ".js": "javascript", ".jsx": "jsx", ".ts": "typescript",
  ".tsx": "tsx", ".go": "go", ".rs": "rust", ".cs": "csharp", ".sh": "bash", ".sql": "sql", ".rb": "ruby",
  ".php": "php", ".swift": "swift", ".vhd": "vhdl", ".vhdl": "vhdl",
};
const IGNORED_DIRS = new Set(["node_modules", "vendor", "dist", "build", "target", "out", "bin", "obj", "__pycache__"]);

export interface CourseRepo {
  owner: string;
  repo: string;
  /** Timetable course code the documents are filed under, e.g. PRG. */
  course: string;
  /** Default branch of the repository when absent. */
  branch?: string;
  /** Only this folder of the repository. */
  folder?: string;
  /** Folders of the repository left out, e.g. those of other classes. */
  exclude?: string[];
  /** Where to fetch from: the HTTPS address of the repository unless set (tests). */
  remote?: string;
}

const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Reads a GitHub repository address: https://github.com/owner/repo(.git), …/tree/branch/folder, git@github.com:owner/repo
 * or owner/repo. Addresses holding a password or a token are refused: authentication stays with the user's git.
 */
export function parseRepoUrl(url: string): Pick<CourseRepo, "owner" | "repo" | "branch" | "folder"> {
  const text = url.trim();
  if (/^https?:\/\/[^/]*@/i.test(text)) throw new Error("The address holds credentials: remove them, your local git account is used");
  const match =
    /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/tree\/([^/\s]+)(?:\/(\S*?))?)?\/?$/i.exec(text);
  if (!match || /^[a-z]+:/i.test(match[1]) || !NAME.test(match[1]) || !NAME.test(match[2])) {
    throw new Error(`Not a GitHub repository address: "${url}" (expected https://github.com/owner/repo)`);
  }
  const [, owner, repo, branch, folder] = match;
  return { owner, repo, ...(branch && { branch: decodeURIComponent(branch) }), ...(folder && { folder: decodeURIComponent(folder) }) };
}

function mirrorName(r: CourseRepo): string {
  return safeName(`${r.owner}__${r.repo}__${r.branch ?? "HEAD"}`);
}

export function repoLabel(r: CourseRepo): string {
  return `${r.owner}/${r.repo}${r.branch ? `@${r.branch}` : ""}${r.folder ? `/${r.folder}` : ""}`;
}

/** Whether a file of a repository is course material, from its path and size. */
export function isIndexable(file: string, size: number): boolean {
  const parts = file.split("/");
  if (parts.some((part, i) => part.startsWith(".") || (i < parts.length - 1 && IGNORED_DIRS.has(part)))) return false;
  if (/\.min\.[a-z]+$/i.test(file) || parts[parts.length - 1] === "CMakeLists.txt" || size > MAX_BYTES) return false;
  if (EXTRACTABLE.test(file)) return true;
  return path.posix.extname(file).toLowerCase() in CODE && size <= MAX_CODE_BYTES;
}

/** A source file as Markdown: its path as a title and the code in a fence longer than any fence it contains. */
export function codeToMarkdown(file: string, code: string): string {
  const language = CODE[path.posix.extname(file).toLowerCase()] ?? "";
  const longest = Math.max(2, ...(code.match(/`{3,}/g) ?? []).map((fence) => fence.length));
  const fence = "`".repeat(longest + 1);
  return `# ${file}\n\n${fence}${language}\n${code.replace(/\n+$/, "")}\n${fence}\n`;
}

/**
 * How git authenticates to GitHub: with HEIG_GITHUB_TOKEN when set (a token of the account reading the course
 * repositories, the only way on the remote server, whose container has no git account), through the environment so
 * that the token shows in no command line; otherwise with the computer's own git account (credential helper, keychain).
 */
export function gitAuthEnv(token = process.env.HEIG_GITHUB_TOKEN): NodeJS.ProcessEnv {
  // A missing authentication fails instead of waiting for a password nobody types during an unattended update.
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0" };
  const secret = token?.trim();
  if (secret) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${secret}`).toString("base64")}`;
  }
  return env;
}

async function git(mirror: string, args: string[]): Promise<Buffer> {
  const { stdout } = await run("git", ["-C", mirror, ...args], {
    encoding: "buffer",
    maxBuffer: MAX_BYTES * 2,
    timeout: 5 * 60_000,
    env: { ...process.env, ...gitAuthEnv() },
  });
  return stdout;
}

/**
 * Files of GitHub repositories, fetched with the user's own git account (credential helper, keychain…). Each repository
 * is a bare shallow mirror in data/repos: only the latest commit is kept, nothing is checked out and no code runs.
 * A file's version is its git blob id, so unchanged files are skipped and changed ones replace their previous version.
 */
export class GitHubSource implements Source {
  readonly name = "github";
  /** Repositories the last `list()` could not fetch: their documents must not be taken as removed. */
  failed: string[] = [];
  /** Why, per repository label. */
  readonly errors = new Map<string, string>();

  constructor(
    private readonly repos: CourseRepo[],
    private readonly mirrorsDir = MIRRORS_DIR,
    private readonly log: (line: string) => void = () => {},
  ) {}

  async list(): Promise<SourceDocument[]> {
    this.failed = [];
    this.errors.clear();
    const documents: SourceDocument[] = [];
    for (const repo of this.repos) {
      try {
        documents.push(...(await this.repoDocuments(repo)));
      } catch (error) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
        const reason = (stderr || (error instanceof Error ? error.message : String(error))).split("\n").at(-1) ?? "";
        this.failed.push(repoLabel(repo));
        this.errors.set(repoLabel(repo), reason);
        this.log(`${repoLabel(repo)}: FAILED, ${stderr || (error instanceof Error ? error.message : error)}`);
      }
    }
    return documents;
  }

  private async repoDocuments(repo: CourseRepo): Promise<SourceDocument[]> {
    const mirror = path.join(this.mirrorsDir, mirrorName(repo));
    const remote = repo.remote ?? `https://github.com/${repo.owner}/${repo.repo}.git`;
    if (!existsSync(path.join(mirror, "HEAD"))) {
      await mkdir(mirror, { recursive: true });
      await git(mirror, ["init", "--quiet", "--bare"]);
    }
    await git(mirror, ["fetch", "--quiet", "--depth", "1", "--no-tags", remote, `+${repo.branch ?? "HEAD"}:${TIP}`]);

    const prefix = repo.folder ? `${repo.folder.replace(/\/+$/, "")}/` : "";
    const listing = (await git(mirror, ["ls-tree", "-r", "-l", "-z", TIP])).toString("utf-8");
    const documents: SourceDocument[] = [];
    for (const line of listing.split("\0").filter(Boolean)) {
      const match = /^(\d+) (\w+) ([0-9a-f]+)\s+(\d+)\t(.+)$/s.exec(line);
      // Regular files only: no symbolic links nor submodules.
      if (!match || match[2] !== "blob" || match[1] === "120000") continue;
      const [, , , blob, size, file] = match;
      if (!file.startsWith(prefix) || !isIndexable(file, Number(size))) continue;
      if (repo.exclude?.some((folder) => file.startsWith(`${folder.replace(/\/+$/, "")}/`))) continue;
      // Compiled programs sometimes get committed under a source name.
      if (!EXTRACTABLE.test(file) && (await git(mirror, ["cat-file", "blob", blob])).includes(0)) continue;
      documents.push({ ...this.fileDocument(repo, mirror, file, blob), size: Number(size) });
    }
    return documents;
  }

  private fileDocument(repo: CourseRepo, mirror: string, file: string, blob: string): SourceDocument {
    const isDocument = EXTRACTABLE.test(file);
    const parts = file.split("/");
    const name = path.posix.basename(file);
    const chapter = parts.length > 1 ? parts[0] : undefined;
    const filename = isDocument ? name : `${name}.md`;
    const url = `https://github.com/${repo.owner}/${repo.repo}/blob/${encodeURIComponent(repo.branch ?? "HEAD")}/${parts.map(encodeURIComponent).join("/")}`;
    return {
      source: this.name,
      externalId: `${repo.owner}/${repo.repo}@${repo.branch ?? "HEAD"}:${file}`,
      title: `${repo.repo} / ${file}`,
      url,
      version: blob,
      filename,
      localPath: path.join("data", "documents", "github", safeName(repo.course), safeName(repo.repo), ...parts.slice(0, -1).map(safeName), safeName(filename)),
      courseCode: repo.course,
      courseName: `${repo.owner}/${repo.repo}`,
      teachers: [],
      chapter,
      docType: guessDocType(file, repo.repo),
      load: async () => {
        const bytes = await git(mirror, ["cat-file", "blob", blob]);
        return isDocument ? bytes : Buffer.from(codeToMarkdown(file, bytes.toString("utf-8")));
      },
    };
  }
}

export async function readCourseRepos(file = CONFIG_FILE): Promise<CourseRepo[]> {
  if (!existsSync(file)) return [];
  return JSON.parse(await readFile(file, "utf-8")) as CourseRepo[];
}

/** Adds a repository to the indexed ones, or updates its course, and returns the description of the result. */
export async function addCourseRepo(url: string, course: string, branch?: string, exclude: string[] = [], file = CONFIG_FILE): Promise<string> {
  const code = course.trim();
  if (!code) throw new Error("A course code is required, e.g. PRG");
  const parsed = parseRepoUrl(url);
  const repo: CourseRepo = { ...parsed, course: code, ...(branch && { branch }), ...(exclude.length > 0 && { exclude }) };
  const repos = (await readCourseRepos(file)).filter((r) => repoLabel(r).toLowerCase() !== repoLabel(repo).toLowerCase());
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify([...repos, repo], null, 2)}\n`);
  return `${repoLabel(repo)} added to ${code}`;
}

/** Removes a repository; its documents leave the index at the next indexing. */
export async function removeCourseRepo(url: string, file = CONFIG_FILE): Promise<string> {
  const parsed = parseRepoUrl(url);
  const repos = await readCourseRepos(file);
  const label = repoLabel({ ...parsed, course: "" }).toLowerCase();
  const matches = (r: CourseRepo) =>
    repoLabel(r).toLowerCase() === label || (!parsed.branch && !parsed.folder && `${r.owner}/${r.repo}`.toLowerCase() === label);
  const kept = repos.filter((r) => !matches(r));
  if (kept.length === repos.length) throw new Error(`${url} is not an indexed repository`);
  await writeFile(file, `${JSON.stringify(kept, null, 2)}\n`);
  const stillUsed = new Set(kept.map(mirrorName));
  for (const repo of repos.filter(matches)) {
    if (!stillUsed.has(mirrorName(repo))) await rm(path.join(path.dirname(file), "repos", mirrorName(repo)), { recursive: true, force: true });
  }
  return `${repos.length - kept.length} repository removed: its documents leave the index at the next indexing`;
}

export function formatCourseRepos(repos: CourseRepo[]): string {
  if (repos.length === 0) return "No GitHub repository indexed. Add one with: npm run repos -- add <url> --course <CODE>";
  return repos.map((r) => `${r.course}  https://github.com/${r.owner}/${r.repo}${r.branch ? `  (branch ${r.branch})` : ""}${r.folder ? `  (folder ${r.folder})` : ""}${r.exclude ? `  (without ${r.exclude.join(", ")})` : ""}`).join("\n");
}
