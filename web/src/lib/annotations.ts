/**
 * Annotations of a work copy (mirrors src/app/workcopies.ts): strokes, shapes and texts in coordinates relative to the
 * page (0 to 1), widths and sizes relative to the page width, so that they do not depend on the zoom nor the screen.
 * The same drawing code paints the screen layer and the pages sent for correction.
 */

export type Stroke = { t: "pen" | "hl"; c: string; w: number; p: number[] };
export type Shape = { t: "line" | "arrow" | "rect" | "ellipse"; c: string; w: number; a: [number, number]; b: [number, number] };
export type TextOp = { t: "text"; c: string; s: number; x: number; y: number; v: string };
export type Op = Stroke | Shape | TextOp;

const isStroke = (op: Op): op is Stroke => op.t === "pen" || op.t === "hl";
const isText = (op: Op): op is TextOp => op.t === "text";

export type Annotations = Record<string, Op[]>;

export type ShapeKind = "line" | "arrow" | "rect" | "ellipse";
export const COLORS = ["#1c1a17", "#d90115", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed"];
export const STROKES = [
  { label: "Fin", w: 0.0016 },
  { label: "Moyen", w: 0.003 },
  { label: "Épais", w: 0.006 },
];
export const TEXT_SIZES = [
  { label: "Petit", s: 0.016 },
  { label: "Moyen", s: 0.022 },
  { label: "Grand", s: 0.032 },
];
export const HIGHLIGHT_WIDTH = 0.02;
const HIGHLIGHT_ALPHA = 0.35;
export const TEXT_LINE = 1.25;

const round = (n: number) => Math.round(n * 10000) / 10000;

export function textLines(op: TextOp): string[] {
  return op.v.split("\n");
}

/** Paints one annotation on a canvas of `W` × `H` pixels. */
export function drawOp(ctx: CanvasRenderingContext2D, op: Op, W: number, H: number): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = op.c;
  ctx.fillStyle = op.c;
  if (isText(op)) {
    const size = op.s * W;
    ctx.font = `${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = "top";
    textLines(op).forEach((line, i) => ctx.fillText(line, op.x * W, op.y * H + i * size * TEXT_LINE));
  } else if (isStroke(op)) {
    ctx.lineWidth = op.w * W;
    if (op.t === "hl") ctx.globalAlpha = HIGHLIGHT_ALPHA;
    const p = op.p;
    ctx.beginPath();
    if (p.length === 2) {
      ctx.arc(p[0] * W, p[1] * H, Math.max(op.w * W, 1) / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(p[0] * W, p[1] * H);
      // Quadratic curves through the middle of each segment: smooth strokes from sparse points.
      for (let i = 2; i < p.length - 2; i += 2) ctx.quadraticCurveTo(p[i] * W, p[i + 1] * H, ((p[i] + p[i + 2]) / 2) * W, ((p[i + 1] + p[i + 3]) / 2) * H);
      ctx.lineTo(p[p.length - 2] * W, p[p.length - 1] * H);
      ctx.stroke();
    }
  } else {
    ctx.lineWidth = op.w * W;
    const [x1, y1, x2, y2] = [op.a[0] * W, op.a[1] * H, op.b[0] * W, op.b[1] * H];
    ctx.beginPath();
    if (op.t === "rect") ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    else if (op.t === "ellipse") ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    else {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      if (op.t === "arrow") {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = Math.max(op.w * W * 4, 0.018 * W);
        for (const side of [-1, 1]) {
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - head * Math.cos(angle + (side * Math.PI) / 7), y2 - head * Math.sin(angle + (side * Math.PI) / 7));
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawOps(ctx: CanvasRenderingContext2D, ops: Op[], W: number, H: number): void {
  for (const op of ops) drawOp(ctx, op, W, H);
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Rough size of a text in page-relative units (the width of a character is taken as 0.55 of the font size). */
export function textBox(op: TextOp, aspect: number): { x: number; y: number; w: number; h: number } {
  const lines = textLines(op);
  const w = Math.max(...lines.map((l) => l.length), 1) * op.s * 0.55;
  const h = ((lines.length * op.s * TEXT_LINE) / aspect);
  return { x: op.x, y: op.y, w, h };
}

/** Whether the point (page-relative) is on the annotation, within `tol` pixels of a page of `W` × `H`. */
export function hitOp(op: Op, x: number, y: number, W: number, H: number, tol: number): boolean {
  const px = x * W;
  const py = y * H;
  if (isText(op)) {
    const box = textBox(op, H / W);
    return x >= box.x - tol / W && x <= box.x + box.w + tol / W && y >= box.y - tol / H && y <= box.y + box.h + tol / H;
  }
  const reach = tol + (op.w * W) / 2;
  if (isStroke(op)) {
    const p = op.p;
    if (p.length === 2) return Math.hypot(px - p[0] * W, py - p[1] * H) <= reach;
    for (let i = 0; i < p.length - 2; i += 2) if (distToSegment(px, py, p[i] * W, p[i + 1] * H, p[i + 2] * W, p[i + 3] * H) <= reach) return true;
    return false;
  }
  const [x1, y1, x2, y2] = [op.a[0] * W, op.a[1] * H, op.b[0] * W, op.b[1] * H];
  if (op.t === "line" || op.t === "arrow") return distToSegment(px, py, x1, y1, x2, y2) <= reach;
  if (op.t === "rect") {
    const [l, r, t, b] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
    return [distToSegment(px, py, l, t, r, t), distToSegment(px, py, r, t, r, b), distToSegment(px, py, r, b, l, b), distToSegment(px, py, l, b, l, t)].some((d) => d <= reach);
  }
  const [cx, cy, rx, ry] = [(x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2];
  if (rx < 1 || ry < 1) return distToSegment(px, py, x1, y1, x2, y2) <= reach;
  // Distance to the outline, approximated by the normalized radius scaled back by the smaller semi-axis.
  const k = Math.hypot((px - cx) / rx, (py - cy) / ry);
  return Math.abs(k - 1) * Math.min(rx, ry) <= reach;
}

export function moveOp(op: Op, dx: number, dy: number): Op {
  if (isText(op)) return { ...op, x: round(op.x + dx), y: round(op.y + dy) };
  if (isStroke(op)) return { ...op, p: op.p.map((n, i) => round(n + (i % 2 === 0 ? dx : dy))) };
  return { ...op, a: [round(op.a[0] + dx), round(op.a[1] + dy)], b: [round(op.b[0] + dx), round(op.b[1] + dy)] };
}

/** Ramer–Douglas–Peucker on a flat list of points, then rounded: a stroke of a few hundred samples keeps its shape in a few dozen points. */
export function simplify(points: number[], W: number, H: number, tolPx = 0.35): number[] {
  const n = points.length / 2;
  if (n <= 2) return points.map(round);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let far = -1;
    let farDist = tolPx;
    for (let i = first + 1; i < last; i++) {
      const d = distToSegment(points[2 * i] * W, points[2 * i + 1] * H, points[2 * first] * W, points[2 * first + 1] * H, points[2 * last] * W, points[2 * last + 1] * H);
      if (d > farDist) {
        far = i;
        farDist = d;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([first, far], [far, last]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(round(points[2 * i]), round(points[2 * i + 1]));
  return out;
}

export const countAnnotated = (ops: Annotations): number => Object.values(ops).filter((o) => o.length > 0).length;
