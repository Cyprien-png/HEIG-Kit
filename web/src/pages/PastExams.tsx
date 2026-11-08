import { ArrowDownTrayIcon, CameraIcon, ChevronRightIcon, DocumentCheckIcon, DocumentTextIcon, FolderIcon, LinkIcon, PhotoIcon, QrCodeIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Markdown } from "../components/Markdown";
import { PdfOverlay } from "../components/PdfOverlay";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Select, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { bytes, dateTime } from "../lib/format";
import type { Correction, ExamAttempt, ExamStatus, PastExam } from "../lib/types";
import { STATE_LABEL } from "./Corrections";
import { Grade } from "./MockExams";

const STATUS: Record<ExamStatus, { label: string; tone: "neutral" | "warn" | "ok" }> = {
  todo: { label: "pas encore fait", tone: "neutral" },
  pending: { label: "correction en cours", tone: "warn" },
  done: { label: "fait", tone: "ok" },
};

const fileUrl = (exam: PastExam, name: string) => `/api/past-exams/files/${exam.id.split("/").map(encodeURIComponent).join("/")}/${name}`;

/** The folder the URL points at: `/past-exams/PRG1/INF1/2016-2017`. */
function useFolder(): string[] {
  const { pathname } = useLocation();
  return pathname.replace(/^\/past-exams\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

export function PastExams() {
  const navigate = useNavigate();
  const folder = useFolder();
  const exams = useApi<{ exams: PastExam[] }>("/api/past-exams", [], { refreshMs: 60_000 });
  const corrections = useApi<{ corrections: Correction[] }>("/api/corrections");
  const [viewing, setViewing] = useState<{ exam: PastExam; name: string }>();
  const [link, setLink] = useState<{ title: string; url: string }>();
  const [linking, setLinking] = useState<PastExam>();
  const all = exams.data?.exams ?? [];

  // The exams under the current folder, and the sub-folders to offer (branches, then years).
  const inside = all.filter((e) => folder.every((seg, i) => [...e.branch, e.year][i] === seg));
  const depth = folder.length;
  const subfolders = useMemo(() => {
    const names = new Map<string, { exams: number; done: number; years?: Set<string> }>();
    for (const e of inside) {
      const pathParts = [...e.branch, e.year];
      if (pathParts.length <= depth) continue;
      const name = pathParts[depth];
      const entry = names.get(name) ?? { exams: 0, done: 0, years: new Set<string>() };
      entry.exams++;
      if (e.status === "done") entry.done++;
      entry.years!.add(e.year);
      names.set(name, entry);
    }
    return [...names.entries()].sort(([a], [b]) => (/^\d{4}-\d{4}$/.test(a) && /^\d{4}-\d{4}$/.test(b) ? b.localeCompare(a) : a.localeCompare(b)));
  }, [inside, depth]);
  const atYear = depth > 0 && /^\d{4}-\d{4}$/.test(folder[depth - 1]);
  const here = atYear ? inside : inside.filter((e) => [...e.branch, e.year].length === depth);
  const go = (parts: string[]) => navigate(`/past-exams${parts.length ? `/${parts.map(encodeURIComponent).join("/")}` : ""}`);

  const photograph = async (e: PastExam) => {
    const c = await api<Correction & { captureUrl: string }>("/api/corrections", {
      method: "POST",
      json: { title: `Ancien TE : ${e.meta.title}`, course: e.meta.course, exam: `exam:${e.id}`, notes: "Photographiez chaque page de vos réponses, dans l'ordre, puis appuyez sur Envoyer. Demandez ensuite à l'agent de corriger cet ancien TE." },
    });
    setLink({ title: e.meta.title, url: c.captureUrl });
    void exams.reload();
    void corrections.reload();
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Anciens TE" subtitle="Les travaux écrits des années précédentes : le scan original, l'énoncé retranscrit et un corrigé. Faites-en un sur papier, photographiez vos réponses, l'agent le corrige." />
      <nav className="flex items-center gap-1 text-sm flex-wrap" aria-label="Dossier">
        <button onClick={() => go([])} className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-surface-2", depth === 0 ? "font-semibold" : "text-ink-2")}><FolderIcon className="h-4 w-4" /> Branches</button>
        {folder.map((seg, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <ChevronRightIcon className="h-3.5 w-3.5 text-ink-3" />
            <button onClick={() => go(folder.slice(0, i + 1))} className={cx("rounded-md px-1.5 py-0.5 hover:bg-surface-2", i === depth - 1 ? "font-semibold" : "text-ink-2")}>{seg}</button>
          </span>
        ))}
      </nav>
      {exams.error && <ErrorBox error={exams.error} retry={exams.reload} />}
      {exams.loading && !exams.data ? <Loading /> : all.length === 0 ? (
        <Empty title="Aucun ancien TE" hint={<>Sur l'ordinateur qui a les archives : <code className="font-mono text-xs">npm run exams -- import &lt;dossier&gt;</code> puis <code className="font-mono text-xs">npm run exams -- push</code>.</>} />
      ) : (
        <>
          {subfolders.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {subfolders.map(([name, info]) => (
                <button key={name} onClick={() => go([...folder, name])} className="text-left bg-surface border border-line rounded-xl shadow-card px-4 py-3 hover:border-line-strong transition-colors flex items-center gap-3">
                  <span className="h-10 w-10 rounded-lg bg-surface-2 text-ink-2 grid place-items-center shrink-0"><FolderIcon className="h-5 w-5" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium">{name}</span>
                    <span className="block text-xs text-ink-3">{info.exams} TE{info.years && info.years.size > 1 ? ` · ${info.years.size} années` : ""}{info.done ? ` · ${info.done} fait${info.done > 1 ? "s" : ""}` : ""}</span>
                  </span>
                  <ChevronRightIcon className="h-4 w-4 text-ink-3 shrink-0" />
                </button>
              ))}
            </div>
          )}
          {here.length > 0 && (
            <div className="grid md:grid-cols-2 gap-3">
              {here.map((e) => (
                <ExamCard key={e.id} exam={e} onView={(name) => setViewing({ exam: e, name })} onPhotograph={() => void photograph(e)} onLink={() => setLinking(e)} />
              ))}
            </div>
          )}
          {subfolders.length === 0 && here.length === 0 && <Empty title="Rien ici" hint="Ce dossier est vide." />}
        </>
      )}
      {viewing && <Viewer exam={viewing.exam} name={viewing.name} onClose={() => setViewing(undefined)} />}
      {link && (
        <Modal open onClose={() => setLink(undefined)} title={link.title}>
          <div className="space-y-3 text-sm">
            <p className="text-ink-2">Ouvrez ce lien sur votre téléphone pour photographier vos réponses (valable 6 heures). Une fois envoyées, demandez à l'agent de corriger cet ancien TE : la note apparaîtra ici.</p>
            <a href={link.url} className="block break-all font-mono text-xs bg-surface-2 rounded-lg p-3 text-accent">{link.url}</a>
            <div className="flex gap-2">
              <Button onClick={() => void navigator.clipboard?.writeText(link.url)}>Copier</Button>
              <a href={link.url}><Button variant="primary"><QrCodeIcon className="h-4 w-4" /> Ouvrir ici</Button></a>
            </div>
          </div>
        </Modal>
      )}
      {linking && (
        <LinkCorrection
          exam={linking}
          corrections={(corrections.data?.corrections ?? []).filter((c) => !c.exam)}
          onClose={() => setLinking(undefined)}
          onLinked={() => {
            setLinking(undefined);
            void exams.reload();
            void corrections.reload();
          }}
        />
      )}
    </div>
  );
}

function ExamCard({ exam: e, onView, onPhotograph, onLink }: { exam: PastExam; onView: (name: string) => void; onPhotograph: () => void; onLink: () => void }) {
  const status = STATUS[e.status];
  const score = e.last?.score;
  const title = `${e.meta.number === "EXA" ? "Examen" : e.meta.number}${e.meta.variant ? ` (${e.meta.variant})` : ""}`;
  return (
    <Card padded={false} className="flex flex-col hover:border-line-strong transition-colors">
      <div className="p-4 flex-1 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CourseChip code={e.meta.course} link={false} />
              <Badge tone={status.tone}>{status.label}</Badge>
              {!e.has.statement && <Badge>énoncé à retranscrire</Badge>}
            </div>
            <h3 className="font-medium mt-1.5 leading-snug">{title} <span className="text-ink-3 font-normal">· {e.year}{e.meta.teacher ? ` · ${e.meta.teacher}` : ""}</span></h3>
          </div>
          {score && (
            <div className="text-right shrink-0" title={`${score.obtained} / ${score.total} points · ${score.percent} %`}>
              <Grade grade={score.grade} className="text-3xl" />
              <div className="text-[11px] text-ink-3 tabular-nums">{score.percent} %{e.best && e.best.grade !== score.grade ? ` · meilleure ${e.best.grade.toFixed(1)}` : ""}</div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {e.has.statementPdf ? <Button size="sm" variant="primary" onClick={() => onView("enonce.pdf")}><DocumentTextIcon className="h-4 w-4" /> Énoncé</Button> : e.has.statement ? <Button size="sm" variant="primary" onClick={() => onView("enonce.md")}><DocumentTextIcon className="h-4 w-4" /> Énoncé</Button> : null}
          {e.has.solutionsPdf ? <Button size="sm" onClick={() => onView("corrige.pdf")}><DocumentCheckIcon className="h-4 w-4" /> Corrigé</Button> : e.has.solutions ? <Button size="sm" onClick={() => onView("corrige.md")}><DocumentCheckIcon className="h-4 w-4" /> Corrigé</Button> : null}
          {e.has.original && <Button size="sm" variant="ghost" onClick={() => onView("original.pdf")}><PhotoIcon className="h-4 w-4" /> Scan original</Button>}
          {e.has.blank && <Button size="sm" variant="ghost" onClick={() => onView("original-vierge.pdf")}><PhotoIcon className="h-4 w-4" /> Vierge</Button>}
          {e.has.teacherSolutions && <Button size="sm" variant="ghost" onClick={() => onView("original-corrige.pdf")}><DocumentCheckIcon className="h-4 w-4" /> Corrigé du prof</Button>}
        </div>
        {e.attempts.length > 0 && (
          <ul className="divide-y divide-line border border-line rounded-lg text-sm">
            {[...e.attempts].reverse().map((a) => <Attempt key={a.id} a={a} />)}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-1 px-3 py-2 border-t border-line text-xs text-ink-3">
        <span className="mr-auto truncate">{e.has.statement ? (e.has.solutions ? "énoncé et corrigé" : "énoncé seul") : "scan seul : demandez l'énoncé à l'agent"}</span>
        <Button size="sm" variant="ghost" onClick={onLink} title="Rattacher une correction déjà faite à ce TE"><LinkIcon className="h-4 w-4" /> Lier</Button>
        <Button size="sm" onClick={onPhotograph}><CameraIcon className="h-4 w-4" /> {e.status === "done" ? "Refaire" : "Photographier"}</Button>
      </div>
    </Card>
  );
}

function Attempt({ a }: { a: ExamAttempt }) {
  return (
    <li>
      <Link to={`/corrections/${a.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2 transition-colors">
        <span className="flex-1 min-w-0 truncate text-ink-2">{dateTime(a.createdAt)}</span>
        {a.score ? (
          <>
            <span className="text-xs text-ink-3 tabular-nums">{a.score.obtained}/{a.score.total} pts</span>
            <Grade grade={a.score.grade} />
          </>
        ) : (
          <Badge tone={a.state === "received" ? "warn" : "neutral"}>{STATE_LABEL[a.state]}</Badge>
        )}
        <span className="text-accent text-xs">correction →</span>
      </Link>
    </li>
  );
}

function Viewer({ exam, name, onClose }: { exam: PastExam; name: string; onClose: () => void }) {
  const [text, setText] = useState<string>();
  const url = fileUrl(exam, name);
  const file = exam.files.find((f) => f.name === name);
  const isMd = name.endsWith(".md");
  useEffect(() => {
    if (!isMd) return;
    fetch(url, { credentials: "same-origin" }).then((r) => r.text()).then(setText).catch(() => setText("Impossible de charger le fichier."));
  }, [url, isMd]);
  if (name.endsWith(".pdf")) {
    // A clean statement can be copied to fill in; a scan filled by a student or a solution cannot.
    const copyable = name === "enonce.pdf" || name === "original-vierge.pdf";
    return <PdfOverlay url={url} title={`${exam.meta.title} · ${name}`} downloadUrl={`${url}?download=1`} copy={copyable ? { title: exam.meta.title, course: exam.meta.course, exam: `exam:${exam.id}`, label: name } : undefined} onClose={onClose} />;
  }
  return (
    <Modal open onClose={onClose} title={<span>{exam.meta.title} <span className="font-mono text-xs text-ink-3">· {name}</span></span>} wide>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-ink-2">
          {file && <span>{bytes(file.size)} · {dateTime(file.modifiedAt)}</span>}
          <a href={`${url}?download=1`} className="ml-auto"><Button size="sm"><ArrowDownTrayIcon className="h-4 w-4" /> Télécharger</Button></a>
        </div>
        {isMd ? (text === undefined ? <Loading /> : <Markdown source={text} />) : <img src={url} alt={name} className="w-full rounded-lg" />}
      </div>
    </Modal>
  );
}

function LinkCorrection({ exam, corrections, onClose, onLinked }: { exam: PastExam; corrections: Correction[]; onClose: () => void; onLinked: () => void }) {
  const [id, setId] = useState(corrections[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/corrections/${id}`, { method: "PATCH", json: { exam: `exam:${exam.id}` } });
      onLinked();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={<>Lier une correction à « {exam.meta.title} »</>}>
      {corrections.length === 0 ? (
        <p className="text-sm text-ink-2">Aucune correction libre : toutes sont déjà rattachées à un test, ou il n'y en a pas encore. Utilisez « Photographier » pour en créer une.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <Select value={id} onChange={(e) => setId(e.target.value)}>
            {corrections.map((c) => (
              <option key={c.id} value={c.id}>{c.title} · {STATE_LABEL[c.state]} · {dateTime(c.createdAt)}</option>
            ))}
          </Select>
          {error && <ErrorBox error={error} />}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Annuler</Button>
            <Button variant="primary" disabled={busy || !id} onClick={() => void submit()}>Lier</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
