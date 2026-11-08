export interface LevelAxis {
  label: string;
  /** 0 to 1. */
  value: number;
  tone: "ok" | "warn" | "bad" | "neutral";
  /** Not assessed: drawn hollow, at mid-height, so the shape stays readable without claiming a value. */
  muted?: boolean;
}

const TONE_VAR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", neutral: "var(--ink-3)" } as const;

/** One value per axis (the chapters of a course): a single polygon, each vertex coloured by its status. */
export function LevelRadar({ axes, size = 260, label = "Niveau par chapitre" }: { axes: LevelAxis[]; size?: number; label?: string }) {
  const c = size / 2;
  const r = size * 0.34;
  const n = axes.length;
  const point = (i: number, v: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v] as const;
  };
  const ring = (v: number) => axes.map((_, i) => point(i, v).join(",")).join(" ");
  const shape = axes.map((x, i) => point(i, Math.max(0.04, x.value)).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[18rem] mx-auto block" role="img" aria-label={label}>
      {[0.25, 0.5, 0.75, 1].map((v) => (
        <polygon key={v} points={ring(v)} fill="none" stroke="var(--line)" strokeWidth={1} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--line)" strokeWidth={1} />;
      })}
      <polygon points={shape} fill="var(--accent)" fillOpacity={0.12} stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />
      {axes.map((x, i) => {
        const [px, py] = point(i, Math.max(0.04, x.value));
        return x.muted ? (
          <circle key={i} cx={px} cy={py} r={size * 0.016} fill="var(--surface)" stroke={TONE_VAR.neutral} strokeWidth={1.5} strokeDasharray="2 2" />
        ) : (
          <circle key={i} cx={px} cy={py} r={size * 0.016} fill={TONE_VAR[x.tone]} />
        );
      })}
      {axes.map((x, i) => {
        const [px, py] = point(i, 1.2);
        return (
          <text key={i} x={px} y={py} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.05} fontWeight={600} fill={x.muted ? "var(--ink-3)" : "var(--ink-2)"} fontFamily="inherit">
            {x.label}
          </text>
        );
      })}
    </svg>
  );
}
