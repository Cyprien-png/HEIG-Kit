import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { CourseChip } from "./CourseChip";
import { Badge, Input, Segmented, cx } from "./ui";

/** How a list is ordered: in groups (by course unless the page says otherwise), newest or oldest first, or by name. */
export type SortKey = "group" | "recent" | "oldest" | "name";

/** What a page tells the filters about its items. */
export interface FilterSpec<T> {
  title: (t: T) => string;
  /** The texts the search looks in (the title is always one); leave it out when the server searches. */
  text?: (t: T) => (string | null | undefined)[];
  /** No search at all on this page's side (the server does it). */
  serverSearch?: boolean;
  course?: (t: T) => string | null | undefined;
  date?: (t: T) => string | null | undefined;
  categories?: (t: T) => (string | null | undefined | false)[];
  /** Categories shown first, in this order, as filled badges; the others are topics, outlined. */
  kinds?: string[];
  /** The grouping of the first sort; by course when left out and the items have one. */
  group?: { label: string; key: (t: T) => string; order?: string[]; heading?: (key: string, items: T[]) => ReactNode };
  /** Hide the course chips (a list of courses, for instance). */
  courseChips?: boolean;
}

export interface FilterState {
  q: string;
  sort: SortKey;
  course?: string;
  tags: string[];
}

export const NO_COURSE = "–";
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const byName = (a: string, b: string) => a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });

function loadFilters(storageKey: string, defaultSort: SortKey): FilterState {
  const fallback: FilterState = { q: "", sort: defaultSort, tags: [] };
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Partial<FilterState> | null;
    return saved ? { ...fallback, ...saved, tags: Array.isArray(saved.tags) ? saved.tags : [] } : fallback;
  } catch {
    return fallback;
  }
}

/** The filters of a page, kept while the student opens an item and comes back (same tab). */
export function useFilterState(key: string, defaultSort: SortKey = "group"): [FilterState, (patch: Partial<FilterState>) => void] {
  const storageKey = `heig-filters:${key}`;
  const [entry, setEntry] = useState(() => ({ key: storageKey, state: loadFilters(storageKey, defaultSort) }));
  const update = useCallback(
    (patch: Partial<FilterState>) =>
      setEntry((current) => {
        const next = { ...current.state, ...patch };
        try {
          sessionStorage.setItem(current.key, JSON.stringify(next));
        } catch {
          /* private window: the filters just are not kept */
        }
        return { key: current.key, state: next };
      }),
    [],
  );
  // Another page of the same kind (another course): its own filters.
  if (entry.key !== storageKey) {
    const next = { key: storageKey, state: loadFilters(storageKey, defaultSort) };
    setEntry(next);
    return [next.state, update];
  }
  return [entry.state, update];
}

const courseOf = <T,>(spec: FilterSpec<T>, t: T) => spec.course?.(t) || NO_COURSE;
const categoriesOf = <T,>(spec: FilterSpec<T>, t: T) => (spec.categories?.(t) ?? []).filter((c): c is string => typeof c === "string" && c.length > 0);
const courseOrder = (a: string, b: string) => (a === NO_COURSE ? 1 : b === NO_COURSE ? -1 : a.localeCompare(b));

export interface Filtered<T> {
  list: T[];
  groups: { key?: string; items: T[] }[];
  courses: string[];
  categories: string[];
  /** Some filter narrows the list. */
  active: boolean;
}

/** The items left by the filters, sorted, in groups when the sort groups them. */
export function useFiltered<T>(items: T[], spec: FilterSpec<T>, state: FilterState): Filtered<T> {
  return useMemo(() => {
    const courses = spec.course ? [...new Set(items.map((t) => courseOf(spec, t)))].sort(courseOrder) : [];
    const kinds = spec.kinds ?? [];
    const rank = (c: string) => (kinds.includes(c) ? kinds.indexOf(c) : kinds.length);
    const categories = [...new Set(items.flatMap((t) => categoriesOf(spec, t)))].sort((a, b) => rank(a) - rank(b) || byName(a, b));
    const words = spec.serverSearch ? [] : fold(state.q).split(/\s+/).filter(Boolean);
    const list = items.filter((t) => {
      if (state.course && courseOf(spec, t) !== state.course) return false;
      const own = categoriesOf(spec, t);
      if (!state.tags.every((tag) => own.includes(tag))) return false;
      if (words.length === 0) return true;
      const haystack = fold([spec.title(t), courseOf(spec, t), ...own, ...(spec.text?.(t) ?? [])].filter(Boolean).join(" "));
      return words.every((w) => haystack.includes(w));
    });
    const date = (t: T) => spec.date?.(t) ?? "";
    const recent = (a: T, b: T) => date(b).localeCompare(date(a)) || byName(spec.title(a), spec.title(b));
    const sort = state.sort === "group" && !spec.group && !spec.course ? (spec.date ? "recent" : "name") : state.sort;
    if (sort !== "group") {
      const order = sort === "name" ? (a: T, b: T) => byName(spec.title(a), spec.title(b)) : sort === "oldest" ? (a: T, b: T) => -recent(a, b) : recent;
      return { list, groups: [{ items: [...list].sort(order) }], courses, categories, active: Boolean(state.q.trim() || state.course || state.tags.length) };
    }
    const keyOf = spec.group?.key ?? ((t: T) => courseOf(spec, t));
    const groupRank = (k: string) => (spec.group?.order?.includes(k) ? spec.group.order.indexOf(k) : spec.group?.order?.length ?? 0);
    const byKey = new Map<string, T[]>();
    for (const t of list) byKey.set(keyOf(t), [...(byKey.get(keyOf(t)) ?? []), t]);
    const groups = [...byKey.entries()]
      .sort(([a], [b]) => groupRank(a) - groupRank(b) || courseOrder(a, b))
      .map(([key, group]) => ({ key, items: group.sort(spec.date ? recent : (a, b) => byName(spec.title(a), spec.title(b))) }));
    return { list, groups, courses, categories, active: Boolean(state.q.trim() || state.course || state.tags.length) };
  }, [items, spec, state]);
}

