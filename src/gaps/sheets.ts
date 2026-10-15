import * as cheerio from "cheerio";
import { htmlToText } from "../courses.js";
import { GAPS_URL, type GapsClient } from "./client.js";

interface SectionData {
  data?: {
    text?: string;
    totalperiods?: number;
    teachingform?: { title: string; periods: string; data: { title: string; periods: string }[] }[];
    hascustom?: boolean;
    defaultvalues?: { title: string; text: string }[];
    customvalues?: { title: string; text: string }[];
    examduration?: number;
    examauthmat?: { name: string; checked: boolean }[];
  };
}

/** Calls the sheet's "reload" function: GAPS answers a JSON string, itself containing JSON. */
async function reload(gaps: GapsClient, path: string, parts: Record<string, string[]>): Promise<Record<string, SectionData>> {
  const answer = await gaps.sajax<string>(path, "__rfReloadAll", [JSON.stringify(parts), null]);
  return JSON.parse(answer) as Record<string, SectionData>;
}

function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => (cells[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
}

/** Contents and periods per topic ("Contenu et formes d'enseignement"). */
function teachingForms(data: NonNullable<SectionData["data"]>): string {
  return (data.teachingform ?? [])
    .map((form) => {
      const rows = [["Contenu", "Périodes"], ...form.data.map((d) => [d.title, d.periods])];
      return `**${form.title}** (${form.periods} périodes)\n\n${markdownTable(rows)}`;
    })
    .join("\n\n");
}

/** Assessment rules ("Contrôle des connaissances"): the unit's own rules when it has some, else the defaults. */
function assessment(data: NonNullable<SectionData["data"]>): string {
  const rules = (data.hascustom ? data.customvalues : data.defaultvalues) ?? [];
  const parts = rules.map((r) => `**${r.title}** : ${htmlToText(r.text).replace(/\n+/g, " ")}`);
  if (data.examduration) parts.push(`**Examen** : ${data.examduration} minutes`);
  const material = (data.examauthmat ?? []).filter((m) => m.checked).map((m) => m.name);
  if (material.length > 0) parts.push(`**Matériel autorisé à l'examen** : ${material.join(", ")}`);
  return parts.join("\n\n");
}

/** Planned periods per semester of a "Temporalité" table, e.g. "S1 : Cours 80 périodes". */
function temporality($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>): string {
  const rows = table.find("> tbody > tr");
  const header = rows.first().children("th").toArray().map((th) => $(th).text().trim());
  const semesters = new Map<string, string[]>();
  rows.slice(1).each((_, tr) => {
    const type = $(tr).children("th").first().text().trim();
    $(tr).children("td").each((i, td) => {
      const periods = $(td).find("span").first().text().trim();
      if (/^\d+$/.test(periods)) semesters.set(header[i + 1], [...(semesters.get(header[i + 1]) ?? []), `${type} ${periods}`]);
    });
  });
  return [...semesters].map(([semester, items]) => `${semester} : ${items.join(", ")} périodes`).join(" ; ");
}

/**
 * A unit sheet ("fiche d'unité", /consultation/fiches/uv/…) or module sheet ("descriptif de module",
 * /consultation/fiches/mv/…) as Markdown: key facts, then each section (prerequisites, objectives or skills,
 * content and periods, assessment, bibliography, remarks).
 */
export async function fetchSheet(gaps: GapsClient, sheetPath: string, title: string): Promise<string> {
  const first = await reload(gaps, sheetPath, { tabPlan: ["planTab"] });
  const plan = (first.tabPlan?.data as { content?: string; tabtitles?: string[] } | undefined) ?? {};
  const $ = cheerio.load(plan.content ?? "");

  const parts: Record<string, string[]> = {};
  $("[rfdb][id]").each((_, e) => {
    (parts[$(e).attr("rfdb")!] ??= []).push($(e).attr("id")!);
  });
  const sections = await reload(gaps, sheetPath, parts);

  for (const [key, section] of Object.entries(sections)) {
    const data = section.data;
    if (!data || Array.isArray(data)) continue;
    const target = $(`#disp-0-${key}`);
    if (data.text !== undefined) target.html(data.text);
    else if (data.teachingform) target.attr("data-md", teachingForms(data));
    else if (data.defaultvalues || data.customvalues) target.attr("data-md", assessment(data));
  }

  // Choice lists (level, type, characteristic): only the checked option is kept.
  $(".sheet-chkbx-f").closest(".sheet-sct-container").remove();
  $(".sheet-chkbx-t").remove();

  const facts: string[][] = [["", ""]];
  $(".sheet-sct-introducer-container").each((_, item) => {
    const label = $(item).find(".sheet-sct-title").first().text().trim();
    // Spaces between elements: values are split in spans ("80" "périodes" "correspondant à" "60" "heures").
    const html = $(item).find(".sheet-sct-content").first().html() ?? "";
    const value = cheerio.load(html.replace(/></g, "> <")).text().replace(/\s+/g, " ").trim();
    // In module sheets, the final grade of each unit is under the unit's name ("Analyse 1 (ANA1) [poids: 90]").
    const unit = $(item).closest(".detail-notes").siblings(".sheet-sct-title").first().text().trim();
    if (label && value) facts.push([unit ? `${label} — ${unit}` : label, value]);
  });
  $(".temporalorganisation table.sheet-table-style").filter((_, t) => $(t).parents("table").length === 0).each((_, table) => {
    const owner = $(table).closest(".sheet-sct-container").children(".sheet-sct-title").first().text().replace(/\s+/g, " ").trim();
    const summary = temporality($, $(table));
    if (summary) facts.push([owner && owner !== "Temporalité" ? `Temporalité — ${owner}` : "Temporalité", summary]);
  });

  const out = [`# ${title}`, ""];
  if (plan.tabtitles?.length) out.push(`*Plan de formation ${plan.tabtitles.join(", ")} · [fiche GAPS](${new URL(sheetPath, GAPS_URL)})*`, "");
  out.push(markdownTable(facts.filter((row, i) => facts.findIndex((other) => other.join("|") === row.join("|")) === i)));

  const clean = (text: string) => text.replace(/^Chargement\.\.\.$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  const titleOf = (el: cheerio.Cheerio<any>) => el.children(".sheet-sct-title").first().text().replace(/\s+/g, " ").trim();

  // Sheets are made of parts (div#part-…), introduced in module sheets by a numbered separator ("9 Bibliographie").
  $("[id^='part-']").each((_, part) => {
    const partTitle = $(part).prev(".sheet-separator").find(".ss-title").first().text().replace(/\s+/g, " ").trim();
    const blocks: { title: string; text: string }[] = [];
    $(part)
      .find(".sheet-sct-container")
      .each((_, container) => {
        const block = $(container);
        // Titled blocks without titled sub-blocks (e.g. "Niveau" with its checked option), and untitled blocks that
        // are not part of a titled one; the key facts and the period tables are already summarized above.
        const hasTitledChild = block.find(".sheet-sct-container").filter((_, c) => titleOf($(c)) !== "").length > 0;
        const hasTitledAncestor = block.parentsUntil(part, ".sheet-sct-container").filter((_, c) => titleOf($(c)) !== "").length > 0;
        if (titleOf(block) ? hasTitledChild : block.find(".sheet-sct-container").length > 0 || hasTitledAncestor) return;
        if (block.closest(".temporalorganisation, .detail-notes").length > 0) return;
        if (block.find(".sheet-sct-introducer-container").length > 0) return;
        const title = titleOf(block);
        if (/^(Temporalité|Organisation temporelle)$/.test(title)) return;
        const text = clean(block.find("[data-md]").first().attr("data-md") ?? htmlToText(block.find(".sheet-sct-content, [id^='disp-0-']").first().html() ?? ""));
        if (text) blocks.push({ title, text });
      });
    if (blocks.length === 0) return;
    if (partTitle) {
      out.push("", `## ${partTitle}`);
      for (const block of blocks) out.push("", ...(block.title ? [`### ${block.title}`, ""] : []), block.text);
    } else {
      for (const block of blocks) out.push("", `## ${block.title || "Informations"}`, "", block.text);
    }
  });
  return out.join("\n");
}
