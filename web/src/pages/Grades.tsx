import { CourseChip } from "../components/CourseChip";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Table, Td, cx } from "../components/ui";
import { useApi } from "../lib/api";
import { relative } from "../lib/format";
import type { CourseGrades, Snapshot, Transcript } from "../lib/types";

function gradeTone(value: string): string {
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n)) return "";
  return n < 4 ? "text-bad font-semibold" : n >= 5 ? "text-ok font-semibold" : "font-semibold";
}

export function Grades() {
  const grades = useApi<Snapshot<CourseGrades[]>>("/api/campus/grades");
  const transcript = useApi<Snapshot<Transcript>>("/api/campus/transcript");
  const missing = grades.error && /not fetched/.test(grades.error);

  return (
    <div className="space-y-5">
      <PageHeader title="Notes" subtitle={grades.data ? `Contrôle continu et bulletin, relevés sur GAPS ${relative(grades.data.checkedAt)}.` : "Contrôle continu et bulletin de notes (GAPS)."} />
      {missing ? <Empty title="Pas encore relevé" hint="Le serveur n'a pas encore synchronisé GAPS : lancez une synchronisation depuis la page Statut." /> : grades.error ? <ErrorBox error={grades.error} retry={grades.reload} /> : null}
      {grades.loading ? <Loading /> : grades.data && (
        <div className="grid xl:grid-cols-2 gap-4">
          {grades.data.data.map((c) => (
            <Card key={c.course} title={<span className="flex items-center gap-2"><CourseChip code={c.course.split(" ")[0]} /> {c.course}</span>} actions={<span className={cx("text-lg tabular-nums", gradeTone(c.average))}>{c.average || "–"}</span>} padded={false}>
              {c.parts.map((p, i) => (
                <div key={i} className="border-b border-line last:border-0">
                  <div className="flex items-center justify-between px-4 py-2 bg-surface-2/60 text-xs">
                    <span className="font-medium">{p.type}</span>
                    <span className="text-ink-2 tabular-nums">moyenne <span className={gradeTone(p.average)}>{p.average || "–"}</span> · poids {p.weight}</span>
                  </div>
                  <Table head={["Date", "Évaluation", "Classe", "Coef.", "Note"]} className="mx-0">
                    {p.assessments.map((a, j) => (
                      <tr key={j}>
                        <Td mono className="whitespace-nowrap text-ink-2">{a.date}</Td>
                        <Td>{a.title}</Td>
                        <Td mono className="text-ink-2">{a.classAverage}</Td>
                        <Td mono className="text-ink-2 whitespace-nowrap">{a.coefficient}</Td>
                        <Td mono className={gradeTone(a.grade)}>{a.grade || "–"}</Td>
                      </tr>
                    ))}
                  </Table>
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}
      {transcript.data && (
        <Card title="Bulletin de notes" actions={<Badge tone="accent">{transcript.data.data.totalCredits} crédits</Badge>} padded={false}>
          <Table head={transcript.data.data.header}>
            {transcript.data.data.lines.map((l, i) => (
              <tr key={i}>
                {l.cells.map((cell, j) => (
                  <Td key={j} mono={j > 0} className={j > 0 ? gradeTone(cell) : ""}>{cell}</Td>
                ))}
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
