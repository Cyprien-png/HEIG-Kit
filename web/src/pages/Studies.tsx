import { CourseChip } from "../components/CourseChip";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Table, Td, cx } from "../components/ui";
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
  const current = [...years.keys()].sort().at(-1);

  return (
    <div className="space-y-5">
      <PageHeader title="Études" subtitle={plan.data ? `Plan d'études et absences, relevés sur GAPS ${relative(plan.data.checkedAt)}.` : "Plan d'études et absences (GAPS)."} />
      {missing ? <Empty title="Pas encore relevé" hint="Lancez une synchronisation depuis la page Statut." /> : plan.error ? <ErrorBox error={plan.error} retry={plan.reload} /> : null}
      {absences.data && absences.data.data.length > 0 && (
        <Card title="Absences" padded={false}>
          <Table head={["Unité", "Périodes", "Justifiées", "Taux (donné)", "Taux (total)", "Périodes totales"]}>
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
        </Card>
      )}
      {plan.loading ? <Loading /> : [...years.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([year, modules]) => (
        <Card key={year} title={`Année ${year}`} actions={year === current ? <Badge tone="accent">en cours</Badge> : undefined} padded={false}>
          <div className="divide-y divide-line">
            {[...modules.entries()].map(([code, units]) => (
              <div key={code} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-xs font-semibold bg-surface-2 rounded px-1.5 py-0.5">{code}</span>
                  <span className="text-sm font-medium">{units[0].module.name}</span>
                  <span className="ml-auto text-xs text-ink-2 tabular-nums">{units.reduce((s, u) => s + u.credits.reduce((c, p) => c + p.credits, 0), 0)} ECTS</span>
                </div>
                <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
                  {units.map((u, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm rounded-lg border border-line px-2.5 py-1.5">
                      <CourseChip code={u.unit.code} />
                      <span className="flex-1 min-w-0 truncate">{u.unit.name}</span>
                      <span className="text-xs text-ink-2 tabular-nums">{u.credits.filter((c) => c.credits > 0).map((c) => `${c.period} ${c.credits}`).join(" · ")}</span>
                      <Badge tone={STATUS[u.status]?.tone ?? "neutral"}>{STATUS[u.status]?.label ?? u.status}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
