import { ArrowDownTrayIcon, DocumentIcon, FilmIcon, MagnifyingGlassIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Markdown } from "../components/Markdown";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, Input, Loading, Modal, PageHeader, Segmented, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { bytes, dateTime } from "../lib/format";
import type { LibraryFile, LibraryItem } from "../lib/types";

const fileUrl = (f: LibraryFile) => `/api/library/files/${f.id}`;

export function Library() {
  const { kind, name } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "document" | "video">("all");
  const items = useApi<{ items: LibraryItem[] }>(`/api/library${q.trim() ? `?q=${encodeURIComponent(q)}` : ""}`, [q]);
  const list = (items.data?.items ?? []).filter((i) => filter === "all" || i.kind === filter);
  const opened = kind && name ? (items.data?.items ?? []).flatMap((i) => i.files).find((f) => f.id === `${kind}/${name}`) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title="Bibliothèque" />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer par mots-clés…" className="pl-9" />
        </div>
        <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "Tout" }, { value: "document", label: "Documents" }, { value: "video", label: "Vidéos" }]} />
      </div>
      {items.error && <ErrorBox error={items.error} retry={items.reload} />}
      {items.loading && !items.data ? <Loading /> : list.length === 0 ? <Empty title="Bibliothèque vide" hint="Les PDF et vidéos créés par l'agent apparaîtront ici." /> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((item) => (
            <LibraryCard key={`${item.kind}:${item.name}`} item={item} onOpen={(f) => navigate(`/library/${f.id}`)} onDeleted={() => void items.reload()} />
          ))}
        </div>
      )}
      {opened && <Viewer file={opened} onClose={() => navigate("/library")} />}
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

function Viewer({ file, onClose }: { file: LibraryFile; onClose: () => void }) {
  const [text, setText] = useState<string>();
  const url = fileUrl(file);
  const isVideo = [".mp4", ".mov", ".gif"].includes(file.ext);
  const isText = file.ext === ".md" || file.ext === ".py";
  useEffect(() => {
    if (!isText) return;
    fetch(url, { credentials: "same-origin" }).then((r) => r.text()).then(setText).catch(() => setText("Impossible de charger le fichier."));
  }, [url, isText]);
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
        ) : file.ext === ".pdf" ? (
          <iframe title={file.name} src={`${url}#view=FitH`} className="w-full h-[75vh] rounded-lg bg-surface-2" />
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
