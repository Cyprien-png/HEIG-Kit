import { ArrowDownTrayIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Markdown } from "../components/Markdown";
import { Badge, Button, Card, ErrorBox, Input, Loading, PageHeader, Segmented } from "../components/ui";
import { useApi } from "../lib/api";
import type { DocumentText } from "../lib/types";
import { DOC_TYPE_LABEL } from "./Courses";

type Mode = "pdf" | "markdown" | "text";

/**
 * The extracted text of a page as Markdown to render: the `[figure n : labels]` markers become the figure's image and
 * the `[formule : …]` markers (raw text of a formula the extraction could not read) a marked span.
 */
export function pageMarkdown(text: string, documentId: string): string {
  return text
    .replace(/\[figure (\d+) : ([^\]]*)\]/g, (_, n: string, labels: string) => `![${labels.replace(/[\[\]()]/g, " ").trim()}](/api/kb/documents/${documentId}/figures/${n})`)
    .replace(/\[figure (\d+)\]/g, (_, n: string) => `![figure ${n}](/api/kb/documents/${documentId}/figures/${n})`)
    .replace(/\[formule : ([^\]]*)\]/g, (_, raw: string) => `<span class="formula">${raw.replace(/</g, "&lt;")}</span>`);
}

export function DocumentView() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const doc = useApi<DocumentText>(`/api/kb/documents/${id}`, [id]);
  const [mode, setMode] = useState<Mode>(() => (window.innerWidth < 768 ? "markdown" : "pdf"));
  const [filter, setFilter] = useState("");
  const page = Number(params.get("page") ?? 1) || 1;
  const fileUrl = `/api/kb/documents/${id}/file`;
  const [hasFile, setHasFile] = useState<boolean>();

  useEffect(() => {
    fetch(fileUrl, { method: "HEAD", credentials: "same-origin" }).then((r) => setHasFile(r.ok && (r.headers.get("content-type") ?? "").includes("pdf"))).catch(() => setHasFile(false));
  }, [fileUrl]);

  const pages = useMemo(() => {
    const text = doc.data?.text ?? "";
    return text.split(/^--- page (\d+) ---\n/m).slice(1).reduce<{ n: number; text: string }[]>((acc, part, i, arr) => {
      if (i % 2 === 0) acc.push({ n: Number(part), text: arr[i + 1] ?? "" });
      return acc;
    }, []);
  }, [doc.data]);
  const shown = filter.trim() ? pages.filter((p) => p.text.toLowerCase().includes(filter.toLowerCase())) : pages;

  if (doc.loading) return <Loading />;
  if (doc.error || !doc.data) return <ErrorBox error={doc.error ?? "Document introuvable"} retry={doc.reload} />;
  const d = doc.data;
  const viewMode: Mode = hasFile === false && mode === "pdf" ? "markdown" : mode;

  return (
    <div className="space-y-4">
      <PageHeader
        title={d.title}
        subtitle={<span className="flex items-center gap-2 flex-wrap"><CourseChip code={d.course} /> <Badge>{DOC_TYPE_LABEL[d.docType] ?? d.docType}</Badge> {d.chapter && <span>{d.chapter}</span>} <span>· {d.pageCount} pages · document {d.id}</span></span>}
        actions={
          <>
            <Segmented value={viewMode} onChange={setMode} options={[...(hasFile !== false ? [{ value: "pdf" as const, label: "PDF" }] : []), { value: "markdown" as const, label: "Markdown" }, { value: "text" as const, label: "Texte" }]} />
            {hasFile && (
              <a href={`${fileUrl}`} download>
                <Button size="md"><ArrowDownTrayIcon className="h-4 w-4" /> Fichier</Button>
              </a>
            )}
            {d.url && (
              <a href={d.url} target="_blank" rel="noreferrer">
                <Button size="md"><ArrowTopRightOnSquareIcon className="h-4 w-4" /> Cyberlearn</Button>
              </a>
            )}
          </>
        }
      />
      {viewMode === "pdf" ? (
        <Card padded={false} className="overflow-hidden">
          <iframe title={d.title} src={`${fileUrl}#page=${page}&view=FitH`} className="w-full h-[calc(100vh-14rem)] min-h-[480px] bg-surface-2" />
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer les pages contenant…" className="max-w-sm" />
            <span className="text-xs text-ink-2">{shown.length} / {pages.length} pages</span>
          </div>
          {shown.map((p) => (
            <Card key={p.n} id={`page-${p.n}`} padded={false} className={p.n === page ? "ring-2 ring-accent/40" : ""}>
              <div className="px-4 py-1.5 border-b border-line text-[11px] uppercase tracking-wide text-ink-3 flex justify-between">
                <span>Page {p.n}</span>
                {hasFile && <button onClick={() => { setParams({ page: String(p.n) }); setMode("pdf"); }} className="text-accent">voir dans le PDF</button>}
              </div>
              {viewMode === "markdown" ? <Markdown source={pageMarkdown(p.text, id)} className="px-4 py-3 doc-page" /> : <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed px-4 py-3 text-ink-2">{p.text.trim()}</pre>}
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-ink-3">
        <Link to={d.course ? `/courses/${encodeURIComponent(d.course)}` : "/courses"} className="text-accent">← Retour au cours</Link>
      </p>
    </div>
  );
}
