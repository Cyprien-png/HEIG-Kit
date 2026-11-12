/**
 * Past exams (« anciens TE »): the scanned written tests of former years, filed by branch, year and test, with the
 * statement and the solutions the agent writes from them, and the student's own attempts (docs/app.md).
 *
 * Everything is files under the `exams` output folder: `<branch…>/<year>/<slug>/` holds the originals
 * (`original.pdf`: a scan filled by a student, `original-vierge.pdf`: unfilled, `original-corrige.pdf`: the teacher's
 * solutions), the generated `enonce.md` / `enonce.pdf` (the statement alone, nothing a student wrote) and `corrige.md`
 * / `corrige.pdf`, the page images `pages/p01.png`… the agent reads, and `exam.json` (what the file names said).
 */
import { requireAdmin } from "./sharing.js";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Db } from "../rag/db.js";
import { outputDir } from "../vendor.js";
import { type Correction, listCorrections } from "./corrections.js";
import { type ExamAttempt, type ExamScore, type ExamStatus, attemptOf } from "./exams.js";

/** What an original PDF is: a scan filled by a student, an unfilled copy, the teacher's solutions, or a scan with the solutions written in. */
export type OriginalRole = "filled" | "blank" | "solutions" | "included";

export interface ExamMeta {
  title: string;
  /** Course code as the file names write it (MAD, PRG1, INF1). */
  course: string;
  /** Teacher's initials when the file name has them (JHH, GMB). */
  teacher?: string;
  /** School year, `2024-2025`. */
  year: string;
  /** `TE1`, `TE2`, `EXA`, `examen`. */
  number: string;
  /** `a`, `b`, `partie1`, `1A` (class)… */
  variant?: string;
  /** The teacher's solutions are inside `original.pdf` (« corrigé inclus »). */
  solutionsIncluded?: boolean;
  importedAt: string;
  /** The archive files each original came from. */
  sources: Record<string, string>;
}

export interface ExamFile {
  /** Name inside the exam folder (`original.pdf`, `enonce.md`, `pages/p01.png`). */
  name: string;
  size: number;
  modifiedAt: string;
}

export interface PastExam {
  /** `MAD/2024-2025/MAD_JHH_24-25_TE1`: the folder path, what a correction's `exam:<id>` names. */
  id: string;
  /** Branch path: `["MAD"]`, `["PRG1", "INF1"]`. */
  branch: string[];
  year: string;
  slug: string;
  meta: ExamMeta;
  files: ExamFile[];
  /** Which pieces exist. */
  has: { original: boolean; blank: boolean; teacherSolutions: boolean; statement: boolean; statementPdf: boolean; solutions: boolean; solutionsPdf: boolean; pages: number };
  attempts: ExamAttempt[];
  status: ExamStatus;
  last?: ExamAttempt;
  best?: ExamScore;
}

/** A flat file of the exams tree, for syncs (`exams/<id>/<name>`). */
export interface ExamTreeFile {
  id: string;
  size: number;
  modifiedAt: string;
}

export const examsDir = () => outputDir("exams");
const YEAR = /^(\d{4})-(\d{4})$/;
const SEGMENT = /^[\p{L}\p{N}_-][\p{L}\p{N} ._-]{0,150}$/u;
const FILE_EXT = new Set([".pdf", ".md", ".png", ".svg", ".json", ".html"]);
const ORIGINALS = ["original.pdf", "original-vierge.pdf", "original-corrige.pdf"] as const;

const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Whether a path inside the tree is acceptable: `MAD/2024-2025/slug/pages/p01.png`, no dot segments, known types. */
export function parseExamPath(id: string): { exam: string; name: string } | undefined {
  const parts = id.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith(".") || !SEGMENT.test(p))) return undefined;
  const inPages = parts.length >= 2 && parts.at(-2) === "pages";
  const name = parts.at(-1)!;
  if (!FILE_EXT.has(path.extname(name).toLowerCase())) return undefined;
  const examParts = parts.slice(0, inPages ? -2 : -1);
  // Branch (one folder at least), year, exam folder.
  if (examParts.length < 3 || !YEAR.test(examParts.at(-2)!) || examParts.slice(0, -2).some((p) => YEAR.test(p) || p === "pages")) return undefined;
  return { exam: examParts.join("/"), name: inPages ? `pages/${name}` : name };
}

