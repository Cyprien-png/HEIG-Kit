import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import { ETUDES, type NavItem, REVISION } from "../components/Shell";
import { PageHeader } from "../components/ui";
import { useApi } from "../lib/api";
import type { Correction, Deck, MockExam, StudyStats } from "../lib/types";

/** A list of places to go, one row each, with a count when something waits there. */
function Hub({ title, items, counts = {} }: { title: string; items: NavItem[]; counts?: Record<string, number | undefined> }) {
  return (
    <div className="max-w-2xl">
      <PageHeader title={title} />
      <ul className="bg-surface border border-line rounded-xl shadow-card divide-y divide-line overflow-hidden">
        {items.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors">
              <span className="h-10 w-10 rounded-lg bg-surface-2 text-ink-2 grid place-items-center shrink-0">
                <item.icon className="h-5 w-5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                {item.hint && <span className="block text-xs text-ink-3 truncate">{item.hint}</span>}
              </span>
              {counts[item.to] ? <span className="shrink-0 rounded-full bg-accent-soft text-accent text-xs font-semibold tabular-nums px-2 py-0.5">{counts[item.to]}</span> : null}
              <ChevronRightIcon className="h-4 w-4 text-ink-3 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Revision() {
  const decks = useApi<{ decks: Deck[]; stats: StudyStats }>("/api/decks");
  const corrections = useApi<{ corrections: Correction[] }>("/api/corrections");
  const exams = useApi<{ exams: MockExam[] }>("/api/exams");
  const open = (corrections.data?.corrections ?? []).filter((c) => c.state !== "corrected").length;
  const todo = (exams.data?.exams ?? []).filter((e) => e.status === "todo").length;
  return <Hub title="Révision" items={REVISION} counts={{ "/cards": decks.data?.stats.due, "/corrections": open, "/exams": todo }} />;
}

export function Etudes() {
  return <Hub title="Études" items={ETUDES} />;
}
