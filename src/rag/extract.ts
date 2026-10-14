import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../paths.js";

/** docling-serve of `rag/compose.yml` (profile "ingest"); RAG_DOCLING_URL overrides it. */
const DOCLING_URL = process.env.RAG_DOCLING_URL ?? "http://127.0.0.1:5001";
const EXTRACTED_DIR = path.join(ROOT, "data", "extracted");
const POLL_SECONDS = 10;

/** Placed between pages in the extracted markdown, so chunks can keep page numbers. */
export const PAGE_BREAK = "<!-- page break -->";

/** File types docling converts; other files (archives, videos, captures…) are not indexed. */
export const EXTRACTABLE = /\.(pdf|docx|pptx|xlsx|html?|md|txt)$/i;

/**
 * Converts a document to markdown with docling, pages separated by `PAGE_BREAK`. Results are cached in
 * data/extracted by content hash: a document is only converted once, even across ingestion runs.
 */
export async function extractMarkdown(bytes: Buffer, filename: string, contentHash: string): Promise<string> {
  const cached = path.join(EXTRACTED_DIR, `${contentHash}.md`);
  try {
    return await readFile(cached, "utf-8");
  } catch {
    // Not converted yet.
  }

  const markdown = /\.(md|txt)$/i.test(filename) ? bytes.toString("utf-8") : await convert(bytes, filename);
  await mkdir(EXTRACTED_DIR, { recursive: true });
  await writeFile(cached, markdown);
  return markdown;
}

export async function isDoclingAvailable(): Promise<boolean> {
  try {
    return (await fetch(`${DOCLING_URL}/health`)).ok;
  } catch {
    return false;
  }
}

/** Asynchronous conversion (submit, then poll): large documents take longer than an HTTP request may wait. */
async function convert(bytes: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(bytes)]), filename);
  form.append("to_formats", "md");
  // Course documents are text PDFs: OCR would only slow conversion down. Scanned documents are not supported yet.
  form.append("do_ocr", "false");
  form.append("image_export_mode", "placeholder");
  form.append("include_images", "false");
  form.append("do_pdf_heading_hierarchy", "true");
  form.append("md_page_break_placeholder", PAGE_BREAK);

  const submitted = await fetch(`${DOCLING_URL}/v1/convert/file/async`, { method: "POST", body: form });
  if (!submitted.ok) throw new Error(`docling refused ${filename}: ${submitted.status} ${await submitted.text()}`);
  const { task_id } = (await submitted.json()) as { task_id: string };

  for (;;) {
    const status = (await (await fetch(`${DOCLING_URL}/v1/status/poll/${task_id}?wait=${POLL_SECONDS}`)).json()) as {
      task_status: string;
      error_message?: string;
    };
    if (status.task_status === "success" || status.task_status === "partial_success") break;
    if (status.task_status === "failure" || status.task_status === "skipped") {
      throw new Error(`docling could not convert ${filename}: ${status.error_message ?? status.task_status}`);
    }
  }

  const result = (await (await fetch(`${DOCLING_URL}/v1/result/${task_id}`)).json()) as {
    document?: { md_content?: string };
  };
  return result.document?.md_content ?? "";
}
