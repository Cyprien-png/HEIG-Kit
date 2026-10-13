import { TIME_ZONE, addDays, isoDate } from "./dates.js";
import type { Lesson } from "./gaps/client.js";
import { type ColorMode, SPLIT, type Styler, createStyler, drawGrid } from "./render.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const style = createStyler(mode, scheduleCourses(allLessons));
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
    out.push(`${style.marker(parseCode(event.summary).course)}${style.bold(event.summary)} ${style.dim(`(${span}, all day)`)}`);
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

/**
 * One table row for a block, at least 3 lines high so every row has the same size. Nested slots
 * (e.g. 09:15–10:00 inside 08:30–10:00) use one line per sub-slot: a lesson covering the whole block is
 * centered, a shorter one sits on the line of its sub-slot, cut off from the rest of its cell by a dashed line.
 */
function blockRow(block: Lesson[], days: Date[], style: Styler): string[][] {
  const bounds = [...new Set(block.flatMap((l) => [startOf(l), endOf(l)]))].sort();
  // Sub-slot i is drawn on line 2i, with a possible separator on the odd line between two sub-slots.
  const height = Math.max(3, 2 * (bounds.length - 1) - 1);
  const middle = Math.floor((height - 1) / 2);

  const label = Array<string>(height).fill("");
  label[middle] = style.bold(`${bounds[0]}–${bounds.at(-1)}`);

  const cells = days.map((day) => {
    const lines = Array<string>(height).fill("");
    for (const lesson of lessonsOn(block, day)) {
      const first = 2 * bounds.indexOf(startOf(lesson));
      const last = 2 * bounds.indexOf(endOf(lesson)) - 2;
      const whole = first === 0 && last === 2 * (bounds.length - 2);
      const line = whole ? middle : Math.floor((first + last) / 2);
      lines[line] = lines[line] ? `${lines[line]} / ${lessonLine(lesson, style)}` : lessonLine(lesson, style);
      if (!whole) {
        for (const separator of [first - 1, last + 1]) {
          if (separator >= 0 && separator < height && !lines[separator]) lines[separator] = SPLIT;
        }
      }
    }
    return lines;
  });
  return [label, ...cells];
}

function lessonsOn(lessons: Lesson[], day: Date): Lesson[] {
  return lessons.filter((l) => isoDate(new Date(l.start)) === isoDate(day));
}

/** Course codes of the schedule (e.g. `PRG`), sorted: their order sets each course's color everywhere. */
export function scheduleCourses(lessons: Lesson[]): string[] {
  return [...new Set(lessons.map((l) => parseCode(l.summary).course))].sort();
}

/** GAPS codes look like `PRG-D-L1`: course, class, then lesson type (C lecture, L lab, A support) and number. */
function parseCode(summary: string): { course: string; type: string } {
  const parts = summary.split("-");
  const kind = /^([A-Z])\d+$/.exec(parts.at(-1) ?? "");
  if (parts.length < 3 || !kind) return { course: summary, type: "" };
  return { course: parts[0], type: kind[1] };
}

/** One line per lesson, e.g. `PRG-L · C23`. */
function lessonLine(lesson: Lesson, style: Styler): string {
  const { course, type } = parseCode(lesson.summary);
  const name = type ? `${course}-${type}` : course;
  const room = lesson.location ? style.dim(` · ${lesson.location}`) : "";
  return `${style.marker(course)}${style.course(course, name)}${room}`;
}
