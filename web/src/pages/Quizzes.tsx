import { PlayIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Link, useNavigate } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Button, Card, Empty, ErrorBox, IconButton, Loading, PageHeader, Toggle, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { relative } from "../lib/format";
import { useShuffle } from "../lib/shuffle";
import type { QuizSummary } from "../lib/types";

/** The score of an attempt as a percentage and a tone. */
export function scoreTone(score: number, total: number): "ok" | "warn" | "bad" {
  const ratio = total ? score / total : 0;
  return ratio >= 0.8 ? "ok" : ratio >= 0.6 ? "warn" : "bad";
}

export function Quizzes() {
  const quizzes = useApi<{ quizzes: QuizSummary[] }>("/api/quizzes");
  const navigate = useNavigate();
  const [shuffle, setShuffle] = useShuffle();
  const list = quizzes.data?.quizzes ?? [];
  const remove = async (q: QuizSummary) => {
    if (!confirm(`Supprimer le quiz « ${q.title} » et ses essais ?`)) return;
    await api(`/api/quizzes/${q.id}`, { method: "DELETE" });
    void quizzes.reload();
  };
  const start = async (q: QuizSummary) => {
    const progress = await api<{ attempt: { id: number } }>(`/api/quizzes/${q.id}/attempts`, { method: "POST", json: { mode: "web", shuffle } });
    navigate(`/quiz/play/${progress.attempt.id}`);
  };

  return (
    <div>
      <PageHeader title="Quiz" actions={<Toggle checked={shuffle} onChange={setShuffle} label="Mélanger" />} />
      {quizzes.error && <ErrorBox error={quizzes.error} retry={quizzes.reload} />}
      {quizzes.loading && !quizzes.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty title="Aucun quiz" hint="Demandez à l'agent « fais-moi un quiz vrai/faux sur le chapitre 4 de RXI » : il l'écrit à partir de vos supports, et vous le jouez ici ou à l'oral." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((q) => {
            const tone = q.last ? scoreTone(q.last.score, q.last.total) : undefined;
            return (
              <Card key={q.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CourseChip code={q.course} />
                    <h2 className="font-semibold mt-1.5 leading-snug">{q.title}</h2>
                    {q.description && <p className="text-sm text-ink-2 mt-1 line-clamp-2">{q.description}</p>}
                  </div>
                  <IconButton label="Supprimer" onClick={() => void remove(q)} className="shrink-0 -mr-2 -mt-1">
                    <TrashIcon className="h-4.5 w-4.5" />
                  </IconButton>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3 text-sm">
                  <div className="text-ink-2">
                    {q.questions} question{q.questions > 1 ? "s" : ""} · {q.attempts} essai{q.attempts > 1 ? "s" : ""}
                    {q.last && (
                      <div className="text-xs text-ink-3 mt-0.5">
                        Dernier : <Link to={`/quiz/attempts/${q.last.attemptId}`} className={cx("font-semibold tabular-nums", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-bad")}>{q.last.score}/{q.last.total}</Link> {relative(q.last.finishedAt)}
                        {q.best && q.best.score !== q.last.score && <span> · meilleur {q.best.score}/{q.best.total}</span>}
                      </div>
                    )}
                  </div>
                  <Button variant="primary" size="sm" onClick={() => void start(q)}>
                    <PlayIcon className="h-4 w-4" /> {q.attempts ? "Refaire" : "Commencer"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
