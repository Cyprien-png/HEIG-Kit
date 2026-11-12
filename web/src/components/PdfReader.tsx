import {
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  BackspaceIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HandRaisedIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PaintBrushIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { COLORS, STROKES, TEXT_SIZES, type Op, type ShapeKind } from "../lib/annotations";
import { MAX_CANVAS_PIXELS, openPdf } from "../lib/pdf";
import type { AnnotationsApi } from "../lib/useAnnotations";
import { AnnotLayer, type GestureState, type Tool, type ToolStyle } from "./AnnotLayer";
import { IconButton, cx } from "./ui";

export interface PdfInfo {
  pdf: PDFDocumentProxy;
  bytes: ArrayBuffer;
  pages: number;
}

interface Props {
  /** The PDF, fetched with the session. */
  url: string;
  title: ReactNode;
  /** Covers the whole window (a PDF opened from a list); otherwise inline, with a button to go full screen. */
  overlay?: boolean;
  onClose?: () => void;
  downloadUrl?: string;
  /** Buttons of the header (make a copy, submit…). */
  actions?: ReactNode;
  /** Makes it an editor: the tools and the annotations of the copy. */
  edit?: AnnotationsApi & { status?: ReactNode };
  onLoaded?: (info: PdfInfo) => void;
  /** Page to show first. */
  initialPage?: number;
  /** Height classes of the inline reader. */
  className?: string;
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;
const GAP = 12;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const SHAPES: { kind: ShapeKind; label: string; glyph: string }[] = [
  { kind: "line", label: "Ligne", glyph: "╱" },
  { kind: "arrow", label: "Flèche", glyph: "➚" },
  { kind: "rect", label: "Rectangle", glyph: "▭" },
  { kind: "ellipse", label: "Ellipse", glyph: "◯" },
];

/**
 * A PDF reader that fits the screen: pages at the width of the window, zoom (buttons, pinch, Ctrl + wheel), page
 * navigation, full screen, and, with `edit`, a pen, highlighter, eraser, text and shapes drawn on the pages.
 */
export function PdfReader({ url, title, overlay, onClose, downloadUrl, actions, edit, onLoaded, initialPage, className }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [error, setError] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [avail, setAvail] = useState(0);
  const [current, setCurrent] = useState(1);
  const [full, setFull] = useState(false);
  const [tool, setTool] = useState<Tool>(edit ? "pen" : "hand");
  const [shape, setShape] = useState<ShapeKind>("line");
  const [color, setColor] = useState(COLORS[0]);
  const [stroke, setStroke] = useState(1);
  const [textSize, setTextSize] = useState(1);

  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const gesture = useRef<GestureState>({ active: false, penSeen: false });
  const pending = useRef<{ left: number; top: number } | undefined>(undefined);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;

  // Opening: fetch the bytes, then the size of every page.
  useEffect(() => {
    let dead = false;
    let doc: PDFDocumentProxy | undefined;
    setPdf(undefined);
    setError(undefined);
    (async () => {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(res.status === 404 ? "Fichier introuvable" : `Erreur ${res.status}`);
      const bytes = await res.arrayBuffer();
      doc = await openPdf(bytes);
      const all = await Promise.all(Array.from({ length: doc.numPages }, async (_, i) => {
        const page = await doc!.getPage(i + 1);
        const v = page.getViewport({ scale: 1 });
        return { w: v.width, h: v.height };
      }));
      if (dead) return;
      setSizes(all);
      setPdf(doc);
      loaded.current?.({ pdf: doc, bytes, pages: doc.numPages });
    })().catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
      void doc?.loadingTask.destroy();
    };
  }, [url]);

  // The pages take the width of the window (zoom 1): nothing overflows, on a phone or a wide screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setAvail(Math.max(160, el.clientWidth - 2 * GAP));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cssW = avail * zoom;
  const pageH = useCallback((i: number) => (sizes[i] ? (cssW * sizes[i].h) / sizes[i].w : 0), [sizes, cssW]);

  // Zoom around a point of the viewport, keeping what is under it where it is.
  const zoomTo = useCallback((next: number, fx?: number, fy?: number) => {
    const el = scroller.current;
    if (!el) return;
    const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
    setZoom((previous) => {
      const x = fx ?? el.clientWidth / 2;
      const y = fy ?? el.clientHeight / 2;
      const ratio = z / previous;
      pending.current = { left: (el.scrollLeft + x) * ratio - x, top: (el.scrollTop + y) * ratio - y };
      return z;
    });
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pending.current) {
      el.scrollLeft = pending.current.left;
      el.scrollTop = pending.current.top;
      pending.current = undefined;
    }
  }, [zoom]);

  // Ctrl/⌘ + wheel (and the trackpad pinch) zooms the pages instead of the whole application.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Touch: one finger scrolls (when it does not draw), two fingers pinch and pan. Mouse: drag to scroll with the hand tool.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number; fx: number; fy: number; left: number; top: number } | undefined>(undefined);
  const pan = useRef<{ x: number; y: number; t: number; vx: number; vy: number } | undefined>(undefined);
  const inertia = useRef(0);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const editing = !!edit;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    if (!el) return;
    cancelAnimationFrame(inertia.current);
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        const rect = el.getBoundingClientRect();
        gesture.current.active = true;
        pan.current = undefined;
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: zoomRef.current, fx: (a.x + b.x) / 2 - rect.left, fy: (a.y + b.y) / 2 - rect.top, left: el.scrollLeft, top: el.scrollTop };
        return;
      }
      if (touches.current.size > 2) return;
      if (editing && toolRef.current !== "hand") return;
    } else if (!(e.pointerType === "mouse" && e.button === 0 && (!editing || toolRef.current === "hand"))) return;
    if (gesture.current.active) return;
    el.setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    if (!el) return;
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()];
      const rect = el.getBoundingClientRect();
      const fx = (a.x + b.x) / 2 - rect.left;
      const fy = (a.y + b.y) / 2 - rect.top;
      const z = clamp((p.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / p.dist, MIN_ZOOM, MAX_ZOOM);
      const ratio = z / p.zoom;
      pending.current = { left: (p.left + p.fx) * ratio - fx, top: (p.top + p.fy) * ratio - fy };
      if (z !== zoomRef.current) setZoom(z);
      else {
        el.scrollLeft = pending.current.left;
        el.scrollTop = pending.current.top;
      }
      return;
    }
    const d = pan.current;
    if (!d) return;
    const now = performance.now();
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    el.scrollLeft -= dx;
    el.scrollTop -= dy;
    const dt = Math.max(now - d.t, 1);
    pan.current = { x: e.clientX, y: e.clientY, t: now, vx: 0.8 * (dx / dt) + 0.2 * d.vx, vy: 0.8 * (dy / dt) + 0.2 * d.vy };
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = undefined;
    if (touches.current.size === 0) gesture.current.active = false;
    const d = pan.current;
    pan.current = undefined;
    if (!el || !d || e.type === "pointercancel") return;
    let vx = d.vx;
    let vy = d.vy;
    const step = () => {
      vx *= 0.94;
      vy *= 0.94;
      el.scrollLeft -= vx * 16;
      el.scrollTop -= vy * 16;
      if (Math.abs(vx) > 0.02 || Math.abs(vy) > 0.02) inertia.current = requestAnimationFrame(step);
    };
    if (performance.now() - d.t < 80) inertia.current = requestAnimationFrame(step);
  };

  // Opens on the requested page once the pages have their size.
  useLayoutEffect(() => {
    const page = pdf && initialPage && initialPage > 1 ? pageEls.current[Math.min(initialPage, sizes.length) - 1] : undefined;
    if (page && scroller.current) scroller.current.scrollTop = page.offsetTop - GAP;
    // Only when the document opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf]);

  // The page shown: the first one whose bottom is below the top third of the window.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const line = el.scrollTop + el.clientHeight * 0.3;
    let found = 1;
    for (let i = 0; i < pageEls.current.length; i++) {
      const page = pageEls.current[i];
      if (page && page.offsetTop + page.offsetHeight > line) {
        found = i + 1;
        break;
      }
    }
    setCurrent(found);
  }, []);
  const goTo = (n: number) => {
    const page = pageEls.current[clamp(n, 1, sizes.length) - 1];
    if (page && scroller.current) scroller.current.scrollTo({ top: page.offsetTop - GAP, behavior: "smooth" });
  };

  // Full screen: the application's own (the window is the reader's, also on iOS), plus the browser's when it has one.
  const isFull = overlay || full;
  const toggleFull = () => {
    const next = !full;
    setFull(next);
    const el = root.current;
    if (next) void el?.requestFullscreen?.().catch(() => undefined);
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  };
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (!isFull) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFull]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      if (e.key === "Escape" && overlay) onClose?.();
      else if ((e.key === "+" || e.key === "=") && !e.metaKey && !e.ctrlKey) zoomTo(zoomRef.current * 1.25);
      else if (e.key === "-" && !e.metaKey && !e.ctrlKey) zoomTo(zoomRef.current / 1.25);
      else if (e.key === "0" && !e.metaKey && !e.ctrlKey) zoomTo(1);
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && edit) {
        e.preventDefault();
        if (e.shiftKey) edit.redo();
        else edit.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, onClose, zoomTo, edit]);

  const style: ToolStyle = useMemo(() => ({ tool, shape, color, width: STROKES[stroke].w, textSize: TEXT_SIZES[textSize].s }), [tool, shape, color, stroke, textSize]);

  const body = (
    <div ref={root} className={cx("flex flex-col bg-canvas text-ink", isFull ? "fixed inset-0 z-[100]" : cx("relative rounded-xl border border-line overflow-hidden", className ?? "h-[calc(100vh-14rem)] min-h-[480px]"))}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface px-2 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]">
        {overlay && (
          <IconButton label="Fermer" onClick={onClose}>
            <XMarkIcon className="h-5 w-5" />
          </IconButton>
        )}
        <div className="min-w-0 flex-1 basis-40 truncate text-sm font-medium px-1">{title}</div>
        {actions}
        <div className="flex items-center gap-0.5">
          <IconButton label="Page précédente" onClick={() => goTo(current - 1)} disabled={current <= 1}>
            <ChevronLeftIcon className="h-5 w-5" />
          </IconButton>
          <PageInput current={current} total={sizes.length} onGo={goTo} />
          <IconButton label="Page suivante" onClick={() => goTo(current + 1)} disabled={current >= sizes.length}>
            <ChevronRightIcon className="h-5 w-5" />
          </IconButton>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label="Dézoomer" onClick={() => zoomTo(zoom / 1.25)}>
            <MagnifyingGlassMinusIcon className="h-5 w-5" />
          </IconButton>
          <button onClick={() => zoomTo(1)} title="Ajuster à la largeur" className="h-9 min-w-[3.25rem] rounded-lg px-1 text-xs font-medium tabular-nums text-ink-2 hover:bg-surface-2">
            {Math.round(zoom * 100)} %
          </button>
          <IconButton label="Zoomer" onClick={() => zoomTo(zoom * 1.25)}>
            <MagnifyingGlassPlusIcon className="h-5 w-5" />
          </IconButton>
        </div>
        <IconButton label={isFull && !overlay ? "Quitter le plein écran" : "Plein écran"} onClick={overlay ? () => (document.fullscreenElement ? void document.exitFullscreen() : void root.current?.requestFullscreen?.().catch(() => undefined)) : toggleFull}>
          {isFull && !overlay ? <ArrowsPointingInIcon className="h-5 w-5" /> : <ArrowsPointingOutIcon className="h-5 w-5" />}
        </IconButton>
        {downloadUrl && (
          <a href={downloadUrl} aria-label="Télécharger" title="Télécharger" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink">
            <ArrowDownTrayIcon className="h-5 w-5" />
          </a>
        )}
      </header>

      {edit && (
        <Toolbar
          tool={tool}
          setTool={setTool}
          shape={shape}
          setShape={setShape}
          color={color}
          setColor={setColor}
          stroke={stroke}
          setStroke={setStroke}
          textSize={textSize}
          setTextSize={setTextSize}
          edit={edit}
          page={current}
        />
      )}

      <div
        ref={scroller}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className="relative flex-1 overflow-auto bg-surface-2 select-none"
        style={{ touchAction: "none", cursor: !edit || tool === "hand" ? "grab" : undefined, overscrollBehavior: "contain" }}
      >
        {error ? (
          <p className="p-6 text-sm text-bad">{error}</p>
        ) : !pdf ? (
          <p className="p-6 text-sm text-ink-2">Chargement du PDF…</p>
        ) : (
          <div className="flex min-w-full w-max flex-col items-center py-3" style={{ gap: GAP, paddingLeft: GAP, paddingRight: GAP }}>
            {sizes.map((size, i) => (
              <div
                key={i}
                ref={(el) => {
                  pageEls.current[i] = el;
                }}
                className="relative shrink-0 bg-white shadow-card"
                style={{ width: cssW, height: pageH(i) }}
              >
                <PageCanvas pdf={pdf} n={i + 1} cssW={cssW} cssH={pageH(i)} base={size} scroller={scroller} />
                {edit && <AnnotLayer page={i + 1} cssW={cssW} cssH={pageH(i)} ops={edit.ops[String(i + 1)] ?? EMPTY} style={style} gesture={gesture} commit={edit.commit} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  // An overlay is a child of <body>: no ancestor of the application can clip it or stack above it.
  return overlay ? createPortal(body, document.body) : body;
}

const EMPTY: Op[] = [];

function PageInput({ current, total, onGo }: { current: number; total: number; onGo: (n: number) => void }) {
  const [value, setValue] = useState<string>();
  return (
    <span className="flex items-center gap-1 px-1 text-sm tabular-nums text-ink-2">
      <input
        value={value ?? String(current)}
        inputMode="numeric"
        aria-label="Numéro de page"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        onBlur={() => setValue(undefined)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (value) onGo(Number(value));
            e.currentTarget.blur();
          }
        }}
        className="h-8 w-9 rounded-md border border-line bg-surface text-center text-sm text-ink"
      />
      <span>/ {total || "…"}</span>
    </span>
  );
}

/** One page of the PDF on a canvas, rendered when near the window and sharp at the current zoom. */
const PageCanvas = memo(function PageCanvas({ pdf, n, cssW, cssH, base, scroller }: { pdf: PDFDocumentProxy; n: number; cssW: number; cssH: number; base: { w: number; h: number }; scroller: React.RefObject<HTMLDivElement | null> }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(n <= 2);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: scroller.current, rootMargin: "100% 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scroller]);

  useEffect(() => {
    const target = canvas.current;
    if (!near) {
      if (target) target.width = target.height = 0;
      return;
    }
    if (!target || cssW < 1) return;
    let cancelled = false;
    let task: { cancel: () => void } | undefined;
    // After a zoom the old bitmap stays on screen, stretched, until the sharp one replaces it.
    const timer = setTimeout(async () => {
      try {
        const page = await pdf.getPage(n);
        let scale = (cssW * Math.min(window.devicePixelRatio || 1, 2.5)) / base.w;
        if (base.w * scale * base.h * scale > MAX_CANVAS_PIXELS) scale = Math.sqrt(MAX_CANVAS_PIXELS / (base.w * base.h));
        const viewport = page.getViewport({ scale });
        const buffer = document.createElement("canvas");
        buffer.width = Math.floor(viewport.width);
        buffer.height = Math.floor(viewport.height);
        const ctx = buffer.getContext("2d");
        if (!ctx) return;
        const render = page.render({ canvas: buffer, canvasContext: ctx, viewport, background: "#ffffff" });
        task = render;
        await render.promise;
        if (cancelled) return;
        target.width = buffer.width;
        target.height = buffer.height;
        target.getContext("2d")?.drawImage(buffer, 0, 0);
      } catch {
        // Cancelled by a newer zoom, or a page that cannot be drawn: the next render replaces it.
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [near, pdf, n, cssW, base.w, base.h]);

  return (
    <div ref={holder} className="absolute inset-0">
      <canvas ref={canvas} className="h-full w-full" style={{ width: cssW, height: cssH }} />
    </div>
  );
});

interface ToolbarProps {
  tool: Tool;
  setTool: (t: Tool) => void;
  shape: ShapeKind;
  setShape: (s: ShapeKind) => void;
  color: string;
  setColor: (c: string) => void;
  stroke: number;
  setStroke: (n: number) => void;
  textSize: number;
  setTextSize: (n: number) => void;
  edit: NonNullable<Props["edit"]>;
  page: number;
}

function Toolbar({ tool, setTool, shape, setShape, color, setColor, stroke, setStroke, textSize, setTextSize, edit, page }: ToolbarProps) {
  const toolButton = (id: Tool, label: string, icon: ReactNode) => (
    <button key={id} onClick={() => setTool(id)} aria-pressed={tool === id} title={label} className={cx("flex h-10 min-w-10 shrink-0 flex-col items-center justify-center rounded-lg px-2 text-[10px] leading-tight", tool === id ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-surface-2")}>
      <span className="grid h-5 w-5 place-items-center text-base font-semibold">{icon}</span>
      <span>{label}</span>
    </button>
  );
  const sep = <span className="mx-1 h-6 w-px shrink-0 bg-line" />;
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 py-1">
      {toolButton("hand", "Main", <HandRaisedIcon className="h-5 w-5" />)}
      {toolButton("pen", "Stylo", <PencilIcon className="h-5 w-5" />)}
      {toolButton("hl", "Surligneur", <PaintBrushIcon className="h-5 w-5" />)}
      {toolButton("text", "Texte", "T")}
      {toolButton("shape", "Forme", SHAPES.find((s) => s.kind === shape)?.glyph)}
      {toolButton("erase", "Gomme", <BackspaceIcon className="h-5 w-5" />)}
      {toolButton("move", "Déplacer", "✥")}
      {sep}
      {tool === "shape" && (
        <>
          {SHAPES.map((s) => (
            <button key={s.kind} onClick={() => setShape(s.kind)} title={s.label} aria-label={s.label} aria-pressed={shape === s.kind} className={cx("h-9 w-9 shrink-0 rounded-lg text-lg", shape === s.kind ? "bg-surface-2 ring-1 ring-accent text-ink" : "text-ink-2 hover:bg-surface-2")}>
              {s.glyph}
            </button>
          ))}
          {sep}
        </>
      )}
      {(tool === "pen" || tool === "hl" || tool === "text" || tool === "shape") && (
        <>
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} aria-label={`Couleur ${c}`} aria-pressed={color === c} className={cx("h-7 w-7 shrink-0 rounded-full border-2", color === c ? "border-accent" : "border-line")} style={{ background: c }} />
          ))}
          {sep}
        </>
      )}
      {(tool === "pen" || tool === "shape") && STROKES.map((s, i) => (
        <button key={s.label} onClick={() => setStroke(i)} title={s.label} aria-label={`Trait ${s.label}`} aria-pressed={stroke === i} className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", stroke === i ? "bg-surface-2 ring-1 ring-accent" : "hover:bg-surface-2")}>
          <span className="rounded-full bg-ink" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
        </button>
      ))}
      {tool === "text" && TEXT_SIZES.map((s, i) => (
        <button key={s.label} onClick={() => setTextSize(i)} title={s.label} aria-label={`Texte ${s.label}`} aria-pressed={textSize === i} className={cx("h-9 w-9 shrink-0 rounded-lg font-semibold", textSize === i ? "bg-surface-2 ring-1 ring-accent" : "hover:bg-surface-2")} style={{ fontSize: 11 + i * 4 }}>
          A
        </button>
      ))}
      <span className="flex-1" />
      <IconButton label="Annuler" onClick={edit.undo} disabled={!edit.canUndo} className="shrink-0">
        <ArrowUturnLeftIcon className="h-5 w-5" />
      </IconButton>
      <IconButton label="Rétablir" onClick={edit.redo} disabled={!edit.canRedo} className="shrink-0">
        <ArrowUturnRightIcon className="h-5 w-5" />
      </IconButton>
      <IconButton label={`Effacer toute la page ${page}`} onClick={() => confirm(`Effacer tout ce qui est écrit sur la page ${page} ?`) && edit.clearPage(page)} disabled={!edit.ops[String(page)]} className="shrink-0">
        <TrashIcon className="h-5 w-5" />
      </IconButton>
      {edit.status && <span className="ml-1 shrink-0 whitespace-nowrap pr-1 text-xs text-ink-3">{edit.status}</span>}
    </div>
  );
}

