import { PencilSquareIcon, PlayIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Markdown } from "../components/Markdown";
import { Badge, Button, Card, Empty, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Textarea, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { relative } from "../lib/format";
import type { Card as CardT, Deck } from "../lib/types";

type DeckFull = Deck & { cardList: CardT[] };

export function DeckDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const deck = useApi<DeckFull>(`/api/decks/${id}`, [id]);
  const [editing, setEditing] = useState<CardT | "new">();
  const [editingDeck, setEditingDeck] = useState(false);
  const [flipped, setFlipped] = useState<Set<number>>(new Set());

  if (deck.loading && !deck.data) return <Loading />;
  if (deck.error || !deck.data) return <ErrorBox error={deck.error ?? "Paquet introuvable"} retry={deck.reload} />;
  const d = deck.data;
  const toggle = (cardId: number) => setFlipped((s) => {
    const next = new Set(s);
    if (next.has(cardId)) next.delete(cardId);
    else next.add(cardId);
    return next;
  });
  const removeDeck = async () => {
    if (!confirm(`Supprimer le paquet « ${d.title} » et ses ${d.cards} cartes ?`)) return;
    await api(`/api/decks/${d.id}`, { method: "DELETE" });
    navigate("/cards");
  };
  const removeCard = async (card: CardT) => {
    if (!confirm("Supprimer cette carte ?")) return;
    await api(`/api/cards/${card.id}`, { method: "DELETE" });
    void deck.reload();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-3"><CourseChip code={d.course} /> {d.title}</span>}
        subtitle={<>{d.cards} cartes · {d.due} à réviser · {d.fresh} nouvelles{d.description ? ` · ${d.description}` : ""}</>}
        actions={
          <>
            <Button onClick={() => setEditingDeck(true)}><PencilSquareIcon className="h-4 w-4" /> Paquet</Button>
            <Button onClick={() => setEditing("new")}><PlusIcon className="h-4 w-4" /> Carte</Button>
            <Link to={`/study/${d.id}`}>
              <Button variant="primary" disabled={d.cards === 0}><PlayIcon className="h-4 w-4" /> Réviser</Button>
            </Link>
          </>
        }
      />
      {d.cardList.length === 0 ? <Empty title="Paquet vide" hint="Ajoutez des cartes, ou demandez à l'agent d'en créer depuis le cours." action={<Button onClick={() => setEditing("new")}>Ajouter une carte</Button>} /> : (
        <div className="grid md:grid-cols-2 2xl:grid-cols-3 gap-3">
          {d.cardList.map((c) => {
            const back = flipped.has(c.id);
            const state = c.state;
            const tone = !state ? "neutral" : new Date(state.dueAt) <= new Date() ? "accent" : "ok";
            return (
              <Card key={c.id} padded={false} className="flex flex-col">
                <button onClick={() => toggle(c.id)} className="text-left p-4 flex-1 min-h-[7rem]">
                  <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">{back ? "Verso" : "Recto"}</div>
                  <Markdown source={back ? c.back : c.front} />
                  {!back && c.hint && <p className="text-xs text-ink-3 mt-2 italic">Indice : {c.hint}</p>}
                </button>
                <div className="flex items-center gap-1.5 px-3 py-2 border-t border-line text-xs text-ink-2">
                  <Badge tone={tone}>{!state ? "nouvelle" : new Date(state.dueAt) <= new Date() ? "à réviser" : `revient ${relative(state.dueAt)}`}</Badge>
                  {c.tags.slice(0, 2).map((t) => <Badge key={t}>{t}</Badge>)}
                  {c.source && <span className="truncate ml-1" title={c.source}>{c.source}</span>}
                  <span className="ml-auto flex items-center">
                    <IconButton label="Modifier" className="h-7 w-7" onClick={() => setEditing(c)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
                    <IconButton label="Supprimer" className="h-7 w-7" onClick={() => void removeCard(c)}><TrashIcon className="h-4 w-4" /></IconButton>
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <div className="pt-4">
        <Button variant="danger" size="sm" onClick={removeDeck}><TrashIcon className="h-4 w-4" /> Supprimer le paquet</Button>
      </div>
      {editing && <CardEditor deckId={d.id} card={editing === "new" ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void deck.reload(); }} />}
      {editingDeck && <DeckEditor deck={d} onClose={() => setEditingDeck(false)} onSaved={() => { setEditingDeck(false); void deck.reload(); }} />}
    </div>
  );
}

function CardEditor({ deckId, card, onClose, onSaved }: { deckId: number; card?: CardT; onClose: () => void; onSaved: () => void }) {
  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  const [hint, setHint] = useState(card?.hint ?? "");
  const [tags, setTags] = useState(card?.tags.join(", ") ?? "");
  const [source, setSource] = useState(card?.source ?? "");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { front, back, hint: hint || undefined, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), source: source || undefined };
      if (card) await api(`/api/cards/${card.id}`, { method: "PATCH", json: body });
      else await api(`/api/decks/${deckId}/cards`, { method: "POST", json: { cards: [body] } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={card ? "Modifier la carte" : "Nouvelle carte"} wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex justify-end">
          <Button type="button" size="sm" variant={preview ? "primary" : "secondary"} onClick={() => setPreview(!preview)}>Aperçu</Button>
        </div>
        <div className={cx("grid gap-3", preview && "md:grid-cols-2")}>
          <div className="space-y-3">
            <Field label="Recto (Markdown, LaTeX entre $…$)">
              <Textarea rows={4} value={front} onChange={(e) => setFront(e.target.value)} required autoFocus />
            </Field>
            <Field label="Verso">
              <Textarea rows={6} value={back} onChange={(e) => setBack(e.target.value)} required />
            </Field>
          </div>
          {preview && (
            <div className="space-y-3">
              <div className="rounded-lg border border-line p-3 min-h-[6rem]"><Markdown source={front} /></div>
              <div className="rounded-lg border border-line p-3 min-h-[9rem]"><Markdown source={back} /></div>
            </div>
          )}
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Indice"><Input value={hint} onChange={(e) => setHint(e.target.value)} /></Field>
          <Field label="Tags (virgules)"><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
          <Field label="Source"><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Cours MAD ch. 1 p. 32" /></Field>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy}>Enregistrer</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeckEditor({ deck, onClose, onSaved }: { deck: Deck; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(deck.title);
  const [course, setCourse] = useState(deck.course ?? "");
  const [description, setDescription] = useState(deck.description ?? "");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await api(`/api/decks/${deck.id}`, { method: "PATCH", json: { title, course: course || null, description: description || null } });
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title="Modifier le paquet">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Titre"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
        <Field label="Cours"><Input value={course} onChange={(e) => setCourse(e.target.value.toUpperCase())} /></Field>
        <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy}>Enregistrer</Button>
        </div>
      </form>
    </Modal>
  );
}
