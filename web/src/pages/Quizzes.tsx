import { PlayIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Link, useNavigate } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { type FilterSpec, FilterBar, FilteredGroups, useFilterState, useFiltered } from "../components/ListFilters";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, Loading, PageHeader, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { relative } from "../lib/format";
import { ShuffleToggle } from "../components/ShuffleToggle";
import { useShuffle } from "../lib/shuffle";
import type { QuizSummary } from "../lib/types";

/** The score of an attempt as a percentage and a tone. */
export function scoreTone(score: number, total: number): "ok" | "warn" | "bad" {
  const ratio = total ? score / total : 0;
  return ratio >= 0.8 ? "ok" : ratio >= 0.6 ? "warn" : "bad";
}

const KIND_LABEL = { truefalse: "vrai/faux", mcq: "QCM", mixed: "vrai/faux · QCM" } as const;
const RESULT_LABEL = { none: "pas encore fait", ok: "réussi", warn: "à consolider", bad: "à revoir" } as const;
const resultOf = (q: QuizSummary) => (q.last ? RESULT_LABEL[scoreTone(q.last.score, q.last.total)] : RESULT_LABEL.none);

const SPEC: FilterSpec<QuizSummary> = {
  title: (q) => q.title,
  text: (q) => [q.description],
  course: (q) => q.course,
  date: (q) => q.last?.finishedAt ?? q.createdAt,
  categories: (q) => [q.mine && "créés par moi", KIND_LABEL[q.kind], resultOf(q)],
  kinds: ["créés par moi", ...Object.values(KIND_LABEL), ...Object.values(RESULT_LABEL)],
};

export function Quizzes() {
  const quizzes = useApi<{ quizzes: QuizSummary[] }>("/api/quizzes");
  const navigate = useNavigate();
  const [shuffle, setShuffle] = useShuffle();
  const list = quizzes.data?.quizzes ?? [];
  const [state, set] = useFilterState("quizzes");
  const filtered = useFiltered(list, SPEC, state);
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
    <div className="space-y-4">
      <PageHeader title="Quiz" actions={<ShuffleToggle on={shuffle} onChange={setShuffle} />} />
      {list.length > 0 && <FilterBar spec={SPEC} state={state} set={set} filtered={filtered} />}
      {quizzes.error && <ErrorBox error={quizzes.error} retry={quizzes.reload} />}
      {quizzes.loading && !quizzes.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty title="Aucun quiz" hint="Demandez à l'agent « fais-moi un quiz vrai/faux sur le chapitre 4 de RXI » ou « un QCM sur les relations » : il l'écrit à partir de vos supports, et vous le jouez ici ou à l'oral." />
      ) : filtered.list.length === 0 ? (
        <Empty title="Rien ne correspond" hint="Changez les filtres." />
      ) : (
        <FilteredGroups spec={SPEC} filtered={filtered} grid="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(q) => {
            const tone = q.last ? scoreTone(q.last.score, q.last.total) : undefined;
            return (
              <Card key={q.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <CourseChip code={q.course} />
                      <Badge>{KIND_LABEL[q.kind]}</Badge>
                    </div>
                    <h2 className="font-semibold mt-1.5 leading-snug">{q.title}</h2>
                    {q.description && <p className="text-sm text-ink-2 mt-1 line-clamp-2">{q.description}</p>}
                    {!q.mine && q.author && <p className="text-xs text-ink-3 mt-1">par {q.author}</p>}
                  </div>
                  {/* A shared quiz is deleted by an administrator only. */}
                  {q.deletable !== false && (
                    <IconButton label="Supprimer" onClick={() => void remove(q)} className="shrink-0 -mr-2 -mt-1">
                      <TrashIcon className="h-4.5 w-4.5" />
                    </IconButton>
                  )}
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
          }}
        </FilteredGroups>
      )}
    </div>
  );
}
