import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatGenerated, listGenerated, openGenerated } from "../../generated.js";
import { ROOT } from "../../paths.js";
import { outputDir } from "../../vendor.js";
import { respond } from "../common.js";

const run = promisify(execFile);
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

/** File name safe on every OS, without extension. */
function fileName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "document";
}

/** Tools that create files on the user's computer: documents (PDF, DOCX, HTML), animations, and what exists already. */
export function registerOutputTools(server: McpServer): void {
  server.registerTool(
    "list_generated",
    {
      title: "Already generated documents and videos",
      description:
        "Lists documents and videos already generated for the user, optionally on a topic: items mentioning any of the " +
        "keywords in their name, title or text, best matches first. Call it BEFORE creating a document or an animation, " +
        "once with several words and synonyms, and reuse or update what exists instead of regenerating it.",
      inputSchema: { keywords: z.string().optional().describe("Topic words and synonyms, e.g. 'ordre total hasse'") },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      respond(async () => {
        const words = (a.keywords ?? "").split(/\s+/).filter(Boolean);
        return formatGenerated(listGenerated(words), words.length > 0);
      }),
  );

  server.registerTool(
    "open_generated",
    {
      title: "Open a generated file",
      description: "Opens a generated document or video (path from list_generated) with the default application of the computer.",
      inputSchema: { file: z.string() },
    },
    async (a) =>
      respond(async () => {
        openGenerated(a.file);
        return `Opened ${a.file}`;
      }),
  );

  server.registerTool(
    "render_document",
    {
      title: "Create a document",
      description:
        "Writes Markdown to the user's documents folder and renders it to PDF (default), DOCX and/or HTML, then opens it. " +
        "Markdown supports LaTeX math ($…$, $$…$$, KaTeX), ```mermaid diagrams, tables, code, and videos as " +
        "![caption](../videos/Scene.mp4). New page: <div style=\"page-break-after: always\"></div>. Requires the " +
        "documents module.",
      inputSchema: {
        name: z.string().describe("Short file name without spaces, e.g. MAD-relations-ordre-exercices"),
        markdown: z.string().describe("The whole document, starting with a # title"),
        formats: z.array(z.enum(["pdf", "docx", "html"])).optional().describe("Default: pdf"),
        open: z.boolean().optional().describe("Open the result (default: true)"),
      },
    },
    async (a) =>
      respond(async () => {
        const renderer = path.join(ROOT, "modules", "documents", "render.ts");
        if (!existsSync(path.join(ROOT, "modules", "documents", "node_modules"))) {
          throw new Error("The documents module is not installed: the user should run `npm run setup -- documents`");
        }
        const folder = outputDir("documents");
        await mkdir(folder, { recursive: true });
        const source = path.join(folder, `${fileName(a.name)}.md`);
        await writeFile(source, a.markdown);
        const formats = (a.formats?.length ? a.formats : ["pdf"]).map((f) => `--${f}`);
        const { stdout } = await run(process.execPath, [TSX, renderer, source, ...formats, ...(a.open === false ? [] : ["--open"])], {
          cwd: ROOT,
          maxBuffer: 10 * 1024 * 1024,
        });
        return `Markdown: ${source}\n${stdout.trim()}`;
      }),
  );

  server.registerTool(
    "render_animation",
    {
      title: "Create an animation",
      description:
        "Writes a ManimGL scene (3b1b/manim 1.7: `from manimlib import *`, ShowCreation not Create, Tex(r\"…\") for math, " +
        "Text/TexText for text, colored with .set_color() since Text(color=…) is ignored) to the user's videos folder, " +
        "checks it, renders it to MP4 and opens it as soon as it is ready, then returns its layout problems (texts over each " +
        "other, lines through texts, off screen) and an image of its key frames: fix them and call again. Ready-made pieces: `from heigkit_manim import *` (title_card, Panel, colored, live_value, approach, " +
        "hole, vertical_asymptote, sign_line, value_table, UnitCircle, recap, source_line). Never create Text or Tex inside " +
        "always_redraw or an updater. On failure, returns manim's error so you can fix the code and call again. Give each " +
        "Scene class a one-line docstring saying what it shows. Requires the visuals module.",
      inputSchema: {
        name: z.string().describe("File name without spaces, e.g. divisibilite_antisymetrie"),
        code: z.string().describe("Python source of the scene(s)"),
        scene: z.string().describe("Name of the Scene class to render"),
        quality: z.enum(["low", "medium", "high"]).optional().describe("medium (720p) by default"),
        open: z.boolean().optional().describe("Open the video (default: true)"),
      },
    },
    async (a) => {
      const folder = outputDir("videos");
      await mkdir(folder, { recursive: true });
      const source = path.join(folder, `${fileName(a.name)}.py`);
      await writeFile(source, a.code);
      const args = [TSX, path.join(ROOT, "modules", "visuals", "render.ts"), source, a.scene, "--quality", a.quality ?? "medium", "--frames"];
      if (a.open !== false) args.push("--open");
      try {
        const { stdout } = await run(process.execPath, args, { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, PYTHONWARNINGS: "ignore" } });
        const lines = stdout.split(/[\r\n]+/).map((l) => l.trim());
        const videos = lines.filter((l) => /\.(mp4|mov|gif)$/.test(l) && path.isAbsolute(l) && existsSync(l));
        const frames = lines.find((l) => l.startsWith("Frames: "))?.slice("Frames: ".length);
        // Layout problems found by the dry run (texts over each other, lines through texts, off screen).
        const layout = lines.filter((l) => l.startsWith("Layout:") || l.startsWith("- animation"));
        const summary = [
          `Scene: ${source}`,
          `Video: ${videos.join(", ") || "(see the videos folder)"}${a.open !== false ? " (opened)" : ""}`,
          ...layout,
        ].join("\n");
        if (!frames || !existsSync(frames)) return { content: [{ type: "text" as const, text: summary }] };
        return {
          content: [
            { type: "text" as const, text: `${summary}\nKey frames of the video (3 per row): check the layout, fix the scene and render again if needed.` },
            { type: "image" as const, data: (await readFile(frames)).toString("base64"), mimeType: "image/png" },
          ],
        };
      } catch (error) {
        const output = error as { stdout?: string; stderr?: string };
        const log = `${output.stderr ?? ""}\n${output.stdout ?? ""}`.replace(/\r/g, "\n").split("\n").filter((l) => l.trim() && !/it\/s\]|\d+%\|/.test(l));
        return { content: [{ type: "text" as const, text: `Rendering failed. Scene file: ${source}\n${log.slice(-40).join("\n")}` }], isError: true };
      }
    },
  );
}
