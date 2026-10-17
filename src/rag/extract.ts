import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../paths.js";

/** docling-serve of `rag/compose.yml` (profile "ingest"); RAG_DOCLING_URL overrides it. */
const DOCLING_URL = process.env.RAG_DOCLING_URL ?? "http://127.0.0.1:5001";
const EXTRACTED_DIR = path.join(ROOT, "data", "extracted");
const POLL_SECONDS = 10;
/** docling may answer a poll before `wait` elapses: never poll more often than this. */
const MIN_POLL_INTERVAL_MS = 2000;
/** Longest list of figure labels kept in the text (node names, axis labels…). */
const MAX_FIGURE_LABELS_CHARS = 300;

/**
 * Version of the extraction. Raising it makes the next ingestion convert and index every document again.
 * 2: formulas as their raw text (matrices row by row) and figures saved as images with their labels.
 * 3: pages without text (blank pages, scans, full-page images) are kept, so that page numbers match the document.
 */
export const EXTRACTOR_VERSION = 3;

/** Placed between pages in the extracted markdown, so chunks can keep page numbers. */
export const PAGE_BREAK = "<!-- page break -->";

/** File types docling converts; other files (archives, videos, captures…) are not indexed. */
export const EXTRACTABLE = /\.(pdf|docx|pptx|xlsx|html?|md|txt)$/i;

export function extractedMarkdownPath(contentHash: string): string {
  return path.join(EXTRACTED_DIR, `${contentHash}.v${EXTRACTOR_VERSION}.md`);
}

/** Figure `number` (1-based, in reading order) of a document, as referenced by `[figure <number> …]` in its text. */
export function figurePath(contentHash: string, number: number): string {
  return path.join(EXTRACTED_DIR, contentHash, `figure-${number}.png`);
}

/**
 * Converts a document to markdown with docling, pages separated by `PAGE_BREAK`. Results are cached in
 * data/extracted by content hash: a document is only converted once, even across ingestion runs.
 */
export async function extractMarkdown(bytes: Buffer, filename: string, contentHash: string): Promise<string> {
  const cached = extractedMarkdownPath(contentHash);
  try {
    return await readFile(cached, "utf-8");
  } catch {
    // Not converted yet.
  }

  let markdown: string;
  if (/\.(md|txt)$/i.test(filename)) {
    markdown = bytes.toString("utf-8");
  } else {
    const converted = enrichMarkdown(...(await convert(bytes, filename)));
    markdown = converted.markdown;
    await rm(path.join(EXTRACTED_DIR, contentHash), { recursive: true, force: true });
    if (converted.figures.length > 0) await mkdir(path.join(EXTRACTED_DIR, contentHash), { recursive: true });
    for (const [i, png] of converted.figures.entries()) await writeFile(figurePath(contentHash, i + 1), png);
  }
  await mkdir(EXTRACTED_DIR, { recursive: true });
  await writeFile(cached, markdown);
  await rm(path.join(EXTRACTED_DIR, `${contentHash}.md`), { force: true }); // extraction of version 1
  return markdown;
}

export async function isDoclingAvailable(): Promise<boolean> {
  try {
    return (await fetch(`${DOCLING_URL}/health`)).ok;
  } catch {
    return false;
  }
}

/** The parts of docling's JSON document used here. */
interface DoclingNode {
  label?: string;
  /** "body", or "furniture" for page headers and footers. */
  content_layer?: string;
  text?: string;
  orig?: string;
  children?: { $ref: string }[];
  prov?: { page_no: number }[];
  image?: { uri?: string } | null;
}
export interface DoclingDocument {
  body: DoclingNode;
  texts: DoclingNode[];
  pictures: DoclingNode[];
  groups?: DoclingNode[];
  tables?: DoclingNode[];
  /** Pages of the document by number ("1", "2"…). */
  pages?: Record<string, unknown>;
}

