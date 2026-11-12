import { ArrowUpTrayIcon, CheckCircleIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { type FilterSpec, FilterBar, FilteredGroups, useFilterState, useFiltered } from "../components/ListFilters";
import { PdfReader, type PdfInfo } from "../components/PdfReader";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, Loading, PageHeader } from "../components/ui";
import { ApiError, api, useApi } from "../lib/api";
import { countAnnotated } from "../lib/annotations";
import { dateTime, relative } from "../lib/format";
import { renderPageImage } from "../lib/pdf";
import type { Correction, Workcopy } from "../lib/types";
import { useAnnotations } from "../lib/useAnnotations";
import { makeCopy } from "../lib/workcopies";

const SPEC: FilterSpec<Workcopy> = {
  title: (c) => c.title,
  text: (c) => [c.sourceLabel],
  course: (c) => c.course,
  date: (c) => c.updatedAt,
  categories: (c) => [c.submittedAt ? "envoyée" : "en cours", c.correctionId && "corrigée", c.exam?.startsWith("exam:") ? "ancien TE" : c.exam ? "test blanc" : undefined, c.annotatedPages === 0 && "vierge"],
  kinds: ["en cours", "envoyée", "corrigée", "test blanc", "ancien TE", "vierge"],
  families: [
    { label: "État", all: "Tous les états", options: ["en cours", "envoyée", "corrigée", "vierge"] },
    { label: "Origine", all: "Toutes les origines", options: ["test blanc", "ancien TE"] },
  ],
};

