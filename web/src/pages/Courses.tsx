import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { type FilterSpec, FilterBar, useFilterState, useFiltered } from "../components/ListFilters";
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader } from "../components/ui";
import { api, useApi } from "../lib/api";
import { useHasCampus } from "../lib/auth";
import { prettyCourseName } from "../lib/courses";
import type { CyberlearnCourse, KbCourse, SearchResult, Snapshot } from "../lib/types";

export const DOC_TYPE_LABEL: Record<string, string> = { lecture: "cours", exercises: "exercices", solutions: "corrigés", exam: "examens", lab: "labos", planning: "planning", other: "autre" };

export function SearchBox({ course, autoFocus }: { course?: string; autoFocus?: boolean }) {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<SearchResult[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(undefined);
    setParams(course ? { q } : { q }, { replace: true });
    try {
      setResults((await api<{ results: SearchResult[] }>(`/api/kb/search?q=${encodeURIComponent(q)}${course ? `&course=${encodeURIComponent(course)}` : ""}&limit=12`)).results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={course ? `Chercher dans ${course}… (ex. « 1.57 », « inclusion-exclusion »)` : "Chercher dans tous les supports de cours…"} className="pl-9" autoFocus={autoFocus} />
        </div>
        <Button type="submit" variant="primary" disabled={loading}>
          Chercher
        </Button>
      </form>
      {error && <ErrorBox error={error} />}
      {loading && <Loading label="Recherche…" />}
      {results && !loading && (results.length === 0 ? <Empty title="Aucun passage trouvé" /> : (
        <div className="space-y-2">
          {results.map((r, i) => (
            <Link key={i} to={`/documents/${r.documentId}?page=${r.pages.split("-")[0]}`} className="block bg-surface border border-line rounded-xl p-3 hover:border-line-strong">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                <CourseChip code={r.course} link={false} />
                <span className="font-medium text-ink">{r.title}</span>
                <Badge>{DOC_TYPE_LABEL[r.docType] ?? r.docType}</Badge>
                {r.pages && <span className="font-mono">p. {r.pages}</span>}
                {r.exercise && <span className="font-mono">ex. {r.exercise}</span>}
              </div>
              {r.headingPath && <div className="text-[11px] text-ink-3 mt-1 truncate">{r.headingPath}</div>}
              <p className="text-sm text-ink-2 mt-1 line-clamp-3 whitespace-pre-line">{r.text}</p>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

const SPEC: FilterSpec<KbCourse> = {
  title: (c) => prettyCourseName(c.name, c.course),
  text: (c) => [c.course, c.name, ...(c.teachers ?? [])],
  categories: (c) => c.docTypes.map((t) => DOC_TYPE_LABEL[t] ?? t),
  kinds: Object.values(DOC_TYPE_LABEL),
  families: [{ label: "Supports", all: "Tous les supports", options: Object.values(DOC_TYPE_LABEL) }],
};

export function Courses() {
  const kb = useApi<{ courses: KbCourse[] }>("/api/kb/courses");
  const campus = useHasCampus();
  const cyberlearn = useApi<Snapshot<CyberlearnCourse[]>>(campus ? "/api/campus/courses" : null);
  const [params] = useSearchParams();

  const indexed = (kb.data?.courses ?? []).filter((c) => c.course);
  const [state, set] = useFilterState("courses", "name");
  const filtered = useFiltered(indexed, SPEC, state);
  const extra = (cyberlearn.data?.data ?? []).filter((c) => !indexed.some((i) => c.shortName.includes(i.course!)));

  return (
    <div className="space-y-5">
      <PageHeader title="Cours" />
      <SearchBox autoFocus={Boolean(params.get("q"))} />
      {kb.error && <ErrorBox error={kb.error} retry={kb.reload} />}
      {indexed.length > 1 && <FilterBar spec={SPEC} state={state} set={set} filtered={filtered} placeholder="Filtrer les cours par nom, sigle, enseignant…" />}
      {kb.loading ? <Loading /> : indexed.length === 0 ? <Empty title="Aucun cours indexé" hint="Lancez l'ingestion sur le serveur (npm run ingest)." /> : filtered.list.length === 0 ? <Empty title="Aucun cours ne correspond" hint="Changez les filtres." /> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.groups[0].items.map((c) => (
            <Link key={c.course} to={`/courses/${encodeURIComponent(c.course!)}`} className="block">
              <Card className="h-full hover:border-line-strong transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CourseChip code={c.course} link={false} className="text-xs" />
                    <h2 className="mt-2 font-semibold leading-tight">{prettyCourseName(c.name, c.course)}</h2>
                    {c.teachers && c.teachers.length > 0 && <p className="text-xs text-ink-2 mt-1">{c.teachers.join(", ")}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-semibold tabular-nums">{c.documents}</div>
                    <div className="text-[11px] uppercase tracking-wide text-ink-3">documents</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {c.docTypes.map((t) => (
                    <Badge key={t}>{DOC_TYPE_LABEL[t] ?? t}</Badge>
                  ))}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {extra.length > 0 && (
        <Card title="Autres cours Cyberlearn (non indexés)">
          <ul className="text-sm text-ink-2 grid sm:grid-cols-2 gap-1">
            {extra.map((c) => (
              <li key={c.id}>
                <a href={`https://cyberlearn.hes-so.ch/course/view.php?id=${c.id}`} target="_blank" rel="noreferrer" className="hover:text-accent">
                  {c.fullName}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
