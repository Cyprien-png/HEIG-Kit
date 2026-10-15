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
      const title = /^#\s+(.+)$/m.exec(readFileSync(file, "utf-8"))?.[1] ?? f;
      return { kind: "document" as const, file, title, modified: statSync(file).mtime, extra: formats.length ? `rendered: ${formats.join(", ")}` : "not rendered" };
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
      // The scene's docstring or first comment usually says what it shows.
      const about = source && (/"""([\s\S]*?)"""/.exec(source.source)?.[1] ?? /^#\s*(.+)$/m.exec(source.source)?.[1]);
      return {
        kind: "video" as const,
        file: path.join(folder, f),
        title: about?.trim().split("\n")[0] || scene,
        modified: statSync(path.join(folder, f)).mtime,
        extra: source ? `scene: ${path.basename(source.file)} (${scene})` : "",
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


/** Generated items whose file name, title or scene mentions every keyword, most recent first. */
export function listGenerated(keywords: string[] = []): GeneratedItem[] {
  const words = keywords.map(normalize);
  return [...documents(), ...videos()]
    .filter((item) => words.every((w) => normalize(`${path.basename(item.file)} ${item.title} ${item.extra}`).includes(w)))
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

export function formatGenerated(items: GeneratedItem[], filtered: boolean): string {
  if (items.length === 0) return filtered ? "Nothing generated yet on this topic." : "Nothing generated yet.";
  return items
    .map((item) => `${item.kind.padEnd(9)} ${item.modified.toISOString().slice(0, 10)}  ${item.title}\n          ${item.file}${item.extra ? `  (${item.extra})` : ""}`)
    .join("\n");
}
