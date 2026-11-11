/**
 * The library: every generated document and video of the output folder, as files that can be listed, streamed,
 * uploaded and synced between a computer and the server (docs/app.md).
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listGenerated } from "../generated.js";
import type { Db } from "../rag/db.js";
import { type Existing, type ReuseClaim, requireNew } from "./reuse.js";
import { type Authorship, authorColumns, authorship, refusal } from "./sharing.js";
import { resolveGenerated } from "../server/files.js";
import { outputDir } from "../vendor.js";
import { latestSnapshot } from "./snapshots.js";

export type LibraryKind = "documents" | "videos";

export interface LibraryFile {
  /** `documents/name.pdf`: the identifier used by every API. */
  id: string;
  kind: LibraryKind;
  name: string;
  ext: string;
  size: number;
  modifiedAt: string;
}

export interface LibraryItem extends Partial<Authorship> {
  kind: "document" | "video";
  /** Base name without extension, shared by the source and its renderings. */
  name: string;
  title: string;
  modifiedAt: string;
  files: LibraryFile[];
  /** Course code and tags (type such as « exercices », topic such as « calcul matriciel »): saved by the agent or the
   * user when `tagged`, otherwise guessed from the name and the title. */
  course?: string;
  tags: string[];
  tagged: boolean;
}

/** The saved tags of an item (`document:name` or `video:name`). */
export interface LibraryTags {
  item: string;
  course?: string;
  tags: string[];
  updatedAt: Date;
}

export interface LibraryTagPatch {
  /** The course code; null removes it. */
  course?: string | null;
  /** Replaces every tag. */
  tags?: string[];
  add?: string[];
  remove?: string[];
}

/** The type tags the library recognises in names and titles, in the order it shows them. */
export const TYPE_TAGS = ["explication", "révision", "exercices", "corrigé", "te blanc", "vidéo"] as const;

const EXTENSIONS: Record<LibraryKind, Set<string>> = {
  documents: new Set([".md", ".pdf", ".docx", ".html"]),
  videos: new Set([".mp4", ".mov", ".gif", ".py", ".tsx"]),
};
const SAFE_NAME = /^[\p{L}\p{N}_-][\p{L}\p{N} ._-]{0,150}$/u;

/** Parses `documents/name.pdf`; undefined for anything not acceptable in the library. */
export function parseLibraryId(id: string): { kind: LibraryKind; name: string; ext: string } | undefined {
  const match = /^(documents|videos)\/([^/\\]+)$/.exec(id);
  if (!match) return undefined;
  const kind = match[1] as LibraryKind;
  const name = match[2];
  const ext = path.extname(name).toLowerCase();
  if (!SAFE_NAME.test(name) || name.startsWith(".") || name.endsWith(".partial") || !EXTENSIONS[kind].has(ext)) return undefined;
  return { kind, name, ext };
}