/** The search box, the sort, then the course chips and the categories: the same on every list page. */
export function FilterBar<T>({ spec, state, set, filtered, placeholder = "Chercher par nom, sujet…", extra }: { spec: FilterSpec<T>; state: FilterState; set: (patch: Partial<FilterState>) => void; filtered: Filtered<T>; placeholder?: string; extra?: ReactNode }) {
  const sorts: { value: SortKey; label: string }[] = [];
  if (spec.group || spec.course) sorts.push({ value: "group", label: spec.group?.label ?? "Par cours" });
  if (spec.date) sorts.push({ value: "recent", label: "Récents" }, { value: "oldest", label: "Anciens" });
  sorts.push({ value: "name", label: "A–Z" });
  const sort = sorts.some((s) => s.value === state.sort) ? state.sort : sorts[0].value;
  const showCourses = spec.courseChips !== false && filtered.courses.length > 1;
  const toggle = (tag: string) => set({ tags: state.tags.includes(tag) ? state.tags.filter((t) => t !== tag) : [...state.tags, tag] });
  // A selected filter stays visible even when nothing carries it any more, so it can be removed.
  const categories = [...filtered.categories, ...state.tags.filter((t) => !filtered.categories.includes(t))];
  const courses = state.course && !filtered.courses.includes(state.course) ? [...filtered.courses, state.course] : filtered.courses;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input type="search" value={state.q} onChange={(e) => set({ q: e.target.value })} placeholder={placeholder} className="pl-9" />
        </div>
        {extra}
        {sorts.length > 1 && <Segmented size="sm" value={sort} onChange={(v) => set({ sort: v })} options={sorts} />}
      </div>
      {(showCourses || categories.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {showCourses &&
            courses.map((c) => (
              <button key={c} onClick={() => set({ course: state.course === c ? undefined : c })} className={cx("rounded-md ring-offset-1 ring-offset-canvas transition", state.course === c ? "ring-2 ring-accent" : "opacity-80 hover:opacity-100")} aria-pressed={state.course === c}>
                {c === NO_COURSE ? <Badge>sans cours</Badge> : <CourseChip code={c} link={false} />}
              </button>
            ))}
          {showCourses && categories.length > 0 && <span className="w-px h-4 bg-line mx-1" />}
          {categories.map((t) => (
            <button key={t} onClick={() => toggle(t)} aria-pressed={state.tags.includes(t)} className="transition hover:opacity-100">
              <Badge tone={state.tags.includes(t) ? "accent" : "neutral"} className={cx("normal-case tracking-normal text-xs", spec.kinds && !spec.kinds.includes(t) && !state.tags.includes(t) && "bg-transparent border border-line")}>
                {t}
              </Badge>
            </button>
          ))}
          {(state.course || state.tags.length > 0 || state.q) && (
            <button onClick={() => set({ course: undefined, tags: [], q: "" })} className="text-xs text-ink-3 hover:text-ink ml-1">
              Effacer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The heading of a group: its course chip (or the page's own heading) and how many items it holds. */
export function GroupHeading<T>({ spec, groupKey, items }: { spec: FilterSpec<T>; groupKey: string; items: T[] }) {
  if (spec.group?.heading) return <>{spec.group.heading(groupKey, items)}</>;
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold">
      {spec.group ? <span>{groupKey}</span> : groupKey === NO_COURSE ? <span className="text-ink-2">Sans cours</span> : <CourseChip code={groupKey} className="text-xs" />}
      <span className="text-xs text-ink-3 font-normal tabular-nums">{items.length}</span>
    </h2>
  );
}

/** The filtered items, in their groups, each group a grid of cards. */
export function FilteredGroups<T>({ spec, filtered, grid, children }: { spec: FilterSpec<T>; filtered: Filtered<T>; grid: string; children: (t: T) => ReactNode }) {
  return (
    <div className="space-y-6">
      {filtered.groups.map((group) => (
        <section key={group.key ?? "all"} className="space-y-2">
          {group.key !== undefined && <GroupHeading spec={spec} groupKey={group.key} items={group.items} />}
          <div className={grid}>{group.items.map(children)}</div>
        </section>
      ))}
    </div>
  );
}
