/** ansi: terminal colors; emoji: colored squares, for places without ANSI support (e.g. chat replies); none: plain text. */
export type ColorMode = "ansi" | "emoji" | "none";

const ANSI_COLORS = [31, 32, 33, 34, 35, 36, 91, 92, 93, 94, 95, 96];
const EMOJI_COLORS = ["🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "🟫"];

/** Cell line drawn as a dashed separator between two sub-slots of a block. */
export const SPLIT = "\u0000split";

export interface Styler {
  bold(text: string): string;
  dim(text: string): string;
  today(text: string): string;
  border(text: string): string;
  /** Colors text with the course's color. */
  course(course: string, text: string): string;
  /** Colored square before a course in emoji mode, nothing otherwise. */
  marker(course: string): string;
}

/** `courses` is the ordered list of course codes: a course's position picks its color. */
export function createStyler(mode: ColorMode, courses: string[]): Styler {
  const colorIndex = (course: string) => Math.max(0, courses.indexOf(course));
  const ansi = (code: string) => (text: string) => (mode === "ansi" && text ? `\x1b[${code}m${text}\x1b[0m` : text);

  return {
    bold: ansi("1"),
    dim: ansi("2"),
    today: mode === "ansi" ? ansi("1;7") : (text) => text,
    border: ansi("2"),
    course: (course, text) => ansi(`1;${ANSI_COLORS[colorIndex(course) % ANSI_COLORS.length]}`)(text),
    marker: (course) => (mode === "emoji" ? `${EMOJI_COLORS[colorIndex(course) % EMOJI_COLORS.length]} ` : ""),
  };
}

/** Terminal columns taken by a string: ANSI codes take none, emoji take two. */
function width(text: string): number {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  let columns = 0;
  for (const char of plain) columns += /\p{Emoji_Presentation}/u.test(char) ? 2 : 1;
  return columns;
}

function pad(text: string, columns: number): string {
  return text + " ".repeat(columns - width(text));
}

/** Draws a box-drawing grid; each cell is a list of lines. */
export function drawGrid(rows: string[][][], style: Styler): string {
  const cellWidth = (text: string) => (text === SPLIT ? 0 : width(text));
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => Math.max(0, ...row[col].map(cellWidth)))));
  const line = (left: string, mid: string, right: string) =>
    style.border(left + widths.map((w) => "─".repeat(w + 2)).join(mid) + right);

  const out = [line("┌", "┬", "┐")];
  rows.forEach((row, i) => {
    const height = Math.max(1, ...row.map((cell) => cell.length));
    for (let l = 0; l < height; l++) {
      const cells = row.map((cell, col) =>
        cell[l] === SPLIT ? style.border("╌".repeat(widths[col] + 2)) : ` ${pad(cell[l] ?? "", widths[col])} `,
      );
      out.push(style.border("│") + cells.join(style.border("│")) + style.border("│"));
    }
    out.push(i === rows.length - 1 ? line("└", "┴", "┘") : line("├", "┼", "┤"));
  });
  return out.join("\n");
}
