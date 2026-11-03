import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { outputDir } from "../vendor.js";

export type OutputKind = "documents" | "videos";

/** What can be downloaded: never scene sources' neighbours such as hidden files or anything else in the folders. */
const DOWNLOADABLE = new Set([".pdf", ".docx", ".html", ".md", ".mp4", ".mov", ".gif", ".py"]);

export const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".gif": "image/gif",
};

/**
 * The real path of a generated file from its identifier `documents/name.pdf`, or undefined for anything else: other
 * folders, subfolders, `..`, hidden files, other types, symbolic links.
 */
export function resolveGenerated(id: string): string | undefined {
  const match = /^(documents|videos)\/([^/\\]+)$/.exec(id);
  if (!match) return undefined;
  const [, kind, name] = match;
  if (name.startsWith(".") || name.includes("\0") || !DOWNLOADABLE.has(path.extname(name).toLowerCase())) return undefined;
  try {
    const root = realpathSync(outputDir(kind as OutputKind));
    const file = path.join(root, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || realpathSync(file) !== file) return undefined;
    return file;
  } catch {
    return undefined;
  }
}

/** The identifier of a generated file given by its path (as list_generated shows it) or already an identifier. */
export function generatedId(file: string): string {
  if (/^(documents|videos)\/[^/\\]+$/.test(file)) return file;
  const resolved = path.resolve(file);
  for (const kind of ["documents", "videos"] as const) {
    if (path.dirname(resolved) === outputDir(kind)) return `${kind}/${path.basename(resolved)}`;
  }
  throw new Error("Only generated documents and videos can be downloaded");
}
