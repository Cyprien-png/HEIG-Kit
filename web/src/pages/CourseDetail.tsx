import { ArrowTopRightOnSquareIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { Link, useParams } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { type FilterSpec, FilterBar, useFilterState, useFiltered } from "../components/ListFilters";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { useApi } from "../lib/api";
import { prettyCourseName } from "../lib/courses";
import { addDays, day, today } from "../lib/format";
import type { CalendarEvent, Correction, Deck, KbCourse, KbDocument, ProfileSummary } from "../lib/types";
import { DOC_TYPE_LABEL, SearchBox } from "./Courses";

const TYPE_ORDER = ["lecture", "exercises", "solutions", "exam", "lab", "planning", "other"];

const typeLabel = (t: string) => DOC_TYPE_LABEL[t] ?? t;

const SPEC: FilterSpec<KbDocument> = {
  title: (d) => d.title,
  text: (d) => [d.chapter],
  date: (d) => d.uploadedAt,
  categories: (d) => [typeLabel(d.docType), d.chapter],
  kinds: TYPE_ORDER.map(typeLabel),
  group: { label: "Par type", key: (d) => typeLabel(d.docType), order: TYPE_ORDER.map(typeLabel) },
};

export function CourseDetail() {
  const { code = "" } = useParams();
  const docs = useApi<{ documents: KbDocument[] }>(`/api/kb/courses/${encodeURIComponent(code)}/documents`, [code]);
  const courses = useApi<{ courses: KbCourse[] }>("/api/kb/courses");
  const events = useApi<{ events: CalendarEvent[] }>(`/api/calendar?from=${today()}&to=${addDays(today(), 60)}&course=${encodeURIComponent(code)}&kinds=deadline,exam,event`, [code]);
  const decks = useApi<{ decks: Deck[] }>(`/api/decks?course=${encodeURIComponent(code)}`, [code]);
  const corrections = useApi<{ corrections: Correction[] }>(`/api/corrections?course=${encodeURIComponent(code)}`, [code]);
  const profile = useApi<ProfileSummary>(`/api/profile?course=${encodeURIComponent(code)}`, [code]);

  const info = courses.data?.courses.find((c) => c.course?.toLowerCase() === code.toLowerCase());
  const documents = docs.data?.documents ?? [];
  const [state, set] = useFilterState(`course-documents:${code}`);
  const filtered = useFiltered(documents, SPEC, state);
  const me = profile.data?.courses[0];

  return (
    <div className="space-y-5">
      <PageHeader title={<span className="flex items-center gap-3"><CourseChip code={code} link={false} className="text-sm" /> {prettyCourseName(info?.name, code)}</span>} subtitle={info?.teachers?.join(", ")} />
      <SearchBox course={code} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          {docs.error && <ErrorBox error={docs.error} retry={docs.reload} />}
          {documents.length > 1 && <FilterBar spec={SPEC} state={state} set={set} filtered={filtered} placeholder="Filtrer les documents par titre, chapitre…" />}
          {docs.loading ? <Loading /> : documents.length === 0 ? <Empty title="Aucun document indexé pour ce cours" /> : filtered.list.length === 0 ? <Empty title="Aucun document ne correspond" hint="Changez les filtres." /> : (
            filtered.groups.map((group) => (
              <Card key={group.key ?? "all"} title={group.key !== undefined ? `${group.key} · ${group.items.length}` : `${group.items.length} document${group.items.length > 1 ? "s" : ""}`} padded={false}>
                <ul className="divide-y divide-line">
                  {group.items.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-4 py-2 hover:bg-surface-2">
                      <DocumentTextIcon className="h-4 w-4 text-ink-3 shrink-0" />
                      <Link to={`/documents/${d.id}`} className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{d.title}</div>
                        <div className="text-[11px] text-ink-3 truncate">{group.key === undefined ? `${typeLabel(d.docType)} · ` : ""}{d.chapter ?? "—"}{d.uploadedAt ? ` · ${day(d.uploadedAt)}` : ""}</div>
                      </Link>
                      {d.url && (
                        <a href={d.url} target="_blank" rel="noreferrer" title="Sur Cyberlearn" className="text-ink-3 hover:text-accent">
                          <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4 min-w-0">
          <Card title="Échéances" padded={false}>
            {events.loading ? <Loading /> : (events.data?.events.length ?? 0) === 0 ? <Empty title="Rien de prévu" hint="Pas de rendu ni d'examen dans les 60 jours." /> : (
              <ul className="divide-y divide-line">
                {events.data!.events.map((e) => (
                  <li key={e.key} className="px-4 py-2 text-sm flex items-center gap-2">
                    <span className="font-mono text-xs text-ink-2 w-20 shrink-0">{day(e.startsAt)}</span>
                    <span className="flex-1 min-w-0 truncate">{e.title}</span>
                    <Badge tone={e.kind === "exam" ? "bad" : e.kind === "deadline" ? "warn" : "info"}>{e.kind === "exam" ? "examen" : e.kind === "deadline" ? "rendu" : "événement"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Points à travailler">
            {profile.loading ? <Loading /> : !me || (me.weaknesses.length === 0 && me.mistakes.length === 0) ? <p className="text-sm text-ink-2">Aucune observation pour l'instant. Faites corriger vos exercices pour alimenter votre profil.</p> : (
              <ul className="space-y-2">
                {[...me.weaknesses, ...me.mistakes].slice(0, 6).map((t, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.topic}</span>
                      <Badge tone={t.severity >= 3 ? "bad" : t.severity === 2 ? "warn" : "neutral"}>×{t.count}</Badge>
                    </div>
                    <p className="text-xs text-ink-2 line-clamp-2">{t.examples[0]}</p>
                  </li>
                ))}
                <li>
                  <Link to="/profile" className="text-xs text-accent">Voir le profil</Link>
                </li>
              </ul>
            )}
          </Card>

          <Card title="Cartes" padded={false}>
            {decks.loading ? <Loading /> : (decks.data?.decks.length ?? 0) === 0 ? <Empty title="Pas de paquet" hint="« crée-moi des cartes sur ce cours »" /> : (
              <ul className="divide-y divide-line">
                {decks.data!.decks.map((d) => (
                  <li key={d.id}>
                    <Link to={`/cards/${d.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-surface-2">
                      <span className="truncate">{d.title}</span>
                      <span className="text-xs text-ink-2 tabular-nums">{d.due > 0 ? <span className="text-accent font-semibold">{d.due} dues</span> : `${d.cards}`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Corrections" padded={false}>
            {corrections.loading ? <Loading /> : (corrections.data?.corrections.length ?? 0) === 0 ? <Empty title="Aucune correction" /> : (
              <ul className="divide-y divide-line">
                {corrections.data!.corrections.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link to={`/corrections/${c.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-surface-2">
                      <span className="truncate">{c.title}</span>
                      <span className="text-xs text-ink-2">{c.state === "corrected" ? `${c.result?.exercises.filter((e) => e.verdict === "correct").length}/${c.result?.exercises.length}` : c.state}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