/** The real path of a file of the tree, or undefined (outside the folder, symbolic link, unknown type). */
export function pastExamFile(id: string): string | undefined {
  if (!parseExamPath(id)) return undefined;
  try {
    const root = path.resolve(examsDir());
    const file = path.join(root, ...id.split("/"));
    const stat = lstatSync(file);
    return stat.isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/** Writes a file of the tree atomically, keeping its modification time (for syncs). */
export function savePastExamFile(id: string, content: Buffer, modifiedAt?: Date): ExamTreeFile {
  requireAdmin("add or change a past written test");
  const parsed = parseExamPath(id);
  if (!parsed) throw new Error(`"${id}" is not an acceptable past exam file (<branch>/<year>/<exam>/<name>.pdf|md|png|svg|json)`);
  const file = path.join(path.resolve(examsDir()), ...id.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && !lstatSync(file).isFile()) throw new Error(`${id} exists and is not a regular file`);
  const partial = path.join(path.dirname(file), `.${path.basename(file)}.partial`);
  writeFileSync(partial, content);
  if (modifiedAt && !Number.isNaN(modifiedAt.getTime())) utimesSync(partial, modifiedAt, modifiedAt);
  renameSync(partial, file);
  const stat = statSync(file);
  return { id, size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

export function deletePastExamFile(id: string): boolean {
  requireAdmin("delete a past written test");
  const file = pastExamFile(id);
  if (!file) return false;
  rmSync(file);
  return true;
}

/** Every file of the tree, flat, for syncs. */
export function listPastExamFiles(): ExamTreeFile[] {
  const root = examsDir();
  if (!existsSync(root)) return [];
  const files: ExamTreeFile[] = [];
  const walk = (folder: string, rel: string[]) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full, [...rel, entry.name]);
      else if (entry.isFile()) {
        const id = [...rel, entry.name].join("/");
        if (parseExamPath(id)) {
          const stat = statSync(full);
          files.push({ id, size: stat.size, modifiedAt: stat.mtime.toISOString() });
        }
      }
    }
  };
  walk(root, []);
  return files.sort((a, b) => a.id.localeCompare(b.id));
}

// Import of an archive folder

export interface ParsedName {
  course: string;
  teacher?: string;
  /** `2024-2025` */
  year?: string;
  number: string;
  variant?: string;
  role: OriginalRole;
}

/**
 * What a file name of the archives says: `MAD_JHH_24-25_TE1_corrigé.pdf`, `PRG1_GMB_23-24_TE1a_blanc.pdf`,
 * `INF_OCE_16-17_TE3_corrige.pdf`, `PRG1_21-22_EXA_partie2.pdf`, `MAD_examen_14-15.pdf`. Undefined when it is not a test.
 */
export function parseExamName(filename: string): ParsedName | undefined {
  const base = plain(path.basename(filename, path.extname(filename))).replace(/\s+/g, "_");
  const tokens = base.split(/[_-]+/).filter(Boolean);
  if (tokens.length < 2) return undefined;
  const course = tokens[0].toUpperCase();
  if (!/^[A-Z]{2,5}\d?$/.test(course)) return undefined;
  let teacher: string | undefined;
  let year: string | undefined;
  let number: string | undefined;
  let variant: string | undefined;
  let role: OriginalRole = "filled";
  const rest: string[] = [];
  for (const [i, t] of tokens.slice(1).entries()) {
    const yy = /^(\d{2})$/.exec(t);
    if (yy && !year && tokens[i + 2] && /^\d{2}$/.test(tokens[i + 2])) continue; // first half of 24-25, handled on the second
    if (yy && !year && /^\d{2}$/.test(tokens[i] ?? "")) {
      year = `20${tokens[i]}-20${t}`;
      continue;
    }
    if (/^te\d+[a-z]?$/.test(t) && !number) {
      number = t.toUpperCase();
      const letter = /[a-z]$/.exec(t);
      if (letter) {
        number = number.slice(0, -1);
        variant = letter[0];
      }
      continue;
    }
    if ((t === "exa" || t === "examen" || t === "exam") && !number) {
      number = "EXA";
      continue;
    }
    if (/^[a-z]{3}$/.test(t) && !teacher && !number && !/^(te|exa)$/.test(t)) {
      teacher = t.toUpperCase();
      continue;
    }
    if (/^corrig/.test(t) || t === "correction" || t === "solution" || t === "solutions") {
      role = role === "included" ? role : "solutions";
      continue;
    }
    if (t === "inclu" || t === "inclus") {
      role = "included";
      continue;
    }
    if (t === "vierge" || t === "blanc") {
      role = "blank";
      continue;
    }
    rest.push(t);
  }
  if (!number) return undefined;
  const extra = rest.join("-");
  if (extra) variant = variant ? `${variant}-${extra}` : extra;
  return { course, teacher, year, number, variant, role };
}

export interface ImportItem {
  id: string;
  meta: ExamMeta;
  /** Source file → name inside the exam folder. */
  copies: { from: string; to: string }[];
}

export interface ImportPlan {
  items: ImportItem[];
  /** Files of the folder that are not written tests (labs, exercise sheets, archives). */
  skipped: string[];
}

const slugify = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
const ROLE_RANK: Record<OriginalRole, number> = { filled: 0, blank: 1, solutions: 2, included: 3 };
const ROLE_FILE: Record<OriginalRole, string> = { filled: "original.pdf", blank: "original-vierge.pdf", solutions: "original-corrige.pdf", included: "original-corrige.pdf" };

/**
 * Plans the import of an archive folder laid out as `<branch>/[<sub-branch>/]<year>/<files or folders>`: each written
 * test becomes one exam folder with its originals named by role. Nothing is copied yet.
 */
export function planImport(root: string, branch?: string): ImportPlan {
  const found: { full: string; rel: string[]; parsed: ParsedName }[] = [];
  const skipped: string[] = [];
  const walk = (folder: string, rel: string[]) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.startsWith("__MACOSX")) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full, [...rel, entry.name]);
        continue;
      }
      if (!entry.isFile()) continue;
      const parsed = path.extname(entry.name).toLowerCase() === ".pdf" ? parseExamName(entry.name) : undefined;
      if (!parsed || !rel.some((p) => YEAR.test(p))) {
        skipped.push(path.relative(root, full));
        continue;
      }
      found.push({ full, rel, parsed });
    }
  };
  walk(root, []);
  found.sort((a, b) => a.rel.join("/").localeCompare(b.rel.join("/")) || ROLE_RANK[a.parsed.role] - ROLE_RANK[b.parsed.role] || a.full.localeCompare(b.full));

  const items = new Map<string, ImportItem>();
  for (const { full, rel, parsed } of found) {
    const yearIndex = rel.findIndex((p) => YEAR.test(p));
    const year = rel[yearIndex];
    // The folders above the year name the branch; the archive's top folder is dropped when it repeats the next one.
    let branchParts = rel.slice(0, yearIndex).filter((p, i, all) => !(i > 0 && plain(p) === plain(all[i - 1])));
    if (branch) branchParts = [branch, ...branchParts.filter((p) => plain(p) !== plain(branch))];
    if (branchParts.length === 0) branchParts = [parsed.course];
    // `INF_OCE_16-17_TE3` inside the INF1 folder is an INF1 test.
    const leaf = branchParts.at(-1)!;
    const course = plain(leaf).startsWith(plain(parsed.course)) && /^[A-Za-z]{2,5}\d?$/.test(leaf) ? leaf.toUpperCase() : parsed.course;
    const schoolYear = parsed.year ?? year;
    // A folder below the year (MAD_RTE_1A_16-17_TE1) carries the class.
    const classMatch = rel.slice(yearIndex + 1).map((p) => /_(\d[A-Z])_/.exec(p)?.[1]).find(Boolean);
    const variant = [classMatch, parsed.variant].filter(Boolean).join("-") || undefined;
    const slug = slugify([course, parsed.teacher, schoolYear.replace(/^20(\d{2})-20(\d{2})$/, "$1-$2"), parsed.number, variant].filter(Boolean).join("_"));
    const id = [...branchParts, year, slug].join("/");
    const item = items.get(id) ?? {
      id,
      meta: { title: "", course, teacher: parsed.teacher, year: schoolYear, number: parsed.number, variant, importedAt: new Date().toISOString(), sources: {} },
      copies: [],
    };
    let name = ROLE_FILE[parsed.role];
    // A scan with the solutions written in stands for the original when there is no plain scan.
    if (parsed.role === "included") {
      item.meta.solutionsIncluded = true;
      if (!item.copies.some((c) => c.to === "original.pdf")) name = "original.pdf";
    }
    // A second file of the same role (TE2_2 and TE2) keeps a numbered name.
    for (let n = 2; item.copies.some((c) => c.to === name); n++) name = ROLE_FILE[parsed.role].replace(/\.pdf$/, `-${n}.pdf`);
    item.copies.push({ from: full, to: name });
    item.meta.sources[name] = path.relative(root, full);
    items.set(id, item);
  }
  for (const item of items.values()) {
    const m = item.meta;
    m.title = `${m.course} ${m.number === "EXA" ? "Examen" : m.number}${m.variant ? ` (${m.variant})` : ""} · ${m.year}${m.teacher ? ` · ${m.teacher}` : ""}`;
  }
  return { items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)), skipped: skipped.sort() };
}

