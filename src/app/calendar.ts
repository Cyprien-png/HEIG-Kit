/**
 * The calendar: lessons from GAPS, deadlines from Cyberlearn, exams and events added by hand, spread over calendars
 * (layers) the user shows or hides. Every state of every event is kept (`calendar_versions`); the version shown is
 * the most recent one, so a manual change wins until the source changes again after it (docs/app.md).
 */
import { randomUUID } from "node:crypto";
import type { Deadline } from "../cyberlearn/client.js";
import { isoDate } from "../dates.js";
import { courseLabel } from "../deadlines.js";
import type { Lesson } from "../gaps/client.js";
import type { Db } from "../rag/db.js";

export type EventKind = "lesson" | "deadline" | "exam" | "event";
export type EventSource = "gaps" | "cyberlearn" | "manual";
export type Author = "sync" | "user" | "agent";

/** The calendars every installation has; the sources feed them, they cannot be deleted. */
export type BuiltinCalendar = "schedule" | "exams" | "deadlines";
export const BUILTIN_CALENDARS: BuiltinCalendar[] = ["schedule", "exams", "deadlines"];

export interface Calendar {
  id: number;
  /** Set for the built-in calendars only. */
  slug?: BuiltinCalendar;
  name: string;
  color: string;
  description?: string;
  visible: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarInput {
  name: string;
  color?: string;
  description?: string;
}

export interface CalendarPatch {
  name?: string;
  color?: string;
  description?: string | null;
  visible?: boolean;
  position?: number;
}

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
  /** Default: the built-in calendar of the kind (exams, deadlines, or the schedule). */
  calendarId?: number;
}

export interface CalendarEvent extends EventInput {
  key: string;
  calendarId: number;
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
  calendarId?: number;
}

const EXAM = /\b(TE\s?\d*|examen|test écrit|travail écrit|contrôle continu|CC\s?\d+|épreuve)\b/i;
/** An exam announced in the Cyberlearn planning of a lesson ("Évaluation sur les chapitres 1 à 3"). */
const ANNOUNCED_EXAM = /(^|[\s:])(évaluation|evaluation|examen|travail écrit|test écrit|TE\s?\d*)($|[\s:,.!])/i;

/** Colors offered for new calendars, readable in both themes. */
export const CALENDAR_COLORS = ["#7c3aed", "#0d9488", "#db2777", "#4f46e5", "#ea580c", "#0891b2", "#65a30d", "#9333ea", "#be185d", "#0284c7"];

/** `PRG-D-L1` → PRG; anything else is kept as is. */
export function courseOfSummary(summary: string): string {
  const parts = summary.split("-");
  return parts.length >= 3 && /^[A-Z]\d+$/.test(parts.at(-1) ?? "") ? parts[0] : summary;
}

const isAllDay = (lesson: Lesson) => /T00:00:00/.test(lesson.start) && /T00:00:00/.test(lesson.end) && Date.parse(lesson.end) - Date.parse(lesson.start) >= 86_400_000;

/** What the course page says about a lesson day (the Cyberlearn planning), by course code and local day. */
export type LessonNotes = (course: string, day: string) => string | undefined;

/**
 * GAPS lessons as calendar events, keyed so that a lesson keeps its key when its room changes. With `notes`, each
 * lesson carries the programme announced on Cyberlearn for its day, and a lesson announced as an evaluation becomes
 * an exam named after the announcement.
 */
