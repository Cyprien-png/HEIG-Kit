import type { Entity } from "./entities.js";
import type { CourseGrades, TranscriptLine } from "./grades.js";
import type { AbsenceRow, PlanUnit } from "./student.js";

const STATUS_LABEL: Record<PlanUnit["status"], string> = {
  followed: "suivie",
  replaced: "remplacée",
  "to follow": "à suivre",
  equivalence: "équivalence",
  exchange: "échange / transfert",
  planned: "prévue",
};

function table(rows: string[][]): string {
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => (cells[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
}

/** Study plan as Markdown: per academic year, each module with its units, credits and status. */
export function renderPlan(plan: PlanUnit[], years?: string[]): string {
  const selected = years ? plan.filter((u) => years.includes(u.year)) : plan;
  const out: string[] = [];
  for (const year of [...new Set(selected.map((u) => u.year))].sort()) {
    const units = selected.filter((u) => u.year === year);
    const credits = units.reduce((sum, u) => sum + u.credits.reduce((s, c) => s + c.credits, 0), 0);
    out.push(`## ${year} (${credits} crédits ECTS)`, "");
    const rows = [["Module", "Unité", "Semestre", "Crédits", "Statut"]];
    for (const u of units) {
      rows.push([
        `${u.module.name} (${u.module.code})`,
        `${u.unit.name} (${u.unit.code})`,
        u.credits.map((c) => c.period).join(", "),
        String(u.credits.reduce((s, c) => s + c.credits, 0)),
        STATUS_LABEL[u.status],
      ]);
    }
    out.push(table(rows), "");
  }
  return out.join("\n").trim() || "No unit found in the study plan.";
}

/** Continuous assessment grades and transcript as Markdown. */
export function renderGrades(courses: CourseGrades[], transcript: { header: string[]; lines: TranscriptLine[]; totalCredits: string }): string {
  const out = ["## Contrôles continus (semestre en cours)", ""];
  if (courses.length === 0) out.push("Aucun contrôle continu pour l'instant.", "");
  for (const course of courses) {
    out.push(`### ${course.course} — moyenne : ${course.average || "-"}`, "");
    for (const part of course.parts) {
      out.push(`**${part.type}** (poids ${part.weight}, moyenne ${part.average || "-"})`, "");
      const rows = [["Date", "Évaluation", "Note", "Moyenne de classe", "Coefficient"]];
      for (const a of part.assessments) rows.push([a.date, a.title, a.grade, a.classAverage, a.coefficient]);
      out.push(table(rows), "");
    }
  }
  out.push("## Bulletin de notes", "");
  if (transcript.lines.length === 0) out.push("Aucune note au bulletin pour l'instant (les modules y apparaissent une fois évalués).");
  else out.push(table([transcript.header, ...transcript.lines.map((l) => l.cells)]));
  out.push("", `Total des crédits obtenus : ${transcript.totalCredits || "0"}`);
  out.push("", "*Échelle de 1 à 6, 4 est la note minimale de réussite. « a 1.0 » : absence au contrôle ; [x] : note ignorée dans la moyenne.*");
  return out.join("\n");
}

export function renderAbsences(absences: AbsenceRow[]): string {
  if (absences.length === 0) return "Aucune absence enregistrée.";
  const rows = [["Unité", "Périodes d'absence", "dont justifiées", "Taux (périodes données)", "Taux (toute l'unité)", "Périodes de l'unité"]];
  for (const a of absences) rows.push([a.unit, String(a.periods), String(a.justified), a.relativeRate, a.absoluteRate, String(a.totalPeriods)]);
  return `${table(rows)}\n\n*Le taux relatif porte sur les périodes déjà données, le taux absolu sur toutes les périodes de l'unité.*`;
}

const TYPE_LABEL: Record<Entity["type"], string> = { student: "étudiant·e", teacher: "enseignant·e", course: "enseignement", room: "salle", class: "classe" };

export function renderEntities(entities: Entity[]): string {
  if (entities.length === 0) return "No match. Teachers are listed by acronym (e.g. JHH), rooms by name (e.g. C23).";
  return entities.map((e) => `${TYPE_LABEL[e.type].padEnd(13)} ${e.name}`).join("\n");
}
