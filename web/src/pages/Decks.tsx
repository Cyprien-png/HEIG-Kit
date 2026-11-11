import { PlusIcon } from "@heroicons/react/24/outline";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type FilterSpec, FilterBar, FilteredGroups, useFilterState, useFiltered } from "../components/ListFilters";
import { ReviewButton } from "../components/ReviewButton";
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Stat, Textarea } from "../components/ui";
import { ApiError, api, useApi } from "../lib/api";
import { relative } from "../lib/format";
import { ShuffleToggle } from "../components/ShuffleToggle";
import { useShuffle } from "../lib/shuffle";
import type { Deck, StudyStats } from "../lib/types";

const SPEC: FilterSpec<Deck> = {
  title: (d) => d.title,
  text: (d) => [d.description],
  course: (d) => d.course,
  date: (d) => d.updatedAt,
  categories: (d) => [d.mine && "créés par moi", d.due > 0 && "à réviser", d.fresh > 0 && "nouvelles cartes", d.cards > 0 && d.due === 0 && d.fresh === 0 && "à jour", d.cards === 0 && "vide"],
  kinds: ["créés par moi", "à réviser", "nouvelles cartes", "à jour", "vide"],
};

export function Decks() {
  const decks = useApi<{ decks: Deck[]; stats: StudyStats }>("/api/decks");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const [shuffle, setShuffle] = useShuffle();
  const stats = decks.data?.stats;
  const all = decks.data?.decks ?? [];
  const [state, set] = useFilterState("decks");
  const filtered = useFiltered(all, SPEC, state);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cartes"
        actions={
          <>
            <ShuffleToggle on={shuffle} onChange={setShuffle} />
            <Button onClick={() => setCreating(true)}>
              <PlusIcon className="h-4 w-4" /> Paquet
            </Button>
            <ReviewButton disabled={!stats || stats.due + stats.fresh === 0} count={stats?.due} shuffle={shuffle} />
          </>
        }
      />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="À réviser" value={stats?.due ?? "–"} tone={stats && stats.due > 0 ? "accent" : "neutral"} />
        <Stat label="Nouvelles" value={stats?.fresh ?? "–"} />
        <Stat label="Vues aujourd'hui" value={stats?.reviewedToday ?? "–"} hint={stats && <Sparkline days={stats.days} />} />
      </div>
      {decks.error && <ErrorBox error={decks.error} retry={decks.reload} />}
      {all.length > 0 && <FilterBar spec={SPEC} state={state} set={set} filtered={filtered} />}
      {decks.loading && !decks.data ? <Loading /> : all.length === 0 ? (
        <Empty title="Aucun paquet" hint="Demandez à l'agent « crée-moi des cartes sur le chapitre 2 de MAD », ou créez un paquet vide et ajoutez vos cartes." action={<Button onClick={() => setCreating(true)}>Créer un paquet</Button>} />
      ) : filtered.list.length === 0 ? (
        <Empty title="Rien ne correspond" hint="Changez les filtres." />
      ) : (
        <FilteredGroups spec={SPEC} filtered={filtered} grid="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {(d) => (
            <Link key={d.id} to={`/cards/${d.id}`}>
              <Card className="h-full hover:border-line-strong transition-colors">
                <h3 className="font-medium leading-snug">{d.title}</h3>
                {d.description && <p className="text-xs text-ink-2 mt-1 line-clamp-2">{d.description}</p>}
                {!d.mine && d.author && <p className="text-xs text-ink-3 mt-1">par {d.author}</p>}
                <div className="mt-3 flex items-center gap-3 text-xs text-ink-2">
                  <span className="tabular-nums">{d.cards} cartes</span>
                  {d.due > 0 && <span className="text-accent font-semibold tabular-nums">{d.due} à réviser</span>}
                  {d.fresh > 0 && <span className="tabular-nums">{d.fresh} nouvelles</span>}
                  <span className="ml-auto text-ink-3">{relative(d.updatedAt)}</span>
                </div>
                <Progress deck={d} />
              </Card>
            </Link>
          )}
        </FilteredGroups>
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
  /** Decks that look like this one: the server refuses a copy until they were looked at. */
  const [similar, setSimilar] = useState<{ ref: string; title: string; course?: string; author?: string; mine: boolean }[]>([]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const anyway = similar.length > 0 ? { checked: similar.map((s) => s.ref), new_because: "Créé à la main dans l'application par son auteur, après avoir vu les paquets existants." } : {};
      const deck = await api<Deck>("/api/decks", { method: "POST", json: { title, course: course || undefined, description: description || undefined, ...anyway } });
      onCreated(deck.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && Array.isArray(err.data.similar)) setSimilar(err.data.similar as typeof similar);
      else setError(err instanceof Error ? err.message : String(err));
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
        {similar.length > 0 && (
          <div className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm space-y-1.5">
            <p className="font-medium text-warn">Des paquets semblables existent déjà, partagés avec la classe :</p>
            <ul className="space-y-1">
              {similar.map((s) => (
                <li key={s.ref}>
                  <Link to={`/cards/${s.ref.replace(/\D+/g, "")}`} className="underline" onClick={onClose}>
                    {s.title}
                  </Link>
                  <span className="text-ink-3"> {s.course ? `· ${s.course} ` : ""}· {s.mine ? "le vôtre" : `par ${s.author ?? "un autre compte"}`}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-2">Utilisez-en un s'il convient. Sinon, validez encore une fois pour créer le vôtre.</p>
          </div>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy}>Créer</Button>
        </div>
      </form>
    </Modal>
  );
}
