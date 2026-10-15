import * as cheerio from "cheerio";
import type { GapsClient } from "./client.js";

/** A graded assessment of a course ("contrôle continu"), e.g. a quiz or a written test. */
export interface Assessment {
  date: string;
  title: string;
  /** Average of the class. */
  classAverage: string;
  /** Weight within its teaching type, e.g. "1/10 (10%)". */
  coefficient: string;
  grade: string;
}

export interface CourseGrades {
  course: string;
  average: string;
  /** Teaching types (Cours, Laboratoire…) with their weight in the course grade. */
  parts: { type: string; average: string; weight: string; assessments: Assessment[] }[];
}

/** A line of the official transcript ("bulletin de notes"). */
export interface TranscriptLine {
  cells: string[];
}

const text = (html: string) => cheerio.load(`<div>${html}</div>`)("div").first().text().replace(/\s+/g, " ").trim();

/** Grades of continuous assessment of the current semester, per course (loaded by GAPS through SAJAX). */
export async function fetchContinuousGrades(gaps: GapsClient): Promise<CourseGrades[]> {
  const path = "/consultation/controlescontinus/consultation.php";
  await gaps.page(`${path}?idst=${gaps.student}`);
  const answer = await gaps.sajax<string | { parts: { result: string } }>(path, "replaceHtmlPart", ["result", null]);
  const html = (typeof answer === "string" ? (JSON.parse(answer) as { parts: { result: string } }) : answer).parts.result;
  const $ = cheerio.load(html);

  const courses: CourseGrades[] = [];
  let part: CourseGrades["parts"][number] | undefined;
  $("table.displayArray tr").each((_, tr) => {
    const row = $(tr);
    const header = row.children("td.bigheader").first();
    if (header.length) {
      const [course, average] = header.text().split(/ - moyenne\s*:\s*/);
      courses.push({ course: course.trim(), average: (average ?? "").trim(), parts: [] });
      return;
    }
    const typeCell = row.children("td.odd").first();
    if (typeCell.length) {
      const lines = (typeCell.html() ?? "").split(/<br\s*\/?>/i).map(text);
      part = {
        type: lines[0],
        average: lines.find((l) => l.startsWith("moyenne"))?.replace(/^moyenne\s*:\s*/, "") ?? "",
        weight: lines.find((l) => l.startsWith("poids"))?.replace(/^poids\s*:\s*/, "") ?? "",
        assessments: [],
      };
      courses.at(-1)?.parts.push(part);
    }
    const cells = row.children("td").not(".odd").toArray();
    if (!part || cells.length !== 5 || $(cells[0]).hasClass("l2header")) return;
    const [date, title, classAverage, coefficient, grade] = cells.map((td, i) => {
      // The description is shown twice (short and long version) for long titles.
      const short = $(td).find("[id^='short__']").first();
      return (i === 1 && short.length ? short.text() : $(td).text()).replace(/\s+/g, " ").trim();
    });
    part.assessments.push({ date, title, classAverage, coefficient, grade });
  });
  return courses;
}

/** Lines of the official transcript (modules, situation, year, grade, coefficient, credits). */
export async function fetchTranscript(gaps: GapsClient): Promise<{ header: string[]; lines: TranscriptLine[]; totalCredits: string }> {
  const page = await gaps.page(`/consultation/notes/bulletin.php?id=${gaps.student}`);
  const $ = cheerio.load(page.html);
  const rows = $("#record_table tr").toArray();
  const header = $(rows[0]).children("td").toArray().map((td) => $(td).text().trim());
  const lines: TranscriptLine[] = [];
  let totalCredits = "";
  for (const tr of rows.slice(1)) {
    const cells = $(tr).children("td").toArray().map((td) => $(td).text().replace(/\s+/g, " ").trim());
    if ($(tr).hasClass("total-credits-row")) totalCredits = cells.filter(Boolean).at(-1) ?? "";
    else if (cells.some(Boolean)) lines.push({ cells });
  }
  return { header, lines, totalCredits };
}
