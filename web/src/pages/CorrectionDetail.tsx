import { CheckCircleIcon, ExclamationCircleIcon, EyeIcon, EyeSlashIcon, MinusCircleIcon, PhotoIcon, TrashIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Markdown } from "../components/Markdown";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Segmented, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { dateTime } from "../lib/format";
import type { CorrectedExercise, Correction, Verdict } from "../lib/types";
import { STATE_LABEL, STATE_TONE, VerdictBar, swissGrade, verdictCounts } from "./Corrections";
import { Grade } from "./MockExams";

type Level = 0 | 1 | 2;

const VERDICT: Record<Verdict, { label: string; tone: "ok" | "warn" | "bad" | "neutral"; icon: typeof CheckCircleIcon; ring: string }> = {
  correct: { label: "juste", tone: "ok", icon: CheckCircleIcon, ring: "border-ok/50" },
  partial: { label: "partiel", tone: "warn", icon: ExclamationCircleIcon, ring: "border-warn/50" },
  wrong: { label: "faux", tone: "bad", icon: XCircleIcon, ring: "border-bad/50" },
  missing: { label: "non traité", tone: "neutral", icon: MinusCircleIcon, ring: "border-line" },
};

export function CorrectionDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const correction = useApi<Correction>(`/api/corrections/${id}`, [id], { refreshMs: 30_000 });
  const [level, setLevel] = useState<Level>(() => {
    try {
      return (Number(localStorage.getItem("heig-correction-level")) as Level) || 0;
    } catch {
      return 0;
    }
  });
  const [photo, setPhoto] = useState<number>();
  const setLevelKeep = (l: Level) => {
    setLevel(l);
    try {
      localStorage.setItem("heig-correction-level", String(l));
    } catch {
      // Private window.
    }
  };

  if (correction.loading && !correction.data) return <Loading />;
  if (correction.error || !correction.data) return <ErrorBox error={correction.error ?? "Correction introuvable"} retry={correction.reload} />;
  const c = correction.data;
  const v = verdictCounts(c);
  const setImpact = async (affectsProfile: boolean) => {
    await api(`/api/corrections/${c.id}`, { method: "PATCH", json: { affectsProfile } });
    correction.reload();
  };
  const remove = async () => {
    if (!confirm("Supprimer cette correction et ses photos ?")) return;
    await api(`/api/corrections/${c.id}`, { method: "DELETE" });
    navigate("/corrections");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-3"><CourseChip code={c.course} /> {c.title}</span>}
        subtitle={<span className="flex items-center gap-2 flex-wrap"><Badge tone={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</Badge>{c.topic && <span>{c.topic}</span>}{c.exam && <Link to="/exams" className="text-accent">· test blanc</Link>}{!c.affectsProfile && <Badge>hors profil</Badge>}<span>· créée {dateTime(c.createdAt)}</span>{c.correctedAt && <span>· corrigée {dateTime(c.correctedAt)}</span>}</span>}
        actions={
          c.state === "corrected" ? (
            <Segmented<Level> value={level} onChange={setLevelKeep} options={[{ value: 0, label: <span className="inline-flex items-center gap-1"><EyeSlashIcon className="h-4 w-4" /> Sans correction</span> }, { value: 1, label: "Verdicts" }, { value: 2, label: <span className="inline-flex items-center gap-1"><EyeIcon className="h-4 w-4" /> Détails</span> }]} />
          ) : undefined
        }
      />

      <Card>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent,currentColor)]" checked={c.affectsProfile} onChange={(e) => void setImpact(e.target.checked)} />
          <span className="text-sm">
            <span className="font-medium">Compte dans mon profil</span>
            <span className="block text-xs text-ink-2">{c.affectsProfile ? "Les exercices de cette correction comptent dans la note du cours, les points faibles et les chapitres. Décochez pour ne pas les compter." : "Cette correction est laissée de côté : elle ne change ni la note du cours, ni les points faibles, ni les chapitres. Cochez pour la compter à nouveau."}</span>
          </span>
        </label>
      </Card>

      {c.state !== "corrected" && (
        <Card>
          {c.state === "capture" ? (
            <Empty title="En attente de vos photos" hint={<>Ouvrez le lien de capture sur votre téléphone (bouton Photographier dans la liste), photographiez vos pages et appuyez sur Envoyer.{c.notes && <><br />Consigne : {c.notes}</>}</>} />
          ) : (
            <Empty title="Photos envoyées, correction en attente" hint="Dites à l'agent que les photos sont envoyées : il les lit, transcrit et corrige, puis le résultat apparaît ici." />
          )}
        </Card>
      )}

      {c.state === "corrected" && c.result && (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[12rem]">
                {level >= 1 ? (
                  <>
                    <div className="text-3xl font-semibold tabular-nums">{v.percent} %<span className="text-ink-3 text-lg font-normal"> de réussite</span>{c.exam && swissGrade(c) !== undefined && <span className="text-ink-3 text-lg font-normal"> · note <Grade grade={swissGrade(c)!} className="text-3xl" /></span>}</div>
                    <div className="mt-2"><VerdictBar c={c} /></div>
                    {(() => { const pts = c.result.exercises.filter((e) => e.points && e.points.total > 0); if (pts.length === 0) return null; const got = pts.reduce((s, e) => s + e.points!.obtained, 0); const tot = pts.reduce((s, e) => s + e.points!.total, 0); const num = (n: number) => String(Math.round(n * 100) / 100).replace(".", ","); return <div className="mt-1.5 text-sm font-medium tabular-nums">{num(got)} / {num(tot)} pts{pts.length < c.result.exercises.length ? <span className="text-ink-3 font-normal text-xs"> · {pts.length} exercice{pts.length > 1 ? "s" : ""} sur {c.result.exercises.length} avec points</span> : null}</div>; })()}
                    <div className="mt-1.5 text-xs text-ink-2 tabular-nums">{v.correct} juste{v.correct > 1 ? "s" : ""}{v.partial ? ` · ${v.partial} partiel${v.partial > 1 ? "s" : ""}` : ""}{v.wrong ? ` · ${v.wrong} faux` : ""} · {v.total} exercice{v.total > 1 ? "s" : ""}</div>
                  </>
                ) : (
                  <div className="text-3xl font-semibold tabular-nums">{v.total}<span className="text-ink-3 text-lg font-normal"> exercice{v.total > 1 ? "s" : ""}</span></div>
                )}
              </div>
              {level >= 2 ? <Markdown source={c.result.summary} className="flex-[2] min-w-[16rem]" /> : <p className="flex-[2] min-w-[16rem] text-sm text-ink-2">{level === 0 ? "Les verdicts sont masqués : relisez vos réponses et cherchez vos erreurs, puis affichez les verdicts." : "Essayez de trouver vos erreurs sur les exercices faux ou partiels avant d'afficher les détails."}</p>}
            </div>
            {level >= 2 && c.result.toRevise && c.result.toRevise.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs min-w-0"><span className="text-ink-3 uppercase tracking-wide">À réviser :</span>{c.result.toRevise.map((t) => <Badge key={t} tone="warn" wrap>{t}</Badge>)}</div>
            )}
          </Card>
          <div className="space-y-3">
            {c.result.exercises.map((e, i) => (
              <Exercise key={i} e={e} level={level} />
            ))}
          </div>
        </>
      )}

      {c.photos.length > 0 && (
        <Card title={`Photos · ${c.photos.length}`} padded={false}>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 p-3">
            {c.photos.map((p, i) => (
              <button key={p.id} onClick={() => setPhoto(i)} className="aspect-[3/4] rounded-lg overflow-hidden border border-line bg-surface-2 relative">
                <img src={`/api/corrections/${c.id}/photos/${p.id}`} alt={`Page ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] font-mono rounded px-1">{i + 1}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between text-xs text-ink-3">
        <Link to="/corrections" className="text-accent">← Corrections</Link>
        <Button variant="danger" size="sm" onClick={remove}><TrashIcon className="h-4 w-4" /> Supprimer</Button>
      </div>

      {photo !== undefined && (
        <Modal open onClose={() => setPhoto(undefined)} title={`Page ${photo + 1} / ${c.photos.length}`} wide>
          <img src={`/api/corrections/${c.id}/photos/${c.photos[photo].id}`} alt="" className="w-full rounded-lg" />
          <div className="flex justify-between mt-3">
            <Button disabled={photo === 0} onClick={() => setPhoto(photo - 1)}>Précédente</Button>
            <Button disabled={photo >= c.photos.length - 1} onClick={() => setPhoto(photo + 1)}>Suivante</Button>
          </div>
        </Modal>
      )}
      {c.photos.length === 0 && c.state === "corrected" && <p className="text-xs text-ink-3 flex items-center gap-1"><PhotoIcon className="h-4 w-4" /> Aucune photo conservée.</p>}
    </div>
  );
}

function Exercise({ e, level }: { e: CorrectedExercise; level: Level }) {
  const info = VERDICT[e.verdict];
  const Icon = info.icon;
  const [open, setOpen] = useState(true);
  return (
    <Card padded={false} className={cx("border-l-4", level >= 1 ? info.ring : "border-l-line")}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="font-mono text-sm font-semibold min-w-[2.5rem] shrink-0 whitespace-nowrap">{e.number}</span>
        <span className="flex-1 min-w-0 font-medium truncate">{e.title ?? (e.topics[0] ? e.topics[0] : "Exercice")}</span>
        {level >= 1 ? (
          <Badge tone={info.tone} className="inline-flex items-center gap-1 shrink-0"><Icon className="h-3.5 w-3.5" /> {info.label}{e.points ? ` · ${e.points.obtained}/${e.points.total}` : ""}</Badge>
        ) : (
          <Badge>?</Badge>
        )}
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3 space-y-4">
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">Énoncé</h3>
            {e.statement ? (
              <div className="rounded-lg border border-line p-3"><Markdown source={e.statement} /></div>
            ) : (
              <p className="text-xs text-ink-3">Énoncé non enregistré : demandez à l'agent de le compléter.</p>
            )}
          </section>
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">Votre réponse (transcrite)</h3>
            <div className="rounded-lg bg-surface-2 p-3"><Markdown source={e.answer} /></div>
          </section>
          {level >= 2 && (
            <>
              <section className={cx("rounded-lg border p-3", e.verdict === "correct" ? "border-ok/40 bg-ok-soft/40" : "border-bad/40 bg-bad-soft/40")}>
                <h3 className={cx("text-[11px] uppercase tracking-wide mb-1", e.verdict === "correct" ? "text-ok" : "text-bad")}>{e.verdict === "correct" ? "Correction" : "Ce qui ne va pas, et comment faire"}</h3>
                <Markdown source={e.feedback} />
                {e.cause && <p className="mt-2 text-sm"><span className="font-semibold">Cause probable :</span> {e.cause}</p>}
              </section>
              {e.solution && (
                <section>
                  <h3 className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">Solution complète</h3>
                  <div className="rounded-lg border border-line p-3"><Markdown source={e.solution} /></div>
                </section>
              )}
              {e.topics.length > 0 && <div className="flex flex-wrap gap-1 min-w-0">{e.topics.map((t) => <Badge key={t} wrap>{t}</Badge>)}</div>}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
