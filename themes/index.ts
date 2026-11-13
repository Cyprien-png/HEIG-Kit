/**
 * The graphic charter of each course: one color per course (the one of the calendar), from which the colors of the
 * videos, the documents and the web app are derived, and a mood that sets how the dark backgrounds feel.
 *
 * Pure functions without any import, shared by the server, the renderers and the web app: the settings (themes.json,
 * next to this file) are read by whoever calls them. docs/themes.md explains how to change a color or the mood.
 */

export interface ThemeConfig {
  /** Mood of every course that does not set its own. */
  mood?: string;
  /** Other codes of a course: { "ANA": "ANA1" }. */
  aliases?: Record<string, string>;
  courses?: Record<string, { color: string; mood?: string }>;
}

/** How a mood turns the color of a course into dark backgrounds. Saturations and lightnesses are HSL percentages. */
export interface Mood {
  label: string;
  /** Saturation of the backgrounds: how much of the course color they carry. */
  sat: number;
  /** Lightness of the edge and of the center of the background, of the panels and of the lines. */
  bg0: number;
  bg1: number;
  panel: number;
  line: number;
  /** Strength of the two colored halos (1 = the usual one) and opacity of the grid. */
  halo: number;
  grid: number;
  /** Hue of the second halo, in degrees from the course color. */
  shift: number;
}

export const MOODS: Record<string, Mood> = {
  nuit: { label: "Nuit : sombre et teinté, le style habituel", sat: 50, bg0: 6, bg1: 12, panel: 15, line: 28, halo: 1, grid: 0.035, shift: -35 },
  encre: { label: "Encre : presque noir, sobre, la couleur seulement sur les accents", sat: 14, bg0: 4, bg1: 8, panel: 11, line: 23, halo: 0.4, grid: 0.02, shift: -20 },
  neon: { label: "Néon : saturé, halos marqués", sat: 72, bg0: 5, bg1: 14, panel: 17, line: 33, halo: 1.8, grid: 0.05, shift: -50 },
  aube: { label: "Aube : plus clair et plus doux", sat: 36, bg0: 11, bg1: 20, panel: 23, line: 37, halo: 1.2, grid: 0.03, shift: 40 },
};
export const DEFAULT_MOOD = "nuit";

/** Colors of a High quality video (the `C` of the kit). Hex colors, so that `alpha()` can make them transparent. */
export interface VideoColors {
  bg0: string;
  bg1: string;
  panel: string;
  line: string;
  text: string;
  dim: string;
  /** The accent of the course, also the color of a 1 or of what is true. */
  one: string;
  zero: string;
  sel: string;
  varA: string;
  varB: string;
  bad: string;
  /** The two halos of the background and their strength, the opacity of the grid. */
  haloA: string;
  haloB: string;
  halo: number;
  grid: number;
  /** Gradients of the boxes (top, bottom) and of their edges (start; the end is `one`). */
  boxTop: string;
  boxBottom: string;
  edge: string;
}

/** Colors of a document (light page, printed). */
export interface DocColors {
  accent: string;
  /** Headings. */
  ink: string;
  /** Borders under the headings and around the tables. */
  rule: string;
  /** Background of table headers and quotes. */
  soft: string;
}

/** Colors of a course chip and of a lesson in the calendar of the web app. */
export interface ChipColors {
  bg: string;
  soft: string;
  text: string;
  textDark: string;
}

export interface CourseTheme {
  /** Code of the course in the settings, null for the neutral theme (no course). */
  course: string | null;
  mood: string;
  /** The color of the course, as in the calendar. */
  color: string;
  video: VideoColors;
  doc: DocColors;
  chip: ChipColors;
}

/** The look of the kit before courses had a theme: used when a video belongs to no course. */
export const NEUTRAL_VIDEO: VideoColors = {
  bg0: "#070b18",
  bg1: "#0e1630",
  panel: "#121c3a",
  line: "#2a3a66",
  text: "#eaf0ff",
  dim: "#8493b8",
  one: "#3fe0c5",
  zero: "#6f7fa6",
  sel: "#ffc857",
  varA: "#ff7ac6",
  varB: "#9d8cff",
  bad: "#ff6b6b",
  haloA: "#3b5bff",
  haloB: "#3fe0c5",
  halo: 1,
  grid: 0.035,
  boxTop: "#1a2750",
  boxBottom: "#101937",
  edge: "#6aa8ff",
};
const NEUTRAL_COLOR = "#64748b";

/** Colors given to the courses that are not in the settings: the ones the calendar always used. */
const FALLBACK = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4", "#84cc16", "#f97316", "#ec4899", "#14b8a6"];

/** Second colors of a video (selection, variables): the first three that are far enough from the course color. */
const SECONDARY = [
  { hue: 41, color: "#ffc857" },
  { hue: 326, color: "#ff7ac6" },
  { hue: 249, color: "#9d8cff" },
  { hue: 195, color: "#5fd4ff" },
  { hue: 140, color: "#7ee79b" },
];

function hash(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Math.abs(h);
}

