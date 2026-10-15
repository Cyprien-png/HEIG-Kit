/**
 * HEIG-Kit documents module: renders a Markdown file (with LaTeX math and Mermaid diagrams) to PDF, HTML and/or DOCX.
 *
 *   npm run doc -- <file.md> [--pdf] [--html] [--docx] [--open] [--out <folder>]
 *
 * PDF is the default. Math ($…$, $$…$$) is rendered with KaTeX, ```mermaid blocks with Mermaid, code with highlight.js,
 * and the PDF is printed by a headless Chromium. DOCX goes through pandoc: math becomes native Word equations and
 * Mermaid diagrams are inserted as images. Videos (![caption](clip.mp4)) are played in HTML and appear in PDF/DOCX as
 * their first frame linking to the video file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import hljs from "highlight.js";
import katex from "katex";
import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import puppeteer, { type Browser } from "puppeteer";

const require = createRequire(import.meta.url);
const asset = (id: string) => pathToFileURL(require.resolve(id)).href;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;

type Target = "pdf" | "html" | "docx";

const STYLE = `
  @page { size: A4; margin: 18mm 16mm 20mm; }
  body { font: 11pt/1.55 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1f2328; max-width: 800px; margin: 0 auto; padding: 0 12px; }
  h1, h2, h3 { line-height: 1.25; margin: 1.4em 0 .5em; } h1 { font-size: 1.9em; border-bottom: 2px solid #d0d7de; padding-bottom: .3em; }
  h2 { font-size: 1.45em; border-bottom: 1px solid #d0d7de; padding-bottom: .2em; } h3 { font-size: 1.2em; }
  h1, h2, h3, figure, pre, table, .katex-display { break-inside: avoid; } h2, h3 { break-after: avoid; }
  code { font: .9em ui-monospace, Menlo, Consolas, monospace; background: #f6f8fa; padding: .1em .3em; border-radius: 4px; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; } pre code { background: none; padding: 0; }
  table { border-collapse: collapse; margin: 1em 0; } th, td { border: 1px solid #d0d7de; padding: 6px 12px; } th { background: #f6f8fa; }
  blockquote { margin: 1em 0; padding: 0 1em; color: #59636e; border-left: 4px solid #d0d7de; }
  img, video { max-width: 100%; } figure { margin: 1.2em 0; text-align: center; } figcaption { color: #59636e; font-size: .9em; margin-top: .4em; }
  pre.mermaid { background: none; text-align: center; }
  .video-link { display: inline-block; position: relative; } .video-link::after { content: "▶"; position: absolute; inset: 0; display: grid; place-items: center; font-size: 48px; color: #fff; text-shadow: 0 0 12px #000; }
`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** First frame (after 1 s) of a video, next to it, when ffmpeg is available (visuals module). */
function videoPoster(video: string): string | undefined {
  const poster = `${video}.poster.png`;
  if (existsSync(poster)) return poster;
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "1", "-i", video, "-frames:v", "1", poster], { stdio: "ignore" });
  return result.status === 0 && existsSync(poster) ? poster : undefined;
}

function markdownRenderer(target: Target, baseDir: string): InstanceType<typeof MarkdownIt> {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight: (code, lang) =>
      lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : "",
  });
  md.use(texmath, { engine: katex, delimiters: ["dollars", "brackets", "beg_end"], katexOptions: { throwOnError: false } });

  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, ...rest) =>
    tokens[idx].info.trim() === "mermaid" ? `<pre class="mermaid">${escapeHtml(tokens[idx].content)}</pre>\n` : fence(tokens, idx, ...rest);

  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, ...rest) => {
    const src = String(tokens[idx].attrGet("src") ?? "");
    if (!VIDEO.test(src)) return image(tokens, idx, ...rest);
    const caption = escapeHtml(tokens[idx].content);
    const file = path.resolve(baseDir, decodeURI(src));
    if (target === "html") return `<figure><video controls src="${escapeHtml(src)}"></video><figcaption>${caption}</figcaption></figure>`;
    const poster = videoPoster(file);
    const link = pathToFileURL(file).href;
    const preview = poster ? `<a class="video-link" href="${link}"><img src="${pathToFileURL(poster).href}"></a>` : "";
    return `<figure>${preview}<figcaption>▶ <a href="${link}">${caption || path.basename(file)}</a> (vidéo : ${escapeHtml(path.basename(file))})</figcaption></figure>`;
  };
  return md;
}

