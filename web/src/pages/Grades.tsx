import { useMemo } from "react";
import { CourseChip } from "../components/CourseChip";
import { Badge, Disclosure, Empty, ErrorBox, Loading, PageHeader, Table, Td, cx } from "../components/ui";

/** One assessment per row: date, title, then the grade, with the class average and the coefficient underneath. */
function Assessments({ list }: { list: CourseGrades["parts"][number]["assessments"] }) {
  return (
    <ul className="divide-y divide-line">
      {list.map((a, j) => (
        <li key={j} className="flex items-center gap-3 px-4 py-2 text-sm">
          <span className="font-mono text-xs text-ink-2 tabular-nums shrink-0 w-[4.75rem]">{a.date}</span>
          <span className="flex-1 min-w-0">
            <span className="block truncate">{a.title}</span>
            <span className="block text-[11px] text-ink-3 tabular-nums">classe {a.classAverage || "–"} · coef. {a.coefficient}</span>
          </span>
          <span className={cx("font-mono tabular-nums shrink-0", gradeTone(a.grade))}>{a.grade || "–"}</span>
        </li>
      ))}
    </ul>
  );
}
import { useApi } from "../lib/api";
import { relative } from "../lib/format";
import type { CourseGrades, PlanUnit, Snapshot, Transcript } from "../lib/types";

const num = (value: string | undefined) => {
  const n = Number((value ?? "").replace(",", "."));
  return Number.isFinite(n) && value ? n : undefined;
};
const fmt = (n: number) => n.toFixed(2).replace(".", ",");

function gradeTone(value: string | number | undefined): string {
  const n = typeof value === "number" ? value : num(value);
  if (n === undefined) return "";
  return n < 4 ? "text-bad font-semibold" : n >= 5 ? "text-ok font-semibold" : "font-semibold";
}

interface ModuleGroup {
  code: string;
  name: string;
  units: { code: string; name: string; credits: number; grades?: CourseGrades }[];
  /** Weighted by the credits of the units that have an average. */
  average?: number;
  /** Credits of the units with an average, out of the module's. */
  gradedCredits: number;
  credits: number;
}

/** The courses with grades, grouped by the modules of the current year of the study plan (the rest under « Autres »). */
export function moduleGroups(grades: CourseGrades[], plan: PlanUnit[] | undefined): ModuleGroup[] {
  const byCode = new Map(grades.map((g) => [g.course.split(" ")[0].toUpperCase(), g]));
  const followedYear = plan?.filter((u) => u.status === "followed").map((u) => u.year).sort().at(-1);
  const units = (plan ?? []).filter((u) => u.year === followedYear);
  const groups = new Map<string, ModuleGroup>();
  for (const u of units) {
    const g = groups.get(u.module.code) ?? { code: u.module.code, name: u.module.name, units: [], gradedCredits: 0, credits: 0 };
    const credits = u.credits.reduce((s, c) => s + c.credits, 0);
    g.units.push({ code: u.unit.code, name: u.unit.name, credits, grades: byCode.get(u.unit.code.toUpperCase()) });
    g.credits += credits;
    groups.set(u.module.code, g);
    byCode.delete(u.unit.code.toUpperCase());
  }
  if (byCode.size > 0) groups.set("—", { code: "—", name: "Autres", units: [...byCode.values()].map((g) => ({ code: g.course.split(" ")[0], name: g.course, credits: 0, grades: g })), gradedCredits: 0, credits: 0 });
  const list = [...groups.values()].filter((g) => g.units.some((u) => u.grades));
  for (const g of list) {
    const graded = g.units.filter((u) => u.grades && num(u.grades.average) !== undefined);
    const weight = (u: ModuleGroup["units"][number]) => u.credits || 1;
    const total = graded.reduce((s, u) => s + weight(u), 0);
    g.gradedCredits = graded.reduce((s, u) => s + u.credits, 0);
    g.average = total ? graded.reduce((s, u) => s + num(u.grades!.average)! * weight(u), 0) / total : undefined;
  }
  return list;
}

