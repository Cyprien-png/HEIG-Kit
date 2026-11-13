/** A truth table whose rows appear one by one, can be highlighted, and grouped by 2, 4… with a result per group. */
import React from "react";
import { C, MONO, Val, colorOf, lerp, ramp } from "./ui";

export type TableGeo = { x: number; y: number; rowH: number; vars: string[] };

const NUM_W = 80;
const VAR_W = 70;
const OUT_W = 110;
const HEAD = 56;
const GROUP_W = 118;

export const tableW = (t: TableGeo) => NUM_W + t.vars.length * VAR_W + OUT_W;

/** Center of a cell: `key` is "n" (row number), the name of a variable, or "F" (the output column). */
export function cellPos(t: TableGeo, row: number, key: string): { x: number; y: number } {
  const y = t.y + HEAD + t.rowH * (row + 0.5);
  if (key === "n") return { x: t.x + NUM_W / 2, y };
  if (key === "F") return { x: t.x + NUM_W + t.vars.length * VAR_W + OUT_W / 2, y };
  const i = t.vars.indexOf(key);
  if (i < 0) throw new Error(`The table has no column "${key}"`);
  return { x: t.x + NUM_W + i * VAR_W + VAR_W / 2, y };
}

/** Center of the result chip of group `index` in the `level`-th `groups` entry (0: nearest to the table). */
export function groupPos(t: TableGeo, level: number, size: number, index: number): { x: number; y: number } {
  return { x: t.x + tableW(t) + 78 + level * GROUP_W, y: t.y + HEAD + t.rowH * (size * index + size / 2) };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface TableGroup {
  /** Rows per group: 2 for pairs, 4 for halves of an 8-row table… */
  size: number;
  /** Result written next to each group ("1", "A", "/B"…). */
  labels: string[];
  /** Appearance of each result, 0 → 1. */
  progress: number[];
  /** Strength of the colored bands around the groups, 0 → 1 (default: 0). */
  band?: number;
  /** Opacity of the results, to fade a level once the next one took over (default: 1). */
  dim?: number;
}

export const TruthTable: React.FC<{
  t: TableGeo;
  /** Name of the output column. */
  name: string;
  /** Output of each row, row 0 first: "0", "1", "-"… */
  values: string[];
  /** Appearance of the frame and header, 0 → 1. */
  appear?: number;
  /** How many rows are revealed (fractional: the next row slides in). Default: all. */
  rows?: number;
  /** A highlighted row. */
  hi?: { row: number; strength: number; color?: string } | null;
  /** A column put forward (the variable that leaves the select inputs, for instance). */
  emphasis?: { col: string; strength: number };
  groups?: TableGroup[];
}> = ({ t, name, values, appear = 1, rows = values.length, hi = null, emphasis, groups = [] }) => {
  const width = tableW(t);
  const h = HEAD + t.rowH * values.length;
  const n = t.vars.length;
  // Only the outermost bands that are visible are drawn: nested bands would be unreadable.
  const banded = [...groups].reverse().find((g) => (g.band ?? 0) > 0);
  return (
    <g opacity={appear}>
      <rect x={t.x - 14} y={t.y - 10} width={width + 28} height={h + 20} rx={22} fill={C.panel} fillOpacity={0.75} stroke={C.line} strokeWidth={1.5} />
      {banded
        ? Array.from({ length: Math.ceil(values.length / banded.size) }, (_, i) => {
            const color = i % 2 ? C.edge : C.one;
            return (
              <rect
                key={i}
                x={t.x - 4}
                y={t.y + HEAD + t.rowH * banded.size * i + 4}
                width={width + 8}
                height={t.rowH * banded.size - 8}
                rx={14}
                fill={color}
                fillOpacity={0.09 * banded.band!}
                stroke={color}
                strokeOpacity={0.45 * banded.band!}
                strokeWidth={1.5}
              />
            );
          })
        : null}
      {emphasis && emphasis.strength > 0 ? (
        <rect x={cellPos(t, 0, emphasis.col).x - 28} y={t.y + 6} width={56} height={h - 12} rx={14} fill={C.varA} fillOpacity={0.12 * emphasis.strength} stroke={C.varA} strokeOpacity={0.7 * emphasis.strength} strokeWidth={2} />
      ) : null}
      {hi && hi.strength > 0 ? (
        <rect
          x={t.x - 6}
          y={t.y + HEAD + t.rowH * hi.row + 5}
          width={width + 12}
          height={t.rowH - 10}
          rx={14}
          fill={hi.color ?? C.sel}
          fillOpacity={0.16 * hi.strength}
          stroke={hi.color ?? C.sel}
          strokeOpacity={hi.strength}
          strokeWidth={2.5}
        />
      ) : null}
      {["n", ...t.vars, "F"].map((key) => (
        <text key={key} x={cellPos(t, 0, key).x} y={t.y + HEAD / 2 + 2} textAnchor="middle" dominantBaseline="central" fontFamily={MONO} fontWeight={700} fontSize={26} fill={key === "F" ? C.text : key === "n" ? C.dim : C.sel}>
          {key === "n" ? "N°" : key === "F" ? name : key}
        </text>
      ))}
      <line x1={t.x} x2={t.x + width} y1={t.y + HEAD} y2={t.y + HEAD} stroke={C.line} strokeWidth={2} />
      {values.map((v, r) => {
        const p = clamp01(rows - r);
        return (
          <g key={r} opacity={p} transform={`translate(${lerp(-18, 0, p)} 0)`}>
            <text x={cellPos(t, r, "n").x} y={cellPos(t, r, "n").y + 1} textAnchor="middle" dominantBaseline="central" fontFamily={MONO} fontSize={24} fill={C.dim}>
              {r}
            </text>
            {t.vars.map((key, i) => {
              const bit = (r >> (n - 1 - i)) & 1;
              return (
                <text key={key} x={cellPos(t, r, key).x} y={cellPos(t, r, key).y + 1} textAnchor="middle" dominantBaseline="central" fontFamily={MONO} fontSize={28} fill={bit ? C.text : C.dim}>
                  {bit}
                </text>
              );
            })}
            <text x={cellPos(t, r, "F").x} y={cellPos(t, r, "F").y + 1} textAnchor="middle" dominantBaseline="central" fontFamily={MONO} fontWeight={700} fontSize={32} fill={colorOf(v)}>
              {v}
            </text>
          </g>
        );
      })}
      {groups.map((group, level) =>
        group.labels.map((label, i) => {
          const p = group.progress[i] ?? 0;
          if (p <= 0) return null;
          const pos = groupPos(t, level, group.size, i);
          const x0 = pos.x - 56;
          const half = (t.rowH * group.size) / 2 - 12;
          return (
            <g key={`${level}-${i}`} opacity={p * (group.dim ?? 1)}>
              <path d={`M${x0} ${pos.y - half} h10 V${pos.y + half} h-10`} fill="none" stroke={C.dim} strokeWidth={2.5} strokeLinecap="round" />
              <Val x={pos.x} y={pos.y} label={label} size={46 + level * 4} scale={lerp(0.6, 1, p)} glow={level > 0} />
            </g>
          );
        }),
      )}
    </g>
  );
};

/** A value chip flying from one place to another along an arc, starting at frame `start`: a value copied from a table to an input. */
export const Fly: React.FC<{ f: number; start: number; from: { x: number; y: number }; to: { x: number; y: number }; label: string; dur?: number; opacity?: number }> = ({ f, start, from, to, label, dur = 26, opacity = 1 }) => {
  const p = ramp(f, start, dur);
  if (p <= 0) return null;
  const x = lerp(from.x, to.x, p);
  const y = lerp(from.y, to.y, p) - Math.sin(p * Math.PI) * 70;
  return <Val x={x} y={y} label={label} size={lerp(40, 46, p)} opacity={opacity * Math.min(1, p * 4)} glow={p < 1} />;
};
