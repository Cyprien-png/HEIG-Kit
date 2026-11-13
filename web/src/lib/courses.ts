import config from "../../../themes/themes.json";
import { type ChipColors, type ThemeConfig, courseTheme } from "../../../themes/index";

/**
 * The color of a course, the same everywhere (calendar, chips, videos, documents): the one of its theme
 * (themes/themes.json, shared with the renderers), readable in both themes of the app.
 */
export function courseColor(code: string | undefined | null): ChipColors {
  return courseTheme(code, config as ThemeConfig).chip;
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

/** "26_HEIG-VD_MAD_JHH_Mathématiques discrètes" → "Mathématiques discrètes"; names without such a prefix stay as they are. */
export function prettyCourseName(name: string | null | undefined, code?: string | null): string {
  if (!name) return code ?? "";
  const tokens = name.split(/[_/]+/).filter(Boolean);
  const noise = (t: string) => /^(\d{2,4}(-\d{2,4})?|HEIG-?VD(-[A-Z0-9]+)?|[A-Z]{2,4}\d?|[A-Z]{2,4}\d?-[A-Z]{1,2})$/.test(t) || (code ? t.toUpperCase() === code.toUpperCase() : false);
  while (tokens.length > 1 && noise(tokens[0])) tokens.shift();
  const rest = tokens.join(" ").replace(/\s+/g, " ").trim();
  return rest || name;
}
