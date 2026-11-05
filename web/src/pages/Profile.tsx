import { CheckIcon, PencilSquareIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { LevelRadar } from "../components/Radar";
import { Badge, Button, Card, Disclosure, Empty, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Segmented, Select, Stat, Textarea, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { dateTime, relative } from "../lib/format";
import type { ChapterStatus, ChapterSummary, ProfileNote, ProfileSummary, TopicSummary } from "../lib/types";

const KIND_LABEL = { weakness: "faiblesse", strength: "point fort", mistake: "erreur", note: "note" } as const;
const KIND_TONE = { weakness: "warn", strength: "ok", mistake: "bad", note: "info" } as const;
/** The four states of a chapter. */
const STATUS: Record<ChapterStatus, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  mastered: { label: "maîtrisé", tone: "ok" },
  fragile: { label: "fragile", tone: "warn" },
  struggling: { label: "en difficulté", tone: "bad" },
  unassessed: { label: "non évalué", tone: "neutral" },
};

export function Profile() {
  const summary = useApi<ProfileSummary>("/api/profile");
  const [tab, setTab] = useState<"summary" | "notes">("summary");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string>();
  const s = summary.data;
  const totals = s?.courses.reduce((acc, c) => ({ correct: acc.correct + (c.verdicts?.correct ?? 0), total: acc.total + (c.verdicts ? c.verdicts.correct + c.verdicts.partial + c.verdicts.wrong + c.verdicts.missing : 0) }), { correct: 0, total: 0 });

  return (
    <div className="space-y-5">
      <PageHeader title="Profil" actions={<><Segmented value={tab} onChange={setTab} options={[{ value: "summary", label: "Synthèse" }, { value: "notes", label: "Notes" }]} /><Button onClick={() => setAdding(true)}><PlusIcon className="h-4 w-4" /> Note</Button></>} />
      {summary.error && <ErrorBox error={summary.error} retry={summary.reload} />}
      {summary.loading && !s ? <Loading /> : tab === "notes" ? <Notes onChanged={() => void summary.reload()} /> : !s || (s.courses.length === 0 && s.toRevise.length === 0) ? (
        <Empty title="Profil vide" hint="Faites corriger vos exercices (« corrige ma série 3 ») : chaque correction note vos erreurs et vos acquis ici." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Exercices justes" value={totals && totals.total > 0 ? `${Math.round((totals.correct / totals.total) * 100)} %` : "–"} hint={totals ? `${totals.correct} / ${totals.total} corrigés` : undefined} tone={totals && totals.total > 0 ? (totals.correct / totals.total >= 0.7 ? "ok" : "warn") : "neutral"} />
            <Stat label="Points à travailler" value={s.toRevise.length} tone={s.toRevise.length > 0 ? "warn" : "ok"} />
            <Stat label="Observations ouvertes" value={s.openNotes} />
          </div>

          {s.toRevise.length > 0 && (
            <Card title="À réviser en priorité">
              <ol className="space-y-2">
                {s.toRevise.map((t, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="font-mono text-xs text-ink-3 w-5 pt-1 tabular-nums">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CourseChip code={t.course} />
                        <span className="font-medium">{t.topic}</span>
                        <Badge tone={t.severity >= 3 ? "bad" : "warn"}>×{t.count}</Badge>
                        <span className="text-xs text-ink-3">{relative(t.lastAt)}</span>
                      </div>
                      {t.examples[0] && <p className="text-sm text-ink-2 mt-0.5 line-clamp-2">{t.examples[0]}</p>}
                    </div>
                    <div className="w-24 shrink-0 hidden sm:block">
                      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-warn" style={{ width: `${Math.min(100, (t.score / s.toRevise[0].score) * 100)}%` }} /></div>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-ink-3 mt-3">Demandez à l'agent « révise mes points faibles » : il part de cette liste.</p>
            </Card>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {s.courses.map((c) => (
              <CourseCard key={c.course ?? "-"} c={c} onEdit={() => setEditing(c.course ?? "")} />
            ))}
          </div>
        </>
      )}
      {adding && <NoteEditor onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void summary.reload(); setTab("notes"); }} />}
      {editing && <ChapterEditor course={editing} chapters={s?.courses.find((c) => c.course === editing)?.chapters ?? []} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void summary.reload(); }} />}
    </div>
  );
}

/** A course of the profile: its chapters on a radar with their status, then the topics behind them. */
function CourseCard({ c, onEdit }: { c: ProfileSummary["courses"][number]; onEdit: () => void }) {
  const total = c.verdicts ? c.verdicts.correct + c.verdicts.partial + c.verdicts.wrong + c.verdicts.missing : 0;
  const assessed = c.chapters.filter((ch) => ch.status !== "unassessed").length;
  return (
    <Card
      title={<span className="flex items-center gap-2 min-w-0">{c.course ? <CourseChip code={c.course} /> : "Général"}{c.verdicts && <span className="text-xs font-normal text-ink-2 tabular-nums truncate">{c.verdicts.correct} justes · {c.verdicts.partial} partiels · {c.verdicts.wrong + c.verdicts.missing} faux</span>}</span>}
      actions={c.course ? <IconButton label="Chapitres" onClick={onEdit}><PencilSquareIcon className="h-4 w-4" /></IconButton> : undefined}
    >
      {c.verdicts && total > 0 && (
        <div className="h-1.5 rounded-full overflow-hidden flex bg-surface-2 mb-4">
          {(["correct", "partial", "wrong"] as const).map((k) => {
            const n = k === "wrong" ? c.verdicts!.wrong + c.verdicts!.missing : c.verdicts![k];
            return <div key={k} className={cx(k === "correct" ? "bg-ok" : k === "partial" ? "bg-warn" : "bg-bad")} style={{ width: `${(n / total) * 100}%` }} />;
          })}
        </div>
      )}
      {c.chapters.length === 0 ? (
        c.course && (
          <div className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-ink-2 flex items-center justify-between gap-3 mb-4">
            <span>Pas encore de chapitres : définissez-les pour voir votre niveau chapitre par chapitre.</span>
            <Button size="sm" variant="secondary" onClick={onEdit}>Définir</Button>
          </div>
        )
      ) : (
        <div className="mb-4">
          {c.chapters.length >= 3 && (
            <LevelRadar axes={c.chapters.map((ch) => ({ label: String(ch.position), value: ch.level, tone: STATUS[ch.status].tone, muted: ch.status === "unassessed" }))} label={`Niveau par chapitre, ${c.course}`} />
          )}
          <ul className="divide-y divide-line">
            {c.chapters.map((ch) => (
              <ChapterRow key={ch.id} ch={ch} />
            ))}
          </ul>
          <p className="text-[11px] text-ink-3 mt-2">{assessed} chapitre{assessed > 1 ? "s" : ""} évalué{assessed > 1 ? "s" : ""} sur {c.chapters.length}.{c.unassigned.length > 0 && <> Sans chapitre : {c.unassigned.join(", ")}.</>}</p>
        </div>
      )}
      {c.mistakes.length + c.weaknesses.length + c.strengths.length > 0 && (
        <Disclosure level={2} className="-mx-4 -mb-4 border-t" title={<span className="text-ink-2 font-normal">Thèmes</span>} aside={<span className="text-xs text-ink-3 tabular-nums">{c.mistakes.length + c.weaknesses.length + c.strengths.length}</span>}>
          <div className="px-4 py-3">
            <TopicList title="Erreurs fréquentes" tone="bad" list={c.mistakes} />
            <TopicList title="Faiblesses" tone="warn" list={c.weaknesses} />
            <TopicList title="Points forts" tone="ok" list={c.strengths} />
          </div>
        </Disclosure>
      )}
    </Card>
  );
}

function ChapterRow({ ch }: { ch: ChapterSummary }) {
  const st = STATUS[ch.status];
  const counts = [ch.strengths && `${ch.strengths} fort${ch.strengths > 1 ? "s" : ""}`, ch.weaknesses && `${ch.weaknesses} faible${ch.weaknesses > 1 ? "s" : ""}`, ch.mistakes && `${ch.mistakes} erreur${ch.mistakes > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className="font-mono text-xs text-ink-3 tabular-nums w-5 shrink-0 text-right">{ch.position}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate">{ch.title.replace(/^\d+[.:)\s-]+/, "")}</span>
        {(counts || ch.topics.length > 0) && <span className="block text-[11px] text-ink-3 truncate">{[counts, ch.topics.join(", ")].filter(Boolean).join(" · ")}</span>}
      </span>
      {ch.status !== "unassessed" && <span className={cx("font-mono text-xs tabular-nums shrink-0", st.tone === "ok" ? "text-ok" : st.tone === "warn" ? "text-warn" : "text-bad")}>{Math.round(ch.level * 100)} %</span>}
      <Badge tone={st.tone} className="shrink-0">{st.label}</Badge>
    </li>
  );
}

/** The chapters of a course, one per line: « Titre | mot-clé, mot-clé », prefilled from the course's documents when empty. */
function ChapterEditor({ course, chapters, onClose, onSaved }: { course: string; chapters: ChapterSummary[]; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(chapters.map((c) => `${c.title}${c.keywords.length ? ` | ${c.keywords.join(", ")}` : ""}`).join("\n"));
  const [busy, setBusy] = useState(false);
  const docs = useApi<{ documents: { chapter: string | null }[] }>(chapters.length === 0 ? `/api/kb/courses/${encodeURIComponent(course)}/documents` : null, [course]);
  useEffect(() => {
    if (chapters.length > 0 || !docs.data) return;
    const seen = [...new Set(docs.data.documents.map((d) => d.chapter).filter((c): c is string => Boolean(c)))];
    if (seen.length > 0) setText(seen.join("\n"));
  }, [docs.data, chapters.length]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const list = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [title, keywords = ""] = l.split("|");
      return { title: title.trim(), keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean) };
    });
    try {
      await api(`/api/profile/chapters/${encodeURIComponent(course)}`, { method: "PUT", json: { chapters: list } });
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Chapitres de ${course}`}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-2">Un chapitre par ligne, dans l'ordre du cours. Après « | », les thèmes qu'il couvre, séparés par des virgules : les observations portant ces thèmes comptent pour ce chapitre.</p>
        <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1. Ensembles | cardinal, inclusion-exclusion\n2. Relations | relation d'ordre, diagramme de Hasse"} className="font-mono text-[13px]" />
        <div className="flex justify-between items-center gap-2">
          <span className="text-xs text-ink-3">{chapters.length === 0 && docs.data ? "Pré-rempli avec les chapitres des documents du cours." : ""}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
            <Button type="submit" variant="primary" disabled={busy}>Enregistrer</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function TopicList({ title, tone, list }: { title: string; tone: "bad" | "warn" | "ok"; list: TopicSummary[] }) {
  if (list.length === 0) return null;
  return (
    <section className="mb-3 last:mb-0">
      <h3 className={cx("text-[11px] uppercase tracking-wide mb-1.5", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ok")}>{title}</h3>
      <ul className="space-y-1.5">
        {list.map((t, i) => (
          <li key={i} className="text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t.topic}</span>
              <Badge tone={tone}>×{t.count}</Badge>
              {t.severity >= 3 && <Badge tone="bad">récurrent</Badge>}
            </div>
            {t.examples[0] && <p className="text-xs text-ink-2 line-clamp-2">{t.examples[0]}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notes({ onChanged }: { onChanged: () => void }) {
  const [course, setCourse] = useState("");
  const [kind, setKind] = useState("");
  const [resolved, setResolved] = useState(false);
  const [q, setQ] = useState("");
  const query = new URLSearchParams({ ...(course && { course }), ...(kind && { kind }), ...(resolved && { resolved: "1" }), ...(q.trim() && { q }) }).toString();
  const notes = useApi<{ notes: ProfileNote[] }>(`/api/profile/notes${query ? `?${query}` : ""}`, [query]);
  const act = async (fn: () => Promise<unknown>) => {
    await fn();
    await notes.reload();
    onChanged();
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher par sens (« inclusion-exclusion »)…" className="max-w-xs" />
        <Input value={course} onChange={(e) => setCourse(e.target.value.toUpperCase())} placeholder="Cours" className="w-24" />
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Tous types</option>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <label className="inline-flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} className="accent-accent" /> inclure les résolues</label>
      </div>
      {notes.loading && !notes.data ? <Loading /> : (notes.data?.notes.length ?? 0) === 0 ? <Empty title="Aucune note" /> : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {notes.data!.notes.map((n) => (
              <li key={n.id} className={cx("flex items-start gap-3 px-4 py-2.5", n.resolvedAt && "opacity-60")}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CourseChip code={n.course} />
                    <Badge tone={KIND_TONE[n.kind]}>{KIND_LABEL[n.kind]}</Badge>
                    <span className="font-medium text-sm">{n.topic}</span>
                    {n.chapter && <span className="text-xs text-ink-3">· {n.chapter}</span>}
                    {n.severity === 3 && <Badge tone="bad">sévérité 3</Badge>}
                    {n.correctionId && <Link to={`/corrections/${n.correctionId}`} className="text-xs text-accent">correction{n.exercise ? ` ex. ${n.exercise}` : ""}</Link>}
                  </div>
                  <p className="text-sm text-ink-2 mt-0.5">{n.text}</p>
                  <p className="text-[11px] text-ink-3 mt-0.5">{dateTime(n.createdAt)}{n.resolvedAt ? ` · résolue ${dateTime(n.resolvedAt)}` : ""}</p>
                </div>
                {!n.resolvedAt && n.kind !== "strength" && <IconButton label="Marquer comme acquis" onClick={() => void act(() => api(`/api/profile/notes/${n.id}/resolve`, { method: "POST", json: { resolved: true } }))}><CheckIcon className="h-4 w-4" /></IconButton>}
                <IconButton label="Supprimer" onClick={() => confirm("Supprimer cette note ?") && void act(() => api(`/api/profile/notes/${n.id}`, { method: "DELETE" }))}><TrashIcon className="h-4 w-4" /></IconButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function NoteEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [course, setCourse] = useState("");
  const [topic, setTopic] = useState("");
  const [chapter, setChapter] = useState("");
  const [kind, setKind] = useState<keyof typeof KIND_LABEL>("note");
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState(2);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await api("/api/profile/notes", { method: "POST", json: { notes: [{ course: course || undefined, chapter: chapter || undefined, topic, kind, text, severity }] } });
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title="Nouvelle note">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Cours"><Input value={course} onChange={(e) => setCourse(e.target.value.toUpperCase())} placeholder="MAD" /></Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as keyof typeof KIND_LABEL)} className="w-full">
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Sévérité">
            <Select value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="w-full">
              <option value={1}>1 · mineure</option>
              <option value={2}>2 · notable</option>
              <option value={3}>3 · récurrente</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Thème"><Input value={topic} onChange={(e) => setTopic(e.target.value)} required placeholder="inclusion-exclusion" /></Field>
          <Field label="Chapitre"><Input value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="1. Ensembles" /></Field>
        </div>
        <Field label="Observation"><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} required placeholder="Je confonds ⊆ et ∈ quand…" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy}>Enregistrer</Button>
        </div>
      </form>
    </Modal>
  );
}
