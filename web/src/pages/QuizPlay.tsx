import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Markdown } from "../components/Markdown";
import { AnswerButton, NextCard, Session, SessionCard } from "../components/Session";
import { CardBody, type SwipeCardHandle, SwipeCard, cardNumber } from "../components/SwipeCard";
import { Button, ErrorBox, Loading } from "../components/ui";
import { api, useApi } from "../lib/api";
import type { QuizProgress, QuizResult } from "../lib/types";

/** Plays an attempt full screen: one statement per card, swiped right for true and left for false; the result page follows the last one. */
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

  return (
    <Session
      back="/quiz"
      progress={attempt.answered / Math.max(attempt.total, 1)}
      onFinish={next ? () => void finish() : undefined}
      buttons={
        next && (
          <>
            <AnswerButton tone="bad" icon={XMarkIcon} label="Faux" kbd="←" disabled={busy} onClick={() => swipe.current?.fly(-1)} />
            <AnswerButton tone="ok" icon={CheckIcon} label="Vrai" kbd="→" disabled={busy} onClick={() => swipe.current?.fly(1)} />
          </>
        )
      }
    >
      {error && <ErrorBox error={error} />}
      {next ? (
        <>
          {attempt.answered + 1 < attempt.total && <NextCard />}
          <SwipeCard ref={swipe} resetKey={next.id} disabled={busy} leftLabel="Faux" rightLabel="Vrai" onSwipe={(d) => void answer(d > 0)}>
            <SessionCard number={cardNumber(next.position, attempt.total)}>
              <CardBody>
                <Markdown source={next.statement} className="text-xl leading-snug" />
              </CardBody>
            </SessionCard>
          </SwipeCard>
        </>
      ) : (
        <div className="grid place-items-center h-full">
          <Button variant="primary" onClick={() => navigate(`/quiz/attempts/${attempt.id}`)}>Voir le résultat</Button>
        </div>
      )}
    </Session>
  );
}
