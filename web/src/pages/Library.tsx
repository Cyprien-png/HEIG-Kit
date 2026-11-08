import { ArrowDownTrayIcon, DocumentIcon, FilmIcon, MagnifyingGlassIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { PdfOverlay } from "../components/PdfOverlay";
import { Markdown } from "../components/Markdown";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, Input, Loading, Modal, PageHeader, Segmented, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { bytes, dateTime } from "../lib/format";
import type { LibraryFile, LibraryItem } from "../lib/types";

const fileUrl = (f: LibraryFile) => `/api/library/files/${f.id}`;

/** The type tags, in the order the library shows them; the other tags are topics. */
const TYPE_TAGS = ["explication", "révision", "exercices", "corrigé", "te blanc", "vidéo"];
const tagOrder = (a: string, b: string) => {
  const ra = TYPE_TAGS.indexOf(a);
  const rb = TYPE_TAGS.indexOf(b);
  return (ra < 0 ? TYPE_TAGS.length : ra) - (rb < 0 ? TYPE_TAGS.length : rb) || a.localeCompare(b);
};
const NO_COURSE = "–";

export function Library() {
  const { kind, name } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "document" | "video">("all");
  const [sort, setSort] = useState<"course" | "recent">("course");
  const [course, setCourse] = useState<string>();
  const [tags, setTags] = useState<string[]>([]);
  const items = useApi<{ items: LibraryItem[] }>(`/api/library${q.trim() ? `?q=${encodeURIComponent(q)}` : ""}`, [q]);
  const all = items.data?.items ?? [];

  // The filters offered: every course and tag present (the type tags first).
  const courses = useMemo(() => [...new Set(all.map((i) => i.course ?? NO_COURSE))].sort((a, b) => (a === NO_COURSE ? 1 : b === NO_COURSE ? -1 : a.localeCompare(b))), [all]);
  const allTags = useMemo(() => [...new Set(all.flatMap((i) => i.tags))].sort(tagOrder), [all]);

  const list = all.filter((i) => (filter === "all" || i.kind === filter) && (!course || (i.course ?? NO_COURSE) === course) && tags.every((t) => i.tags.includes(t)));
  const groups = useMemo(() => {
    if (sort === "recent") return [{ course: undefined, items: [...list].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) }];
    const byCourse = new Map<string, LibraryItem[]>();
    for (const i of list) byCourse.set(i.course ?? NO_COURSE, [...(byCourse.get(i.course ?? NO_COURSE) ?? []), i]);
    return [...byCourse.entries()]
      .sort(([a], [b]) => (a === NO_COURSE ? 1 : b === NO_COURSE ? -1 : a.localeCompare(b)))
      .map(([code, group]) => ({ course: code, items: group.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) }));
  }, [list, sort]);
  const opened = kind && name ? all.flatMap((i) => i.files).find((f) => f.id === `${kind}/${name}`) : undefined;
  const toggleTag = (t: string) => setTags((current) => (current.includes(t) ? current.filter((x) => x !== t) : [...current, t]));

  return (
    <div className="space-y-4">
      <PageHeader title="Bibliothèque" actions={<Segmented size="sm" value={sort} onChange={setSort} options={[{ value: "course", label: "Par cours" }, { value: "recent", label: "Récents" }]} />} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer par mots-clés…" className="pl-9" />
        </div>
        <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "Tout" }, { value: "document", label: "Documents" }, { value: "video", label: "Vidéos" }]} />
      </div>
      {(courses.length > 1 || allTags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {courses.length > 1 &&
            courses.map((c) => (
              <button key={c} onClick={() => setCourse(course === c ? undefined : c)} className={cx("rounded-md ring-offset-1 ring-offset-canvas transition", course === c ? "ring-2 ring-accent" : "opacity-80 hover:opacity-100")} aria-pressed={course === c}>
                {c === NO_COURSE ? <Badge>sans cours</Badge> : <CourseChip code={c} link={false} />}
              </button>
            ))}
          {courses.length > 1 && allTags.length > 0 && <span className="w-px h-4 bg-line mx-1" />}
          {allTags.map((t) => (
            <button key={t} onClick={() => toggleTag(t)} aria-pressed={tags.includes(t)} className="transition hover:opacity-100">
              <Badge tone={tags.includes(t) ? "accent" : "neutral"} className={cx("normal-case tracking-normal text-xs", !TYPE_TAGS.includes(t) && !tags.includes(t) && "bg-transparent border border-line")}>
                {t}
              </Badge>
            </button>
          ))}
          {(course || tags.length > 0) && (
            <button onClick={() => { setCourse(undefined); setTags([]); }} className="text-xs text-ink-3 hover:text-ink ml-1">
              Effacer
            </button>
          )}
        </div>
      )}
      {items.error && <ErrorBox error={items.error} retry={items.reload} />}
      {items.loading && !items.data ? <Loading /> : list.length === 0 ? (
        <Empty title={all.length === 0 ? "Bibliothèque vide" : "Rien ne correspond"} hint={all.length === 0 ? "Les PDF et vidéos créés par l'agent apparaîtront ici." : "Changez les filtres."} />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.course ?? "all"} className="space-y-2">
              {group.course !== undefined && (
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  {group.course === NO_COURSE ? <span className="text-ink-2">Sans cours</span> : <CourseChip code={group.course} className="text-xs" />}
                  <span className="text-xs text-ink-3 font-normal tabular-nums">{group.items.length}</span>
                </h2>
              )}
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {group.items.map((item) => (
                  <LibraryCard key={`${item.kind}:${item.name}`} item={item} onOpen={(f) => navigate(`/library/${f.id}`)} onDeleted={() => void items.reload()} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {opened && <Viewer file={opened} item={all.find((i) => i.files.some((f) => f.id === opened.id))} onClose={() => navigate("/library")} />}
    </div>
  );
}

function LibraryCard({ item, onOpen, onDeleted }: { item: LibraryItem; onOpen: (f: LibraryFile) => void; onDeleted: () => void }) {
  const main = item.files.find((f) => (item.kind === "video" ? f.ext === ".mp4" || f.ext === ".mov" || f.ext === ".gif" : f.ext === ".pdf")) ?? item.files.find((f) => f.ext === ".md") ?? item.files[0];
  const Icon = item.kind === "video" ? FilmIcon : DocumentIcon;
  const remove = async () => {
    if (!confirm(`Supprimer « ${item.title} » et ses ${item.files.length} fichier(s) du serveur ?`)) return;
    for (const f of item.files) await api(fileUrl(f), { method: "DELETE" }).catch(() => undefined);
    onDeleted();
  };
  return (
    <Card padded={false} className="flex flex-col overflow-hidden hover:border-line-strong transition-colors">
      <button onClick={() => onOpen(main)} className="text-left p-4 flex-1">
        <div className="flex items-start gap-3">
          <span className={cx("h-10 w-10 rounded-lg grid place-items-center shrink-0", item.kind === "video" ? "bg-info-soft text-info" : "bg-accent-soft text-accent")}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-medium leading-snug line-clamp-2">{item.title}</h2>
            <p className="text-xs text-ink-3 mt-1 font-mono truncate">{item.name}</p>
            {item.tags.length > 0 && (
              <div className={cx("flex flex-wrap gap-1 mt-2", !item.tagged && "opacity-60")} title={item.tagged ? undefined : "Classement automatique, pas encore tagué"}>
                {[...item.tags].sort(tagOrder).map((t) => (
                  <Badge key={t} className="normal-case tracking-normal">{t}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </button>
      <div className="flex items-center gap-1 px-3 py-2 border-t border-line text-xs text-ink-2">
        <span className="mr-auto">{dateTime(item.modifiedAt)}</span>
        {item.files.map((f) => (
          <button key={f.id} onClick={() => onOpen(f)} className="hover:text-accent">
            <Badge>{f.ext.slice(1)}</Badge>
          </button>
        ))}
        <IconButton label="Supprimer" onClick={remove} className="h-7 w-7">
          <TrashIcon className="h-4 w-4" />
        </IconButton>
      </div>
    </Card>
  );
}

/** The exam a library document is the statement of: a mock exam (tagged « te blanc »), not its solutions. */
const examOf = (item?: LibraryItem) => (item && item.tags.includes("te blanc") && !/corrig|solution/i.test(item.name) ? `document:${item.name}` : undefined);

function Viewer({ file, item, onClose }: { file: LibraryFile; item?: LibraryItem; onClose: () => void }) {
  const [text, setText] = useState<string>();
  const url = fileUrl(file);
  const isVideo = [".mp4", ".mov", ".gif"].includes(file.ext);
  const isText = file.ext === ".md" || file.ext === ".py";
  useEffect(() => {
    if (!isText) return;
    fetch(url, { credentials: "same-origin" }).then((r) => r.text()).then(setText).catch(() => setText("Impossible de charger le fichier."));
  }, [url, isText]);
  if (file.ext === ".pdf") return <PdfOverlay url={url} title={item?.title ?? file.name} downloadUrl={`${url}?download=1`} copy={{ title: item?.title ?? file.name.replace(/\.pdf$/i, ""), course: item?.course, exam: examOf(item), label: file.name }} onClose={onClose} />;
  return (
    <Modal open onClose={onClose} title={<span className="font-mono text-sm">{file.name}</span>} wide>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-ink-2">
          <span>{bytes(file.size)}</span>
          <span>· {dateTime(file.modifiedAt)}</span>
          <a href={`${url}?download=1`} className="ml-auto">
            <Button size="sm"><ArrowDownTrayIcon className="h-4 w-4" /> Télécharger</Button>
          </a>
        </div>
        {isVideo && file.ext !== ".gif" ? (
          <video src={url} controls playsInline preload="metadata" className="w-full rounded-lg bg-black aspect-video" />
        ) : file.ext === ".gif" ? (
          <img src={url} alt={file.name} className="w-full rounded-lg" />
        ) : isText ? (
          text === undefined ? <Loading /> : file.ext === ".md" ? <Markdown source={text} /> : <pre className="text-xs font-mono bg-surface-2 rounded-lg p-3 overflow-auto max-h-[70vh]">{text}</pre>
        ) : (
          <p className="text-sm text-ink-2">Ce format ne s'affiche pas dans le navigateur : téléchargez le fichier.</p>
        )}
        <p className="text-xs text-ink-3">
          <Link to="/library" onClick={onClose} className="text-accent">Bibliothèque</Link> · {file.id}
        </p>
      </div>
    </Modal>
  );
}
