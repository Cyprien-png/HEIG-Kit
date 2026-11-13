/** The themes of the courses (themes/index.ts) with the settings of this installation, themes/themes.json. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type CourseTheme, DEFAULT_MOOD, MOODS, type ThemeConfig, courseKey, courseTheme, detectCourse } from "../themes/index.js";
import { ROOT } from "./paths.js";

export const THEMES_FILE = path.join(ROOT, "themes", "themes.json");

/** The settings; an unreadable file is an error to report, not a reason to render with other colors. */
export function readThemeConfig(file = THEMES_FILE): ThemeConfig {
  return JSON.parse(readFileSync(file, "utf8")) as ThemeConfig;
}

export function writeThemeConfig(config: ThemeConfig, file = THEMES_FILE): void {
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * The theme of what is being rendered: of `course` when given, otherwise of the course its name, title or first
 * comment starts with (`hints`), otherwise the neutral theme.
 */
export function themeFor(course: string | undefined, hints: (string | null | undefined)[], mood?: string): CourseTheme {
  const config = readThemeConfig();
  return courseTheme(course ?? detectCourse(hints, config), config, mood);
}

/** The courses of the settings with their color and mood, and the moods, as text (CLI and MCP tool). */
export function describeThemes(color = false): string {
  const config = readThemeConfig();
  const swatch = (hex: string) => {
    if (!color) return "";
    const n = Number.parseInt(hex.slice(1), 16);
    return `\x1b[48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m    \x1b[0m `;
  };
  const lines = [`Mood: ${config.mood ?? DEFAULT_MOOD}`, "", "Courses:"];
  for (const code of Object.keys(config.courses ?? {}).sort()) {
    const theme = courseTheme(code, config);
    const aliases = Object.entries(config.aliases ?? {}).filter(([, to]) => to === code).map(([from]) => from);
    lines.push(`  ${swatch(theme.color)}${code.padEnd(12)} ${theme.color}  mood ${theme.mood}${aliases.length ? `  (also ${aliases.join(", ")})` : ""}`);
  }
  lines.push("", "Moods:");
  for (const [name, mood] of Object.entries(MOODS)) lines.push(`  ${name.padEnd(8)} ${mood.label}`);
  return lines.join("\n");
}

/** Sets the color and/or the mood of a course (`mood: null` goes back to the general one), or the general mood. */
export function setTheme(change: { course?: string; color?: string; mood?: string | null }): CourseTheme {
  const config = readThemeConfig();
  if (change.color !== undefined && !/^#[0-9a-f]{6}$/i.test(change.color)) throw new Error(`Invalid color "${change.color}", expected #rrggbb`);
  if (change.mood && !MOODS[change.mood]) throw new Error(`Unknown mood "${change.mood}" (moods: ${Object.keys(MOODS).join(", ")})`);
  if (!change.course) {
    if (!change.mood) throw new Error("Nothing to change: give a mood, or a course with a color or a mood");
    config.mood = change.mood;
  } else {
    const key = courseKey(change.course, config);
    const current = config.courses?.[key];
    if (!current && !change.color) throw new Error(`${key} is not in the settings yet: give it a color (#rrggbb)`);
    const next = { color: (change.color ?? current!.color).toLowerCase(), ...(current?.mood ? { mood: current.mood } : {}) };
    if (change.mood) next.mood = change.mood;
    if (change.mood === null) delete next.mood;
    config.courses = { ...config.courses, [key]: next };
  }
  writeThemeConfig(config);
  return courseTheme(change.course, config);
}
