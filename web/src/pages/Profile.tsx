import { CheckIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Badge, Button, Card, Empty, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Segmented, Select, Stat, Textarea, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { dateTime, relative } from "../lib/format";
import type { ProfileNote, ProfileSummary, TopicSummary } from "../lib/types";

const KIND_LABEL = { weakness: "faiblesse", strength: "point fort", mistake: "erreur", note: "note" } as const;
const KIND_TONE = { weakness: "warn", strength: "ok", mistake: "bad", note: "info" } as const;

export function Profile() {
  const summary = useApi<ProfileSummary>("/api/profile");
  const [tab, setTab] = useState<"summary" | "notes">("summary");
  const [adding, setAdding] = useState(false);
  const s = summary.data;
  const totals = s?.courses.reduce((acc, c) => ({ correct: acc.correct + (c.verdicts?.correct ?? 0), total: acc.total + (c.verdicts ? c.verdicts.correct + c.verdicts.partial + c.verdicts.wrong + c.verdicts.missing : 0) }), { correct: 0, total: 0 });

  return (
    <div className="space-y-5">
      <PageHeader title="Profil" subtitle="Ce que vos corrections révèlent : points faibles, erreurs fréquentes, points forts. L'agent s'en sert pour cibler vos révisions." actions={<><Segmented value={tab} onChange={setTab} options={[{ value: "summary", label: "Synthèse" }, { value: "notes", label: "Notes" }]} /><Button onClick={() => setAdding(true)}><PlusIcon className="h-4 w-4" /> Note</Button></>} />
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
              <Card key={c.course ?? "-"} title={<span className="flex items-center gap-2">{c.course ? <CourseChip code={c.course} /> : "Général"}{c.verdicts && <span className="text-xs font-normal text-ink-2 tabular-nums">{c.verdicts.correct} justes · {c.verdicts.partial} partiels · {c.verdicts.wrong + c.verdicts.missing} faux ({c.verdicts.corrections} correction{c.verdicts.corrections > 1 ? "s" : ""})</span>}</span>}>
                {c.verdicts && (
                  <div className="h-2 rounded-full overflow-hidden flex bg-surface-2 mb-4">
                    {(["correct", "partial", "wrong"] as const).map((k) => {
                      const total = c.verdicts!.correct + c.verdicts!.partial + c.verdicts!.wrong + c.verdicts!.missing;
                      const n = k === "wrong" ? c.verdicts!.wrong + c.verdicts!.missing : c.verdicts![k];
                      return <div key={k} className={cx(k === "correct" ? "bg-ok" : k === "partial" ? "bg-warn" : "bg-bad")} style={{ width: `${(n / total) * 100}%` }} />;
                    })}
                  </div>
                )}
                <TopicList title="Erreurs fréquentes" tone="bad" list={c.mistakes} />
                <TopicList title="Faiblesses" tone="warn" list={c.weaknesses} />
                <TopicList title="Points forts" tone="ok" list={c.strengths} />
              </Card>
            ))}
          </div>
        </>
      )}
      {adding && <NoteEditor onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void summary.reload(); setTab("notes"); }} />}
    </div>
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
  const [kind, setKind] = useState<keyof typeof KIND_LABEL>("note");
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState(2);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await api("/api/profile/notes", { method: "POST", json: { notes: [{ course: course || undefined, topic, kind, text, severity }] } });
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
        <Field label="Thème"><Input value={topic} onChange={(e) => setTopic(e.target.value)} required placeholder="inclusion-exclusion" /></Field>
        <Field label="Observation"><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} required placeholder="Je confonds ⊆ et ∈ quand…" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy}>Enregistrer</Button>
        </div>
      </form>
    </Modal>
  );
}
