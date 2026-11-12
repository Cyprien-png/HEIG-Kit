import { ArrowPathIcon, CameraIcon, DocumentCheckIcon, DocumentTextIcon, LinkIcon, QrCodeIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { type FilterSpec, FilterBar, FilteredGroups, NO_COURSE, useFilterState, useFiltered } from "../components/ListFilters";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Select, Stat, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { day, dateTime } from "../lib/format";
import type { Correction, ExamAttempt, ExamStatus, LibraryItem, MockExam } from "../lib/types";
import { STATE_LABEL } from "./Corrections";

const STATUS: Record<ExamStatus, { label: string; tone: "neutral" | "warn" | "ok" }> = {
  todo: { label: "à faire", tone: "neutral" },
  pending: { label: "correction en cours", tone: "warn" },
  done: { label: "fait", tone: "ok" },
};

/** A Swiss grade, coloured: 4 and above passes. */
export function Grade({ grade, className }: { grade: number; className?: string }) {
  return <span className={cx("tabular-nums font-semibold", grade >= 4 ? "text-ok" : "text-bad", className)}>{grade.toFixed(1)}</span>;
}

const mainFile = (item: LibraryItem) => item.files.find((f) => f.ext === ".pdf") ?? item.files.find((f) => f.ext === ".md") ?? item.files[0];

const SPEC: FilterSpec<MockExam> = {
  title: (e) => e.title,
  text: (e) => e.items.map((i) => i.name),
  course: (e) => e.course,
  date: (e) => e.createdAt,
  categories: (e) => [STATUS[e.status].label, e.last?.score && (e.last.score.grade >= 4 ? "réussi" : "insuffisant"), ...(e.statement?.tags ?? []).filter((t) => !["te blanc", "corrigé", "exercices"].includes(t))],
  kinds: [...Object.values(STATUS).map((s) => s.label), "réussi", "insuffisant"],
  families: [
    { label: "État", all: "Tous les états", options: Object.values(STATUS).map((s) => s.label) },
    { label: "Résultat", all: "Tous les résultats", options: ["réussi", "insuffisant"] },
  ],
  topicsLabel: "Sujet",
  topicsAll: "Tous les sujets",
  group: {
    label: "Par cours",
    key: (e) => e.course ?? NO_COURSE,
    heading: (course, group) => (
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {course === NO_COURSE ? <span className="text-ink-2">Sans cours</span> : <CourseChip code={course} className="text-xs" />}
        <span className="text-xs text-ink-3 font-normal tabular-nums">{group.filter((e) => e.status === "done").length}/{group.length} fait{group.filter((e) => e.status === "done").length > 1 ? "s" : ""}</span>
      </h2>
    ),
  },
};

export function MockExams() {
  const navigate = useNavigate();
  const exams = useApi<{ exams: MockExam[] }>("/api/exams", [], { refreshMs: 60_000 });
  const corrections = useApi<{ corrections: Correction[] }>("/api/corrections");
  const [state, set] = useFilterState("exams");
  const [link, setLink] = useState<{ title: string; url: string }>();
  const [linking, setLinking] = useState<MockExam>();
  const all = exams.data?.exams ?? [];
  const filtered = useFiltered(all, SPEC, state);

  const done = all.filter((e) => e.status === "done");
  const average = done.length ? done.reduce((s, e) => s + (e.last?.score?.grade ?? 0), 0) / done.length : undefined;

  /** Starts a correction of this exam: the capture link comes back at once, the agent corrects once the photos are sent. */
  const photograph = async (e: MockExam) => {
    const c = await api<Correction & { captureUrl: string }>("/api/corrections", {
      method: "POST",
      json: { title: `TE blanc : ${e.title}`, course: e.course, exam: e.key, notes: "Photographiez chaque page de vos réponses, dans l'ordre, puis appuyez sur Envoyer. Demandez ensuite à l'agent de corriger ce test blanc." },
    });
    setLink({ title: e.title, url: c.captureUrl });
    void exams.reload();
    void corrections.reload();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tests blancs"
        subtitle="Les TE blancs de la bibliothèque, par cours : faites-les sur papier, photographiez vos réponses, l'agent les corrige et la note apparaît ici."
      />
      {all.length > 0 && (
        <div className="grid grid-cols-3 gap-3 max-w-xl">
          <Stat compact label="À faire" value={all.filter((e) => e.status === "todo").length} tone={all.some((e) => e.status === "todo") ? "accent" : "neutral"} />
          <Stat compact label="Faits" value={`${done.length}/${all.length}`} />
          <Stat compact label="Moyenne" value={average === undefined ? "–" : <Grade grade={Math.round(average * 10) / 10} />} hint={average === undefined ? "aucun test corrigé" : "dernière note de chaque test"} />
        </div>
      )}
      {exams.error && <ErrorBox error={exams.error} retry={exams.reload} />}
      {all.length > 0 && <FilterBar spec={SPEC} state={state} set={set} filtered={filtered} />}
      {exams.loading && !exams.data ? <Loading /> : filtered.list.length === 0 ? (
        <Empty title={all.length === 0 ? "Aucun test blanc" : "Rien ne correspond"} hint={all.length === 0 ? "Dans Claude Code : « génère-moi un TE blanc de MAD sur les chapitres 1 à 3 ». L'énoncé et le corrigé tagués « te blanc » apparaissent ici." : "Changez les filtres."} />
      ) : (
        <FilteredGroups spec={SPEC} filtered={filtered} grid="grid md:grid-cols-2 gap-3">
          {(e) => <ExamCard key={e.key} exam={e} onOpen={(item) => navigate(`/library/${mainFile(item).id}`)} onPhotograph={() => void photograph(e)} onLink={() => setLinking(e)} />}
        </FilteredGroups>
      )}
      {link && (
        <Modal open onClose={() => setLink(undefined)} title={link.title}>
          <div className="space-y-3 text-sm">
            <p className="text-ink-2">Ouvrez ce lien sur votre téléphone pour photographier vos réponses (valable 6 heures). Une fois envoyées, demandez à l'agent de corriger ce test blanc : la note apparaîtra ici.</p>
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
          corrections={(corrections.data?.corrections ?? []).filter((c) => !c.exam && (!linking.course || !c.course || c.course === linking.course))}
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

function ExamCard({ exam: e, onOpen, onPhotograph, onLink }: { exam: MockExam; onOpen: (item: LibraryItem) => void; onPhotograph: () => void; onLink: () => void }) {
  const status = STATUS[e.status];
  const score = e.last?.score;
  return (
    <Card padded={false} className="flex flex-col hover:border-line-strong transition-colors">
      <div className="p-4 flex-1 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={status.tone}>{status.label}</Badge>
              <span className="text-xs text-ink-3">{day(e.createdAt)}</span>
            </div>
            <h3 className="font-medium mt-1.5 leading-snug">{e.title}</h3>
          </div>
          {score && (
            <div className="text-right shrink-0" title={`${score.obtained} / ${score.total} points · ${score.percent} %`}>
              <Grade grade={score.grade} className="text-3xl" />
              <div className="text-[11px] text-ink-3 tabular-nums">{score.percent} %{e.best && e.best.grade !== score.grade ? ` · meilleure ${e.best.grade.toFixed(1)}` : ""}</div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {e.statement && (
            <Button size="sm" onClick={() => onOpen(e.statement!)}><DocumentTextIcon className="h-4 w-4" /> Énoncé</Button>
          )}
          {e.solutions && (
            <Button size="sm" onClick={() => onOpen(e.solutions!)} title={e.status === "todo" ? "À ouvrir après avoir fait le test" : undefined}><DocumentCheckIcon className="h-4 w-4" /> Corrigé</Button>
          )}
        </div>
        {e.attempts.length > 0 && (
          <ul className="divide-y divide-line border border-line rounded-lg text-sm">
            {[...e.attempts].reverse().map((a) => <Attempt key={a.id} a={a} />)}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-1 px-3 py-2 border-t border-line text-xs text-ink-3">
        <span className="mr-auto">{e.attempts.length === 0 ? "pas encore fait" : `${e.attempts.length} tentative${e.attempts.length > 1 ? "s" : ""}`}</span>
        <Button size="sm" variant="ghost" onClick={onLink} title="Rattacher une correction déjà faite à ce test"><LinkIcon className="h-4 w-4" /> Lier</Button>
        <Button size="sm" variant={e.status === "todo" ? "primary" : "secondary"} onClick={onPhotograph}>
          {e.status === "done" ? <ArrowPathIcon className="h-4 w-4" /> : <CameraIcon className="h-4 w-4" />} {e.status === "done" ? "Refaire" : "Photographier"}
        </Button>
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

/** Attaches an existing correction (one made before this page existed, or started from the Corrections page) to an exam. */
function LinkCorrection({ exam, corrections, onClose, onLinked }: { exam: MockExam; corrections: Correction[]; onClose: () => void; onLinked: () => void }) {
  const [id, setId] = useState(corrections[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/corrections/${id}`, { method: "PATCH", json: { exam: exam.key } });
      onLinked();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={<>Lier une correction à « {exam.title} »</>}>
      {corrections.length === 0 ? (
        <p className="text-sm text-ink-2">Aucune correction libre{exam.course ? ` pour ${exam.course}` : ""} : toutes sont déjà rattachées à un test, ou il n'y en a pas encore. Utilisez « Photographier » pour en créer une.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-ink-2">La correction choisie comptera comme une tentative de ce test blanc, avec sa note.</p>
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