/** A complete HTML page; `local` assets for printing, CDN assets for a standalone HTML file. */
function htmlPage(markdown: string, title: string, target: Target, baseDir: string, local: boolean): string {
  const body = markdownRenderer(target, baseDir).render(markdown);
  const katexCss = local ? asset("katex/dist/katex.min.css") : "https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css";
  const hljsCss = local ? asset("highlight.js/styles/github.min.css") : "https://cdn.jsdelivr.net/npm/highlight.js@11.12.0/styles/github.min.css";
  const mermaidJs = local ? asset("mermaid/dist/mermaid.min.js") : "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.min.js";
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${katexCss}"><link rel="stylesheet" href="${hljsCss}"><style>${STYLE}</style>
</head><body>
${body}
<script src="${mermaidJs}"></script>
<script>
  mermaid.initialize({ startOnLoad: false, theme: "default" });
  mermaid.run().catch((e) => console.error(e)).finally(() => { window.__rendered = true; });
</script>
</body></html>`;
}

async function withBrowser<T>(use: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await puppeteer.launch({ headless: true, args: process.platform === "linux" ? ["--no-sandbox"] : [] });
  try {
    return await use(browser);
  } finally {
    await browser.close();
  }
}

async function renderPdf(markdown: string, title: string, baseDir: string, output: string): Promise<void> {
  // Written next to the source so that relative image paths resolve.
  const page = path.join(baseDir, `.${path.basename(output)}.render.html`);
  writeFileSync(page, htmlPage(markdown, title, "pdf", baseDir, true));
  try {
    await withBrowser(async (browser) => {
      const tab = await browser.newPage();
      await tab.goto(pathToFileURL(page).href, { waitUntil: "networkidle0" });
      await tab.waitForFunction("window.__rendered === true", { timeout: 60_000 });
      await tab.pdf({
        path: output,
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="font: 9px sans-serif; color: #888; width: 100%; text-align: center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
      });
    });
  } finally {
    rmSync(page, { force: true });
  }
}

/** Replaces Mermaid blocks with PNG images and videos with their poster linking to the file, for pandoc. */
async function prepareForPandoc(markdown: string, baseDir: string, tmp: string): Promise<string> {
  const diagrams = [...markdown.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)];
  let result = markdown;
  if (diagrams.length > 0) {
    await withBrowser(async (browser) => {
      for (const [i, match] of diagrams.entries()) {
        const tab = await browser.newPage();
        await tab.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });
        // A file rather than setContent: about:blank pages may not load local (file://) scripts.
        const page = path.join(tmp, `diagram-${i + 1}.html`);
        writeFileSync(
          page,
          `<!doctype html><meta charset="utf-8"><pre class="mermaid">${escapeHtml(match[1])}</pre>
           <script src="${asset("mermaid/dist/mermaid.min.js")}"></script>
           <script>mermaid.initialize({ startOnLoad: false }); mermaid.run().finally(() => { window.__rendered = true; });</script>`,
        );
        await tab.goto(pathToFileURL(page).href, { waitUntil: "load" });
        await tab.waitForFunction("window.__rendered === true", { timeout: 60_000 });
        const file = path.join(tmp, `diagram-${i + 1}.png`);
        const svg = await tab.$("pre.mermaid svg");
        if (svg) await svg.screenshot({ path: file, omitBackground: false });
        result = result.replace(match[0], svg ? `![](${file})` : match[0]);
        await tab.close();
      }
    });
  }
  return result.replace(/!\[([^\]]*)\]\(([^)]+\.(?:mp4|webm|mov|m4v))\)/gi, (_, caption: string, src: string) => {
    const file = path.resolve(baseDir, decodeURI(src));
    const poster = videoPoster(file);
    const link = pathToFileURL(file).href;
    return `${poster ? `[![${caption}](${poster})](${link})\n\n` : ""}▶ [${caption || path.basename(file)}](${link})`;
  });
}

async function renderDocx(markdown: string, baseDir: string, output: string): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "heig-kit-docx-"));
  try {
    const source = path.join(tmp, "document.md");
    writeFileSync(source, await prepareForPandoc(markdown, baseDir, tmp));
    const result = spawnSync("pandoc", [source, "-f", "markdown", "-t", "docx", "-o", output, `--resource-path=${baseDir}`], {
      encoding: "utf-8",
      shell: process.platform === "win32",
    });
    if (result.error || result.status !== 0) {
      throw new Error(`pandoc failed (install the documents module: npm run setup -- documents): ${result.stderr || result.error?.message}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Opens a file with the default application of the OS. */
function open(file: string): void {
  if (process.platform === "darwin") spawnSync("open", [file]);
  else if (process.platform === "win32") spawnSync("cmd", ["/c", "start", '""', file], { shell: true });
  else spawnSync("xdg-open", [file], { stdio: "ignore" });
}

export async function render(input: string, targets: Target[], outDir?: string): Promise<string[]> {
  const source = path.resolve(input);
  const markdown = readFileSync(source, "utf-8");
  const baseDir = path.dirname(source);
  const folder = path.resolve(outDir ?? baseDir);
  mkdirSync(folder, { recursive: true });
  const name = path.basename(source, path.extname(source));
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1] ?? name;

  const outputs: string[] = [];
  for (const target of targets) {
    const output = path.join(folder, `${name}.${target}`);
    if (target === "pdf") await renderPdf(markdown, title, baseDir, output);
    if (target === "html") writeFileSync(output, htmlPage(markdown, title, "html", baseDir, false));
    if (target === "docx") await renderDocx(markdown, baseDir, output);
    outputs.push(output);
  }
  return outputs;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      pdf: { type: "boolean", default: false },
      html: { type: "boolean", default: false },
      docx: { type: "boolean", default: false },
      open: { type: "boolean", default: false },
      out: { type: "string" },
    },
  });
  if (!positionals[0]) {
    console.log("Usage: npm run doc -- <file.md> [--pdf] [--html] [--docx] [--open] [--out <folder>]");
    process.exit(1);
  }
  const targets = (["pdf", "html", "docx"] as const).filter((t) => values[t]);
  render(positionals[0], targets.length > 0 ? [...targets] : ["pdf"], values.out)
    .then((outputs) => {
      for (const output of outputs) console.log(output);
      if (values.open) outputs.forEach(open);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
