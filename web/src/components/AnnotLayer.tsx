import { memo, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { type Op, type ShapeKind, type Shape, type Stroke, type TextOp, HIGHLIGHT_WIDTH, TEXT_LINE, drawOps, hitOp, moveOp, simplify, textLines } from "../lib/annotations";

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
  // Each text being typed is a session of its own: its field is never reused for the next one, and it is finished
  // once, whoever asks first (a key, a blur, a tap elsewhere that opens another text).
  const [editing, setEditing] = useState<TextSession>();
  const sessions = useRef(0);
  const finished = useRef(new Set<number>());
  /** What the open field holds right now, to finish it from outside. */
  const live = useRef("");
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
        // On a touch screen the tap arrives before the open field loses the focus: finish that one first, where it is,
        // with its own text. Otherwise its text would be saved at the place of the new one.
        let current = ops;
        if (editing) current = finishText(editing, live.current) ?? ops;
        const reopened = existing && current.includes(existing);
        const session = { id: ++sessions.current, index: reopened ? current.indexOf(existing) : null, op: reopened ? existing : ({ t: "text", c: style.color, s: style.textSize, x: round(p.x), y: round(p.y), v: "" } as TextOp) };
        live.current = session.op.v;
        setEditing(session);
      }
    }
    schedule();
  };

  /** Saves the text of a session and closes its field; the new operations when something changed. */
  function finishText(session: TextSession, value: string): Op[] | undefined {
    if (finished.current.has(session.id)) return undefined;
    finished.current.add(session.id);
    // Only its own field: another text may already be open.
    setEditing((now) => (now?.id === session.id ? undefined : now));
    const { index, op } = session;
    const text = value.replace(/\s+$/, "");
    let next: Op[] | undefined;
    if (index === null) {
      if (text) next = [...ops, { ...op, v: text }];
    } else if (!text) next = ops.filter((_, i) => i !== index);
    else if (text !== op.v) next = ops.map((o, i) => (i === index ? { ...op, v: text } : o));
    if (next) commit(page, next);
    return next;
  }

  return (
    <>
      <canvas
        ref={canvas}
        width={pixelsW}
        height={pixelsH}
        // The click that follows a tap (and the press of a mouse) would move the focus to the page, away from the text
        // field that the tap has just opened: the canvas never takes the focus, a text is finished by `up`.
        onMouseDown={interactive ? (e) => e.preventDefault() : undefined}
        onPointerDown={interactive ? down : undefined}
        onPointerMove={interactive ? move : undefined}
        onPointerUp={interactive ? up : undefined}
        onPointerCancel={interactive ? () => reset() : undefined}
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: interactive ? "auto" : "none", touchAction: "none", cursor: style.tool === "text" ? "text" : style.tool === "move" ? "move" : interactive ? "crosshair" : "default" }}
      />
      {editing && <TextEditor key={editing.id} op={editing.op} cssW={cssW} live={live} onDone={(value) => finishText(editing, value)} />}
    </>
  );
});

const round = (n: number) => Math.round(n * 10000) / 10000;

interface TextSession {
  id: number;
  /** The operation being changed, or null for a new text. */
  index: number | null;
  op: TextOp;
}

function TextEditor({ op, cssW, live, onDone }: { op: TextOp; cssW: number; live: { current: string }; onDone: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(op.v);
  const size = op.s * cssW;
  const born = useRef(performance.now());
  // Reported once: removing the field makes the browser send a last blur, which must not finish the text again while
  // React is taking the field out (« removeChild: not a child of this node »).
  const done = useRef(false);
  const finish = (text: string) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  // Set before React takes the field out, so that the blur of the removal changes nothing.
  useLayoutEffect(() => {
    done.current = false;
    return () => {
      done.current = true;
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Without scrolling: the field is where the finger is, the page must not jump under it.
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    // A box of its own around the field: what a browser extension (spelling, translation, passwords) adds next to a
    // text field stays inside it, and the whole box leaves at once.
    <div
      className="absolute"
      translate="no"
      // The canvas draws the text from the top of its line; the field centres it in a line 1.25 high: same place.
      style={{ left: `${op.x * 100}%`, top: `${op.y * 100}%`, marginTop: -(size * (TEXT_LINE - 1)) / 2 }}
    >
      <textarea
        ref={ref}
        value={value}
        rows={Math.max(1, textLines({ ...op, v: value }).length)}
        onChange={(e) => {
          live.current = e.target.value;
          setValue(e.target.value);
        }}
        onBlur={() => {
          if (done.current) return;
          // A tap is followed by simulated mouse events that steal the focus: during the first instants, take it back.
          if (performance.now() - born.current < 700) {
            ref.current?.focus({ preventScroll: true });
            // Again once the browser has finished moving the focus: some ignore a focus asked while they are at it.
            setTimeout(() => !done.current && ref.current?.focus({ preventScroll: true }), 0);
            setTimeout(() => !done.current && document.activeElement !== ref.current && ref.current?.focus({ preventScroll: true }), 120);
          } else finish(value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            finish(value);
          }
        }}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        data-lt-active="false"
        data-1p-ignore
        data-lpignore="true"
        placeholder="Texte…"
        className="block resize-none overflow-hidden rounded-sm bg-white/70 outline-dashed outline-1 outline-accent p-0 m-0 border-0 whitespace-pre"
        style={{ minWidth: size * 6, width: `${Math.max(value.split("\n").reduce((m, l) => Math.max(m, l.length), 0) + 2, 6)}ch`, fontSize: size, lineHeight: TEXT_LINE, color: op.c, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
      />
    </div>
  );
}