/** The copies of PDFs the student fills in on the web app. */
export function WorkCopies() {
  const copies = useApi<{ workcopies: Workcopy[] }>("/api/workcopies");
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const importFile = async (file: File) => {
    setBusy(true);
    setError(undefined);
    try {
      const made = await makeCopy({ title: file.name.replace(/\.pdf$/i, ""), label: file.name }, await file.arrayBuffer());
      navigate(`/copies/${made.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const remove = async (copy: Workcopy) => {
    if (!confirm(`Supprimer la copie « ${copy.title} » et tout ce qui y est écrit ?`)) return;
    await api(`/api/workcopies/${copy.id}`, { method: "DELETE" });
    await copies.reload();
  };

  const list = copies.data?.workcopies ?? [];
  const [state, set] = useFilterState("copies");
  const filtered = useFiltered(list, SPEC, state);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Copies"
        subtitle="Des PDF remplis sur l'écran, au stylet, au doigt ou à la souris, puis envoyés en correction"
        actions={
          <>
            <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
            <Button disabled={busy} onClick={() => input.current?.click()}>
              <ArrowUpTrayIcon className="h-4 w-4" /> {busy ? "Import…" : "Importer un PDF"}
            </Button>
          </>
        }
      />
      {error && <p className="text-sm text-bad">{error}</p>}
      {list.length > 0 && <FilterBar spec={SPEC} state={state} set={set} filtered={filtered} />}
      {copies.loading && !copies.data ? (
        <Loading />
      ) : copies.error ? (
        <ErrorBox error={copies.error} retry={copies.reload} />
      ) : list.length === 0 ? (
        <Card>
          <Empty title="Aucune copie" hint="Ouvrez un test blanc, un ancien TE ou un document de la bibliothèque et appuyez sur « Faire une copie », ou importez un PDF." />
        </Card>
      ) : filtered.list.length === 0 ? (
        <Empty title="Rien ne correspond" hint="Changez les filtres." />
      ) : (
        <FilteredGroups spec={SPEC} filtered={filtered} grid="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(c) => (
            <Card key={c.id} padded={false} className="flex flex-col">
              <Link to={`/copies/${c.id}`} className="block flex-1 p-4 hover:bg-surface-2/50 rounded-t-xl">
                <div className="flex flex-wrap items-center gap-2">
                  <CourseChip code={c.course} link={false} />
                  {c.submittedAt ? <Badge tone="ok" className="inline-flex items-center gap-1"><CheckCircleIcon className="h-3.5 w-3.5" /> envoyée</Badge> : <Badge tone="warn">en cours</Badge>}
                </div>
                <h2 className="mt-2 font-medium leading-snug">{c.title}</h2>
                <p className="mt-1 text-xs text-ink-2">
                  {c.annotatedPages} page{c.annotatedPages > 1 ? "s" : ""} annotée{c.annotatedPages > 1 ? "s" : ""}
                  {c.pageCount ? ` sur ${c.pageCount}` : ""}
                  {c.sourceLabel ? ` · ${c.sourceLabel}` : ""}
                </p>
              </Link>
              <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-ink-3">
                <span title={dateTime(c.updatedAt)}>modifiée {relative(c.updatedAt)}</span>
                <span className="flex items-center gap-1">
                  {c.correctionId && <Link to={`/corrections/${c.correctionId}`} className="text-accent">correction</Link>}
                  <IconButton label="Supprimer" onClick={() => void remove(c)} className="h-7 w-7">
                    <TrashIcon className="h-4 w-4" />
                  </IconButton>
                </span>
              </div>
            </Card>
          )}
        </FilteredGroups>
      )}
    </div>
  );
}

export function WorkCopyEditor() {
  const { id = "" } = useParams();
  const copy = useApi<Workcopy>(`/api/workcopies/${id}`, [id]);
  if (copy.loading && !copy.data) return <Loading />;
  if (copy.error || !copy.data) return <ErrorBox error={copy.error ?? "Copie introuvable"} retry={copy.reload} />;
  if (!copy.data.hasSource) return <ErrorBox error="Le PDF de cette copie n'a pas été enregistré : supprimez-la et recommencez." retry={copy.reload} />;
  return <Editor key={`${copy.data.id}`} copy={copy.data} reload={copy.reload} />;
}

type Save = "saved" | "saving" | "error" | "conflict";

function Editor({ copy, reload }: { copy: Workcopy; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const ann = useAnnotations(copy.annotations ?? {});
  const [save, setSave] = useState<Save>("saved");
  const [info, setInfo] = useState<PdfInfo>();
  const [submitting, setSubmitting] = useState(false);

  const rev = useRef(copy.rev);
  const opsRef = useRef(ann.ops);
  const versionRef = useRef(ann.version);
  opsRef.current = ann.ops;
  versionRef.current = ann.version;
  const savedVersion = useRef(0);
  const running = useRef(false);
  const again = useRef(false);

  const flush = useCallback(async (): Promise<boolean> => {
    if (running.current) {
      again.current = true;
      return false;
    }
    if (versionRef.current === savedVersion.current) return true;
    running.current = true;
    const sent = versionRef.current;
    setSave("saving");
    let ok = false;
    try {
      const saved = await api<Workcopy>(`/api/workcopies/${copy.id}`, { method: "PATCH", json: { annotations: opsRef.current, rev: rev.current } });
      rev.current = saved.rev;
      savedVersion.current = sent;
      ok = true;
      setSave(versionRef.current === sent ? "saved" : "saving");
    } catch (e) {
      setSave(e instanceof ApiError && e.status === 409 ? "conflict" : "error");
    } finally {
      running.current = false;
    }
    if (again.current || (ok && versionRef.current !== savedVersion.current)) {
      again.current = false;
      return flush();
    }
    return ok;
  }, [copy.id]);

  // Saved a moment after each change, again after an error, and when the page is left or hidden.
  useEffect(() => {
    if (ann.version === 0 || save === "conflict") return;
    const timer = setTimeout(() => void flush(), 900);
    return () => clearTimeout(timer);
  }, [ann.version, flush, save]);
  useEffect(() => {
    if (save !== "error") return;
    const timer = setTimeout(() => void flush(), 5000);
    return () => clearTimeout(timer);
  }, [save, flush]);
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  // Modified from another device: take the other version, or keep working on this one by reloading later.
  const takeServerVersion = async () => {
    const current = await api<Workcopy>(`/api/workcopies/${copy.id}`);
    rev.current = current.rev;
    ann.reset(current.annotations ?? {});
    savedVersion.current = 0;
    setSave("saved");
  };

  const onLoaded = useCallback(
    (loaded: PdfInfo) => {
      setInfo(loaded);
      if (copy.pageCount !== loaded.pages) void api(`/api/workcopies/${copy.id}`, { method: "PATCH", json: { pageCount: loaded.pages } }).catch(() => undefined);
    },
    [copy.id, copy.pageCount],
  );

  const close = async () => {
    await flush();
    navigate("/copies");
  };

  const status =
    save === "saving" ? "Enregistrement…" : save === "saved" ? (ann.version > 0 || copy.annotatedPages > 0 ? "Enregistré" : "") : save === "error" ? <span className="text-bad">Hors ligne, nouvel essai…</span> : (
      <button onClick={() => void takeServerVersion()} className="text-bad underline">Modifiée ailleurs : recharger</button>
    );

  return (
    <>
      <PdfReader
        overlay
        url={`/api/workcopies/${copy.id}/source`}
        title={copy.title}
        onClose={() => void close()}
        onLoaded={onLoaded}
        edit={{ ...ann, status }}
        actions={
          <Button size="sm" variant="primary" disabled={!info || save === "conflict"} onClick={() => void flush().then(() => setSubmitting(true))}>
            <PencilSquareIcon className="h-4 w-4" /> Soumettre
          </Button>
        }
      />
      {submitting && info && <SubmitDialog copy={copy} info={info} ops={ann.ops} onCancel={() => setSubmitting(false)} onDone={(correctionId) => { void reload(); navigate(`/corrections/${correctionId}`); }} />}
    </>
  );
}

/** Turns the pages of the copy into the photos of a new correction and sends it. */
function SubmitDialog({ copy, info, ops, onCancel, onDone }: { copy: Workcopy; info: PdfInfo; ops: ReturnType<typeof useAnnotations>["ops"]; onCancel: () => void; onDone: (correctionId: string) => void }) {
  const annotated = countAnnotated(ops);
  const [title, setTitle] = useState(copy.title);
  const [which, setWhich] = useState<"all" | "annotated">("all");
  const [counts, setCounts] = useState(true);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();

  const pages = which === "all" ? Array.from({ length: info.pages }, (_, i) => i + 1) : Object.keys(ops).map(Number).filter((n) => n <= info.pages).sort((a, b) => a - b);

  const send = async () => {
    setError(undefined);
    let correctionId: string | undefined;
    try {
      const created = await api<Correction>("/api/corrections", { method: "POST", json: { title: title.trim() || copy.title, course: copy.course, exam: copy.exam, notes: "Copie remplie sur l'application, pages envoyées avec les annotations.", affectsProfile: counts } });
      correctionId = created.id;
      for (const [i, n] of pages.entries()) {
        setProgress(`Page ${i + 1} sur ${pages.length}…`);
        const blob = await renderPageImage(info.pdf, n, ops[String(n)] ?? []);
        await api(`/api/corrections/${created.id}/photos`, { method: "POST", body: blob, headers: { "Content-Type": "image/jpeg" } });
      }
      setProgress("Envoi…");
      await api(`/api/corrections/${created.id}/send`, { method: "POST" });
      await api(`/api/workcopies/${copy.id}`, { method: "PATCH", json: { correctionId: created.id, submitted: true } });
      onDone(created.id);
    } catch (e) {
      // A half-sent correction would stay in the list: remove it so that the next try starts clean.
      if (correctionId) await api(`/api/corrections/${correctionId}`, { method: "DELETE" }).catch(() => undefined);
      setError(e instanceof Error ? e.message : String(e));
      setProgress(undefined);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={progress ? undefined : onCancel} />
      <div className="relative w-full max-w-md space-y-4 rounded-t-2xl border border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-card sm:rounded-2xl">
        <h2 className="text-base font-semibold">Soumettre pour correction</h2>
        <label className="block text-sm">
          <span className="text-xs text-ink-2">Titre de la correction</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!progress} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm" />
        </label>
        <fieldset className="space-y-1 text-sm" disabled={!!progress}>
          <legend className="text-xs text-ink-2">Pages envoyées</legend>
          <label className="flex items-center gap-2"><input type="radio" checked={which === "all"} onChange={() => setWhich("all")} /> Toutes les pages ({info.pages})</label>
          <label className="flex items-center gap-2"><input type="radio" checked={which === "annotated"} onChange={() => setWhich("annotated")} disabled={annotated === 0} /> Seulement celles où j'ai écrit ({annotated})</label>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={counts} onChange={(e) => setCounts(e.target.checked)} disabled={!!progress} />
          <span>Compter dans mon profil<span className="block text-xs text-ink-2">Décochez pour un essai qui ne doit pas changer vos notes ni vos points faibles.</span></span>
        </label>
        {pages.length === 0 && <p className="text-sm text-bad">Aucune page à envoyer : écrivez d'abord sur la copie.</p>}
        {error && <p className="text-sm text-bad">{error}</p>}
        {progress && <p className="text-sm text-ink-2">{progress}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={!!progress}>Annuler</Button>
          <Button variant="primary" disabled={!!progress || pages.length === 0} onClick={() => void send()}>
            Envoyer {pages.length} page{pages.length > 1 ? "s" : ""}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
