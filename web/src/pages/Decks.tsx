import { PlayIcon, PlusIcon } from "@heroicons/react/24/outline";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Stat, Textarea } from "../components/ui";
import { api, useApi } from "../lib/api";
import { relative } from "../lib/format";
import type { Deck, StudyStats } from "../lib/types";

export function Decks() {
  const decks = useApi<{ decks: Deck[]; stats: StudyStats }>("/api/decks");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const stats = decks.data?.stats;
  const byCourse = new Map<string, Deck[]>();
  for (const d of decks.data?.decks ?? []) byCourse.set(d.course ?? "", [...(byCourse.get(d.course ?? "") ?? []), d]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cartes"
        actions={
          <>
            <Button onClick={() => setCreating(true)}>
              <PlusIcon className="h-4 w-4" /> Paquet
            </Button>
            <Link to="/study">
              <Button variant="primary" disabled={!stats || stats.due + stats.fresh === 0}>
                <PlayIcon className="h-4 w-4" /> Réviser {stats && stats.due > 0 ? `(${stats.due})` : ""}
              </Button>
            </Link>
          </>
        }
      />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="À réviser" value={stats?.due ?? "–"} tone={stats && stats.due > 0 ? "accent" : "neutral"} />
        <Stat label="Nouvelles" value={stats?.fresh ?? "–"} />
        <Stat label="Vues aujourd'hui" value={stats?.reviewedToday ?? "–"} hint={stats && <Sparkline days={stats.days} />} />
      </div>
      {decks.error && <ErrorBox error={decks.error} retry={decks.reload} />}
      {decks.loading && !decks.data ? <Loading /> : byCourse.size === 0 ? (
        <Empty title="Aucun paquet" hint="Demandez à l'agent « crée-moi des cartes sur le chapitre 2 de MAD », ou créez un paquet vide et ajoutez vos cartes." action={<Button onClick={() => setCreating(true)}>Créer un paquet</Button>} />
      ) : (
        [...byCourse.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([course, list]) => (
          <section key={course} className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">{course ? <CourseChip code={course} /> : "Sans cours"}</h2>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {list.map((d) => (
                <Link key={d.id} to={`/cards/${d.id}`}>
                  <Card className="h-full hover:border-line-strong transition-colors">
                    <h3 className="font-medium leading-snug">{d.title}</h3>
                    {d.description && <p className="text-xs text-ink-2 mt-1 line-clamp-2">{d.description}</p>}
                    <div className="mt-3 flex items-center gap-3 text-xs text-ink-2">
                      <span className="tabular-nums">{d.cards} cartes</span>
                      {d.due > 0 && <span className="text-accent font-semibold tabular-nums">{d.due} à réviser</span>}
                      {d.fresh > 0 && <span className="tabular-nums">{d.fresh} nouvelles</span>}
                      <span className="ml-auto text-ink-3">{relative(d.updatedAt)}</span>
                    </div>
                    <Progress deck={d} />
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
      {creating && <NewDeck onClose={() => setCreating(false)} onCreated={(id) => navigate(`/cards/${id}`)} />}
    </div>
  );
}

function Progress({ deck }: { deck: Deck }) {
  if (deck.cards === 0) return null;
  const learned = deck.cards - deck.fresh - deck.due;
  const pct = (n: number) => `${(n / deck.cards) * 100}%`;
  return (
    <div className="mt-2 h-1.5 w-full rounded-full bg-surface-2 overflow-hidden flex">
      <div className="bg-ok" style={{ width: pct(learned) }} />
      <div className="bg-accent" style={{ width: pct(deck.due) }} />
    </div>
  );
}

function Sparkline({ days }: { days: { day: string; reviews: number; again: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.reviews));
  const all = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return days.find((x) => x.day === key) ?? { day: key, reviews: 0, again: 0 };
  });
  return (
    <span className="inline-flex items-end gap-px h-4 align-middle" title="14 derniers jours">
      {all.map((d) => (
        <span key={d.day} className="w-1 bg-accent/70 rounded-sm" style={{ height: `${Math.max(8, (d.reviews / max) * 100)}%` }} />
      ))}
    </span>
  );
}

function NewDeck({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const deck = await api<Deck>("/api/decks", { method: "POST", json: { title, course: course || undefined, description: description || undefined } });
      onCreated(deck.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Nouveau paquet">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Titre">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="MAD · Relations" />
        </Field>
        <Field label="Cours">
          <Input value={course} onChange={(e) => setCourse(e.target.value.toUpperCase())} placeholder="MAD" />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy}>Créer</Button>
        </div>
      </form>
    </Modal>
  );
}