/** Copies the planned files into the exams folder and writes each `exam.json`; existing files are kept unless `overwrite`. */
export function runImport(plan: ImportPlan, overwrite = false): { imported: string[]; kept: string[] } {
  const imported: string[] = [];
  const kept: string[] = [];
  for (const item of plan.items) {
    const folder = path.join(examsDir(), ...item.id.split("/"));
    mkdirSync(folder, { recursive: true });
    const metaFile = path.join(folder, "exam.json");
    const existing = existsSync(metaFile) ? (JSON.parse(readFileSync(metaFile, "utf-8")) as ExamMeta) : undefined;
    let changed = false;
    for (const copy of item.copies) {
      const target = path.join(folder, copy.to);
      if (existsSync(target) && !overwrite) continue;
      copyFileSync(copy.from, target);
      const stat = statSync(copy.from);
      utimesSync(target, stat.mtime, stat.mtime);
      changed = true;
    }
    const meta: ExamMeta = existing && !overwrite ? { ...existing, sources: { ...item.meta.sources, ...existing.sources } } : item.meta;
    if (!existing || changed || overwrite) writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    (changed || !existing ? imported : kept).push(item.id);
  }
  return { imported, kept };
}

// Listing

function readMeta(folder: string, id: string): ExamMeta {
  const parts = id.split("/");
  const fallback: ExamMeta = { title: parts.at(-1)!, course: parts[0], year: parts.at(-2)!, number: "", importedAt: "", sources: {} };
  try {
    return { ...fallback, ...(JSON.parse(readFileSync(path.join(folder, "exam.json"), "utf-8")) as Partial<ExamMeta>) };
  } catch {
    return fallback;
  }
}

