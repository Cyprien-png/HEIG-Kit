import { ArrowUturnLeftIcon, CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Markdown } from "../components/Markdown";
import { type SwipeCardHandle, SwipeCard } from "../components/SwipeCard";
import { Button, ErrorBox, Kbd, Loading } from "../components/ui";
import { api, useApi } from "../lib/api";
import type { QuizProgress, QuizResult } from "../lib/types";

/** Plays an attempt: one statement per card, swiped right for true and left for false; the result page follows the last one. */
export function QuizPlay() {
  const { id } = useParams();
  const navigate = useNavigate();
  const initial = useApi<QuizResult>(`/api/quiz-attempts/${id}`, [id]);
  const [progress, setProgress] = useState<QuizProgress>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const swipe = useRef<SwipeCardHandle>(null);

  // The current question is the first one without an answer; a finished attempt goes to its result.
  useEffect(() => {
    if (!initial.data) return;
    const r = initial.data;
    if (r.attempt.finishedAt) {
      navigate(`/quiz/attempts/${r.attempt.id}`, { replace: true });
      return;
    }
    const next = r.answers.find((a) => a.answer === undefined);
    setProgress({ attempt: r.attempt, next: next ? { id: next.questionId, position: next.position, statement: next.statement, topic: next.topic } : undefined });
  }, [initial.data, navigate]);

  const answer = useCallback(
    async (value: boolean) => {
      if (!progress?.next || busy) return;
      setBusy(true);
      try {
        const r = await api<QuizProgress>(`/api/quiz-attempts/${progress.attempt.id}/answers`, { method: "POST", json: { answer: value, questionId: progress.next.id } });
        if (r.result) navigate(`/quiz/attempts/${r.attempt.id}`, { replace: true });
        else setProgress(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [progress, busy, navigate],
  );

  const finish = async () => {
    if (!progress || !confirm("Terminer maintenant ? Les questions restantes compteront comme fausses.")) return;
    await api(`/api/quiz-attempts/${progress.attempt.id}/finish`, { method: "POST" });
    navigate(`/quiz/attempts/${progress.attempt.id}`, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "f" || e.key === "F") swipe.current?.fly(-1);
      else if (e.key === "ArrowRight" || e.key === "v" || e.key === "V") swipe.current?.fly(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (initial.error) return <ErrorBox error={initial.error} retry={initial.reload} />;
  if (!progress) return <Loading />;
  const { attempt, next } = progress;
  const quiz = initial.data?.quiz;

  return (
    <div className="max-w-3xl mx-auto space-y-4 select-none">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-3 uppercase tracking-wide">Quiz vrai / faux</div>
          <h1 className="font-semibold truncate flex items-center gap-2"><CourseChip code={quiz?.course} link={false} /> {quiz?.title}</h1>
        </div>
        <div className="text-sm text-ink-2 tabular-nums shrink-0">{Math.min(attempt.answered + 1, attempt.total)} / {attempt.total}</div>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className="h-full bg-accent transition-all" style={{ width: `${(attempt.answered / Math.max(attempt.total, 1)) * 100}%` }} />
      </div>
      {error && <ErrorBox error={error} />}

      {next ? (
        <>
          <div className="relative min-h-[20rem] sm:min-h-[24rem]">
            {attempt.answered + 1 < attempt.total && <div className="absolute inset-x-3 top-2 bottom-0 rounded-2xl border border-line bg-surface-2/60" aria-hidden />}
            <SwipeCard ref={swipe} resetKey={next.id} disabled={busy} leftLabel="Faux" rightLabel="Vrai" onSwipe={(d) => void answer(d > 0)}>
              <div className="h-full bg-surface border border-line rounded-2xl shadow-card p-5 sm:p-6 flex flex-col cursor-grab active:cursor-grabbing">
                <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-3 flex items-center justify-between"><span>Affirmation {next.position}</span>{next.topic && <span className="normal-case tracking-normal text-ink-3">{next.topic}</span>}</div>
                <div className="flex-1 grid place-items-center text-center overflow-y-auto"><Markdown source={next.statement} className="text-xl leading-snug" /></div>
                <p className="text-xs text-ink-3 text-center mt-3">Glissez à droite si c'est vrai, à gauche si c'est faux</p>
              </div>
            </SwipeCard>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => swipe.current?.fly(-1)} disabled={busy} className="rounded-xl border border-bad/30 bg-bad-soft text-bad h-14 px-3 flex items-center justify-center gap-2 hover:brightness-95 dark:hover:brightness-110 transition disabled:opacity-50">
              <XMarkIcon className="h-5 w-5" /> <span className="text-sm font-semibold">Faux</span> <Kbd>←</Kbd>
            </button>
            <button onClick={() => swipe.current?.fly(1)} disabled={busy} className="rounded-xl border border-ok/30 bg-ok-soft text-ok h-14 px-3 flex items-center justify-center gap-2 hover:brightness-95 dark:hover:brightness-110 transition disabled:opacity-50">
              <CheckIcon className="h-5 w-5" /> <span className="text-sm font-semibold">Vrai</span> <Kbd>→</Kbd>
            </button>
          </div>
        </>
      ) : (
        <Button variant="primary" onClick={() => navigate(`/quiz/attempts/${attempt.id}`)}>Voir le résultat</Button>
      )}

      <div className="flex items-center justify-between text-xs text-ink-3">
        <button onClick={() => void finish()} className="hover:text-ink">Terminer maintenant</button>
        <Link to="/quiz" className="inline-flex items-center gap-1 text-accent"><ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Quitter</Link>
      </div>
    </div>
  );
}
