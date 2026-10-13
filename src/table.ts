import { TIME_ZONE, addDays, isoDate } from "./dates.js";
import type { Lesson } from "./gaps/client.js";

/** ansi: terminal colors; emoji: colored squares, for places without ANSI support (e.g. chat replies); none: plain text. */
export type ColorMode = "ansi" | "emoji" | "none";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LESSON_TYPES: Record<string, string> = { C: "Lecture", L: "Lab", A: "Support" };
const ANSI_COLORS = [31, 32, 33, 34, 35, 36, 91, 92, 93, 94, 95, 96];
const EMOJI_COLORS = ["🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "🟫"];

const time = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, timeStyle: "short" });
const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit" });
const fullDate = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });

/** Monday (Zurich midnight) of the week containing the given day. */
export function startOfWeek(day: Date): Date {
  return addDays(day, -WEEKDAYS.indexOf(weekday.format(day)));
}

/**
 * Renders one week as a timetable: a column per day, a row per time slot (overlapping slots nested in one row).
 * `allLessons` keeps course colors stable from one week to the next.
 */
export function renderWeekTable(allLessons: Lesson[], monday: Date, fetchedAt: string, mode: ColorMode): string {
  const style = styler(mode, allLessons);
  const nextMonday = addDays(monday, 7);
  const lessons = allLessons.filter((l) => new Date(l.end) > monday && new Date(l.start) < nextMonday);
  const timed = lessons.filter((l) => !isAllDay(l));

  const days = WEEKDAYS.map((_, i) => addDays(monday, i)).filter(
    (day, i) => i < 5 || timed.some((l) => isoDate(new Date(l.start)) === isoDate(day)),
  );
  const today = isoDate(new Date());

  const header = [
    "",
    ...days.map((day) => {
      const label = `${weekday.format(day)} ${dayMonth.format(day)}`;
      return isoDate(day) === today ? style.today(`${label} •`) : style.bold(label);
    }),
  ].map((cell) => [cell]);
  const rows = timeBlocks(timed).map((block) => blockRow(block, days, style));

  const lastDay = days.at(-1)!;
  const title = `Week of ${dayMonth.format(monday)} – ${dayMonth.format(lastDay)}.${isoDate(lastDay).slice(0, 4)}`;
  const out = [style.bold(title), style.dim(`GAPS data from ${fullDate.format(new Date(fetchedAt))}`), ""];
  out.push(rows.length > 0 ? drawGrid([header, ...rows], style) : "No lessons this week.");

  for (const event of lessons.filter(isAllDay)) {
    const last = new Date(new Date(event.end).getTime() - 1);
    const span = `${weekday.format(new Date(event.start))} ${dayMonth.format(new Date(event.start))} – ${weekday.format(last)} ${dayMonth.format(last)}`;
    out.push(`${style.marker(event)}${style.bold(event.summary)} ${style.dim(`(${span}, all day)`)}`);
  }
  return out.join("\n");
}

export function isAllDay(lesson: Lesson): boolean {
  return time.format(new Date(lesson.start)) === "00:00" && time.format(new Date(lesson.end)) === "00:00";
}

const startOf = (lesson: Lesson) => time.format(new Date(lesson.start));
const endOf = (lesson: Lesson) => time.format(new Date(lesson.end));

/** Groups lessons whose times of day overlap (e.g. 08:30–10:00 and 09:15–10:00) into one row of the table. */
function timeBlocks(lessons: Lesson[]): Lesson[][] {
  const blocks: Lesson[][] = [];
  let blockEnd = "";
  for (const lesson of [...lessons].sort((a, b) => startOf(a).localeCompare(startOf(b)) || endOf(b).localeCompare(endOf(a)))) {
    if (blocks.length > 0 && startOf(lesson) < blockEnd) {
      blocks.at(-1)!.push(lesson);
    } else {
      blocks.push([lesson]);
    }
    if (endOf(lesson) > blockEnd || blocks.at(-1)!.length === 1) blockEnd = endOf(lesson);
  }
  return blocks;
}

/** Cell line drawn as a dashed separator between two sub-slots of a block. */
const SPLIT = "\u0000split";

