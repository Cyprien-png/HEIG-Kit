import { CourseChip } from "../components/CourseChip";
import { Badge, Disclosure, Empty, ErrorBox, Loading, PageHeader, Table, Td, cx } from "../components/ui";
import { useApi } from "../lib/api";
import { relative } from "../lib/format";
import type { AbsenceRow, PlanUnit, Snapshot } from "../lib/types";

const STATUS: Record<string, { label: string; tone: "ok" | "accent" | "neutral" | "warn" | "info" }> = {
  followed: { label: "suivie", tone: "accent" },
  "to follow": { label: "à suivre", tone: "ok" },
  replaced: { label: "remplacée", tone: "neutral" },
  equivalence: { label: "équivalence", tone: "warn" },
  exchange: { label: "échange", tone: "info" },
  planned: { label: "prévue", tone: "neutral" },
};

/** The study plan, one folding section per year, modules and units inside, absences on top; every section starts closed. */
export function Studies() {
  const plan = useApi<Snapshot<PlanUnit[]>>("/api/campus/plan");
  const absences = useApi<Snapshot<AbsenceRow[]>>("/api/campus/absences");
  const missing = plan.error && /not fetched/.test(plan.error);
  const years = new Map<string, Map<string, PlanUnit[]>>();
  for (const u of plan.data?.data ?? []) {
    const modules = years.get(u.year) ?? new Map<string, PlanUnit[]>();
    modules.set(u.module.code, [...(modules.get(u.module.code) ?? []), u]);
    years.set(u.year, modules);
  }
  const current = [...years.entries()].filter(([, modules]) => [...modules.values()].flat().some((u) => u.status === "followed")).map(([y]) => y).sort().at(-1) ?? [...years.keys()].sort()[0];

  return (
    <div className="space-y-3">
      <PageHeader title="Plan d'études" subtitle={plan.data ? `Relevé sur GAPS ${relative(plan.data.checkedAt)}.` : undefined} />
      {missing ? <Empty title="Pas encore relevé" hint="Lancez une synchronisation depuis la page Statut." /> : plan.error ? <ErrorBox error={plan.error} retry={plan.reload} /> : null}
      {absences.data && absences.data.data.length > 0 && (
        <Disclosure id="studies.absences" title="Absences" aside={<Badge tone={absences.data.data.some((a) => Number(a.relativeRate.replace("%", "").replace(",", ".")) >= 10) ? "warn" : "neutral"}>{absences.data.data.length} unités</Badge>}>
          <Table head={["Unité", "Périodes", "Justifiées", "Taux (donné)", "Taux (total)", "Périodes totales"]} className="mx-0">
            {absences.data.data.map((a, i) => {
              const rate = Number(a.relativeRate.replace("%", "").replace(",", "."));
              return (
                <tr key={i}>
                  <Td><CourseChip code={a.unit} /></Td>
                  <Td mono>{a.periods}</Td>
                  <Td mono>{a.justified}</Td>
                  <Td mono className={cx(rate >= 10 && "text-warn font-semibold", rate >= 15 && "text-bad")}>{a.relativeRate}</Td>
                  <Td mono>{a.absoluteRate}</Td>
                  <Td mono className="text-ink-2">{a.totalPeriods}</Td>
                </tr>
              );
            })}
          </Table>
        </Disclosure>
      )}
      {plan.loading ? <Loading /> : [...years.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, modules]) => {
        const units = [...modules.values()].flat();
        const credits = units.reduce((s, u) => s + u.credits.reduce((c, p) => c + p.credits, 0), 0);
        return (
          <Disclosure key={year} id={`studies.${year}`} title={`Année ${year}`} aside={<>{year === current && <Badge tone="accent">en cours</Badge>}<span className="text-xs text-ink-2 tabular-nums">{credits} ECTS</span></>}>
            {[...modules.entries()].map(([code, list]) => (
              <Disclosure
                key={code}
                id={`studies.${year}.${code}`}
                level={2}
                title={<span className="flex items-center gap-2 min-w-0"><span className="shrink-0 font-mono text-xs font-semibold bg-surface-2 rounded px-1.5 py-0.5">{code}</span><span className="min-w-0 truncate">{list[0].module.name}</span></span>}
                aside={<span className="text-xs text-ink-2 tabular-nums">{list.reduce((s, u) => s + u.credits.reduce((c, p) => c + p.credits, 0), 0)} ECTS</span>}
              >
                <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-1.5 px-4 py-3">
                  {list.map((u, i) => (
                    <li key={i} className="flex items-center gap-2 min-w-0 text-sm rounded-lg border border-line px-2.5 py-1.5">
                      <CourseChip code={u.unit.code} />
                      <span className="flex-1 min-w-0 truncate">{u.unit.name}</span>
                      <span className="shrink-0 whitespace-nowrap text-xs text-ink-2 tabular-nums">{u.credits.filter((c) => c.credits > 0).map((c) => `${c.period} ${c.credits}`).join(" · ")}</span>
                      <Badge tone={STATUS[u.status]?.tone ?? "neutral"} className="shrink-0">{STATUS[u.status]?.label ?? u.status}</Badge>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ))}
          </Disclosure>
        );
      })}
    </div>
  );
}
