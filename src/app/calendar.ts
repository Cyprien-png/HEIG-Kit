/**
 * The calendar: lessons from GAPS, deadlines from Cyberlearn, exams and events added by hand. Every state of every event
 * is kept (`calendar_versions`); the version shown is the most recent one, so a manual change wins until the source
 * changes again after it (docs/app.md).
 */
import { randomUUID } from "node:crypto";
import type { Deadline } from "../cyberlearn/client.js";
import { courseLabel } from "../deadlines.js";
import type { Lesson } from "../gaps/client.js";
import type { Db } from "../rag/db.js";

export type EventKind = "lesson" | "deadline" | "exam" | "event";
export type EventSource = "gaps" | "cyberlearn" | "manual";
export type Author = "sync" | "user" | "agent";

export interface EventInput {
  kind: EventKind;
  title: string;
  course?: string;
  startsAt: Date;
  endsAt?: Date;
  allDay?: boolean;
  location?: string;
  url?: string;
  details?: string;
}

export interface CalendarEvent extends EventInput {
  key: string;
  source: EventSource;
  deleted: boolean;
  fetchedAt: Date;
  author: Author;
  /** Whether the shown version is a manual change of a source event. */
  overridden: boolean;
}

export interface EventPatch {
  kind?: EventKind;
  title?: string;
  course?: string | null;
  startsAt?: Date;
  endsAt?: Date | null;
  allDay?: boolean;
  location?: string | null;
  url?: string | null;
  details?: string | null;
}

const EXAM = /\b(TE\s?\d*|examen|test écrit|travail écrit|contrôle continu|CC\s?\d+|épreuve)\b/i;

/** `PRG-D-L1` → PRG; anything else is kept as is. */
export function courseOfSummary(summary: string): string {
  const parts = summary.split("-");
  return parts.length >= 3 && /^[A-Z]\d+$/.test(parts.at(-1) ?? "") ? parts[0] : summary;
}

const isAllDay = (lesson: Lesson) => /T00:00:00/.test(lesson.start) && /T00:00:00/.test(lesson.end) && Date.parse(lesson.end) - Date.parse(lesson.start) >= 86_400_000;

/** GAPS lessons as calendar events, keyed so that a lesson keeps its key when its room changes. */
export function lessonsToEvents(lessons: Lesson[]): (EventInput & { key: string })[] {
  return lessons.map((lesson) => ({
    key: `gaps:${lesson.summary}|${lesson.start}`,
    kind: EXAM.test(`${lesson.summary} ${lesson.description}`) ? "exam" : "lesson",
    title: lesson.summary,
    course: courseOfSummary(lesson.summary),
    startsAt: new Date(lesson.start),
    endsAt: new Date(lesson.end),
    allDay: isAllDay(lesson),
    location: lesson.location || undefined,
    details: lesson.description || undefined,
  }));
}

/** Cyberlearn deadlines as calendar events (course codes aligned on the timetable's). */
export function deadlinesToEvents(deadlines: Deadline[], scheduleCodes: string[]): (EventInput & { key: string })[] {
  return deadlines.map((d) => ({
    key: `cyberlearn:${d.id}`,
    kind: EXAM.test(d.name) || d.module === "quiz" && /not[ée]/i.test(d.name) ? "exam" : "deadline",
    title: d.name,
    course: courseLabel(d.courseShortName || d.course, scheduleCodes),
    startsAt: new Date(d.due),
    url: d.url,
    details: [d.module, d.action].filter(Boolean).join(" · ") || undefined,
  }));
}

interface Row {
  key: string;
  source: EventSource;
  kind: EventKind;
  title: string;
  course: string | null;
  starts_at: Date;
  ends_at: Date | null;
  all_day: boolean;
  location: string | null;
  url: string | null;
  details: string | null;
  deleted: boolean;
  fetched_at: Date;
  author: Author;
  overridden?: boolean;
}

function fromRow(r: Row): CalendarEvent {
  return {
    key: r.key,
    source: r.source,
    kind: r.kind,
    title: r.title,
    course: r.course ?? undefined,
    startsAt: r.starts_at,
    endsAt: r.ends_at ?? undefined,
    allDay: r.all_day,
    location: r.location ?? undefined,
    url: r.url ?? undefined,
    details: r.details ?? undefined,
    deleted: r.deleted,
    fetchedAt: r.fetched_at,
    author: r.author,
    overridden: r.overridden ?? (r.source === "manual" && !r.key.startsWith("manual:")),
  };
}

const sameState = (a: Row, b: EventInput & { deleted?: boolean }) =>
  !a.deleted === !b.deleted &&
  a.kind === b.kind &&
  a.title === b.title &&
  (a.course ?? null) === (b.course ?? null) &&
  a.starts_at.getTime() === b.startsAt.getTime() &&
  (a.ends_at?.getTime() ?? null) === (b.endsAt?.getTime() ?? null) &&
  a.all_day === Boolean(b.allDay) &&
  (a.location ?? null) === (b.location ?? null) &&
  (a.url ?? null) === (b.url ?? null) &&
  (a.details ?? null) === (b.details ?? null);

