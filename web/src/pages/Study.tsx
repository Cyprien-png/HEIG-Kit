import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Markdown } from "../components/Markdown";
import { AnswerButton, Session, SessionCard, type SlotState } from "../components/Session";
import { CardBody, type SwipeCardHandle, SwipeCard, UnderCard, cardNumber } from "../components/SwipeCard";
import { Button, Card, Empty, ErrorBox, Loading, cx } from "../components/ui";
import { api } from "../lib/api";
import { useShuffle } from "../lib/shuffle";
import type { Card as CardT, StudySession, StudySlot } from "../lib/types";

/** Two answers, like a swipe: left = to review (comes back at the end of the session), right = known (spaced out). */
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

const stateOf = (slot: StudySlot): SlotState => (slot.grade === undefined ? undefined : slot.grade === AGAIN ? "bad" : "ok");

/**
 * A review session full screen, kept on the server: it resumes where it was left, the arrows and the strip move
 * between the cards (answered ones show their answer and can be answered again), tap flips, swipe right when known
 * and left to see the card again; « Terminer » closes it, the deck page can discard it.
 */
export function Study() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [shuffle] = useShuffle();
  const [session, setSession] = useState<StudySession>();
  const [error, setError] = useState<string>();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const swipe = useRef<SwipeCardHandle>(null);
  const back = id ? `/cards/${id}` : "/cards";
  const deck = id ? Number(id) : undefined;

  const load = useCallback(async () => {
    try {
      const { session: s } = await api<{ session: StudySession; resumed: boolean }>("/api/study/sessions", { method: "POST", json: { deck, shuffle } });
      setSession(s);
      setIndex(Math.min(s.position, Math.max(s.slots.length - 1, 0)));
      setFlipped(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [deck, shuffle]);
  useEffect(() => void load(), [load]);

  const move = useCallback(
    (to: number) => {
      if (!session) return;
      const target = Math.max(0, Math.min(to, session.slots.length));
      setIndex(target);
      setFlipped(false);
      if (target < session.slots.length) void api(`/api/study/sessions/${session.id}`, { method: "PATCH", json: { position: target } }).catch(() => undefined);
    },
    [session],
  );

  const answer = useCallback(
    async (slot: StudySlot, grade: number) => {
      if (!session || busy || session.finishedAt) return;
      setBusy(true);
      setIndex((i) => i + 1);
      setFlipped(false);
      try {
        setSession(await api<StudySession>(`/api/study/sessions/${session.id}/answers`, { method: "POST", json: { slot: slot.slot, grade } }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [session, busy],
  );

  const finish = async () => {
    if (!session) return;
    setSession(await api<StudySession>(`/api/study/sessions/${session.id}`, { method: "PATCH", json: { finished: true } }));
    setIndex(session.slots.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.shiftKey && e.key === "ArrowLeft") move(index - 1);
      else if (e.shiftKey && e.key === "ArrowRight") move(index + 1);
      else if (e.key === "ArrowLeft" || e.key === "1") swipe.current?.fly(-1);
      else if (e.key === "ArrowRight" || e.key === "2") swipe.current?.fly(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, index]);

  if (error) return <ErrorBox error={error} retry={() => void load()} />;
  if (!session) return <Loading />;

  const slots = session.slots;
  const total = slots.length;
  const current = slots[index];
  const under = slots[index + 1];
  const states = slots.map(stateOf);
  const nav = { states, index: Math.min(index, total), onMove: move };

  if (total === 0) {
    return (
      <Session back={back}>
        <Empty title="Rien à réviser pour l'instant" hint="Toutes les cartes dues sont faites. Revenez plus tard, ou ouvrez un paquet pour réviser librement." action={<Link to="/cards"><Button>Paquets</Button></Link>} />
      </Session>
    );
  }

  if (!current) {
    const known = session.answered - session.again;
    const left = total - session.answered;
    const firstLeft = slots.findIndex((s) => s.grade === undefined);
    return (
      <Session back={back} slots={nav}>
        <div className="h-full overflow-y-auto overscroll-contain">
          <Card title={session.finishedAt ? "Séance terminée" : "Bilan"} className="max-w-xl mx-auto">
            <div className="text-3xl font-semibold tabular-nums">{session.answered} <span className="text-base font-normal text-ink-2">carte{session.answered > 1 ? "s" : ""} revue{session.answered > 1 ? "s" : ""} sur {total}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-ok/30 bg-ok-soft text-ok px-2 py-2">
                <div className="text-lg font-semibold tabular-nums">{known}</div>
                <div className="text-[11px] uppercase tracking-wide">je sais</div>
              </div>
              <div className="rounded-lg border border-bad/30 bg-bad-soft text-bad px-2 py-2">
                <div className="text-lg font-semibold tabular-nums">{session.again}</div>
                <div className="text-[11px] uppercase tracking-wide">à revoir</div>
              </div>
            </div>
            {left > 0 && !session.finishedAt && <p className="text-sm text-ink-2 mt-3">{left} carte{left > 1 ? "s" : ""} sans réponse. La séance reste ouverte tant qu'elle n'est pas terminée.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {session.finishedAt ? (
                <Button variant="primary" onClick={() => navigate(back)}>Quitter</Button>
              ) : (
                <>
                  <Button variant="primary" onClick={() => void finish()}>Terminer la séance</Button>
                  {left > 0 && <Button onClick={() => move(firstLeft)}>Reprendre</Button>}
                </>
              )}
              <Button variant="ghost" onClick={() => move(0)}>Parcourir les cartes</Button>
            </div>
          </Card>
        </div>
      </Session>
    );
  }

  const number = cardNumber(index + 1, total);
  const closed = Boolean(session.finishedAt);

  return (
    <Session
      back={back}
      slots={nav}
      onFinish={closed ? undefined : () => move(total)}
      finishLabel="Terminer"
      buttons={
        <>
          <AnswerButton tone="bad" icon={XMarkIcon} label="À revoir" sub={nextInterval(current.card, AGAIN)} kbd="←" disabled={busy || closed} onClick={() => swipe.current?.fly(-1)} />
          <AnswerButton tone="ok" icon={CheckIcon} label="Je sais" sub={nextInterval(current.card, KNOWN)} kbd="→" disabled={busy || closed} onClick={() => swipe.current?.fly(1)} />
        </>
      }
    >
      {under && (
        <UnderCard>
          <SessionCard number={cardNumber(index + 2, total)} answered={stateOf(under)}>
            <CardBody>
              <Markdown source={under.card.front} className="text-lg" />
            </CardBody>
          </SessionCard>
        </UnderCard>
      )}
      <SwipeCard key={`${session.id}-${current.slot}`} ref={swipe} disabled={busy || closed} leftLabel="À revoir" rightLabel="Je sais" onTap={() => setFlipped((f) => !f)} onSwipe={(d) => void answer(current, d > 0 ? KNOWN : AGAIN)}>
        <div className="flip-scene h-full">
          <div className={cx("flip-card relative h-full", flipped && "is-flipped")}>
            <SessionCard number={number} answered={stateOf(current)} className="flip-face absolute inset-0">
              <CardBody>
                <Markdown source={current.card.front} className="text-lg" />
                {current.card.hint && <p className="text-xs text-ink-3 italic mt-3">{current.card.hint}</p>}
              </CardBody>
            </SessionCard>
            <SessionCard number={number} accent answered={stateOf(current)} className="flip-face flip-back absolute inset-0">
              <CardBody>
                <Markdown source={current.card.back} className="text-lg" />
              </CardBody>
              {current.card.source && <p className="text-xs text-ink-3 text-center mt-3 shrink-0">{current.card.source}</p>}
            </SessionCard>
          </div>
        </div>
      </SwipeCard>
    </Session>
  );
}