/** The usual HES-SO rule: a module is acquired with an average of 4 or more; between 3,5 and 4 it can be remediated. */
function promotion(avg: number | undefined): { label: string; tone: "ok" | "warn" | "bad" | "neutral" } {
  if (avg === undefined) return { label: "sans note", tone: "neutral" };
  return avg >= 4 ? { label: "acquis", tone: "ok" } : avg >= 3.5 ? { label: "remédiation", tone: "warn" } : { label: "insuffisant", tone: "bad" };
}

export function Grades() {
  const grades = useApi<Snapshot<CourseGrades[]>>("/api/campus/grades");
  const transcript = useApi<Snapshot<Transcript>>("/api/campus/transcript");
  const plan = useApi<Snapshot<PlanUnit[]>>("/api/campus/plan");
  const missing = grades.error && /not fetched/.test(grades.error);
  const modules = useMemo(() => moduleGroups(grades.data?.data ?? [], plan.data?.data), [grades.data, plan.data]);

  return (
    <div className="space-y-3">
      <PageHeader title="Notes" subtitle={grades.data ? `Contrôle continu relevé sur GAPS ${relative(grades.data.checkedAt)}. Moyenne de module pondérée par les crédits ; un module est acquis à 4 ou plus.` : undefined} />
      {missing ? <Empty title="Pas encore relevé" hint="Le serveur n'a pas encore synchronisé GAPS : lancez une synchronisation depuis la page Statut." /> : grades.error ? <ErrorBox error={grades.error} retry={grades.reload} /> : null}
      {grades.loading || plan.loading ? <Loading /> : modules.map((m) => {
        const p = promotion(m.average);
        const partial = m.average !== undefined && m.credits > 0 && m.gradedCredits < m.credits;
        return (
          <Disclosure
            key={m.code}
            defaultOpen
            title={<span className="flex items-center gap-2 min-w-0">{m.code !== "—" && <span className="shrink-0 font-mono text-xs font-semibold bg-surface-2 rounded px-1.5 py-0.5">{m.code}</span>}<span className="min-w-0 break-words leading-snug">{m.name}</span></span>}
            aside={
              <>
                {partial && <span className="hidden sm:inline text-[11px] text-ink-3">provisoire</span>}
                <Badge tone={p.tone}>{p.label}</Badge>
                <span className={cx("text-lg tabular-nums min-w-[3rem] text-right", gradeTone(m.average))}>{m.average === undefined ? "–" : fmt(m.average)}</span>
              </>
            }
          >
            {m.units.map((u) => (
              <Disclosure
                key={u.code}
                level={2}
                defaultOpen={Boolean(u.grades)}
                title={<span className="flex items-center gap-2 min-w-0"><CourseChip code={u.code} /><span className="min-w-0 truncate">{u.name}</span>{u.credits > 0 && <span className="shrink-0 text-xs text-ink-3 tabular-nums">{u.credits} ECTS</span>}</span>}
                aside={<span className={cx("text-base tabular-nums", gradeTone(u.grades?.average))}>{u.grades?.average || "–"}</span>}
              >
                {!u.grades ? (
                  <p className="px-4 py-2 text-xs text-ink-3">Pas encore de note.</p>
                ) : (
                  u.grades.parts.map((part, i) => (
                    <div key={i} className="border-t border-line first:border-t-0">
                      <div className="flex items-center justify-between px-4 py-1.5 text-xs">
                        <span className="font-medium">{part.type}</span>
                        <span className="text-ink-2 tabular-nums">moyenne <span className={gradeTone(part.average)}>{part.average || "–"}</span> · poids {part.weight}</span>
                      </div>
                      <Assessments list={part.assessments} />
                    </div>
                  ))
                )}
              </Disclosure>
            ))}
          </Disclosure>
        );
      })}
      {transcript.data && (
        <Disclosure title="Bulletin de notes" aside={<Badge tone="accent">{transcript.data.data.totalCredits} crédits</Badge>}>
          <Table head={transcript.data.data.header} className="mx-0">
            {transcript.data.data.lines.map((l, i) => (
              <tr key={i}>
                {l.cells.map((cell, j) => (
                  <Td key={j} mono={j > 0} className={j > 0 ? gradeTone(cell) : ""}>{cell}</Td>
                ))}
              </tr>
            ))}
          </Table>
        </Disclosure>
      )}
    </div>
  );
}
