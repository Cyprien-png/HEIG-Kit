import type { Deadline } from "./cyberlearn/client.js";
import { TIME_ZONE, isoDate, startOfDay } from "./dates.js";
import { type ColorMode, createStyler, drawGrid } from "./render.js";

const MODULES: Record<string, string> = { assign: "assignment", quiz: "quiz", forum: "forum", workshop: "workshop" };
const DAY_MS = 24 * 60 * 60 * 1000;

const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit" });
const time = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, timeStyle: "short" });
const fullDate = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });

/**
 * Renders pending Cyberlearn activities as a table sorted by due date. `courses` are the schedule's course
 * codes, so a course has the same color as in the timetable.
 */
export function renderDeadlines(deadlines: Deadline[], courses: string[], mode: ColorMode, now = new Date()): string {
  const labels = deadlines.map((d) => courseLabel(d.courseShortName || d.course, courses));
  const style = createStyler(mode, courses.length > 0 ? courses : [...new Set(labels)].sort());
  const out = [style.bold("Cyberlearn deadlines"), style.dim(`Activities still to do, as of ${fullDate.format(now)}`), ""];
  if (deadlines.length === 0) return [...out, "Nothing left to do."].join("\n");

  const header = ["Due", "Course", "Activity", "Status"].map((h) => [style.bold(h)]);
  const rows = deadlines.map((d, i) => {
    const date = new Date(d.due);
    const kind = MODULES[d.module] ?? d.module;
    return [
      [`${weekday.format(date)} ${dayMonth.format(date)} ${time.format(date)}`],
      [`${style.marker(labels[i])}${style.course(labels[i], labels[i])}`],
      [`${d.name}${kind ? style.dim(` (${kind})`) : ""}`],
      [status(d, now, style.bold)],
    ];
  });
  return [...out, drawGrid([header, ...rows], style)].join("\n");
}

/** Short course code for a Cyberlearn course, e.g. `26-27_HEIG-VD_SYL` → `SYL`, preferring the schedule's codes. */
export function courseLabel(name: string, courses: string[]): string {
  const tokens = name.split(/[_\s()]+/).filter(Boolean);
  const known = tokens.map((t) => t.replace(/-\d{4}$/, "")).find((t) => courses.includes(t));
  if (known) return known;
  const meaningful = tokens.filter((t) => !/^\d{2}(-\d{2})?$/.test(t) && t !== "HEIG-VD");
  return (meaningful[0] ?? name).replace(/-\d{4}$/, "");
}

function status(deadline: Deadline, now: Date, emphasize: (text: string) => string): string {
  const days = Math.round((startOfDay(isoDate(new Date(deadline.due))).getTime() - startOfDay(isoDate(now)).getTime()) / DAY_MS);
  if (deadline.overdue || new Date(deadline.due) < now) {
    return emphasize(days === 0 ? "overdue (today)" : `overdue (${-days} day${days === -1 ? "" : "s"})`);
  }
  if (days === 0) return emphasize("today");
  if (days === 1) return emphasize("tomorrow");
  return `in ${days} days`;
}
