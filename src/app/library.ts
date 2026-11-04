/**
 * The library: every generated document and video of the output folder, as files that can be listed, streamed,
 * uploaded and synced between a computer and the server (docs/app.md).
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listGenerated } from "../generated.js";
import { resolveGenerated } from "../server/files.js";
import { outputDir } from "../vendor.js";

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

export interface LibraryItem {
  kind: "document" | "video";
  /** Base name without extension, shared by the source and its renderings. */
  name: string;
  title: string;
  modifiedAt: string;
  files: LibraryFile[];
}

const EXTENSIONS: Record<LibraryKind, Set<string>> = {
  documents: new Set([".md", ".pdf", ".docx", ".html"]),
  videos: new Set([".mp4", ".mov", ".gif", ".py"]),
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
    const item = items.get(key) ?? { kind, name: base, title: generated?.title ?? base, modifiedAt: file.modifiedAt, files: [] };
    item.files.push(file);
    if (file.modifiedAt > item.modifiedAt) item.modifiedAt = file.modifiedAt;
    items.set(key, item);
  }
  // Scene sources belong to the videos they produce, which have the class name, not the file name: attach them by content.
  for (const item of [...items.values()]) {
    if (item.kind !== "video" || item.files.some((f) => f.ext !== ".py")) continue;
    const scene = item.files[0];
    const owners = [...items.values()].filter((other) => other.kind === "video" && other !== item && titles.get(`video:${other.name}`)?.extra.includes(`scene: ${scene.name} `));
    if (owners.length === 0) continue;
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
export function sameFile(a: LibraryFile, b: LibraryFile): boolean {
  return a.size === b.size && Math.abs(Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt)) < 1500;
}

export interface SyncPlan {
  push: LibraryFile[];
  pull: LibraryFile[];
}

/** Which files each side lacks or has an older copy of. */
export function planSync(local: LibraryFile[], remote: LibraryFile[]): SyncPlan {
  const byId = (files: LibraryFile[]) => new Map(files.map((f) => [f.id, f]));
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
