/** One stable color per course code, readable in both themes. */
const PALETTE = [
  { bg: "#3b82f6", soft: "rgb(59 130 246 / 0.16)", text: "#1d4ed8", textDark: "#93c5fd" },
  { bg: "#8b5cf6", soft: "rgb(139 92 246 / 0.16)", text: "#6d28d9", textDark: "#c4b5fd" },
  { bg: "#10b981", soft: "rgb(16 185 129 / 0.16)", text: "#047857", textDark: "#6ee7b7" },
  { bg: "#f59e0b", soft: "rgb(245 158 11 / 0.18)", text: "#b45309", textDark: "#fcd34d" },
  { bg: "#f43f5e", soft: "rgb(244 63 94 / 0.16)", text: "#be123c", textDark: "#fda4af" },
  { bg: "#06b6d4", soft: "rgb(6 182 212 / 0.16)", text: "#0e7490", textDark: "#67e8f9" },
  { bg: "#84cc16", soft: "rgb(132 204 22 / 0.18)", text: "#4d7c0f", textDark: "#bef264" },
  { bg: "#f97316", soft: "rgb(249 115 22 / 0.16)", text: "#c2410c", textDark: "#fdba74" },
  { bg: "#ec4899", soft: "rgb(236 72 153 / 0.16)", text: "#be185d", textDark: "#f9a8d4" },
  { bg: "#14b8a6", soft: "rgb(20 184 166 / 0.16)", text: "#0f766e", textDark: "#5eead4" },
];

function hash(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Math.abs(h);
}

export function courseColor(code: string | undefined | null) {
  const key = (code ?? "").toUpperCase().trim() || "·";
  return PALETTE[hash(key) % PALETTE.length];
}

/** Inline style of a course chip. */
export function courseStyle(code: string | undefined | null, dark: boolean): React.CSSProperties {
  const c = courseColor(code);
  return { backgroundColor: c.soft, color: dark ? c.textDark : c.text, borderColor: c.bg };
}

/** `PRG-D-L1` → { course: "PRG", type: "L" }. */
export function parseLessonCode(summary: string): { course: string; type: string; label: string } {
  const parts = summary.split("-");
  const kind = /^([A-Z])\d+$/.exec(parts.at(-1) ?? "");
  if (parts.length < 3 || !kind) return { course: summary, type: "", label: summary };
  const type = kind[1];
  const names: Record<string, string> = { C: "cours", L: "labo", A: "appui", E: "exercices" };
  return { course: parts[0], type, label: `${parts[0]} · ${names[type] ?? type}` };
}
