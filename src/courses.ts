import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Course, Module, Section } from "./cyberlearn/client.js";
import { TIME_ZONE } from "./dates.js";
import { courseLabel } from "./deadlines.js";

const COURSE_URL = "https://cyberlearn.hes-so.ch/course/view.php?id=";
const BLOCKS = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "blockquote"]);

const date = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, dateStyle: "short" });
const dateTime = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, dateStyle: "short", timeStyle: "short" });

/** One line per course: the code used in the timetable, the full name, the Cyberlearn short name and id. */
export function renderCourseList(courses: Course[], scheduleCourses: string[]): string {
  return courses
    .map((c) => {
      const code = courseLabel(c.shortName, scheduleCourses);
      return `${(scheduleCourses.includes(code) ? code : "-").padEnd(8)} ${c.fullName} (${c.shortName}, id ${c.id})`;
    })
    .join("\n");
}

/** Finds a course by id, timetable code (e.g. `MAD`), short name or part of its full name. */
export function findCourse(courses: Course[], query: string, scheduleCourses: string[]): Course | undefined {
  const q = query.toLowerCase();
  return (
    courses.find((c) => String(c.id) === query) ??
    courses.find((c) => courseLabel(c.shortName, scheduleCourses).toLowerCase() === q) ??
    courses.find((c) => c.shortName.toLowerCase().includes(q) || c.fullName.toLowerCase().includes(q))
  );
}

/**
 * Renders a course as plain text: sections, then each activity or resource with its text (labels, pages,
 * descriptions), files and dates. `pages` maps a page module id to its HTML content.
 */
export function renderCourse(course: Course, sections: Section[], pages: Map<number, string>): string {
  const out = [`# ${course.fullName}`, `${course.shortName}, id ${course.id}, ${COURSE_URL}${course.id}`];
  for (const section of sections) {
    const modules = section.modules.filter((m) => m.modname !== "subsection");
    const summary = htmlToText(section.summary);
    if (modules.length === 0 && !summary) continue;
    out.push("", `## ${section.name}`);
    if (summary) out.push(summary);
    for (const module of modules) out.push(...renderModule(module, pages.get(module.id)));
  }
  return out.join("\n");
}

function renderModule(module: Module, pageHtml: string | undefined): string[] {
  const description = htmlToText(module.description ?? "");
  if (module.modname === "label") return description ? [`- ${indent(description).trimStart()}`] : [];

  const details = [module.modname];
  const files = (module.contents ?? []).filter((f) => f.type === "file" && module.modname !== "page");
  for (const file of files) {
    const modified = file.timemodified ? `, ${date.format(new Date(file.timemodified * 1000))}` : "";
    details.push(`${(file.filepath ?? "/").slice(1)}${file.filename}${modified}`);
  }
  if (module.modname === "url" && module.contents?.[0]) details.push(module.contents[0].fileurl);
  for (const d of module.dates ?? []) details.push(`${d.label.replace(/:$/, "")} ${dateTime.format(new Date(d.timestamp * 1000))}`);

  const lines = [`- ${module.name} [${details.join("; ")}]`];
  const text = [description, htmlToText(pageHtml ?? "")].filter(Boolean).join("\n");
  if (text) lines.push(indent(text));
  return lines;
}

/** Readable text from Moodle HTML: one line per block or table row (cells separated by `|`), comments dropped. */
export function htmlToText(html: string): string {
  if (!html.trim()) return "";
  const $ = cheerio.load(html);
  $("script, style").remove();

  const walk = (node: AnyNode): string => {
    if (node.type === "text") return node.data.replace(/\s+/g, " ");
    if (node.type !== "tag") return "";
    if (node.name === "br") return "\n";
    const inner = node.children.map(walk).join("");
    if (node.name === "td" || node.name === "th") return `${inner.trim()} | `;
    if (node.name === "li") return `\n- ${inner.trim()}\n`;
    return BLOCKS.has(node.name) ? `\n${inner}\n` : inner;
  };

  return $.root()
    .contents()
    .toArray()
    .map(walk)
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s*\|\s*$/, "").trim())
    .filter((line) => line && line !== "-")
    .join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