/** "#rrggbb" → [hue 0-360, saturation 0-100, lightness 0-100]. */
export function hexToHsl(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lig = Math.min(100, Math.max(0, l)) / 100;
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** A hex color with an opacity: `alpha("#121c3a", 0.85)` → "rgba(18,28,58,0.85)". */
export function alpha(hex: string, opacity: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

const HEX = /^#[0-9a-f]{6}$/i;
const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** The code under which a course is in the settings: upper case, its alias followed. Empty when there is no course. */
export function courseKey(code: string | null | undefined, config: ThemeConfig): string {
  const key = (code ?? "").toUpperCase().trim();
  return config.aliases?.[key] ?? key;
}

/** The color of a course: the one of the settings, otherwise one that only depends on its code. */
export function courseColor(code: string | null | undefined, config: ThemeConfig): string {
  const key = courseKey(code, config);
  if (!key) return NEUTRAL_COLOR;
  const set = config.courses?.[key]?.color;
  return set && HEX.test(set) ? set.toLowerCase() : FALLBACK[hash(key) % FALLBACK.length];
}

function videoColors(color: string, mood: Mood): VideoColors {
  const [h] = hexToHsl(color);
  const panel = hslToHex(h, mood.sat, mood.panel);
  // The accent is as light as its hue needs to be read on a panel: violets and blues more than greens and yellows.
  let light = 66;
  while (light < 88 && contrast(hslToHex(h, 82, light), panel) < 5.5) light += 1;
  const one = hslToHex(h, 82, light);
  const second = SECONDARY.filter((c) => hueDistance(c.hue, h) > 40).map((c) => c.color);
  return {
    bg0: hslToHex(h, mood.sat, mood.bg0),
    bg1: hslToHex(h, mood.sat, mood.bg1),
    panel,
    line: hslToHex(h, mood.sat * 0.8, mood.line),
    text: hslToHex(h, 60, 96),
    dim: hslToHex(h, 20, 66),
    one,
    zero: hslToHex(h, 16, 54),
    sel: second[0],
    varA: second[1],
    varB: second[2],
    bad: "#ff6b6b",
    haloA: hslToHex(h + mood.shift, 90, 60),
    haloB: one,
    halo: mood.halo,
    grid: mood.grid,
    boxTop: hslToHex(h, mood.sat, mood.panel + 6),
    boxBottom: hslToHex(h, mood.sat, mood.panel - 1),
    edge: hslToHex(h + mood.shift, 95, 70),
  };
}

/** Contrast ratio (WCAG) of two hex colors, from 1 (the same) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const n = Number.parseInt(hex.replace("#", ""), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The lightest color of a hue, from `start` down, that reaches a contrast on white: greens and yellows need to be darker than blues. */
function onPaper(h: number, s: number, start: number, min: number): string {
  let l = start;
  while (l > 5 && contrast(hslToHex(h, s, l), "#ffffff") < min) l -= 1;
  return hslToHex(h, s, l);
}

function docColors(color: string): DocColors {
  const [h, s] = hexToHsl(color);
  return { accent: onPaper(h, Math.min(s, 75), 42, 4.5), ink: onPaper(h, 45, 22, 9), rule: hslToHex(h, 40, 78), soft: hslToHex(h, 60, 96) };
}

function chipColors(color: string): ChipColors {
  const [h, s] = hexToHsl(color);
  return { bg: color, soft: alpha(color, 0.16), text: onPaper(h, Math.min(s, 80), 36, 5.5), textDark: hslToHex(h, Math.min(s + 10, 95), 78) };
}

/**
 * The theme of a course. Without a course, the neutral theme (the look videos had before). `mood` overrides the one
 * of the settings; an unknown mood is refused rather than replaced silently.
 */
export function courseTheme(code: string | null | undefined, config: ThemeConfig, mood?: string): CourseTheme {
  const key = courseKey(code, config);
  const name = mood ?? config.courses?.[key]?.mood ?? config.mood ?? DEFAULT_MOOD;
  if (!MOODS[name]) throw new Error(`Unknown mood "${name}" (moods: ${Object.keys(MOODS).join(", ")})`);
  const color = courseColor(key, config);
  if (!key) return { course: null, mood: name, color, video: { ...NEUTRAL_VIDEO }, doc: docColors(color), chip: chipColors(color) };
  return { course: key, mood: name, color, video: videoColors(color, MOODS[name]), doc: docColors(color), chip: chipColors(color) };
}

/**
 * The course a file belongs to, from texts that start with its code: a file name ("rxi-ch5-masque", "MAD-TE-blanc"),
 * a title ("RXI – Labo 2b"), the first comment of a scene file ("SYL ch. 6 : …"). Only courses of the settings and
 * their aliases are recognized, so that an ordinary first word is never taken for a course.
 */
export function detectCourse(texts: (string | null | undefined)[], config: ThemeConfig): string | null {
  const known = new Set([...Object.keys(config.courses ?? {}), ...Object.keys(config.aliases ?? {})]);
  for (const text of texts) {
    const first = /^[^\p{L}\p{N}]*([\p{L}\p{N}]+)/u.exec(text ?? "")?.[1]?.toUpperCase();
    if (first && known.has(first)) return courseKey(first, config);
  }
  return null;
}