async function insert(db: Db, key: string, source: EventSource, event: EventInput, author: Author, deleted = false): Promise<void> {
  await db.query(
    `INSERT INTO calendar_versions (key, source, kind, title, course, starts_at, ends_at, all_day, location, url, details, deleted, author)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [key, source, event.kind, event.title, event.course ?? null, event.startsAt, event.endsAt ?? null, Boolean(event.allDay), event.location ?? null, event.url ?? null, event.details ?? null, deleted, author],
  );
}

/** Latest row per key, optionally only of one source. */
const LATEST = (sourceFilter: string) => `
  SELECT DISTINCT ON (key) * FROM calendar_versions
  WHERE ${sourceFilter}
  ORDER BY key, fetched_at DESC, id DESC`;

export interface SyncResult {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}

/**
 * Records the state of a source's events: a new version for every new or changed event, a deleted version for every
 * event of the source that disappeared among those starting from `missingFrom` on (older ones are not re-fetched).
 */
export async function syncSourceEvents(db: Db, source: "gaps" | "cyberlearn", events: (EventInput & { key: string })[], missingFrom: Date): Promise<SyncResult> {
  const result: SyncResult = { added: 0, changed: 0, removed: 0, unchanged: 0 };
  const { rows } = await db.query<Row>(LATEST("source = $1"), [source]);
  const latest = new Map(rows.map((r) => [r.key, r]));
  const seen = new Set<string>();
  for (const event of events) {
    seen.add(event.key);
    const known = latest.get(event.key);
    if (!known) {
      result.added++;
      await insert(db, event.key, source, event, "sync");
    } else if (!sameState(known, event)) {
      result.changed++;
      await insert(db, event.key, source, event, "sync");
    } else {
      result.unchanged++;
    }
  }
  for (const known of rows) {
    if (seen.has(known.key) || known.deleted || known.starts_at < missingFrom) continue;
    result.removed++;
    await insert(db, known.key, source, fromRow(known), "sync", true);
  }
  return result;
}

/** The events shown between two instants: the latest version of each key, not deleted. */
export async function listEvents(db: Db, from: Date, to: Date, options: { kinds?: EventKind[]; course?: string } = {}): Promise<CalendarEvent[]> {
  const { rows } = await db.query<Row>(
    `WITH latest AS (${LATEST("true")})
     SELECT * FROM latest
     WHERE NOT deleted AND starts_at < $2 AND coalesce(ends_at, starts_at) >= $1
       AND ($3::text[] IS NULL OR kind = ANY ($3))
       AND ($4::text IS NULL OR lower(course) = lower($4))
     ORDER BY starts_at, key`,
    [from, to, options.kinds ?? null, options.course ?? null],
  );
  return rows.map(fromRow);
}

export async function getEvent(db: Db, key: string): Promise<CalendarEvent | undefined> {
  const { rows } = await db.query<Row>(`${LATEST("key = $1")}`, [key]);
  return rows[0] ? fromRow(rows[0]) : undefined;
}

/** Every version of an event, most recent first. */
export async function eventHistory(db: Db, key: string): Promise<CalendarEvent[]> {
  const { rows } = await db.query<Row>("SELECT * FROM calendar_versions WHERE key = $1 ORDER BY fetched_at DESC, id DESC", [key]);
  return rows.map(fromRow);
}

/** Adds an event of the user's own. */
export async function addEvent(db: Db, event: EventInput, author: Author): Promise<CalendarEvent> {
  const key = `manual:${randomUUID()}`;
  await insert(db, key, "manual", event, author);
  return (await getEvent(db, key))!;
}

/** Changes an event (from a source or manual): a new manual version, which the source can later supersede. */
export async function updateEvent(db: Db, key: string, patch: EventPatch, author: Author): Promise<CalendarEvent> {
  const current = await getEvent(db, key);
  if (!current || current.deleted) throw new Error(`No event ${key}`);
  const next: EventInput = {
    kind: patch.kind ?? current.kind,
    title: patch.title ?? current.title,
    course: patch.course === null ? undefined : (patch.course ?? current.course),
    startsAt: patch.startsAt ?? current.startsAt,
    endsAt: patch.endsAt === null ? undefined : (patch.endsAt ?? current.endsAt),
    allDay: patch.allDay ?? current.allDay,
    location: patch.location === null ? undefined : (patch.location ?? current.location),
    url: patch.url === null ? undefined : (patch.url ?? current.url),
    details: patch.details === null ? undefined : (patch.details ?? current.details),
  };
  if (next.endsAt && next.endsAt < next.startsAt) throw new Error("The event ends before it starts");
  await insert(db, key, "manual", next, author);
  return (await getEvent(db, key))!;
}

/** Removes an event from the calendar (a deleted manual version; the source may bring it back if it changes). */
export async function removeEvent(db: Db, key: string, author: Author): Promise<void> {
  const current = await getEvent(db, key);
  if (!current || current.deleted) throw new Error(`No event ${key}`);
  await insert(db, key, "manual", current, author, true);
}

/** Forgets every manual change of a source event, so its source version shows again. */
export async function resetEvent(db: Db, key: string): Promise<CalendarEvent | undefined> {
  if (key.startsWith("manual:")) throw new Error("A manual event has no source version to go back to");
  await db.query("DELETE FROM calendar_versions WHERE key = $1 AND source = 'manual'", [key]);
  return getEvent(db, key);
}

/** Keys whose shown version is a manual change of a source event. */
export async function overriddenEvents(db: Db): Promise<CalendarEvent[]> {
  const { rows } = await db.query<Row>(`WITH latest AS (${LATEST("true")}) SELECT * FROM latest WHERE source = 'manual' AND key NOT LIKE 'manual:%' ORDER BY starts_at`);
  return rows.map(fromRow);
}

/** Dates as ISO strings, for JSON answers and the CLI. */
export function eventToJson(e: CalendarEvent) {
  return { ...e, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString(), fetchedAt: e.fetchedAt.toISOString() };
}
