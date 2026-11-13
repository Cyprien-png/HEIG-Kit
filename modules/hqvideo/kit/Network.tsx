/** Pieces of the network videos (RXI labs): devices, links, packets, broadcasts, terminals, arrow diagrams and the zoom camera. */
import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, MONO, SANS, alpha, lerp, ramp } from "./ui";

export type Pt = { x: number; y: number };
export type DeviceKind = "laptop" | "pc" | "server" | "router" | "switch" | "cloud" | "browser";

/** Color of a kind of traffic, the same in every network video. */
export const NET = {
  dhcp: C.sel,
  icmp: C.one,
  tcp: C.varB,
  http: C.varA,
  arp: "#6aa8ff",
  data: C.text,
};

/** The drawing of a device, centered on (0, 0), about `s` wide. */
const Icon: React.FC<{ kind: DeviceKind; s: number; col: string }> = ({ kind, s, col }) => {
  const st = { fill: "url(#box)", stroke: col, strokeWidth: 2.5, strokeLinejoin: "round" as const };
  const h = s / 2;
  switch (kind) {
    case "laptop":
      return (
        <g>
          <rect x={-h * 0.78} y={-h * 0.72} width={s * 0.78} height={s * 0.5} rx={6} {...st} />
          <rect x={-h * 0.64} y={-h * 0.6} width={s * 0.64} height={s * 0.36} rx={3} fill={col} fillOpacity={0.12} />
          <path d={`M${-h} ${h * 0.34} L${-h * 0.82} ${h * 0.3} H${h * 0.82} L${h} ${h * 0.34} Q${h} ${h * 0.46} ${h * 0.9} ${h * 0.46} H${-h * 0.9} Q${-h} ${h * 0.46} ${-h} ${h * 0.34} Z`} {...st} />
        </g>
      );
    case "pc":
      return (
        <g>
          <rect x={-h * 0.85} y={-h * 0.8} width={s * 0.85} height={s * 0.55} rx={6} {...st} />
          <rect x={-h * 0.7} y={-h * 0.66} width={s * 0.7} height={s * 0.41} rx={3} fill={col} fillOpacity={0.12} />
          <path d={`M${-h * 0.12} ${h * 0.3} V${h * 0.55} M${-h * 0.4} ${h * 0.58} H${h * 0.4}`} stroke={col} strokeWidth={3} strokeLinecap="round" />
        </g>
      );
    case "server":
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(0 ${(i - 1) * s * 0.3})`}>
              <rect x={-h * 0.7} y={-s * 0.12} width={s * 0.7} height={s * 0.24} rx={6} {...st} />
              <circle cx={h * 0.45} cy={0} r={s * 0.025} fill={col} />
              <path d={`M${-h * 0.5} 0 H${h * 0.1}`} stroke={col} strokeOpacity={0.5} strokeWidth={2.5} strokeLinecap="round" />
            </g>
          ))}
        </g>
      );
    case "router":
      return (
        <g>
          <ellipse cx={0} cy={h * 0.18} rx={h * 0.9} ry={h * 0.32} {...st} />
          <rect x={-h * 0.9} y={-h * 0.28} width={s * 0.9} height={h * 0.46} fill="url(#box)" stroke="none" />
          <path d={`M${-h * 0.9} ${-h * 0.28} V${h * 0.18} M${h * 0.9} ${-h * 0.28} V${h * 0.18}`} stroke={col} strokeWidth={2.5} />
          <ellipse cx={0} cy={-h * 0.28} rx={h * 0.9} ry={h * 0.32} {...st} />
          {[
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ].map(([dx, dy], i) => (
            <path
              key={i}
              d={`M${dx * h * 0.12} ${-h * 0.28 + dy * h * 0.05} L${dx * h * 0.5} ${-h * 0.28 + dy * h * 0.2}`}
              stroke={col}
              strokeWidth={3}
              strokeLinecap="round"
              markerEnd=""
            />
          ))}
        </g>
      );
    case "switch":
      return (
        <g>
          <rect x={-h} y={-h * 0.36} width={s} height={h * 0.72} rx={10} {...st} />
          {[-1, 1].map((d) => (
            <g key={d}>
              <path d={`M${-h * 0.5} ${d * h * 0.14} H${h * 0.5}`} stroke={col} strokeWidth={3} strokeLinecap="round" />
              <path
                d={d < 0 ? `M${h * 0.32} ${-h * 0.28} L${h * 0.5} ${-h * 0.14} L${h * 0.32} 0` : `M${-h * 0.32} 0 L${-h * 0.5} ${h * 0.14} L${-h * 0.32} ${h * 0.28}`}
                fill="none"
                stroke={col}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}
        </g>
      );
    case "cloud":
      return (
        <path
          d={`M${-h * 0.7} ${h * 0.4} Q${-h} ${h * 0.4} ${-h} ${h * 0.05} Q${-h} ${-h * 0.3} ${-h * 0.6} ${-h * 0.3} Q${-h * 0.5} ${-h * 0.75} ${-h * 0.05} ${-h * 0.7} Q${h * 0.35} ${-h * 0.9} ${h * 0.55} ${-h * 0.4} Q${h} ${-h * 0.4} ${h} ${0} Q${h} ${h * 0.4} ${h * 0.65} ${h * 0.4} Z`}
          {...st}
        />
      );
    case "browser":
      return (
        <g>
          <rect x={-h} y={-h * 0.7} width={s} height={s * 0.7} rx={8} {...st} />
          <path d={`M${-h} ${-h * 0.4} H${h}`} stroke={col} strokeWidth={2} />
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={-h * 0.82 + i * h * 0.14} cy={-h * 0.55} r={s * 0.02} fill={col} />
          ))}
          <path d={`M${-h * 0.7} ${-h * 0.1} H${h * 0.5} M${-h * 0.7} ${h * 0.12} H${h * 0.2} M${-h * 0.7} ${h * 0.34} H${h * 0.35}`} stroke={col} strokeOpacity={0.5} strokeWidth={3} strokeLinecap="round" />
        </g>
      );
  }
};

/**
 * A device of the network: its icon, its name under it and an optional second line (an address, a role).
 * `active` lights it (it is the one sending or answering), `color` sets its color (C.one by default).
 */
export const Device: React.FC<{
  x: number;
  y: number;
  kind: DeviceKind;
  label: string;
  sub?: string;
  size?: number;
  opacity?: number;
  active?: number;
  color?: string;
  subColor?: string;
}> = ({ x, y, kind, label, sub, size = 120, opacity = 1, active = 0, color = C.one, subColor }) => (
  <g transform={`translate(${x} ${y})`} opacity={opacity}>
    {active > 0 ? <circle r={size * 0.72} fill={color} opacity={0.16 * active} filter="url(#soft)" /> : null}
    <g filter={active > 0.5 ? "url(#glow)" : undefined}>
      <Icon kind={kind} s={size} col={color} />
    </g>
    <text y={size * 0.62} textAnchor="middle" fontFamily={SANS} fontWeight={700} fontSize={Math.max(20, size * 0.2)} fill={C.text}>
      {label}
    </text>
    {sub ? (
      <text y={size * 0.62 + Math.max(24, size * 0.22)} textAnchor="middle" fontFamily={MONO} fontSize={Math.max(17, size * 0.16)} fill={subColor ?? color}>
        {sub}
      </text>
    ) : null}
  </g>
);

/** A cable between two devices; `p` draws it from `from` to `to`, `active` makes traffic run along it. */
export const Link: React.FC<{ from: Pt; to: Pt; p?: number; active?: number; f?: number; color?: string; label?: string; dashed?: boolean }> = ({
  from,
  to,
  p = 1,
  active = 0,
  f = 0,
  color = C.line,
  label,
  dashed,
}) => {
  if (p <= 0) return null;
  const x2 = lerp(from.x, to.x, p);
  const y2 = lerp(from.y, to.y, p);
  return (
    <g>
      <line x1={from.x} y1={from.y} x2={x2} y2={y2} stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={dashed ? "10 10" : undefined} />
      {active > 0 ? (
        <line x1={from.x} y1={from.y} x2={x2} y2={y2} stroke={C.one} strokeOpacity={0.7 * active} strokeWidth={4} strokeLinecap="round" strokeDasharray="6 18" strokeDashoffset={-f * 2} />
      ) : null}
      {label ? (
        <text x={lerp(from.x, to.x, 0.5) + 10} y={lerp(from.y, to.y, 0.5) - 10} fontFamily={MONO} fontSize={18} fill={C.dim} opacity={p}>
          {label}
        </text>
      ) : null}
    </g>
  );
};

/** Where a packet that left `from` at `start` is at frame `f` (null before it leaves and after it arrives). */
export const packetAt = (f: number, start: number, from: Pt, to: Pt, dur = 40, arc = 0) => {
  const p = interpolate(f, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (f < start || f > start + dur + 10) return null;
  return { x: lerp(from.x, to.x, p), y: lerp(from.y, to.y, p) - Math.sin(p * Math.PI) * arc, p };
};

/**
 * A packet travelling from one point to another: an envelope with its name next to it.
 * It leaves at `start`, takes `dur` frames, and can follow a path of several points (`via`), through a switch for example.
 */
export const Packet: React.FC<{ f: number; start: number; from: Pt; to: Pt; via?: Pt[]; label: string; color?: string; dur?: number; size?: number; labelBelow?: boolean }> = ({
  f,
  start,
  from,
  to,
  via = [],
  label,
  color = C.sel,
  dur = 40,
  size = 1,
  labelBelow,
}) => {
  const pts = [from, ...via, to];
  const legs = pts.length - 1;
  const t = interpolate(f, [start, start + dur], [0, legs], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (f < start || f > start + dur + 8) return null;
  const i = Math.min(legs - 1, Math.floor(t));
  const q = t - i;
  const x = lerp(pts[i].x, pts[i + 1].x, q);
  const y = lerp(pts[i].y, pts[i + 1].y, q);
  const fade = interpolate(f, [start, start + 6, start + dur, start + dur + 8], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`} opacity={fade} filter="url(#glow)">
      <rect x={-24} y={-17} width={48} height={34} rx={6} fill={C.bg0} stroke={color} strokeWidth={3} />
      <path d="M-24 -15 L0 4 L24 -15" fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" />
      <g transform={`translate(0 ${labelBelow ? 46 : -36})`}>
        <rect x={-label.length * 7 - 12} y={-17} width={label.length * 14 + 24} height={32} rx={10} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.5} />
        <text textAnchor="middle" dominantBaseline="central" fontFamily={MONO} fontWeight={700} fontSize={20} fill={color}>
          {label}
        </text>
      </g>
    </g>
  );
};