/** The exams of the tree, without attempts. */
export function listPastExamsOnDisk(): Omit<PastExam, "attempts" | "status" | "last" | "best">[] {
  const byExam = new Map<string, ExamFile[]>();
  for (const f of listPastExamFiles()) {
    const parsed = parseExamPath(f.id)!;
    byExam.set(parsed.exam, [...(byExam.get(parsed.exam) ?? []), { name: parsed.name, size: f.size, modifiedAt: f.modifiedAt }]);
  }
  return [...byExam.entries()].map(([id, files]) => {
    const parts = id.split("/");
    const names = new Set(files.map((f) => f.name));
    return {
      id,
      branch: parts.slice(0, -2),
      year: parts.at(-2)!,
      slug: parts.at(-1)!,
      meta: readMeta(path.join(examsDir(), ...parts), id),
      files,
      has: {
        original: names.has("original.pdf"),
        blank: names.has("original-vierge.pdf"),
        teacherSolutions: names.has("original-corrige.pdf"),
        statement: names.has("enonce.md"),
        statementPdf: names.has("enonce.pdf"),
        solutions: names.has("corrige.md"),
        solutionsPdf: names.has("corrige.pdf"),
        pages: files.filter((f) => f.name.startsWith("pages/")).length,
      },
    };
  });
}

/** The exams with the student's attempts: the corrections whose `exam` is `exam:<id>`. */
export function withAttempts(exams: ReturnType<typeof listPastExamsOnDisk>, corrections: Correction[]): PastExam[] {
  return exams
    .map((e) => {
      const attempts = corrections
        .filter((c) => c.exam === `exam:${e.id}`)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(attemptOf);
      const corrected = attempts.filter((a) => a.state === "corrected" && a.score);
      const last = corrected.at(-1);
      const best = corrected.reduce<ExamScore | undefined>((top, a) => (!top || a.score!.grade > top.grade ? a.score : top), undefined);
      return { ...e, attempts, status: (corrected.length > 0 ? "done" : attempts.length > 0 ? "pending" : "todo") as ExamStatus, last, best };
    })
    .sort((a, b) => a.branch.join("/").localeCompare(b.branch.join("/")) || b.year.localeCompare(a.year) || a.slug.localeCompare(b.slug));
}

