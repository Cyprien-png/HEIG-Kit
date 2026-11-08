import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Markdown } from "../components/Markdown";
import { AnswerButton, NextCard, Session, SessionCard } from "../components/Session";
import { CardBody, type SwipeCardHandle, SwipeCard, cardNumber } from "../components/SwipeCard";
import { Button, ErrorBox, Kbd, Loading, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import type { QuizAsked, QuizProgress, QuizResult } from "../lib/types";

const LETTERS = "ABCDEFGH";

/**
 * Plays an attempt full screen, one question per card: a statement is swiped right for true and left for false, a QCM
 * is a form whose options are ticked (letter keys, or a tap) and validated; the result page follows the last one.
 */
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
    const next = r.answers.find((a) => (a.options ? a.choice === undefined : a.answer === undefined));
    setProgress({
      attempt: r.attempt,
      next: next ? { id: next.questionId, position: next.position, statement: next.statement, topic: next.topic, ...(next.options ? { options: next.options, multiple: (next.expectedChoice?.length ?? 0) > 1 } : {}) } : undefined,
    });
  }, [initial.data, navigate]);

  const [choice, setChoice] = useState<number[]>([]);
  const nextId = progress?.next?.id;
  useEffect(() => setChoice([]), [nextId]);

  const answer = useCallback(
    async (value: boolean | number[]) => {
      if (!progress?.next || busy) return;
      setBusy(true);
      try {
        const body = typeof value === "boolean" ? { answer: value, questionId: progress.next.id } : { choice: value, questionId: progress.next.id };
        const r = await api<QuizProgress>(`/api/quiz-attempts/${progress.attempt.id}/answers`, { method: "POST", json: body });
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

  const options = progress?.next?.options;
  const multiple = progress?.next?.multiple ?? false;
  const toggle = useCallback((i: number) => setChoice((c) => (multiple ? (c.includes(i) ? c.filter((x) => x !== i) : [...c, i].sort((a, b) => a - b)) : [i])), [multiple]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (options) {
        const letter = LETTERS.indexOf(e.key.toUpperCase());
        const index = letter >= 0 ? letter : /^[1-8]$/.test(e.key) ? Number(e.key) - 1 : -1;
        if (index >= 0 && index < options.length) toggle(index);
        else if (e.key === "Enter" && choice.length > 0) void answer(choice);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "f" || e.key === "F") swipe.current?.fly(-1);
      else if (e.key === "ArrowRight" || e.key === "v" || e.key === "V") swipe.current?.fly(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, choice, toggle, answer]);

  if (initial.error) return <ErrorBox error={initial.error} retry={initial.reload} />;
  if (!progress) return <Loading />;
  const { attempt, next } = progress;

  return (
    <Session
      back="/quiz"
      progress={attempt.answered / Math.max(attempt.total, 1)}
      onFinish={next ? () => void finish() : undefined}
      buttons={
        next &&
        (next.options ? (
          <Button variant="primary" className="col-span-2 h-12" disabled={busy || choice.length === 0} onClick={() => void answer(choice)}>
            <CheckIcon className="h-5 w-5" /> Valider{choice.length > 0 ? ` ${choice.map((i) => LETTERS[i]).join(", ")}` : ""}
            <span className="hidden md:inline-flex"><Kbd>↵</Kbd></span>
          </Button>
        ) : (
          <>
            <AnswerButton tone="bad" icon={XMarkIcon} label="Faux" kbd="←" disabled={busy} onClick={() => swipe.current?.fly(-1)} />
            <AnswerButton tone="ok" icon={CheckIcon} label="Vrai" kbd="→" disabled={busy} onClick={() => swipe.current?.fly(1)} />
          </>
        ))
      }
    >
      {error && <ErrorBox error={error} />}
      {next ? (
        <>
          {attempt.answered + 1 < attempt.total && <NextCard />}
          {next.options ? (
            <McqCard key={next.id} question={next} total={attempt.total} choice={choice} onToggle={toggle} onSubmit={() => choice.length > 0 && void answer(choice)} disabled={busy} />
          ) : (
            <SwipeCard key={next.id} ref={swipe} disabled={busy} leftLabel="Faux" rightLabel="Vrai" onSwipe={(d) => void answer(d > 0)}>
              <SessionCard number={cardNumber(next.position, attempt.total)}>
                <CardBody>
                  <Markdown source={next.statement} className="text-xl leading-snug" />
                </CardBody>
              </SessionCard>
            </SwipeCard>
          )}
        </>
      ) : (
        <div className="grid place-items-center h-full">
          <Button variant="primary" onClick={() => navigate(`/quiz/attempts/${attempt.id}`)}>Voir le résultat</Button>
        </div>
      )}
    </Session>
  );
}

/** A QCM as a form: the question, then its options with their letters, ticked by a tap or a letter key. */
function McqCard({ question, total, choice, onToggle, onSubmit, disabled }: { question: QuizAsked; total: number; choice: number[]; onToggle: (i: number) => void; onSubmit: () => void; disabled: boolean }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={submit} className="relative h-full">
      <SessionCard number={cardNumber(question.position, total)} className="cursor-default active:cursor-default">
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          <Markdown source={question.statement} className="text-lg leading-snug" />
          <p className="text-xs text-ink-3 mt-2">{question.multiple ? "Plusieurs réponses possibles : cochez toutes les bonnes." : "Une seule réponse."}</p>
          <fieldset className="mt-3 space-y-2" disabled={disabled}>
            <legend className="sr-only">Options</legend>
            {question.options!.map((option, i) => {
              const on = choice.includes(i);
              return (
                <label key={i} className={cx("flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors", on ? "border-accent bg-accent/10" : "border-line hover:bg-surface-2")}>
                  <input type={question.multiple ? "checkbox" : "radio"} name="option" checked={on} onChange={() => onToggle(i)} className="sr-only" />
                  <span className={cx("grid place-items-center h-6 w-6 shrink-0 rounded-md text-xs font-semibold font-mono", question.multiple ? "rounded-md" : "rounded-full", on ? "bg-accent text-white" : "bg-surface-2 text-ink-2")}>{LETTERS[i]}</span>
                  <Markdown source={option} className="flex-1 min-w-0 text-[15px] leading-snug pt-0.5" />
                </label>
              );
            })}
          </fieldset>
        </div>
      </SessionCard>
    </form>
  );
}
