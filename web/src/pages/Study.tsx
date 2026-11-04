import { ArrowUturnLeftIcon, CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Markdown } from "../components/Markdown";
import { Button, Card, Empty, ErrorBox, Kbd, Loading, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import type { Card as CardT, Deck } from "../lib/types";

/** Two answers, like a swipe: left = to review (comes back in ten minutes), right = known (spaced out). */
const AGAIN = 0;
const KNOWN = 2;
const SWIPE_PX = 90;

function nextInterval(card: CardT, grade: number): string {
  const s = card.state;
  const learned = (s?.intervalDays ?? 0) >= 1;
  const ease = s?.ease ?? 2.5;
  if (grade === AGAIN) return "10 min";
  const days = Math.min(learned ? s!.intervalDays * ease : 1, 365);
  return days < 1.5 ? "1 j" : days < 30 ? `${Math.round(days)} j` : `${(days / 30).toFixed(1)} mois`;
}

export function Study() {
  const { id } = useParams();
  const queue = useApi<{ cards: CardT[] }>(`/api/study?limit=50${id ? `&deck=${id}` : ""}`, [id]);
  const deck = useApi<Deck & { cardList: CardT[] }>(id ? `/api/decks/${id}` : null, [id]);
  const [cards, setCards] = useState<CardT[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState<{ grade: number; card: CardT }[]>([]);
  const [busy, setBusy] = useState(false);
  // The swipe: horizontal offset of the card while dragging, and where it flies when released.
  const [drag, setDrag] = useState<{ dx: number; dragging: boolean; leaving?: -1 | 1 }>({ dx: 0, dragging: false });
  const pointer = useRef<{ id: number; startX: number; startY: number; moved: boolean } | undefined>(undefined);

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
        setDrag({ dx: 0, dragging: false });
      }
    },
    [current, busy],
  );

  /** Lets the card fly out, then records the answer. */
  const answer = useCallback(
    (direction: -1 | 1) => {
      if (!current || busy || drag.leaving) return;
      setDrag({ dx: direction * (window.innerWidth || 600), dragging: false, leaving: direction });
      setTimeout(() => void grade(direction > 0 ? KNOWN : AGAIN), 220);
    },
    [current, busy, drag.leaving, grade],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowLeft" || e.key === "1") answer(-1);
      else if (e.key === "ArrowRight" || e.key === "2") answer(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.leaving || e.button !== 0) return;
    pointer.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    // A mostly vertical gesture scrolls the page instead.
    if (!p.moved && Math.abs(dy) > Math.abs(dx)) {
      pointer.current = undefined;
      return;
    }
    p.moved = true;
    setDrag({ dx, dragging: true });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    pointer.current = undefined;
    const dx = e.clientX - p.startX;
    if (!p.moved) {
      setFlipped((f) => !f);
      return;
    }
    if (Math.abs(dx) >= SWIPE_PX) answer(dx > 0 ? 1 : -1);
    else setDrag({ dx: 0, dragging: false });
  };

  if (queue.loading && !queue.data) return <Loading />;
  if (queue.error) return <ErrorBox error={queue.error} retry={queue.reload} />;

  const total = cards.length;
  const title = deck.data?.title ?? "Toutes les cartes dues";

  if (!current) {
    const again = done.filter((d) => d.grade === AGAIN).length;
    const known = done.length - again;
    return (
      <div className="max-w-xl mx-auto space-y-4">
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
              <Link to="/cards"><Button>Paquets</Button></Link>
            </div>
          </Card>
        )}
      </div>
    );
  }

  const ratio = Math.max(-1, Math.min(1, drag.dx / (SWIPE_PX * 1.5)));
  const next = cards[index + 1];

  return (
    <div className="max-w-3xl mx-auto space-y-4 select-none">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-3 uppercase tracking-wide">Révision</div>
          <h1 className="font-semibold truncate flex items-center gap-2"><CourseChip code={deck.data?.course} link={false} /> {title}</h1>
        </div>
        <div className="text-sm text-ink-2 tabular-nums shrink-0">{Math.min(index + 1, total)} / {total}</div>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className="h-full bg-accent transition-all" style={{ width: `${(index / Math.max(total, 1)) * 100}%` }} />
      </div>

      <div className="relative min-h-[20rem] sm:min-h-[24rem]">
        {next && <div className="absolute inset-x-3 top-2 bottom-0 rounded-2xl border border-line bg-surface-2/60" aria-hidden />}
        <div
          className={cx("absolute inset-0 touch-pan-y", !drag.dragging && "transition-transform duration-200 ease-out")}
          style={{ transform: `translateX(${drag.dx}px) rotate(${drag.dx / 24}deg)`, opacity: drag.leaving ? 0 : 1, transition: drag.dragging ? "none" : "transform 0.2s ease-out, opacity 0.2s" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            pointer.current = undefined;
            setDrag({ dx: 0, dragging: false });
          }}
        >
          <div className="flip-scene h-full">
            <div className={cx("flip-card relative h-full cursor-grab active:cursor-grabbing", flipped && "is-flipped")}>
              <div className="flip-face absolute inset-0 bg-surface border border-line rounded-2xl shadow-card p-5 sm:p-6 flex flex-col">
                <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-3">Recto</div>
                <div className="flex-1 grid place-items-center text-center overflow-y-auto"><Markdown source={current.front} className="text-lg" /></div>
                {current.hint && <p className="text-xs text-ink-3 italic text-center mt-2">Indice : {current.hint}</p>}
                <p className="text-xs text-ink-3 text-center mt-3">Touchez pour retourner · glissez à droite si vous savez, à gauche sinon</p>
              </div>
              <div className="flip-face flip-back absolute inset-0 bg-surface border border-accent/40 rounded-2xl shadow-card p-5 sm:p-6 flex flex-col">
                <div className="text-[11px] uppercase tracking-wide text-accent mb-3">Verso</div>
                <div className="flex-1 grid place-items-center text-center overflow-y-auto"><Markdown source={current.back} className="text-lg" /></div>
                {current.source && <p className="text-xs text-ink-3 text-center mt-3">{current.source}</p>}
              </div>
            </div>
          </div>
          {/* Verdict stamps that appear while dragging. */}
          <div className="pointer-events-none absolute top-5 left-5 rounded-lg border-2 border-ok text-ok px-3 py-1 text-lg font-bold uppercase tracking-wide -rotate-12" style={{ opacity: Math.max(0, ratio) }}>Je sais</div>
          <div className="pointer-events-none absolute top-5 right-5 rounded-lg border-2 border-bad text-bad px-3 py-1 text-lg font-bold uppercase tracking-wide rotate-12" style={{ opacity: Math.max(0, -ratio) }}>À revoir</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => answer(-1)} disabled={busy} className="rounded-xl border border-bad/30 bg-bad-soft text-bad h-14 px-3 flex items-center justify-center gap-2 hover:brightness-95 dark:hover:brightness-110 transition disabled:opacity-50">
          <XMarkIcon className="h-5 w-5" />
          <span className="text-left leading-tight"><span className="block text-sm font-semibold">À revoir</span><span className="block text-[11px] opacity-80 tabular-nums">{nextInterval(current, AGAIN)}</span></span>
          <Kbd>←</Kbd>
        </button>
        <button onClick={() => answer(1)} disabled={busy} className="rounded-xl border border-ok/30 bg-ok-soft text-ok h-14 px-3 flex items-center justify-center gap-2 hover:brightness-95 dark:hover:brightness-110 transition disabled:opacity-50">
          <CheckIcon className="h-5 w-5" />
          <span className="text-left leading-tight"><span className="block text-sm font-semibold">Je sais</span><span className="block text-[11px] opacity-80 tabular-nums">{nextInterval(current, KNOWN)}</span></span>
          <Kbd>→</Kbd>
        </button>
      </div>

      <div className="flex items-center justify-between text-xs text-ink-3">
        <span>{current.state ? `Vue ${current.state.reps} fois · facilité ${current.state.ease.toFixed(2)}` : "Nouvelle carte"}</span>
        <span className="flex items-center gap-2">
          {done.length > 0 && <span className="inline-flex items-center gap-1"><CheckIcon className="h-3.5 w-3.5" /> {done.length} faites</span>}
          <Link to={id ? `/cards/${id}` : "/cards"} className="inline-flex items-center gap-1 text-accent"><ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Quitter</Link>
        </span>
      </div>
    </div>
  );
}
