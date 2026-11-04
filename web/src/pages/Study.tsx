import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Markdown } from "../components/Markdown";
import { AnswerButton, NextCard, Session, SessionCard } from "../components/Session";
import { CardBody, type SwipeCardHandle, SwipeCard, cardNumber } from "../components/SwipeCard";
import { Button, Card, Empty, ErrorBox, Loading, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import type { Card as CardT } from "../lib/types";

/** Two answers, like a swipe: left = to review (comes back in ten minutes), right = known (spaced out). */
const AGAIN = 0;
const KNOWN = 2;

function nextInterval(card: CardT, grade: number): string {
  const s = card.state;
  const learned = (s?.intervalDays ?? 0) >= 1;
  const ease = s?.ease ?? 2.5;
  if (grade === AGAIN) return "10 min";
  const days = Math.min(learned ? s!.intervalDays * ease : 1, 365);
  return days < 1.5 ? "1 j" : days < 30 ? `${Math.round(days)} j` : `${(days / 30).toFixed(1)} mois`;
}

/** A review session full screen: tap to flip, swipe right when known and left to see the card again. */
export function Study() {
  const { id } = useParams();
  const queue = useApi<{ cards: CardT[] }>(`/api/study?limit=50${id ? `&deck=${id}` : ""}`, [id]);
  const [cards, setCards] = useState<CardT[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState<{ grade: number; card: CardT }[]>([]);
  const [busy, setBusy] = useState(false);
  const swipe = useRef<SwipeCardHandle>(null);
  const back = id ? `/cards/${id}` : "/cards";

  useEffect(() => {
    if (queue.data) {
      setCards(queue.data.cards);
      setIndex(0);
      setFlipped(false);
      setDone([]);
    }
  }, [queue.data]);

  const current = cards[index];

  const grade = useCallback(
    async (g: number) => {
      if (!current || busy) return;
      setBusy(true);
      try {
        await api(`/api/cards/${current.id}/review`, { method: "POST", json: { grade: g } });
        setDone((d) => [...d, { grade: g, card: current }]);
        // A card to review comes back at the end of this session.
        setCards((list) => (g === AGAIN ? [...list, { ...current, state: { ...(current.state ?? { intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 }), dueAt: new Date().toISOString() } }] : list));
        setIndex((i) => i + 1);
        setFlipped(false);
      } finally {
        setBusy(false);
      }
    },
    [current, busy],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowLeft" || e.key === "1") swipe.current?.fly(-1);
      else if (e.key === "ArrowRight" || e.key === "2") swipe.current?.fly(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (queue.loading && !queue.data) return <Loading />;
  if (queue.error) return <ErrorBox error={queue.error} retry={queue.reload} />;

  const total = cards.length;

  if (!current) {
    const again = done.filter((d) => d.grade === AGAIN).length;
    const known = done.length - again;
    return (
      <Session back={back}>
        <div className="h-full overflow-y-auto overscroll-contain">
          <div className="max-w-xl mx-auto">
            {done.length === 0 ? (
              <Empty title="Rien à réviser pour l'instant" hint="Toutes les cartes dues sont faites. Revenez plus tard, ou ouvrez un paquet pour réviser librement." action={<Link to="/cards"><Button>Paquets</Button></Link>} />
            ) : (
              <Card title="Séance terminée">
                <div className="text-3xl font-semibold tabular-nums">{done.length} <span className="text-base font-normal text-ink-2">cartes revues</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg border border-ok/30 bg-ok-soft text-ok px-2 py-2">
                    <div className="text-lg font-semibold tabular-nums">{known}</div>
                    <div className="text-[11px] uppercase tracking-wide">je sais</div>
                  </div>
                  <div className="rounded-lg border border-bad/30 bg-bad-soft text-bad px-2 py-2">
                    <div className="text-lg font-semibold tabular-nums">{again}</div>
                    <div className="text-[11px] uppercase tracking-wide">à revoir</div>
                  </div>
                </div>
                {again > 0 && <p className="text-sm text-ink-2 mt-3">{again} carte{again > 1 ? "s" : ""} à revoir reviendront dans dix minutes.</p>}
                <div className="mt-4 flex gap-2">
                  <Button variant="primary" onClick={() => void queue.reload()}>Continuer</Button>
                  <Link to={back}><Button>Quitter</Button></Link>
                </div>
              </Card>
            )}
          </div>
        </div>
      </Session>
    );
  }

  const number = cardNumber(index + 1, total);

  return (
    <Session
      back={back}
      progress={index / Math.max(total, 1)}
      onFinish={() => setIndex(cards.length)}
      buttons={
        <>
          <AnswerButton tone="bad" icon={XMarkIcon} label="À revoir" sub={nextInterval(current, AGAIN)} kbd="←" disabled={busy} onClick={() => swipe.current?.fly(-1)} />
          <AnswerButton tone="ok" icon={CheckIcon} label="Je sais" sub={nextInterval(current, KNOWN)} kbd="→" disabled={busy} onClick={() => swipe.current?.fly(1)} />
        </>
      }
    >
      {cards[index + 1] && <NextCard />}
      <SwipeCard ref={swipe} resetKey={`${current.id}-${index}`} disabled={busy} leftLabel="À revoir" rightLabel="Je sais" onTap={() => setFlipped((f) => !f)} onSwipe={(d) => void grade(d > 0 ? KNOWN : AGAIN)}>
        <div className="flip-scene h-full">
          <div className={cx("flip-card relative h-full", flipped && "is-flipped")}>
            <SessionCard number={number} className="flip-face absolute inset-0">
              <CardBody>
                <Markdown source={current.front} className="text-lg" />
                {current.hint && <p className="text-xs text-ink-3 italic mt-3">{current.hint}</p>}
              </CardBody>
            </SessionCard>
            <SessionCard number={number} accent className="flip-face flip-back absolute inset-0">
              <CardBody>
                <Markdown source={current.back} className="text-lg" />
              </CardBody>
              {current.source && <p className="text-xs text-ink-3 text-center mt-3 shrink-0">{current.source}</p>}
            </SessionCard>
          </div>
        </div>
      </SwipeCard>
    </Session>
  );
}
