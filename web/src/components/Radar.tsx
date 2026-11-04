export interface RadarAxis {
  label: string;
  /** 0 to 1. */
  strong: number;
  /** 0 to 1. */
  weak: number;
}

/**
 * A small radar of strengths (green) and weaknesses (red) per course, drawn as SVG with the theme's colours.
 * Needs three axes to make sense; the caller falls back to something else below that.
 */
export function Radar({ axes, size = 260 }: { axes: RadarAxis[]; size?: number }) {
  const c = size / 2;
  const r = size * 0.34;
  const n = axes.length;
  const point = (i: number, v: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v] as const;
  };
  const ring = (v: number) => axes.map((_, i) => point(i, v).join(",")).join(" ");
  const poly = (key: "strong" | "weak") => axes.map((x, i) => point(i, Math.max(0.02, x[key])).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[18rem] mx-auto block" role="img" aria-label="Points forts et points faibles par cours">
      {[0.25, 0.5, 0.75, 1].map((v) => (
        <polygon key={v} points={ring(v)} fill="none" stroke="var(--line)" strokeWidth={1} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--line)" strokeWidth={1} />;
      })}
      <polygon points={poly("weak")} fill="var(--bad)" fillOpacity={0.18} stroke="var(--bad)" strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points={poly("strong")} fill="var(--ok)" fillOpacity={0.22} stroke="var(--ok)" strokeWidth={1.5} strokeLinejoin="round" />
      {axes.map((x, i) => {
        const [px, py] = point(i, 1.22);
        return (
          <text key={x.label} x={px} y={py} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.05} fontWeight={600} fill="var(--ink-2)" fontFamily="inherit">
            {x.label}
          </text>
        );
      })}
    </svg>
  );
}
