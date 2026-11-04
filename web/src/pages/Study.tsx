import { ArrowUturnLeftIcon, CheckIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Markdown } from "../components/Markdown";
import { Button, Card, Empty, ErrorBox, Kbd, Loading, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import type { Card as CardT, Deck } from "../lib/types";

const GRADES = [
  { grade: 0, label: "À revoir", key: "1", tone: "bg-bad-soft text-bad border-bad/30", hint: "10 min" },
  { grade: 1, label: "Difficile", key: "2", tone: "bg-warn-soft text-warn border-warn/30", hint: "" },
  { grade: 2, label: "Bien", key: "3", tone: "bg-ok-soft text-ok border-ok/30", hint: "" },
  { grade: 3, label: "Facile", key: "4", tone: "bg-accent-soft text-accent border-accent/30", hint: "" },
] as const;

function nextInterval(card: CardT, grade: number): string {
  const s = card.state;
  const learned = (s?.intervalDays ?? 0) >= 1;
  const ease = s?.ease ?? 2.5;
  let days: number;
  if (grade === 0) return "10 min";
  if (grade === 1) days = learned ? Math.max(1, s!.intervalDays * 1.2) : 1;
  else if (grade === 2) days = learned ? s!.intervalDays * ease : 1;
  else days = learned ? s!.intervalDays * ease * 1.3 : 3;
  days = Math.min(days, 365);
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
        // A card graded "again" comes back at the end of this session.
        setCards((list) => (g === 0 ? [...list, { ...current, state: { ...(current.state ?? { intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 }), dueAt: new Date().toISOString() } }] : list));
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
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && ["1", "2", "3", "4"].includes(e.key)) void grade(Number(e.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, grade]);

  if (queue.loading && !queue.data) return <Loading />;
  if (queue.error) return <ErrorBox error={queue.error} retry={queue.reload} />;

  const total = cards.length;
  const title = deck.data?.title ?? "Toutes les cartes dues";

  if (!current) {
    const again = done.filter((d) => d.grade === 0).length;
    return (
      <div className="max-w-xl mx-auto space-y-4">
        {done.length === 0 ? (
          <Empty title="Rien à réviser pour l'instant" hint="Toutes les cartes dues sont faites. Revenez plus tard, ou ouvrez un paquet pour réviser librement." action={<Link to="/cards"><Button>Paquets</Button></Link>} />
        ) : (
          <Card title="Séance terminée">
            <div className="text-3xl font-semibold tabular-nums">{done.length} <span className="text-base font-normal text-ink-2">cartes revues</span></div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {GRADES.map((g) => (
                <div key={g.grade} className={cx("rounded-lg border px-2 py-2", g.tone)}>
                  <div className="text-lg font-semibold tabular-nums">{done.filter((d) => d.grade === g.grade).length}</div>
                  <div className="text-[11px] uppercase tracking-wide">{g.label}</div>
                </div>
              ))}
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

  return (
    <div className="max-w-3xl mx-auto space-y-4">
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

      <div className="flip-scene" onClick={() => setFlipped(!flipped)}>
        <div className={cx("flip-card relative min-h-[18rem] sm:min-h-[22rem] cursor-pointer select-none", flipped && "is-flipped")}>
          <div className="flip-face absolute inset-0 bg-surface border border-line rounded-2xl shadow-card p-6 flex flex-col">
            <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-3">Recto</div>
            <div className="flex-1 grid place-items-center text-center"><Markdown source={current.front} className="text-lg" /></div>
            {current.hint && <p className="text-xs text-ink-3 italic text-center">Indice : {current.hint}</p>}
            <p className="text-xs text-ink-3 text-center mt-3">Touchez ou <Kbd>espace</Kbd> pour retourner</p>
          </div>
          <div className="flip-face flip-back absolute inset-0 bg-surface border border-accent/40 rounded-2xl shadow-card p-6 flex flex-col">
            <div className="text-[11px] uppercase tracking-wide text-accent mb-3">Verso</div>
            <div className="flex-1 grid place-items-center text-center overflow-y-auto"><Markdown source={current.back} className="text-lg" /></div>
            {current.source && <p className="text-xs text-ink-3 text-center mt-3">{current.source}</p>}
          </div>
        </div>
      </div>

      <div className={cx("grid grid-cols-4 gap-2 transition-opacity", !flipped && "opacity-40 pointer-events-none")}>
        {GRADES.map((g) => (
          <button key={g.grade} onClick={() => void grade(g.grade)} disabled={busy} className={cx("rounded-xl border px-2 py-3 text-center hover:brightness-95 dark:hover:brightness-110 transition disabled:opacity-50", g.tone)}>
            <div className="text-sm font-semibold">{g.label}</div>
            <div className="text-[11px] opacity-80 tabular-nums">{nextInterval(current, g.grade)}</div>
            <div className="hidden sm:block mt-1"><Kbd>{g.key}</Kbd></div>
          </button>
        ))}
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
