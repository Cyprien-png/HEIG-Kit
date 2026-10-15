import * as cheerio from "cheerio";
import type { GapsClient } from "./client.js";

/** Status of a unit in the student's path, as shown by the cell colors of the GAPS student page. */
export type UnitStatus = "followed" | "replaced" | "to follow" | "equivalence" | "exchange" | "planned";

const STATUS_BY_COLOR: Record<string, UnitStatus> = {
  "#69f": "followed",
  "#d3d3d3": "replaced",
  "#6c6": "to follow",
  "#ffaa88": "equivalence",
  "#ff3": "exchange",
};

/** A teaching unit (e.g. MAD) of the student's study plan, inside its module (e.g. MAI1). */
export interface PlanUnit {
  year: string;
  module: { name: string; code: string; sheet: string };
  unit: { name: string; code: string; sheet: string };
  /** Credits (ECTS) per period of the year: E (preparatory), S1, S2. */
  credits: { period: string; credits: number }[];
  status: UnitStatus;
}

export interface AbsenceRow {
  unit: string;
  /** Absent periods, justified ones in brackets in GAPS ("4 [4]"). */
  periods: number;
  justified: number;
  /** Absences relative to the periods given so far, and to all periods of the unit. */
  relativeRate: string;
  absoluteRate: string;
  totalPeriods: number;
}

export interface StudentRecord {
  plan: PlanUnit[];
  absences: AbsenceRow[];
}

const PERIODS = ["E", "S1", "S2"];

/** "Mathématiques discrètes (MAD)" → name and code. */
function nameAndCode(text: string): { name: string; code: string } {
  const match = /^(.*)\(([^()]+)\)\s*$/.exec(text.replace(/\s+/g, " ").trim());
  return match ? { name: match[1].trim(), code: match[2].trim() } : { name: text.trim(), code: "" };
}

function color(style: string | undefined): string {
  return (/background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})/i.exec(style ?? "")?.[1] ?? "").toLowerCase();
}

/** Study plan and absences from the "Détails étudiant" page (loaded by GAPS through a SAJAX call). */
export async function fetchStudentRecord(gaps: GapsClient): Promise<StudentRecord> {
  const html = (
    await gaps.sajax<string>("/consultation/etudiant/", "smartReplacePart", [
      "STUDENT_SELECT_ID",
      "studentDataDiv",
      null,
      null,
      null,
      Number(gaps.student),
      null,
    ])
  ).replace(/@££@/g, "");
  const $ = cheerio.load(html);

  const plan: PlanUnit[] = [];
  const seen = new Set<string>();
  let year = "";
  let module: PlanUnit["module"] | undefined;
  // The page shows the plan twice ("par année", then "par unité"): only the table organized by year is read.
  const byYear = $("td")
    .filter((_, td) => /^Année \d{4}-\d{4}$/.test($(td).text().replace(/\s+/g, " ").trim()))
    .first()
    .closest("table");
  byYear.find("tr").each((_, tr) => {
    const row = $(tr);
    const text = row.text().replace(/\s+/g, " ").trim();
    const yearMatch = /^Année (\d{4}-\d{4})$/.exec(text);
    if (yearMatch) {
      year = yearMatch[1];
      return;
    }
    const moduleLink = row.find('a[href*="/fiches/mv/"]').first();
    if (moduleLink.length && row.children("td").length === 1) {
      module = { ...nameAndCode(moduleLink.text()), sheet: moduleLink.attr("href") ?? "" };
      return;
    }
    const unitLink = row.children("td").first().find('a[href*="/fiches/uv/"]').first();
    if (!unitLink.length || !module || !year) return;
    const unit = { ...nameAndCode(unitLink.text()), sheet: unitLink.attr("href") ?? "" };
    const key = `${year}|${module.code}|${unit.code}`;
    if (seen.has(key)) return;
    seen.add(key);

    const cells = row.children("td").slice(1).toArray();
    const credits = cells
      .map((td, i) => ({ period: PERIODS[i] ?? `P${i}`, value: $(td).text().trim(), color: color($(td).attr("style")) }))
      .filter((c) => /^\d+(\.\d+)?$/.test(c.value));
    plan.push({
      year,
      module,
      unit,
      credits: credits.map((c) => ({ period: c.period, credits: Number(c.value) })),
      // Units of later years have no status color yet: they are planned by the study plan.
      status: STATUS_BY_COLOR[credits[0]?.color ?? ""] ?? "planned",
    });
  });

  const absences: AbsenceRow[] = [];
  $("tr").each((_, tr) => {
    const cells = $(tr).children("td").toArray().map((td) => $(td).text().replace(/\s+/g, " ").trim());
    const unitIndex = cells.findIndex((c) => / - [A-Za-z0-9-]+$/.test(c));
    if (unitIndex < 0 || cells.length < unitIndex + 13) return;
    const rest = cells.slice(unitIndex + 1);
    const total = /(\d+)\s*\[(\d+)\]/.exec(rest[5] ?? "");
    absences.push({
      unit: cells[unitIndex],
      periods: Number(total?.[1] ?? 0),
      justified: Number(total?.[2] ?? 0),
      relativeRate: rest[7] ?? "",
      absoluteRate: rest[10] ?? "",
      totalPeriods: Number(rest[9] ?? 0),
    });
  });
  return { plan, absences };
}
