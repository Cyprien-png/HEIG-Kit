/**
 * What a course page announces for each lesson day. Teachers post plannings on Cyberlearn as labels or sections
 * ("Lundi 9 novembre — Cours : … — Exercices : …"); this reads them so that the calendar shows the programme of a
 * lesson, and turns an announced evaluation into an exam (see `lessonsToEvents`).
 */
import type { Section } from "../cyberlearn/client.js";
import { htmlToText } from "../courses.js";
import type { LessonNotes } from "./calendar.js";

/** Course contents as the sync stores them: sections per timetable course code. */
export type CourseContents = Record<string, Section[]>;

const DAYS = "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche";
const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const DATE_LINE = new RegExp(`^(?:(?:${DAYS})|semaine du)\\s+(\\d{1,2})(?:er)?\\s+(${MONTHS.join("|")})(?:\\s+(\\d{4}))?\\s*[:\\-–—]?\\s*(.*)$`);
const YEAR = /\b(20\d{2})\b/;
const pad = (n: number) => String(n).padStart(2, "0");

/** The programme announced per day (YYYY-MM-DD), from every text of a course page holding dated headings. */
export function planningByDay(sections: Section[], fallbackYear = new Date().getFullYear()): Map<string, string> {
  const notes = new Map<string, string[]>();
  const texts: { title: string; text: string }[] = [];
  for (const section of sections) {
    texts.push({ title: section.name, text: htmlToText(section.summary ?? "") });
    for (const module of section.modules ?? []) texts.push({ title: module.name, text: htmlToText(module.description ?? "") });
  }
  for (const { title, text } of texts) {
    // The title counts as a first line: a section is often named after its week ("Semaine du 1er décembre").
    const lines = [title, ...text.split("\n")].map((line) => line.replace(/^[-•*]\s*/, "").trim());
    const year = Number(YEAR.exec(lines.slice(0, 2).join(" "))?.[1] ?? fallbackYear);
    let current: string | undefined;
    for (const line of lines) {
      const match = DATE_LINE.exec(plain(line));
      if (match) {
        const month = MONTHS.indexOf(match[2]) + 1;
        current = `${match[3] ? Number(match[3]) : year}-${pad(month)}-${pad(Number(match[1]))}`;
        if (!notes.has(current)) notes.set(current, []);
        const rest = line.slice(line.length - match[4].length).trim();
        if (rest) notes.get(current)!.push(rest);
        continue;
      }
      if (current && line) notes.get(current)!.push(line);
    }
  }
  return new Map([...notes].map(([day, lines]) => [day, lines.join("\n")]));
}

/** A `LessonNotes` over the stored contents of every course, parsed once per course. */
export function lessonNotes(contents: CourseContents): LessonNotes {
  const parsed = new Map<string, Map<string, string>>();
  return (course, day) => {
    const sections = contents[course];
    if (!sections) return undefined;
    if (!parsed.has(course)) parsed.set(course, planningByDay(sections, Number(day.slice(0, 4))));
    return parsed.get(course)!.get(day);
  };
}