/**
 * One table row for a block. A block with nested slots (e.g. 09:15–10:00 inside 08:30–10:00) is split into
 * sub-slots by dashed lines, one line per sub-slot: a 45-minute lesson takes half the height of a 90-minute
 * one, and a lesson covering several sub-slots stays merged across the dashed lines.
 */
function blockRow(block: Lesson[], days: Date[], style: Styler): string[][] {
  const bounds = [...new Set(block.flatMap((l) => [startOf(l), endOf(l)]))].sort();
  const segments = bounds.length - 1;

  if (segments === 1) {
    return [
      [style.bold(`${bounds[0]}–${bounds[1]}`), ""],
      ...days.map((day) => lessonsOn(block, day).flatMap((l) => lessonLines(l, style))),
    ];
  }

  // Sub-slot i is drawn on line 2i, the separator between sub-slots i and i+1 on line 2i+1.
  const height = 2 * segments - 1;
  const label = Array.from({ length: height }, (_, line) =>
    line % 2 === 1 ? SPLIT : style.bold(`${bounds[line / 2]}–${bounds[line / 2 + 1]}`),
  );

  const cells = days.map((day) => {
    const lines = Array.from({ length: height }, (_, line): string => (line % 2 === 1 ? SPLIT : ""));
    for (const lesson of lessonsOn(block, day)) {
      const first = 2 * bounds.indexOf(startOf(lesson));
      const last = 2 * bounds.indexOf(endOf(lesson)) - 2;
      const content = first === last ? [compactLine(lesson, style)] : lessonLines(lesson, style);
      for (let line = first; line <= last; line++) {
        const text = content[line - first] ?? "";
        lines[line] = lines[line] && lines[line] !== SPLIT ? `${lines[line]} / ${text}` : text;
      }
    }
    return lines;
  });
  return [label, ...cells];
}

function lessonsOn(lessons: Lesson[], day: Date): Lesson[] {
  return lessons.filter((l) => isoDate(new Date(l.start)) === isoDate(day));
}

/** GAPS codes look like `PRG-D-L1`: course, class, then lesson type and number. */
function parseCode(summary: string): { course: string; type: string } {
  const parts = summary.split("-");
  const kind = /^([A-Z])\d+$/.exec(parts.at(-1) ?? "");
  if (parts.length < 3 || !kind) return { course: summary, type: "" };
  return { course: parts[0], type: LESSON_TYPES[kind[1]] ?? kind[1] };
}

function lessonLines(lesson: Lesson, style: Styler): string[] {
  const { course, type } = parseCode(lesson.summary);
  const details = [type, lesson.location].filter(Boolean).join(" · ");
  return [`${style.marker(lesson)}${style.course(lesson, course)}`, style.dim(details)];
}

/** Single-line form for a lesson drawn at half height. */
function compactLine(lesson: Lesson, style: Styler): string {
  const { course } = parseCode(lesson.summary);
  const room = lesson.location ? style.dim(` · ${lesson.location}`) : "";
  return `${style.marker(lesson)}${style.course(lesson, course)}${room}`;
}

interface Styler {
  bold(text: string): string;
  dim(text: string): string;
  today(text: string): string;
  border(text: string): string;
  course(lesson: Lesson, text: string): string;
  marker(lesson: Lesson): string;
}

function styler(mode: ColorMode, allLessons: Lesson[]): Styler {
  const courses = [...new Set(allLessons.map((l) => parseCode(l.summary).course))].sort();
  const colorIndex = (lesson: Lesson) => courses.indexOf(parseCode(lesson.summary).course);
  const ansi = (code: string) => (text: string) => (mode === "ansi" && text ? `\x1b[${code}m${text}\x1b[0m` : text);

  return {
    bold: ansi("1"),
    dim: ansi("2"),
    today: mode === "ansi" ? ansi("1;7") : (text) => text,
    border: ansi("2"),
    course: (lesson, text) => ansi(`1;${ANSI_COLORS[colorIndex(lesson) % ANSI_COLORS.length]}`)(text),
    marker: (lesson) => (mode === "emoji" ? `${EMOJI_COLORS[colorIndex(lesson) % EMOJI_COLORS.length]} ` : ""),
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
function drawGrid(rows: string[][][], style: Styler): string {
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