const FORMULA_PLACEHOLDER = "<!-- formula-not-decoded -->";
/** A picture in docling's markdown: a placeholder, or the image itself when images are embedded. */
const PICTURE = /<!-- image -->|!\[[^\]]*\]\(data:image\/[^)]*\)/g;

/**
 * Puts back what docling's markdown leaves out: formulas it cannot turn into LaTeX become their raw text from the
 * PDF (`[formule : …]`), and pictures become `[figure <n> : <labels>]`, their image being returned to be saved.
 * Formulas and pictures appear in the markdown in the order of the document's body; if the counts disagree, the
 * placeholders are left as they are rather than risk attaching a formula to the wrong place.
 */
export function enrichMarkdown(markdown: string, document: DoclingDocument | undefined): { markdown: string; figures: Buffer[] } {
  if (!document) return { markdown: markdown.replace(PICTURE, "<!-- image -->"), figures: [] };
  const formulas: DoclingNode[] = [];
  const pictures: DoclingNode[] = [];
  const pages: number[] = [];
  let previousPage: number | undefined;
  const resolve = (ref: string): DoclingNode | undefined => {
    const [, kind, index] = ref.split("/");
    return (document[kind as keyof DoclingDocument] as DoclingNode[] | undefined)?.[Number(index)];
  };
  const walk = (node: DoclingNode, kind: string) => {
    if (node.content_layer === "furniture") return; // page headers and footers, left out of the markdown
    const page = node.prov?.[0]?.page_no;
    if (page !== undefined) {
      if (previousPage === undefined || page > previousPage) pages.push(page);
      previousPage = page;
    }
    if (kind === "pictures") return void pictures.push(node);
    if (kind === "tables") return; // rendered by docling itself, cells included
    if (node.label === "formula" && !node.text) formulas.push(node);
    for (const child of node.children ?? []) {
      const resolved = resolve(child.$ref);
      if (resolved) walk(resolved, child.$ref.split("/")[1]);
    }
  };
  walk(document.body, "body");

  let result = markdown;
  if (result.split(FORMULA_PLACEHOLDER).length - 1 === formulas.length) {
    let i = 0;
    result = result.replaceAll(FORMULA_PLACEHOLDER, () => {
      const text = formulaText(formulas[i++].orig ?? "");
      return text ? `[formule : ${text}]` : FORMULA_PLACEHOLDER;
    });
  }

  const figures: Buffer[] = [];
  if ((result.match(PICTURE) ?? []).length === pictures.length) {
    let i = 0;
    result = result.replace(PICTURE, () => {
      const picture = pictures[i++];
      const uri = picture.image?.uri ?? "";
      if (!uri.startsWith("data:image/png;base64,")) return "<!-- image -->";
      figures.push(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64"));
      const labels = (picture.children ?? [])
        .map((child) => resolve(child.$ref)?.text ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_FIGURE_LABELS_CHARS);
      return `[figure ${figures.length}${labels ? ` : ${labels}` : ""}]`;
    });
  } else {
    result = result.replace(PICTURE, "<!-- image -->");
  }
  return { markdown: restorePages(result, pages, Object.keys(document.pages ?? {}).length), figures };
}

/**
 * docling only places a page break where the page of the next item is higher than the previous one: pages without
 * any item are left out, and counting breaks would shift the following page numbers. `pages` are the pages that
 * start a part of the markdown, in order (the same rule applied to the document's items); empty pages are put back
 * before them, and after the last one up to `pageCount`. If the parts and the pages disagree (or the reading order
 * goes back to an earlier page), the markdown is kept.
 */
export function restorePages(markdown: string, pages: number[], pageCount: number): string {
  const parts = markdown.split(PAGE_BREAK);
  if (pages.length !== parts.length || pages.some((page, i) => page <= (pages[i - 1] ?? 0))) return markdown;
  const emptyPages = (count: number) => `\n\n${PAGE_BREAK}\n\n`.repeat(count);
  return parts
    .map((part, i) => emptyPages(pages[i] - (pages[i - 1] ?? 0) - 1) + part)
    .join(PAGE_BREAK)
    .concat(emptyPages(Math.max(0, pageCount - pages.at(-1)!)));
}

/**
 * Pieces of big brackets in the private use area of the Symbol font (U+F8EB to U+F8FE), where many PDFs leave them,
 * as their Unicode characters; the integral extender (U+F8F5) is dropped.
 */
const SYMBOL_FONT_PIECES = [..."⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪", "", ..."⎞⎟⎠⎤⎥⎦⎫⎬⎭"];

/**
 * Makes the raw text of a formula readable: PDFs draw big brackets with pieces (⎡ ⎢ ⎣), and a matrix's entries
 * come row after row, so a square matrix is written back as rows, e.g. `[1 0; 0 1]`.
 */
export function formulaText(raw: string): string {
  return raw
    .replace(/[\uf8eb-\uf8fe]/g, (c) => SYMBOL_FONT_PIECES[c.charCodeAt(0) - 0xf8eb] ?? c)
    .replace(/([⎡⎛])[⎢⎜\s]*[⎣⎝]([^⎡⎛⎤⎞]*?)[⎤⎞][⎥⎟\s]*[⎦⎠]/g, (_, open: string, inner: string) => {
      const [left, right] = open === "⎛" ? ["(", ")"] : ["[", "]"];
      const entries = inner.trim().split(/\s+/).filter(Boolean);
      const size = Math.round(Math.sqrt(entries.length));
      if (size < 2 || size * size !== entries.length) return `${left}${entries.join(" ")}${right}`;
      const rows = Array.from({ length: size }, (_, r) => entries.slice(r * size, (r + 1) * size).join(" "));
      return `${left}${rows.join("; ")}${right}`;
    })
    .replace(/[⎧⎨⎩⎪]+/g, "{")
    .replace(/[⎫⎬⎭]+/g, "}")
    .replace(/[⎡⎢⎣]+/g, "[")
    .replace(/[⎤⎥⎦]+/g, "]")
    .replace(/[⎛⎜⎝]+/g, "(")
    .replace(/[⎞⎟⎠]+/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

/** Asynchronous conversion (submit, then poll): large documents take longer than an HTTP request may wait. */
async function convert(bytes: Buffer, filename: string): Promise<[string, DoclingDocument | undefined]> {
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(bytes)]), filename);
  form.append("to_formats", "md");
  form.append("to_formats", "json");
  // Course documents are text PDFs: OCR would only slow conversion down. Scanned documents are not supported yet.
  form.append("do_ocr", "false");
  // Figures come embedded in the JSON document, to be saved as images.
  form.append("image_export_mode", "embedded");
  form.append("include_images", "true");
  form.append("images_scale", "2");
  form.append("do_pdf_heading_hierarchy", "true");
  form.append("md_page_break_placeholder", PAGE_BREAK);

  const submitted = await fetch(`${DOCLING_URL}/v1/convert/file/async`, { method: "POST", body: form });
  if (!submitted.ok) throw new Error(`docling refused ${filename}: ${submitted.status} ${await submitted.text()}`);
  const { task_id } = (await submitted.json()) as { task_id: string };

  for (;;) {
    const polled = Date.now();
    const status = (await (await fetch(`${DOCLING_URL}/v1/status/poll/${task_id}?wait=${POLL_SECONDS}`)).json()) as {
      task_status: string;
      error_message?: string;
    };
    if (status.task_status === "success" || status.task_status === "partial_success") break;
    if (status.task_status === "failure" || status.task_status === "skipped") {
      throw new Error(`docling could not convert ${filename}: ${status.error_message ?? status.task_status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_POLL_INTERVAL_MS - (Date.now() - polled))));
  }

  const result = (await (await fetch(`${DOCLING_URL}/v1/result/${task_id}`)).json()) as {
    document?: { md_content?: string; json_content?: DoclingDocument };
  };
  return [result.document?.md_content ?? "", result.document?.json_content];
}
