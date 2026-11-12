import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { CourseChip } from "./CourseChip";
import { Badge, Input, Segmented, Select, cx } from "./ui";

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
  /**
   * The drop-downs of the filter bar, one per family of categories that do not mix (a type, a state, a result…).
   * Left out: one drop-down « Type » made of `kinds`. Categories of no family go to a last drop-down, the topics.
   */
  families?: Family[];
  topicsLabel?: string;
  topicsAll?: string;
}

export interface Family {
  label: string;
  /** The option that removes the filter: « Tous les types ». */
  all: string;
  /** Its categories, in the order shown; or what tells them from the others when they are not known in advance (years). */
  options: readonly string[] | ((category: string) => boolean);
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

/** The category of what the account made itself: ticked by default on the lists of shared items. */
export const MINE = "créés par moi";

function loadFilters(storageKey: string, defaultSort: SortKey, defaultTags: string[]): FilterState {
  const fallback: FilterState = { q: "", sort: defaultSort, tags: defaultTags };
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Partial<FilterState> | null;
    return saved ? { ...fallback, ...saved, tags: Array.isArray(saved.tags) ? saved.tags : [] } : fallback;
  } catch {
    return fallback;
  }
}

/** The filters of a page, kept while the student opens an item and comes back (same tab). */
export function useFilterState(key: string, defaultSort: SortKey = "group", defaultTags: string[] = []): [FilterState, (patch: Partial<FilterState>) => void] {
  const storageKey = `heig-filters:${key}`;
  const [entry, setEntry] = useState(() => ({ key: storageKey, state: loadFilters(storageKey, defaultSort, defaultTags) }));
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
    const next = { key: storageKey, state: loadFilters(storageKey, defaultSort, defaultTags) };
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
    // Offered: what the items of the selected course carry, so that a drop-down never proposes a topic of another course.
    const offered = state.course ? items.filter((t) => courseOf(spec, t) === state.course) : items;
    const categories = [...new Set(offered.flatMap((t) => categoriesOf(spec, t)))].sort((a, b) => rank(a) - rank(b) || byName(a, b));
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
  // A selected filter stays visible even when nothing carries it any more, so it can be removed.
  const categories = [...filtered.categories, ...state.tags.filter((t) => !filtered.categories.includes(t))];
  const courses = state.course && !filtered.courses.includes(state.course) ? [...filtered.courses, state.course] : filtered.courses;
  // One drop-down per family of categories (never a type next to a result in the same list), then the topics.
  const declared: Family[] = spec.families ?? [{ label: "Type", all: "Tous les types", options: (spec.kinds ?? []).filter((k) => k !== MINE) }];
  const belongs = (f: Family, c: string) => c !== MINE && (typeof f.options === "function" ? f.options(c) : f.options.includes(c));
  const order = (f: Family) => (a: string, b: string) => (typeof f.options === "function" ? byName(b, a) : f.options.indexOf(a) - f.options.indexOf(b));
  const families = [
    ...declared.map((f) => ({ label: f.label, all: f.all, options: categories.filter((c) => belongs(f, c)).sort(order(f)) })),
    { label: spec.topicsLabel ?? "Catégorie", all: spec.topicsAll ?? "Toutes les catégories", options: categories.filter((c) => c !== MINE && !declared.some((f) => belongs(f, c))) },
  ].filter((f) => f.options.length > 0);
  const hasMine = categories.includes(MINE);
  /** Replaces what is selected among `options` by `tag` (or by nothing). */
  const choose = (options: string[], tag: string) => set({ tags: [...state.tags.filter((t) => !options.includes(t)), ...(tag ? [tag] : [])] });
  const chosen = (options: string[]) => state.tags.find((t) => options.includes(t)) ?? "";
  const select = "h-8 max-w-[14rem] text-xs";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input type="search" value={state.q} onChange={(e) => set({ q: e.target.value })} placeholder={placeholder} className="pl-9" />
        </div>
        {sorts.length > 1 && <Segmented size="sm" value={sort} onChange={(v) => set({ sort: v })} options={sorts} />}
      </div>
      {(hasMine || families.length > 0 || extra) && (
        <div className="flex flex-wrap items-center gap-2">
          {hasMine && (
            <Select aria-label="Auteur" className={cx(select, state.tags.includes(MINE) && "ring-1 ring-accent font-medium")} value={chosen([MINE])} onChange={(e) => choose([MINE], e.target.value)}>
              <option value="">Tous les auteurs</option>
              <option value={MINE}>Créés par moi</option>
            </Select>
          )}
          {extra}
          {families.map((f) => (
            <Select key={f.label} aria-label={f.label} className={cx(select, chosen(f.options) && "ring-1 ring-accent font-medium")} value={chosen(f.options)} onChange={(e) => choose(f.options, e.target.value)}>
              <option value="">{f.all}</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o.charAt(0).toUpperCase() + o.slice(1)}
                </option>
              ))}
            </Select>
          ))}
          {(state.course || state.tags.length > 0 || state.q) && (
            <button onClick={() => set({ course: undefined, tags: [], q: "" })} className="text-xs text-ink-3 hover:text-ink ml-1">
              Effacer
            </button>
          )}
        </div>
      )}
      {showCourses && (
        <div className="flex flex-wrap items-center gap-2">
          {courses.map((c) => (
            // inline-flex: the button takes the exact shape of the chip, and so does its ring.
            <button key={c} onClick={() => set({ course: state.course === c ? undefined : c })} className={cx("inline-flex rounded-md transition", state.course === c ? "ring-2 ring-accent ring-offset-2 ring-offset-canvas" : "opacity-80 hover:opacity-100")} aria-pressed={state.course === c}>
              {c === NO_COURSE ? <Badge>sans cours</Badge> : <CourseChip code={c} link={false} />}
            </button>
          ))}
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

/** The list only shows what the account made, and it made nothing yet: the way to what the class shared. */
export function NothingOfMine({ show }: { show: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">Vous n'avez encore rien créé ici</p>
      <p className="text-sm text-ink-2 mt-1">La liste montre par défaut ce que vous avez créé. Ce que les autres comptes ont partagé est juste derrière.</p>
      <button onClick={show} className="mt-4 inline-flex items-center rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
        Voir tout ce qui est partagé
      </button>
    </div>
  );
}