/** A small file icon (a document with its name), for transfers. */
export const FileIcon: React.FC<{ x: number; y: number; name: string; opacity?: number; color?: string; scale?: number }> = ({ x, y, name, opacity = 1, color = C.sel, scale = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
    <path d="M-22 -30 H10 L22 -18 V30 H-22 Z" fill={C.bg0} stroke={color} strokeWidth={3} strokeLinejoin="round" />
    <path d="M10 -30 V-18 H22" fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" />
    <path d="M-12 -6 H12 M-12 6 H12 M-12 18 H4" stroke={color} strokeOpacity={0.6} strokeWidth={3} strokeLinecap="round" />
    <text y={56} textAnchor="middle" fontFamily={MONO} fontSize={19} fill={color}>
      {name}
    </text>
  </g>
);

/** A broadcast: rings that spread from a device, starting at `start` (one wave every `every` frames, `waves` waves). */
export const Broadcast: React.FC<{ f: number; start: number; at: Pt; color?: string; radius?: number; waves?: number; every?: number }> = ({
  f,
  start,
  at,
  color = C.sel,
  radius = 260,
  waves = 3,
  every = 14,
}) => (
  <g>
    {Array.from({ length: waves }, (_, i) => {
      const p = interpolate(f, [start + i * every, start + i * every + 36], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      if (p <= 0 || p >= 1) return null;
      return <circle key={i} cx={at.x} cy={at.y} r={lerp(30, radius, p)} fill="none" stroke={color} strokeWidth={4} opacity={1 - p} />;
    })}
  </g>
);

/** A line of a terminal: a command typed after the prompt (`cmd`), or what is printed (`out`), from frame `at`. */
export type TermLine = { at: number; text: string; out?: boolean; color?: string; prompt?: string };

/**
 * A terminal window (HTML, place it inside AbsoluteFill): commands are typed character by character from their `at`,
 * outputs appear at once. Only the last `rows` lines that have started are shown.
 */
export const Terminal: React.FC<{
  f: number;
  x: number;
  y: number;
  w: number;
  title: string;
  prompt: string;
  lines: TermLine[];
  rows?: number;
  opacity?: number;
  cps?: number;
  fontSize?: number;
  accent?: string;
}> = ({ f, x, y, w, title, prompt, lines, rows = 8, opacity = 1, cps = 1.6, fontSize = 24, accent = C.one }) => {
  const started = lines.filter((l) => f >= l.at);
  const shown = started.slice(-rows);
  const last = shown[shown.length - 1];
  const typing = last && !last.out && Math.floor((f - last.at) * cps) < last.text.length;
  const caretOn = Math.floor(f / 15) % 2 === 0;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        opacity,
        borderRadius: 16,
        overflow: "hidden",
        background: alpha(C.bg0, 0.94),
        border: `1.5px solid ${C.line}`,
        boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        fontFamily: MONO,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "rgba(255,255,255,0.05)", borderBottom: `1px solid ${C.line}` }}>
        {["#ff6b6b", "#ffc857", "#3fe0c5"].map((c) => (
          <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.8 }} />
        ))}
        <div style={{ marginLeft: 10, color: C.dim, fontSize: 18, fontFamily: SANS }}>{title}</div>
      </div>
      <div style={{ padding: "14px 20px", minHeight: rows * fontSize * 1.45, fontSize, lineHeight: 1.45, color: C.text, whiteSpace: "pre" }}>
        {shown.map((l, i) => {
          const isLast = i === shown.length - 1;
          if (l.out) return <div key={i} style={{ color: l.color ?? C.dim }}>{l.text}</div>;
          const n = Math.max(0, Math.floor((f - l.at) * cps));
          return (
            <div key={i}>
              <span style={{ color: accent }}>{l.prompt ?? prompt}</span> <span style={{ color: l.color ?? C.text }}>{l.text.slice(0, n)}</span>
              {isLast && (typing || caretOn) ? <span style={{ background: C.text, opacity: 0.8 }}> </span> : null}
            </div>
          );
        })}
        {!last ? (
          <div>
            <span style={{ color: accent }}>{prompt}</span> {caretOn ? <span style={{ background: C.text, opacity: 0.8 }}> </span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** A message of an arrow diagram: from the lifeline `from` to the lifeline `to`, drawn from frame `at`. */
export type SeqMsg = { at: number; from: number; to: number; label: string; sub?: string; color?: string; broadcast?: boolean };

/**
 * An arrow diagram (time goes down): one lifeline per actor, one arrow per message, each with its name above
 * and a detail under it; `broadcast` draws a dashed arrow with a "broadcast" tag.
 */
export const SeqDiagram: React.FC<{ f: number; x: number; y: number; w: number; gap: number; actors: { label: string; sub?: string; kind?: DeviceKind }[]; msgs: SeqMsg[]; appear?: number; hi?: number | null }> = ({
  f,
  x,
  y,
  w,
  gap,
  actors,
  msgs,
  appear = 1,
  hi = null,
}) => {
  const col = (i: number) => x + (actors.length === 1 ? w / 2 : (i * w) / (actors.length - 1));
  const top = y + 150;
  const bottom = top + gap * (msgs.length + 0.4);
  return (
    <g opacity={appear}>
      {actors.map((a, i) => (
        <g key={i}>
          <Device x={col(i)} y={y + 40} kind={a.kind ?? "pc"} label={a.label} sub={a.sub} size={90} />
          <line x1={col(i)} y1={top} x2={col(i)} y2={bottom} stroke={C.line} strokeWidth={3} strokeDasharray="4 10" />
        </g>
      ))}
      {msgs.map((m, i) => {
        const p = ramp(f, m.at, 22);
        if (p <= 0) return null;
        const yy = top + gap * (i + 0.6);
        const x1 = col(m.from);
        const x2 = lerp(x1, col(m.to), p);
        const dir = Math.sign(col(m.to) - x1);
        const c = m.color ?? C.sel;
        const dim = hi === null || hi === i ? 1 : 0.35;
        return (
          <g key={i} opacity={dim}>
            <line x1={x1} y1={yy} x2={x2} y2={yy} stroke={c} strokeWidth={4} strokeDasharray={m.broadcast ? "14 10" : undefined} strokeLinecap="round" />
            <path d={`M${x2 - dir * 18} ${yy - 11} L${x2} ${yy} L${x2 - dir * 18} ${yy + 11}`} fill="none" stroke={c} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={p} />
            <text x={(x1 + col(m.to)) / 2} y={yy - 18} textAnchor="middle" fontFamily={MONO} fontWeight={700} fontSize={26} fill={c} opacity={p}>
              {m.label}
            </text>
            {m.sub ? (
              <text x={(x1 + col(m.to)) / 2} y={yy + 34} textAnchor="middle" fontFamily={MONO} fontSize={19} fill={C.dim} opacity={ramp(f, m.at + 14, 16)}>
                {m.sub}
              </text>
            ) : null}
            {m.broadcast ? (
              <g opacity={ramp(f, m.at + 10, 14)}>
                <rect x={x1 + dir * 20 - (dir < 0 ? 132 : 0)} y={yy - 64} width={132} height={28} rx={14} fill={c} fillOpacity={0.16} stroke={c} strokeWidth={1.5} />
                <text x={x1 + dir * 20 + (dir < 0 ? -66 : 66)} y={yy - 50} textAnchor="middle" dominantBaseline="central" fontFamily={SANS} fontWeight={700} fontSize={17} fill={c}>
                  BROADCAST
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
};

/** A card of the main fields of a packet or of a configuration (HTML, inside AbsoluteFill). */
export const FieldCard: React.FC<{ x: number; y: number; w: number; title: string; color?: string; fields: [string, string][]; opacity?: number; reveal?: number[]; f?: number }> = ({
  x,
  y,
  w,
  title,
  color = C.sel,
  fields,
  opacity = 1,
  reveal,
  f = 0,
}) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, opacity, padding: "16px 22px", borderRadius: 18, background: alpha(C.panel, 0.92), border: `1.5px solid ${color}`, fontFamily: SANS }}>
    <div style={{ color, fontSize: 22, fontWeight: 800, letterSpacing: 1, marginBottom: 8 }}>{title}</div>
    {fields.map(([k, v], i) => (
      <div key={i} style={{ display: "flex", gap: 16, fontSize: 22, lineHeight: 1.55, opacity: reveal ? ramp(f, reveal[i] ?? 0, 14) : 1 }}>
        <span style={{ color: C.dim, minWidth: 170 }}>{k}</span>
        <span style={{ color: C.text, fontFamily: MONO }}>{v}</span>
      </div>
    ))}
  </div>
);

/**
 * The camera of the zooms: everything inside is scaled around `focus` (1 = normal view).
 * Zoom in at the end of an overview scene (scale 1 → 3, opacity → 0), zoom out at the start of the next one (3 → 1).
 */
export const Camera: React.FC<{ focus: Pt; scale: number; opacity?: number; children: React.ReactNode }> = ({ focus, scale, opacity = 1, children }) => (
  <AbsoluteFill style={{ transformOrigin: `${focus.x}px ${focus.y}px`, transform: `scale(${scale})`, opacity, filter: scale > 1.05 ? `blur(${Math.min(6, (scale - 1) * 2)}px)` : undefined }}>
    {children}
  </AbsoluteFill>
);

/** The zoom camera of a scene: 1 → `max` from `inAt`, and `max` → 1 from `outAt` (frames of the scene), over `dur` frames. */
export const zoomScale = (f: number, opts: { inAt?: number; outAt?: number; max?: number; dur?: number }) => {
  const { inAt, outAt, max = 3, dur = 24 } = opts;
  let s = 1;
  if (outAt !== undefined) s = lerp(max, 1, ramp(f, outAt, dur));
  if (inAt !== undefined && f >= inAt) s = lerp(1, max, ramp(f, inAt, dur));
  return s;
};

/** A dashed frame around what the next zoom will show, with a magnifying glass and its name. */
export const Lens: React.FC<{ x: number; y: number; w: number; h: number; label: string; p: number; color?: string }> = ({ x, y, w, h, label, p, color = C.sel }) => {
  if (p <= 0) return null;
  return (
    <g opacity={p}>
      <rect x={x} y={y} width={w} height={h} rx={22} fill={color} fillOpacity={0.06} stroke={color} strokeWidth={3} strokeDasharray="12 9" />
      <g transform={`translate(${x + w - 6} ${y - 6})`}>
        <circle r={22} fill={C.bg0} stroke={color} strokeWidth={3} />
        <circle cx={-3} cy={-3} r={9} fill="none" stroke={color} strokeWidth={3} />
        <path d="M4 4 L11 11" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
      </g>
      <text x={x + 18} y={y - 14} fontFamily={SANS} fontWeight={700} fontSize={22} fill={color}>
        {label}
      </text>
    </g>
  );
};

/** The breadcrumb of a zoom scene, top right: "Vue d'ensemble › DHCP", with a magnifying glass. */
export const ZoomBadge: React.FC<{ path: string[]; opacity?: number; color?: string }> = ({ path, opacity = 1, color = C.sel }) => (
  <div style={{ position: "absolute", right: 90, top: 62, opacity, display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderRadius: 30, background: alpha(C.panel, 0.9), border: `1.5px solid ${color}`, fontFamily: SANS, fontSize: 22 }}>
    <svg width={26} height={26} viewBox="-13 -13 26 26">
      <circle cx={-2} cy={-2} r={7.5} fill="none" stroke={color} strokeWidth={2.5} />
      <path d="M4 4 L10 10" stroke={color} strokeWidth={3} strokeLinecap="round" />
    </svg>
    {path.map((p, i) => (
      <span key={i} style={{ color: i === path.length - 1 ? color : C.dim, fontWeight: i === path.length - 1 ? 800 : 500 }}>
        {i > 0 ? <span style={{ color: C.dim, marginRight: 12 }}>›</span> : null}
        {p}
      </span>
    ))}
  </div>
);
