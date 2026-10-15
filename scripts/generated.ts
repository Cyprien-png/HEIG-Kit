/**
 * Lists what was already generated in the output folder (documents and videos), so that the assistant reuses it
 * before creating something new, and opens an existing file.
 *
 *   npm run generated                    everything, most recent first
 *   npm run generated -- hasse ordre     items whose name, title or scene mentions all these words
 *   npm run generated -- --open <file>   open a generated file with the default application
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { outputDir } from "../src/vendor.js";

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

interface Item {
  kind: "document" | "video";
  file: string;
  title: string;
  modified: Date;
  extra: string;
}

function documents(): Item[] {
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

function videos(): Item[] {
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

function open(file: string): void {
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  if (process.platform === "darwin") spawnSync("open", [file]);
  else if (process.platform === "win32") spawnSync("cmd", ["/c", "start", '""', file], { shell: true });
  else spawnSync("xdg-open", [file], { stdio: "ignore" });
}

const args = process.argv.slice(2);
if (args[0] === "--open") {
  open(path.resolve(args[1] ?? ""));
} else {
  const words = args.map(normalize);
  const items = [...documents(), ...videos()]
    .filter((item) => words.every((w) => normalize(`${path.basename(item.file)} ${item.title} ${item.extra}`).includes(w)))
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
  if (items.length === 0) console.log(words.length ? "Nothing generated yet on this topic." : "Nothing generated yet.");
  for (const item of items) {
    console.log(`${item.kind.padEnd(9)} ${item.modified.toISOString().slice(0, 10)}  ${item.title}\n          ${item.file}${item.extra ? `  (${item.extra})` : ""}`);
  }
}