export async function listPastExams(db: Db, options: { branch?: string; course?: string } = {}): Promise<PastExam[]> {
  const exams = withAttempts(listPastExamsOnDisk(), await listCorrections(db, { limit: 1000 }));
  return exams.filter((e) => (!options.branch || e.branch[0].toUpperCase() === options.branch.toUpperCase()) && (!options.course || e.meta.course.toUpperCase() === options.course.toUpperCase()));
}

/** The exam named by its id, or by a looser reference (slug, title words); throws when nothing or several match. */
export function findPastExam<T extends { id: string; slug: string; meta: ExamMeta }>(exams: T[], ref: string): T {
  const text = ref.trim().replace(/^exam:/, "");
  const exact = exams.find((e) => e.id === text || e.slug === text);
  if (exact) return exact;
  const words = plain(text).split(/[\s_/-]+/).filter(Boolean);
  const loose = exams.filter((e) => words.every((w) => plain(`${e.id} ${e.meta.title}`).includes(w)));
  if (loose.length === 1) return loose[0];
  if (loose.length === 0) throw new Error(`No past exam "${ref}"`);
  throw new Error(`Several past exams match "${ref}": ${loose.map((e) => e.id).join(", ")}`);
}

/** Renders the pages of an original as PNG images (`pages/p01.png`…) with poppler's pdftoppm, for the agent to read; returns their names. */
export function renderPages(id: string, which: "original.pdf" | "original-vierge.pdf" | "original-corrige.pdf" = "original.pdf", dpi = 110): string[] {
  const pdf = pastExamFile(`${id}/${which}`);
  if (!pdf) throw new Error(`No ${which} for ${id}`);
  const folder = path.join(path.dirname(pdf), "pages");
  const prefix = which === "original.pdf" ? "p" : which === "original-vierge.pdf" ? "v" : "c";
  mkdirSync(folder, { recursive: true });
  // Only the pages of this original are replaced: the scan (p), the unfilled copy (v) and the solutions (c) live side by side.
  for (const old of readdirSync(folder)) if (old.startsWith(prefix) && old.endsWith(".png")) rmSync(path.join(folder, old));
  const run = spawnSync("pdftoppm", ["-r", String(dpi), "-png", pdf, path.join(folder, prefix)], { encoding: "utf-8" });
  if (run.error || run.status !== 0) throw new Error(`pdftoppm failed (install poppler: brew install poppler / apt install poppler-utils): ${run.error?.message ?? run.stderr}`);
  const names = readdirSync(folder).filter((n) => n.startsWith(prefix) && n.endsWith(".png")).sort();
  // pdftoppm pads numbers by page count: normalise to two digits so names sort and stay predictable.
  const renamed = names.map((n) => {
    const m = /^([pvc])-?(\d+)\.png$/.exec(n);
    const fixed = m ? `${m[1]}${m[2].padStart(2, "0")}.png` : n;
    if (fixed !== n) renameSync(path.join(folder, n), path.join(folder, fixed));
    return fixed;
  });
  return renamed.sort().map((n) => `pages/${n}`);
}

/** One line per exam, for the terminal and the MCP tools. */
export function formatPastExams(exams: PastExam[]): string {
  if (exams.length === 0) return "No past exam yet (npm run exams -- import <folder>).";
  const pieces = (e: PastExam) => [e.has.original && "scan", e.has.blank && "vierge", e.has.teacherSolutions && "corrigé prof", e.has.statement && "énoncé", e.has.solutions && "corrigé", e.has.pages > 0 && `${e.has.pages} pages`].filter(Boolean).join(", ");
  const status = (e: PastExam) => (e.status === "done" ? `done · ${e.last!.score!.grade.toFixed(1)}/6` : e.status === "pending" ? "correction pending" : "to do");
  let branch = "";
  const lines: string[] = [];
  for (const e of exams) {
    const b = e.branch.join(" / ");
    if (b !== branch) {
      branch = b;
      lines.push(`## ${b}`);
    }
    lines.push(`${e.year}  ${e.meta.title}  [${pieces(e)}]  ${status(e)}\n  id: exam:${e.id}`);
  }
  return lines.join("\n");
}