/** Every file of the library, flat. */
export function listLibraryFiles(): LibraryFile[] {
  const files: LibraryFile[] = [];
  for (const kind of ["documents", "videos"] as const) {
    const folder = outputDir(kind);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)) {
      const id = `${kind}/${name}`;
      const parsed = parseLibraryId(id);
      if (!parsed) continue;
      const stat = lstatSync(path.join(folder, name));
      if (!stat.isFile()) continue;
      files.push({ id, kind, name, ext: parsed.ext, size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  return files.sort((a, b) => a.id.localeCompare(b.id));
}

/** The library grouped by item: a document with its renderings, a video with its scene source. */
export function listLibrary(keywords: string[] = []): LibraryItem[] {
  const files = listLibraryFiles();
  const titles = new Map(listGenerated(keywords).map((g) => [`${g.kind}:${path.basename(g.file, path.extname(g.file))}`, g]));
  const items = new Map<string, LibraryItem>();
  for (const file of files) {
    const kind = file.kind === "documents" ? "document" : "video";
    const base = path.basename(file.name, file.ext);
    const key = `${kind}:${base}`;
    const generated = titles.get(key);
    const item: LibraryItem = items.get(key) ?? { kind, name: base, title: generated?.title ?? base, modifiedAt: file.modifiedAt, files: [], tags: [], tagged: false };
    item.files.push(file);
    if (file.modifiedAt > item.modifiedAt) item.modifiedAt = file.modifiedAt;
    items.set(key, item);
  }
  // Scene sources belong to the videos they produce, which have the class name, not the file name: attach them by content.
  for (const item of [...items.values()]) {
    if (item.kind !== "video" || item.files.some((f) => f.ext !== ".py" && f.ext !== ".tsx")) continue;
    const scene = item.files[0];
    // The scenes of a high quality video (.tsx) have the name of their video: alone, they were not rendered yet.
    const owners = scene.ext !== ".py" ? [] : [...items.values()].filter((other) => other.kind === "video" && other !== item && titles.get(`video:${other.name}`)?.extra.includes(`scene: ${scene.name} `));
    // A source that produced no video (a helper module, a scene not rendered yet) is not a library item.
    for (const owner of owners) owner.files.push(scene);
    items.delete(`video:${item.name}`);
  }
  const list = [...items.values()];
  if (keywords.length > 0) {
    const order = new Map([...titles.values()].map((g, i) => [g.title, i]));
    return list.filter((i) => order.has(i.title)).sort((a, b) => (order.get(a.title) ?? 0) - (order.get(b.title) ?? 0));
  }
  return list.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A tag as stored: lower case, single spaces, no leading #; empty when nothing is left. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
}

const normalizeTags = (tags: string[]) => [...new Set(tags.map(normalizeTag).filter(Boolean))];

export const libraryItemKey = (item: Pick<LibraryItem, "kind" | "name">) => `${item.kind}:${item.name}`;

/** What the name and title of an item say about it: the course code among the known ones, and the type tags. */
export function classify(item: Pick<LibraryItem, "kind" | "name" | "title">, courses: string[]): { course?: string; tags: string[] } {
  const text = plain(`${item.name} ${item.title}`);
  const course = courses.find((c) => c && new RegExp(`(^|[^a-z0-9])${escapeRegExp(plain(c))}([^a-z0-9]|$)`).test(text));
  const tags: string[] = [];
  if (/explication|expliqu|comprendre|introduction|demonstration|preuve|\bcours\b|lecon/.test(text)) tags.push("explication");
  if (/revision|fiche|resume|recap|memo|synthese|formulaire/.test(text)) tags.push("révision");
  if (/exercice|exos?\b|serie|entrainement|probleme/.test(text)) tags.push("exercices");
  if (/corrig|solution/.test(text)) tags.push("corrigé");
  if (/\bte\b.{0,3}blanc|examen blanc|test blanc|\bte\s*\d|\bte\b/.test(text)) tags.push("te blanc");
  if (item.kind === "video") tags.push("vidéo");
  return { course: course?.toUpperCase(), tags };
}

/** Items with their saved tags, or the guessed ones when nothing was saved (saved course and tags each fall back). */
export function annotateLibrary(items: LibraryItem[], saved: Map<string, LibraryTags>, courses: string[]): LibraryItem[] {
  return items.map((item) => {
    const own = saved.get(libraryItemKey(item));
    const guess = classify(item, courses);
    return { ...item, course: own?.course ?? guess.course, tags: own && own.tags.length > 0 ? own.tags : guess.tags, tagged: own !== undefined };
  });
}

const toTags = (r: Record<string, unknown>): LibraryTags => ({ item: r.item as string, course: (r.course as string | null) ?? undefined, tags: (r.tags as string[]) ?? [], updatedAt: r.updated_at as Date });

export async function listLibraryTags(db: Db): Promise<Map<string, LibraryTags>> {
  const { rows } = await db.query("SELECT * FROM library_tags");
  return new Map(rows.map((r) => [r.item as string, toTags(r)]));
}

/** Saves the course and tags of an item (`document:name`), merging with what was saved before. */
export async function setLibraryTags(db: Db, item: string, patch: LibraryTagPatch): Promise<LibraryTags> {
  if (!/^(document|video):[^/\\]+$/.test(item)) throw new Error(`"${item}" is not a library item (document:name or video:name)`);
  const current = (await listLibraryTags(db)).get(item);
  let tags = patch.tags ? normalizeTags(patch.tags) : (current?.tags ?? []);
  if (patch.add) tags = normalizeTags([...tags, ...patch.add]);
  if (patch.remove) {
    const gone = new Set(normalizeTags(patch.remove));
    tags = tags.filter((t) => !gone.has(t));
  }
  if (tags.length > MAX_TAGS) throw new Error(`At most ${MAX_TAGS} tags per item`);
  const course = patch.course === undefined ? (current?.course ?? null) : patch.course?.trim().toUpperCase() || null;
  const { rows } = await db.query(
    `INSERT INTO library_tags (item, course, tags, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (item) DO UPDATE SET course = EXCLUDED.course, tags = EXCLUDED.tags, updated_at = now() RETURNING *`,
    [item, course, tags],
  );
  return toTags(rows[0]);
}

/** The course codes of the student, from the GAPS snapshots (study plan and grades), to recognise them in file names. */
export async function knownCourses(db: Db): Promise<string[]> {
  const codes = new Set<string>();
  try {
    const plan = await latestSnapshot<{ unit?: { code?: string } }[]>(db, "plan");
    for (const u of plan?.data ?? []) if (u.unit?.code) codes.add(u.unit.code.toUpperCase());
    const grades = await latestSnapshot<{ course?: string }[]>(db, "grades");
    for (const g of grades?.data ?? []) if (g.course) codes.add(g.course.split(" ")[0].toUpperCase());
  } catch {
    // No snapshots table yet (first start): nothing to recognise.
  }
  return [...codes].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** Who created each item (`document:name`). Items nobody is known to have created are missing: anyone may change them. */
export async function libraryAuthors(db: Db): Promise<Map<string, Authorship>> {
  const { rows } = await db.query(`SELECT i.item, ${authorColumns("i")} FROM library_items i`);
  return new Map(rows.map((r) => [r.item as string, authorship(r)]));
}

const UNOWNED: Authorship = { mine: false, editable: true };

/** The library with its tags and authors, the usual entry point of the API, the MCP tools and the CLI. */
export async function annotatedLibrary(db: Db, keywords: string[] = []): Promise<LibraryItem[]> {
  const authors = await libraryAuthors(db);
  return annotateLibrary(listLibrary(keywords), await listLibraryTags(db), await knownCourses(db)).map((item) => ({ ...item, ...(authors.get(libraryItemKey(item)) ?? UNOWNED) }));
}

/** The item a library file belongs to: `documents/notes.pdf` gives `document:notes`. */
export function itemKeyOfFile(id: string): string | undefined {
  const parsed = parseLibraryId(id);
  return parsed ? `${parsed.kind === "documents" ? "document" : "video"}:${path.basename(parsed.name, parsed.ext)}` : undefined;
}

/**
 * Before writing the files of an item: the name becomes the current account's when nobody has it, and an error says
 * whose it is otherwise. A name is therefore never overwritten by someone else's work.
 */
export async function claimLibraryItems(db: Db, keys: string[]): Promise<void> {
  for (const key of new Set(keys)) {
    await requireLibraryEditable(db, key);
    await db.query("INSERT INTO library_items (item) VALUES ($1) ON CONFLICT (item) DO NOTHING", [key]);
  }
}

/** An error when the item belongs to someone else (changing its files, deleting it). */
export async function requireLibraryEditable(db: Db, key: string): Promise<void> {
  const who = (await libraryAuthors(db)).get(key);
  if (who && !who.editable) throw refusal(`"${key}"`, who.author, "Give it to the user as it is, or create yours under another name.");
}

/** Once the last file of an item is gone, its name is free again. */
export async function releaseLibraryItem(db: Db, key: string): Promise<void> {
  const [kind, name] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  const left = listLibraryFiles().some((f) => itemKeyOfFile(f.id) === `${kind}:${name}`);
  if (left) return;
  await db.query("DELETE FROM library_tags WHERE item = $1", [key]);
  await db.query("DELETE FROM library_items WHERE item = $1", [key]);
}

/**
 * Files that were in the library before the accounts existed, or were put there by hand, get the given owner (the
 * first administrator, who took over the installation). Run when the server starts.
 */
export async function adoptLibrary(db: Db, owner: number): Promise<number> {
  const keys = [...new Set(listLibraryFiles().map((f) => itemKeyOfFile(f.id)!))];
  if (keys.length === 0) return 0;
  const { rowCount } = await db.system.query("INSERT INTO library_items (item, created_by) SELECT k, $2 FROM unnest($1::text[]) AS k ON CONFLICT (item) DO NOTHING", [keys, owner]);
  return rowCount ?? 0;
}

/** The library as the duplicate check sees it (src/app/reuse.ts). */
export const libraryExisting = (items: LibraryItem[], kind: LibraryItem["kind"]): Existing[] =>
  items.filter((i) => i.kind === kind).map((i) => ({ ref: libraryItemKey(i), title: i.title === i.name ? i.name : `${i.title} (${i.name})`, course: i.course, author: i.author, mine: i.mine ?? false }));

/**
 * Before rendering a document or a video under `name`: fine when it is an item of the current account (a new version
 * of its own work), refused when the name is someone else's, and checked against similar items when it is new.
 */
export function requireNewLibraryItem(items: LibraryItem[], kind: LibraryItem["kind"], wanted: { name: string; title?: string }, claim: ReuseClaim | undefined): void {
  const same = items.find((i) => i.kind === kind && i.name === wanted.name);
  if (same?.editable === false) throw refusal(`the ${kind} "${wanted.name}"`, same.author, "Give it to the user as it is (list_library, get_download_link), or create yours under another name.");
  if (same) return;
  const title = wanted.title && wanted.title !== wanted.name ? `${wanted.title} ${wanted.name}` : wanted.name;
  requireNew(kind, { title }, libraryExisting(items, kind), claim, "Look at them first (list_library, list_generated with keywords, then the file itself).");
}

/**
 * The item named by a file (`documents/name.pdf`, a path), an item key (`document:name`), a base name or a title.
 * Throws when nothing matches or several items do.
 */
export function findLibraryItem(items: LibraryItem[], ref: string): LibraryItem {
  const text = ref.trim();
  const keyed = /^(document|video):(.+)$/.exec(text);
  const filed = /(?:^|[/\\])(documents|videos)[/\\]([^/\\]+)$/.exec(text);
  const kind = keyed ? (keyed[1] as LibraryItem["kind"]) : filed ? (filed[1] === "documents" ? "document" : "video") : undefined;
  let name = keyed ? keyed[2] : filed ? filed[2] : text.split(/[/\\]/).pop() ?? text;
  const ext = path.extname(name).toLowerCase();
  if (EXTENSIONS.documents.has(ext) || EXTENSIONS.videos.has(ext)) name = name.slice(0, -ext.length);
  const candidates = items.filter((i) => kind === undefined || i.kind === kind);
  const exact = candidates.filter((i) => i.name === name);
  const loose = exact.length > 0 ? exact : candidates.filter((i) => i.name.toLowerCase() === name.toLowerCase() || i.title.toLowerCase() === text.toLowerCase());
  if (loose.length === 1) return loose[0];
  if (loose.length === 0) throw new Error(`No library item "${ref}"`);
  throw new Error(`Several items match "${ref}": ${loose.map((i) => `${i.kind}:${i.name}`).join(", ")}`);
}

/** The real path of a library file, or undefined (same rules as downloads). */
export function libraryFile(id: string): string | undefined {
  return parseLibraryId(id) ? resolveGenerated(id) : undefined;
}

/** Writes a file into the library atomically, keeping the given modification time (for syncs). */
export function saveLibraryFile(id: string, content: Buffer, modifiedAt?: Date): LibraryFile {
  const parsed = parseLibraryId(id);
  if (!parsed) throw new Error(`"${id}" is not an acceptable library file (documents/*.md|pdf|docx|html, videos/*.mp4|mov|gif|py)`);
  const folder = outputDir(parsed.kind);
  mkdirSync(folder, { recursive: true });
  const target = path.join(folder, parsed.name);
  if (existsSync(target) && !lstatSync(target).isFile()) throw new Error(`${id} exists and is not a regular file`);
  const partial = path.join(folder, `.${parsed.name}.partial`);
  writeFileSync(partial, content);
  if (modifiedAt && !Number.isNaN(modifiedAt.getTime())) utimesSync(partial, modifiedAt, modifiedAt);
  renameSync(partial, target);
  const stat = statSync(target);
  return { id, kind: parsed.kind, name: parsed.name, ext: parsed.ext, size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

export function deleteLibraryFile(id: string): boolean {
  const file = libraryFile(id);
  if (!file) return false;
  rmSync(file);
  return true;
}

/** Two copies of a file are the same when their size and modification time (to the second) match. */
export function sameFile(a: SyncFile, b: SyncFile): boolean {
  return a.size === b.size && Math.abs(Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt)) < 1500;
}

export interface SyncPlan<T extends SyncFile = LibraryFile> {
  push: T[];
  pull: T[];
}

/** What a sync compares: a path, a size and a modification time (library files, past exam files). */
export interface SyncFile {
  id: string;
  size: number;
  modifiedAt: string;
}

/** Which files each side lacks or has an older copy of. */
export function planSync<T extends SyncFile>(local: T[], remote: T[]): SyncPlan<T> {
  const byId = (files: T[]) => new Map(files.map((f) => [f.id, f]));
  const here = byId(local);
  const there = byId(remote);
  const push = local.filter((f) => {
    const other = there.get(f.id);
    return !other || (!sameFile(f, other) && Date.parse(f.modifiedAt) > Date.parse(other.modifiedAt));
  });
  const pull = remote.filter((f) => {
    const other = here.get(f.id);
    return !other || (!sameFile(f, other) && Date.parse(f.modifiedAt) > Date.parse(other.modifiedAt));
  });
  return { push, pull };
}
