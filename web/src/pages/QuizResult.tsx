import { ArrowPathIcon, CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Markdown } from "../components/Markdown";
import { Badge, Button, Card, ErrorBox, Loading, Segmented, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { dateTime } from "../lib/format";
import type { QuizResult as Result } from "../lib/types";
import { scoreTone } from "./Quizzes";

const LETTERS = "ABCDEFGH";

/** The score of an attempt, then the mistakes (or every question) with the right answer and why. */
export function QuizResult() {
  const { id } = useParams();
  const navigate = useNavigate();
  const result = useApi<Result>(`/api/quiz-attempts/${id}`, [id]);
  const [show, setShow] = useState<"mistakes" | "all">("mistakes");
  if (result.error) return <ErrorBox error={result.error} retry={result.reload} />;
  if (!result.data) return <Loading />;
  const r = result.data;
  const { attempt, quiz } = r;
  const tone = scoreTone(attempt.score, attempt.total);
  const percent = attempt.total ? Math.round((attempt.score / attempt.total) * 100) : 0;
  const rows = show === "all" ? r.answers : r.mistakes;
  const redo = async () => {
    const progress = await api<{ attempt: { id: number } }>(`/api/quizzes/${quiz.id}/attempts`, { method: "POST", json: { mode: "web" } });
    navigate(`/quiz/play/${progress.attempt.id}`);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2 flex-wrap"><CourseChip code={quiz.course} /> {quiz.title}</h1>
        <p className="text-sm text-ink-3 mt-0.5">{attempt.finishedAt ? `Terminé le ${dateTime(attempt.finishedAt)}` : "En cours"} · {attempt.mode === "voice" ? "à l'oral" : attempt.mode === "cli" ? "dans le terminal" : "sur l'app"}</p>
      </div>

      <Card>
        <div className="flex items-center gap-5">
          <div className={cx("relative h-24 w-24 shrink-0 rounded-full grid place-items-center", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-bad")} style={{ background: `conic-gradient(currentColor ${percent}%, var(--surface-2) 0)` }}>
            <div className="h-[4.5rem] w-[4.5rem] rounded-full bg-surface grid place-items-center">
              <span className="text-2xl font-semibold tabular-nums text-ink">{attempt.score}<span className="text-sm text-ink-3">/{attempt.total}</span></span>
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-semibold tabular-nums">{percent} %</div>
            <div className="text-sm text-ink-2">{r.mistakes.length === 0 ? "Sans faute." : `${r.mistakes.length} erreur${r.mistakes.length > 1 ? "s" : ""}${r.mistakes.some((m) => m.answer === undefined) ? ", dont des questions sans réponse" : ""}.`}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => void redo()}><ArrowPathIcon className="h-4 w-4" /> Refaire</Button>
              <Link to="/quiz"><Button size="sm">Tous les quiz</Button></Link>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{show === "mistakes" ? "Vos erreurs" : "Toutes les questions"}</h2>
        <Segmented size="sm" value={show} onChange={setShow} options={[{ value: "mistakes", label: `Erreurs (${r.mistakes.length})` }, { value: "all", label: `Tout (${r.answers.length})` }]} />
      </div>
      {rows.length === 0 ? (
        <Card><p className="text-sm text-ink-2 text-center py-4">Aucune erreur : rien à revoir.</p></Card>
      ) : (
        <ol className="space-y-2">
          {rows.map((a) => (
            <li key={a.questionId} className={cx("rounded-xl border bg-surface p-4", a.correct ? "border-line" : "border-bad/40")}>
              <div className="flex items-start gap-3">
                {a.correct ? <CheckCircleIcon className="h-5 w-5 text-ok shrink-0 mt-0.5" /> : <XCircleIcon className="h-5 w-5 text-bad shrink-0 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap text-xs text-ink-3">
                    <span className="font-mono">{a.position}</span>
                    {a.topic && <Badge>{a.topic}</Badge>}
                    {a.options ? (
                      <span>
                        QCM · réponse : <strong className="text-ok">{(a.expectedChoice ?? []).map((i) => LETTERS[i]).join(", ")}</strong>
                        {!a.correct && <span> · vous : {a.choice === undefined ? "sans réponse" : a.choice.map((i) => LETTERS[i]).join(", ")}</span>}
                      </span>
                    ) : (
                      <span>
                        Réponse : <strong className={a.expected ? "text-ok" : "text-bad"}>{a.expected ? "vrai" : "faux"}</strong>
                        {!a.correct && <span> · vous : {a.answer === undefined ? "sans réponse" : a.answer ? "vrai" : "faux"}</span>}
                      </span>
                    )}
                  </div>
                  <Markdown source={a.statement} className="mt-1 font-medium" />
                  {a.options && (
                    <ul className="mt-2 space-y-1">
                      {a.options.map((o, i) => {
                        const right = a.expectedChoice?.includes(i) ?? false;
                        const chosen = a.choice?.includes(i) ?? false;
                        return (
                          <li key={i} className={cx("flex items-start gap-2 rounded-lg px-2 py-1 text-sm", right ? "bg-ok-soft" : chosen ? "bg-bad-soft" : "")}>
                            <span className={cx("font-mono text-xs font-semibold w-4 shrink-0 pt-0.5", right ? "text-ok" : chosen ? "text-bad" : "text-ink-3")}>{LETTERS[i]}</span>
                            <Markdown source={o} className="flex-1 min-w-0" />
                            {chosen && <span className={cx("text-[11px] shrink-0 pt-0.5", right ? "text-ok" : "text-bad")}>{right ? "votre choix ✓" : "votre choix ✗"}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {a.explanation && <Markdown source={a.explanation} className="mt-1.5 text-sm text-ink-2" />}
                  {a.source && <p className="text-xs text-ink-3 mt-1">{a.source}</p>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
