import { memo, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { type Op, type ShapeKind, type Shape, type Stroke, type TextOp, HIGHLIGHT_WIDTH, drawOps, hitOp, moveOp, simplify, textLines } from "../lib/annotations";

export type Tool = "hand" | "pen" | "hl" | "erase" | "text" | "shape" | "move";

export interface ToolStyle {
  tool: Tool;
  shape: ShapeKind;
  color: string;
  /** Stroke width relative to the page width. */
  width: number;
  /** Text size relative to the page width. */
  textSize: number;
}

/** Shared with the reader: a second finger turns the touch into a pan/zoom gesture and cancels what was being drawn. */
export interface GestureState {
  active: boolean;
  /** A stylus was seen: fingers no longer draw (palm rejection). */
  penSeen: boolean;
}

interface Props {
  page: number;
  cssW: number;
  cssH: number;
  ops: Op[];
  style: ToolStyle;
  gesture: MutableRefObject<GestureState>;
  commit: (page: number, ops: Op[]) => void;
}

const ERASER_REACH = 12;
const MIN_DRAG = 4;

/** The drawing layer of one page: shows the annotations and lets the pen, shapes, text, eraser and move tools change them. */
export const AnnotLayer = memo(function AnnotLayer({ page, cssW, cssH, ops, style, gesture, commit }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelsW = Math.max(1, Math.round(cssW * dpr));
  const pixelsH = Math.max(1, Math.round(cssH * dpr));
  const interactive = style.tool !== "hand";

  const draft = useRef<Stroke | Shape | undefined>(undefined);
  const erased = useRef(new Set<number>());
  const moving = useRef<{ index: number; dx: number; dy: number } | undefined>(undefined);
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | undefined>(undefined);
  const frame = useRef(0);
  const [editing, setEditing] = useState<{ index: number | null; op: TextOp }>();
  // What the next frame paints: read from here, not from the render that scheduled it (it may be older than a commit).
  const latest = useRef({ ops, editingIndex: editing?.index });
  latest.current = { ops, editingIndex: editing?.index };

  const paint = () => {
    frame.current = 0;
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    const shown: Op[] = [];
    latest.current.ops.forEach((op, i) => {
      if (erased.current.has(i) || latest.current.editingIndex === i) return;
      shown.push(moving.current?.index === i ? moveOp(op, moving.current.dx, moving.current.dy) : op);
    });
    if (draft.current) shown.push(draft.current);
    drawOps(ctx, shown, el.width, el.height);
  };
  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };
  // Repainted when the content, the size or the text being edited changes.
  useLayoutEffect(paint);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const reset = () => {
    draft.current = undefined;
    erased.current.clear();
    moving.current = undefined;
    pointer.current = undefined;
    schedule();
  };

  // Another tool, or another page of the copy, ends what was being drawn.
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style.tool, page]);

  const at = (e: ReactPointerEvent): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  };

  const topHit = (x: number, y: number, reach: number): number => {
    for (let i = ops.length - 1; i >= 0; i--) if (hitOp(ops[i], x, y, cssW, cssH, reach)) return i;
    return -1;
  };
  const eraseAt = (x: number, y: number) => {
    for (let i = 0; i < ops.length; i++) if (!erased.current.has(i) && hitOp(ops[i], x, y, cssW, cssH, ERASER_REACH)) erased.current.add(i);
  };

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "pen") gesture.current.penSeen = true;
    else if (e.pointerType === "touch" && gesture.current.penSeen) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (gesture.current.active || pointer.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    pointer.current = { id: e.pointerId, x, y, moved: false };
    if (style.tool === "pen" || style.tool === "hl") draft.current = { t: style.tool, c: style.color, w: style.tool === "hl" ? HIGHLIGHT_WIDTH : style.width, p: [x, y] };
    else if (style.tool === "shape") draft.current = { t: style.shape, c: style.color, w: style.width, a: [x, y], b: [x, y] };
    else if (style.tool === "erase") eraseAt(x, y);
    else if (style.tool === "move") {
      const index = topHit(x, y, 10);
      if (index >= 0) moving.current = { index, dx: 0, dy: 0 };
    }
    schedule();
  };

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    if (gesture.current.active) return reset();
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const samples = events.length > 0 ? events : [e.nativeEvent];
    const rect = e.currentTarget.getBoundingClientRect();
    for (const s of samples) {
      const x = (s.clientX - rect.left) / rect.width;
      const y = (s.clientY - rect.top) / rect.height;
      if (Math.hypot((x - p.x) * cssW, (y - p.y) * cssH) > MIN_DRAG) p.moved = true;
      const d = draft.current;
      if (d && (d.t === "pen" || d.t === "hl")) {
        const n = d.p.length;
        if (Math.hypot((x - d.p[n - 2]) * cssW, (y - d.p[n - 1]) * cssH) >= 1) d.p.push(x, y);
      } else if (d) (d as Shape).b = [x, y];
      else if (style.tool === "erase") eraseAt(x, y);
      else if (moving.current) {
        moving.current.dx = x - p.x;
        moving.current.dy = y - p.y;
      }
    }
    schedule();
  };

  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const cancelled = gesture.current.active;
    const d = draft.current;
    const tool = style.tool;
    const wasErased = [...erased.current];
    const m = moving.current;
    const moved = p.moved;
    pointer.current = undefined;
    draft.current = undefined;
    erased.current = new Set();
    moving.current = undefined;
    if (!cancelled) {
      if (d && (d.t === "pen" || d.t === "hl")) commit(page, [...ops, { ...d, p: simplify(d.p, cssW, cssH) }]);
      else if (d) {
        const s = d as Shape;
        if (Math.hypot((s.b[0] - s.a[0]) * cssW, (s.b[1] - s.a[1]) * cssH) > MIN_DRAG) commit(page, [...ops, { ...s, a: [round(s.a[0]), round(s.a[1])], b: [round(s.b[0]), round(s.b[1])] }]);
      } else if (tool === "erase" && wasErased.length > 0) commit(page, ops.filter((_, i) => !wasErased.includes(i)));
      else if (tool === "move" && m && moved) commit(page, ops.map((op, i) => (i === m.index ? moveOp(op, m.dx, m.dy) : op)));
      else if (tool === "text" && !moved) {
        const index = topHit(p.x, p.y, 6);
        const existing = index >= 0 && ops[index].t === "text" ? (ops[index] as TextOp) : undefined;
        if (existing) setEditing({ index, op: existing });
        else setEditing({ index: null, op: { t: "text", c: style.color, s: style.textSize, x: round(p.x), y: round(p.y), v: "" } });
      }
    }
    schedule();
  };

  const finishText = (value: string) => {
    if (!editing) return;
    const { index, op } = editing;
    setEditing(undefined);
    const text = value.replace(/\s+$/, "");
    if (index === null) {
      if (text) commit(page, [...ops, { ...op, v: text }]);
    } else if (!text) commit(page, ops.filter((_, i) => i !== index));
    else if (text !== op.v) commit(page, ops.map((o, i) => (i === index ? { ...op, v: text } : o)));
  };

  return (
    <>
      <canvas
        ref={canvas}
        width={pixelsW}
        height={pixelsH}
        onPointerDown={interactive ? down : undefined}
        onPointerMove={interactive ? move : undefined}
        onPointerUp={interactive ? up : undefined}
        onPointerCancel={interactive ? () => reset() : undefined}
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: interactive ? "auto" : "none", touchAction: "none", cursor: style.tool === "text" ? "text" : style.tool === "move" ? "move" : interactive ? "crosshair" : "default" }}
      />
      {editing && <TextEditor key={`${editing.index}`} op={editing.op} cssW={cssW} onDone={finishText} />}
    </>
  );
});

const round = (n: number) => Math.round(n * 10000) / 10000;

function TextEditor({ op, cssW, onDone }: { op: TextOp; cssW: number; onDone: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(op.v);
  const size = op.s * cssW;
  const born = useRef(performance.now());
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={Math.max(1, textLines({ ...op, v: value }).length)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        // A tap is followed by simulated mouse events that steal the focus: during the first instants, take it back.
        if (performance.now() - born.current < 400) ref.current?.focus();
        else onDone(value);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          onDone(value);
        }
      }}
      spellCheck={false}
      placeholder="Texte…"
      className="absolute resize-none overflow-hidden rounded-sm bg-white/70 outline-dashed outline-1 outline-accent p-0 m-0 border-0 whitespace-pre"
      style={{ left: `${op.x * 100}%`, top: `${op.y * 100}%`, minWidth: size * 6, width: `${Math.max(value.split("\n").reduce((m, l) => Math.max(m, l.length), 0) + 2, 6)}ch`, fontSize: size, lineHeight: 1.25, color: op.c, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
    />
  );
}
