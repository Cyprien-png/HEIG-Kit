import type { PDFDocumentProxy } from "pdfjs-dist";
import { drawOps, type Op } from "./annotations";

let library: Promise<typeof import("pdfjs-dist")> | undefined;

/** pdf.js, loaded the first time a PDF is opened (it is large), with its worker. */
export function pdfjs(): Promise<typeof import("pdfjs-dist")> {
  library ??= (async () => {
    const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return library;
}

/** Opens a PDF from its bytes (the buffer is copied: pdf.js takes ownership of what it receives). */
export async function openPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  return lib.getDocument({
    data: new Uint8Array(bytes.slice(0)),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
  }).promise;
}

/** Pixels above which a canvas is refused or very slow on phones. */
export const MAX_CANVAS_PIXELS = 12_000_000;

/** A page with its annotations as a JPEG, `width` pixels wide: what is sent for correction. */
export async function renderPageImage(pdf: PDFDocumentProxy, pageNumber: number, ops: Op[], width = 1700): Promise<Blob> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  let scale = width / base.width;
  if (base.width * scale * base.height * scale > MAX_CANVAS_PIXELS) scale = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible");
  await page.render({ canvas, canvasContext: ctx, viewport, background: "#ffffff" }).promise;
  drawOps(ctx, ops, canvas.width, canvas.height);
  page.cleanup();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("Impossible de produire l'image de la page");
  return blob;
}
