import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { EXTRACTABLE } from "../extract.js";
import { type Source, type SourceDocument, guessDocType } from "./source.js";

/**
 * Documents of local folders, organized as `<folder>/<COURSE>/<chapter>/…/<file>`: the first sub-folder is the
 * course code, the second one the chapter. Files directly in `<folder>` have no course.
 */
export class LocalSource implements Source {
  readonly name = "local";

  constructor(private readonly folders: string[]) {}

  async list(): Promise<SourceDocument[]> {
    const documents: SourceDocument[] = [];
    for (const folder of this.folders) {
      const root = path.resolve(folder);
      for (const file of await walk(root)) {
        const parts = path.relative(root, file).split(path.sep);
        const [courseCode, chapter] = parts.length > 1 ? [parts[0], parts.length > 2 ? parts[1] : undefined] : [];
        const { mtime, size } = await stat(file);
        documents.push({
          source: this.name,
          externalId: file,
          title: path.basename(file, path.extname(file)),
          version: `${mtime.getTime()}:${size}`,
          filename: path.basename(file),
          localPath: file,
          courseCode,
          teachers: [],
          chapter,
          docType: guessDocType(path.basename(file), chapter),
          uploadedAt: mtime,
          load: () => readFile(file),
        });
      }
    }
    return documents;
  }
}

async function walk(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (EXTRACTABLE.test(entry.name)) files.push(full);
  }
  return files;
}
