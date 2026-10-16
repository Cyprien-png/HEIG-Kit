/** Documents and videos generated in the output folder (~/Documents/HEIG-Kit by default), to reuse them. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { outputDir } from "./vendor.js";

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export interface GeneratedItem {
  kind: "document" | "video";
  file: string;
  title: string;
  modified: Date;
  extra: string;
  /** Whole text searched besides the name and title: the Markdown of a document, the Python source of a video. */
  content: string;
}

function documents(): GeneratedItem[] {
  const folder = outputDir("documents");
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const file = path.join(folder, f);
      const base = file.slice(0, -3);
      const formats = ["pdf", "docx", "html"].filter((ext) => existsSync(`${base}.${ext}`));
      const content = readFileSync(file, "utf-8");
      const title = /^#\s+(.+)$/m.exec(content)?.[1] ?? f;
      return {
        kind: "document" as const,
        file,
        title,
        modified: statSync(file).mtime,
        extra: formats.length ? `rendered: ${formats.join(", ")}` : "not rendered",
        content,
      };
    });
}

function videos(): GeneratedItem[] {
  const folder = outputDir("videos");
  if (!existsSync(folder)) return [];
  const scenes = readdirSync(folder)
    .filter((f) => f.endsWith(".py"))
    .map((f) => ({ file: path.join(folder, f), source: readFileSync(path.join(folder, f), "utf-8") }));
  return readdirSync(folder)
    .filter((f) => /\.(mp4|mov|gif)$/i.test(f))
    .map((f) => {
      const scene = path.basename(f, path.extname(f));
      const source = scenes.find((s) => new RegExp(`class\\s+${scene}\\b`).test(s.source));
      // The docstring of the scene's class says what it shows; otherwise the file's first docstring or comment.
      const about =
        source &&
        (new RegExp(`class\\s+${scene}\\b[^\\n]*:\\s*"""([\\s\\S]*?)"""`).exec(source.source)?.[1] ??
          /"""([\s\S]*?)"""/.exec(source.source)?.[1] ??
          /^#\s*(.+)$/m.exec(source.source)?.[1]);
      return {
        kind: "video" as const,
        file: path.join(folder, f),
        title: about?.trim().split("\n")[0] || scene,
        modified: statSync(path.join(folder, f)).mtime,
        extra: source ? `scene: ${path.basename(source.file)} (${scene})` : "",
        content: source?.source ?? "",
      };
    });
}

/** Opens a generated file with the default application; only files of the output folder can be opened. */
export function openGenerated(file: string): void {
  const resolved = path.resolve(file);
  const base = path.dirname(outputDir("documents"));
  if (!resolved.startsWith(base + path.sep)) throw new Error(`Only files in ${base} can be opened`);
  if (!existsSync(resolved)) throw new Error(`${resolved} does not exist`);
  file = resolved;
  if (process.platform === "darwin") spawnSync("open", [file]);
  else if (process.platform === "win32") spawnSync("cmd", ["/c", "start", '""', file], { shell: true });
  else spawnSync("xdg-open", [file], { stdio: "ignore" });
}


/**
 * Generated items mentioning any of the keywords (accents and case ignored), best matches first: a keyword in the file
 * name or title counts twice as much as one in the text (Markdown of a document, scene source of a video), then the
 * most recent first. Give several words at once, synonyms included: "ordre total hasse".
 */
export function listGenerated(keywords: string[] = []): GeneratedItem[] {
  const words = keywords.map(normalize).filter(Boolean);
  return [...documents(), ...videos()]
    .map((item) => {
      const name = normalize(`${path.basename(item.file)} ${item.title} ${item.extra}`);
      const text = normalize(item.content);
      const score = words.reduce((sum, w) => sum + (name.includes(w) ? 2 : text.includes(w) ? 1 : 0), 0);
      return { item, score };
    })
    .filter(({ score }) => words.length === 0 || score > 0)
    .sort((a, b) => b.score - a.score || b.item.modified.getTime() - a.item.modified.getTime())
    .map(({ item }) => item);
}

export function formatGenerated(items: GeneratedItem[], filtered: boolean): string {
  if (items.length === 0) return filtered ? "Nothing generated yet on this topic." : "Nothing generated yet.";
  return items
    .map((item) => `${item.kind.padEnd(9)} ${item.modified.toISOString().slice(0, 10)}  ${item.title}\n          ${item.file}${item.extra ? `  (${item.extra})` : ""}`)
    .join("\n");
}