export function lessonsToEvents(lessons: Lesson[], notes?: LessonNotes): (EventInput & { key: string })[] {
  return lessons.map((lesson) => {
    const course = courseOfSummary(lesson.summary);
    const note = notes?.(course, isoDate(new Date(lesson.start)));
    const announced = note?.split("\n").find((line) => ANNOUNCED_EXAM.test(line));
    const exam = EXAM.test(`${lesson.summary} ${lesson.description}`) || announced !== undefined;
    return {
      key: `gaps:${lesson.summary}|${lesson.start}`,
      kind: exam ? "exam" : "lesson",
      title: announced ? `${announced.replace(/^[-•*]\s*/, "")} (${lesson.summary})` : lesson.summary,
      course,
      startsAt: new Date(lesson.start),
      endsAt: new Date(lesson.end),
      allDay: isAllDay(lesson),
      location: lesson.location || undefined,
      details: [lesson.description, note].filter(Boolean).join("\n\n") || undefined,
    };
  });
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

// Calendars

interface CalendarRow {
  id: number;
  slug: string | null;
  name: string;
  color: string;
  description: string | null;
  visible: boolean;
  position: number;
  created_at: Date;
  updated_at: Date;
}

const calendarFromRow = (r: CalendarRow): Calendar => ({
  id: r.id,
  slug: (r.slug as BuiltinCalendar | null) ?? undefined,
  name: r.name,
  color: r.color,
  description: r.description ?? undefined,
  visible: r.visible,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listCalendars(db: Db): Promise<Calendar[]> {
  const { rows } = await db.query<CalendarRow>("SELECT * FROM calendars ORDER BY position, id");
  return rows.map(calendarFromRow);
}

/** A calendar by id, built-in slug, or name (case-insensitive). */
export async function findCalendar(db: Db, ref: number | string): Promise<Calendar | undefined> {
  const text = String(ref).trim();
  const { rows } = await db.query<CalendarRow>(
    `SELECT * FROM calendars WHERE ($1::int IS NOT NULL AND id = $1) OR slug = $2 OR lower(name) = lower($2) ORDER BY id LIMIT 1`,
    [/^\d+$/.test(text) ? Number(text) : null, text],
  );
  return rows[0] ? calendarFromRow(rows[0]) : undefined;
}

const COLOR = /^#[0-9a-f]{6}$/i;

function checkColor(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  if (!COLOR.test(color)) throw new Error("color must be #rrggbb");
  return color.toLowerCase();
}

function checkName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw new Error("name must be 1 to 80 characters");
  return trimmed;
}

export async function createCalendar(db: Db, input: CalendarInput): Promise<Calendar> {
  const { rows: existing } = await db.query<{ n: string }>("SELECT count(*) AS n FROM calendars");
  const color = checkColor(input.color) ?? CALENDAR_COLORS[Number(existing[0].n) % CALENDAR_COLORS.length];
  const { rows } = await db.query<CalendarRow>(
    "INSERT INTO calendars (name, color, description, position) VALUES ($1, $2, $3, (SELECT coalesce(max(position), 0) + 1 FROM calendars)) RETURNING *",
    [checkName(input.name), color, input.description?.trim() || null],
  );
  return calendarFromRow(rows[0]);
}

export async function updateCalendar(db: Db, id: number, patch: CalendarPatch): Promise<Calendar> {
  const { rows } = await db.query<CalendarRow>(
    `UPDATE calendars SET
       name = coalesce($2, name), color = coalesce($3, color),
       description = CASE WHEN $4 THEN NULL ELSE coalesce($5, description) END,
       visible = coalesce($6, visible), position = coalesce($7, position), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, patch.name === undefined ? null : checkName(patch.name), checkColor(patch.color) ?? null, patch.description === null, patch.description?.trim() || null, patch.visible ?? null, patch.position ?? null],
  );
  if (!rows[0]) throw new Error(`No calendar ${id}`);
  return calendarFromRow(rows[0]);
}

/** Deletes one of the user's calendars with every version of its events (the built-in ones cannot be deleted). */
export async function deleteCalendar(db: Db, id: number): Promise<void> {
  const { rows } = await db.query<CalendarRow>("SELECT * FROM calendars WHERE id = $1", [id]);
  if (!rows[0]) throw new Error(`No calendar ${id}`);
  if (rows[0].slug) throw new Error(`The ${rows[0].name} calendar is built in and cannot be deleted; hide it instead`);
  await db.query("DELETE FROM calendars WHERE id = $1", [id]);
}

/** The built-in calendar an event of a kind goes to unless one is chosen. */
export const defaultCalendarOf = (kind: EventKind): BuiltinCalendar => (kind === "exam" ? "exams" : kind === "deadline" ? "deadlines" : "schedule");

async function builtinIds(db: Db): Promise<Record<BuiltinCalendar, number>> {
  const { rows } = await db.query<{ id: number; slug: BuiltinCalendar }>("SELECT id, slug FROM calendars WHERE slug IS NOT NULL");
  return Object.fromEntries(rows.map((r) => [r.slug, r.id])) as Record<BuiltinCalendar, number>;
}

async function resolveCalendarId(db: Db, event: EventInput): Promise<number> {
  if (event.calendarId !== undefined) {
    const { rows } = await db.query("SELECT 1 FROM calendars WHERE id = $1", [event.calendarId]);
    if (rows.length === 0) throw new Error(`No calendar ${event.calendarId}`);
    return event.calendarId;
  }
  return (await builtinIds(db))[defaultCalendarOf(event.kind)];
}

// Events

interface Row {
  key: string;
  calendar_id: number;
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
}

function fromRow(r: Row): CalendarEvent {
  return {
    key: r.key,
    calendarId: r.calendar_id,
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
    overridden: r.source === "manual" && !r.key.startsWith("manual:"),
  };
}

const sameState = (a: Row, b: EventInput & { deleted?: boolean; calendarId: number }) =>
  !a.deleted === !b.deleted &&
  a.calendar_id === b.calendarId &&
  a.kind === b.kind &&
  a.title === b.title &&
  (a.course ?? null) === (b.course ?? null) &&
  a.starts_at.getTime() === b.startsAt.getTime() &&
  (a.ends_at?.getTime() ?? null) === (b.endsAt?.getTime() ?? null) &&
  a.all_day === Boolean(b.allDay) &&
  (a.location ?? null) === (b.location ?? null) &&
  (a.url ?? null) === (b.url ?? null) &&
  (a.details ?? null) === (b.details ?? null);

async function insert(db: Db, key: string, source: EventSource, event: EventInput & { calendarId: number }, author: Author, deleted = false): Promise<void> {
  await db.query(
    `INSERT INTO calendar_versions (key, calendar_id, source, kind, title, course, starts_at, ends_at, all_day, location, url, details, deleted, author)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [key, event.calendarId, source, event.kind, event.title, event.course ?? null, event.startsAt, event.endsAt ?? null, Boolean(event.allDay), event.location ?? null, event.url ?? null, event.details ?? null, deleted, author],
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
 * Source events go to the built-in calendar of their kind.
 */
export async function syncSourceEvents(db: Db, source: "gaps" | "cyberlearn", events: (EventInput & { key: string })[], missingFrom: Date): Promise<SyncResult> {
  const result: SyncResult = { added: 0, changed: 0, removed: 0, unchanged: 0 };
  const builtin = await builtinIds(db);
  const { rows } = await db.query<Row>(LATEST("source = $1"), [source]);
  const latest = new Map(rows.map((r) => [r.key, r]));
  const seen = new Set<string>();
  for (const input of events) {
    seen.add(input.key);
    const event = { ...input, calendarId: builtin[defaultCalendarOf(input.kind)] };
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

export interface ListOptions {
  kinds?: EventKind[];
  course?: string;
  /** Only these calendars (ids). */
  calendars?: number[];
  /** Only the calendars shown (`visible`). */
  visibleOnly?: boolean;
}

/** The events shown between two instants: the latest version of each key, not deleted. */
export async function listEvents(db: Db, from: Date, to: Date, options: ListOptions = {}): Promise<CalendarEvent[]> {
  const { rows } = await db.query<Row>(
    `WITH latest AS (${LATEST("true")})
     SELECT latest.* FROM latest JOIN calendars c ON c.id = latest.calendar_id
     WHERE NOT deleted AND starts_at < $2 AND coalesce(ends_at, starts_at) >= $1
       AND ($3::text[] IS NULL OR kind = ANY ($3))
       AND ($4::text IS NULL OR lower(course) = lower($4))
       AND ($5::int[] IS NULL OR calendar_id = ANY ($5))
       AND (NOT $6 OR c.visible)
     ORDER BY starts_at, key`,
    [from, to, options.kinds ?? null, options.course ?? null, options.calendars ?? null, Boolean(options.visibleOnly)],
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
  if (event.endsAt && event.endsAt < event.startsAt) throw new Error("The event ends before it starts");
  const key = `manual:${randomUUID()}`;
  await insert(db, key, "manual", { ...event, calendarId: await resolveCalendarId(db, event) }, author);
  return (await getEvent(db, key))!;
}

/** Changes an event (from a source or manual): a new manual version, which the source can later supersede. */
export async function updateEvent(db: Db, key: string, patch: EventPatch, author: Author): Promise<CalendarEvent> {
  const current = await getEvent(db, key);
  if (!current || current.deleted) throw new Error(`No event ${key}`);
  const next: EventInput & { calendarId: number } = {
    kind: patch.kind ?? current.kind,
    title: patch.title ?? current.title,
    course: patch.course === null ? undefined : (patch.course ?? current.course),
    startsAt: patch.startsAt ?? current.startsAt,
    endsAt: patch.endsAt === null ? undefined : (patch.endsAt ?? current.endsAt),
    allDay: patch.allDay ?? current.allDay,
    location: patch.location === null ? undefined : (patch.location ?? current.location),
    url: patch.url === null ? undefined : (patch.url ?? current.url),
    details: patch.details === null ? undefined : (patch.details ?? current.details),
    calendarId: patch.calendarId === undefined ? current.calendarId : await resolveCalendarId(db, { ...current, calendarId: patch.calendarId }),
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

export function calendarToJson(c: Calendar) {
  return { ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}
