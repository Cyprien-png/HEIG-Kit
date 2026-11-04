/**
 * Keeps the server's copy of GAPS and Cyberlearn up to date (snapshots and calendar), and records every run in
 * `sync_runs` for the status page. One sync at a time: GAPS and Cyberlearn share the saved edu-ID session.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { MfaRequiredError } from "../auth/eduid.js";
import { findCourse } from "../courses.js";
import type { Course, Deadline } from "../cyberlearn/client.js";
import { fetchContinuousGrades, fetchTranscript } from "../gaps/grades.js";
import { fetchStudentRecord } from "../gaps/student.js";
import type { Lesson } from "../gaps/client.js";
import type { Db } from "../rag/db.js";
import { CyberlearnSource } from "../rag/sources/cyberlearn.js";
import { CYBERLEARN_TOKEN_FILE, OVERDUE_WINDOW_DAYS, PENDING_MFA_FILE, SESSION_FILE, loginGaps, withCyberlearn } from "../services.js";
import { scheduleCourses } from "../table.js";
import { type SyncResult, deadlinesToEvents, lessonsToEvents, syncSourceEvents } from "./calendar.js";
import { type CourseContents, lessonNotes } from "./lessons.js";
import { latestSnapshot, saveSnapshot } from "./snapshots.js";

export type RunKind = "gaps" | "cyberlearn" | "ingest-check";

export interface SyncRun {
  id: number;
  kind: RunKind;
  startedAt: Date;
  finishedAt?: Date;
  ok?: boolean;
  message?: string;
  stats?: Record<string, unknown>;
}

/** Documents changed on Cyberlearn and not indexed yet. */
export interface IngestCheck {
  checkedAt: Date;
  added: number;
  changed: number;
  removed: number;
  indexed: number;
  courses: string[];
  examples: string[];
}

export class NeedsLoginCode extends Error {
  constructor(invalidCode: boolean) {
    super(invalidCode ? "edu-ID rejected the two-step login code" : "edu-ID asks for a two-step login code");
  }
}

function listSetting(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

export class Syncer {
  private running?: Promise<void>;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Db,
    private readonly intervalMinutes = 60,
    private readonly log: (line: string) => void = (line) => console.error(line),
  ) {}

  /** Syncs now, then every `intervalMinutes`. */
  start(): void {
    if (this.timer) return;
    void this.runAll();
    this.timer = setInterval(() => void this.runAll(), this.intervalMinutes * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get busy(): boolean {
    return this.running !== undefined;
  }

  /** GAPS, then Cyberlearn, then the ingestion check; a run already going on is awaited instead. */
  runAll(mfaCode?: string): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        await this.run("gaps", () => this.gaps(mfaCode));
        await this.run("cyberlearn", () => this.cyberlearn(mfaCode));
        await this.run("ingest-check", () => this.ingestCheck());
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  /** One kind only, from the status page. */
  async runOne(kind: RunKind, mfaCode?: string): Promise<SyncRun> {
    if (this.running) await this.running;
    const work = kind === "gaps" ? () => this.gaps(mfaCode) : kind === "cyberlearn" ? () => this.cyberlearn(mfaCode) : () => this.ingestCheck();
    let result!: SyncRun;
    this.running = this.run(kind, work).then((run) => {
      result = run;
    });
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
    return result;
  }

  private async run(kind: RunKind, work: () => Promise<Record<string, unknown>>): Promise<SyncRun> {
    const { rows } = await this.db.query<{ id: string; started_at: Date }>("INSERT INTO sync_runs (kind) VALUES ($1) RETURNING id, started_at", [kind]);
    const id = Number(rows[0].id);
    let ok = false;
    let message: string | undefined;
    let stats: Record<string, unknown> | undefined;
    try {
      stats = await work();
      ok = true;
    } catch (error) {
      if (error instanceof MfaRequiredError) {
        message = new NeedsLoginCode(error.invalidCode).message;
        stats = { needsCode: true };
      } else {
        message = error instanceof Error ? error.message : String(error);
      }
      this.log(`Sync ${kind} failed: ${message}`);
    }
    await this.db.query("UPDATE sync_runs SET finished_at = now(), ok = $2, message = $3, stats = $4 WHERE id = $1", [id, ok, message ?? null, stats ? JSON.stringify(stats) : null]);
    return { id, kind, startedAt: rows[0].started_at, finishedAt: new Date(), ok, message, stats };
  }

  private async gaps(mfaCode?: string): Promise<Record<string, unknown>> {
    const gaps = await loginGaps(false, mfaCode);
    const lessons = await gaps.fetchSchedule();
    const schedule = await saveSnapshot(this.db, "schedule", lessons);
    const calendar = await this.scheduleEvents(lessons);
    const grades = await saveSnapshot(this.db, "grades", await fetchContinuousGrades(gaps));
    const transcript = await saveSnapshot(this.db, "transcript", await fetchTranscript(gaps));
    const record = await fetchStudentRecord(gaps);
    const plan = await saveSnapshot(this.db, "plan", record.plan);
    const absences = await saveSnapshot(this.db, "absences", record.absences);
    return { lessons: lessons.length, calendar, changed: { schedule: schedule.changed, grades: grades.changed, transcript: transcript.changed, plan: plan.changed, absences: absences.changed } };
  }

  /** The GAPS lessons as events, each with the programme its course page announces for that day. */
  private async scheduleEvents(lessons: Lesson[]): Promise<SyncResult> {
    const contents = (await latestSnapshot<CourseContents>(this.db, "contents"))?.data ?? {};
    return syncSourceEvents(this.db, "gaps", lessonsToEvents(lessons, lessonNotes(contents)), new Date(0));
  }

  private async cyberlearn(mfaCode?: string): Promise<Record<string, unknown>> {
    const from = new Date(Date.now() - OVERDUE_WINDOW_DAYS * 86_400_000);
    const lessons = (await latestSnapshot<Lesson[]>(this.db, "schedule"))?.data ?? [];
    const scheduleCodes = scheduleCourses(lessons);
    const { courses, deadlines, contents } = await withCyberlearn(false, mfaCode, async (client) => {
      const courses = await client.courses();
      const contents: CourseContents = {};
      for (const code of scheduleCodes) {
        const course = findCourse(courses, code, scheduleCodes);
        if (course) contents[code] = await client.courseContents(course.id);
      }
      return { courses, deadlines: await client.deadlines(from), contents };
    });
    const savedCourses = await saveSnapshot(this.db, "courses", courses);
    const savedContents = await saveSnapshot(this.db, "contents", contents);
    const savedDeadlines = await saveSnapshot(this.db, "deadlines", deadlines);
    const calendar = await syncSourceEvents(this.db, "cyberlearn", deadlinesToEvents(deadlines, scheduleCodes), from);
    // The course pages announce the programme or an evaluation of a lesson: refresh the lessons from the saved schedule.
    const schedule = lessons.length > 0 ? await this.scheduleEvents(lessons) : undefined;
    return { courses: courses.length, deadlines: deadlines.length, calendar, schedule, changed: { courses: savedCourses.changed, contents: savedContents.changed, deadlines: savedDeadlines.changed } };
  }

  /** Lists Cyberlearn like an ingestion would and compares with the index, without downloading anything. */
  private async ingestCheck(): Promise<Record<string, unknown>> {
    const scheduleCodes = scheduleCourses((await latestSnapshot<Lesson[]>(this.db, "schedule"))?.data ?? []);
    const selection = { extra: listSetting("RAG_EXTRA_COURSES"), exclude: listSetting("RAG_EXCLUDE_COURSES") };
    const { documents, selected } = await withCyberlearn(false, undefined, async (client) => {
      const source = new CyberlearnSource(client, scheduleCodes, selection);
      return { documents: await source.list(), selected: source.selectedCourses };
    });
    const { rows } = await this.db.query<{ external_id: string; version: string; course_code: string | null }>(
      "SELECT external_id, version, course_code FROM documents WHERE source = 'cyberlearn' AND removed_at IS NULL",
    );
    const indexed = new Map(rows.map((r) => [r.external_id, r]));
    const examples: string[] = [];
    let added = 0;
    let changed = 0;
    const listed = new Set<string>();
    for (const doc of documents) {
      listed.add(doc.externalId);
      const known = indexed.get(doc.externalId);
      if (!known) added++;
      else if (known.version !== doc.version) changed++;
      else continue;
      if (examples.length < 8) examples.push(`${doc.courseCode ?? "?"} · ${doc.title}`);
    }
    const removed = rows.filter((r) => !listed.has(r.external_id) && r.course_code && selected.includes(r.course_code)).length;
    const check: IngestCheck = { checkedAt: new Date(), added, changed, removed, indexed: rows.length, courses: selected, examples };
    return check as unknown as Record<string, unknown>;
  }
}

/** Last run of each kind. */
export async function lastRuns(db: Db): Promise<SyncRun[]> {
  const { rows } = await db.query("SELECT DISTINCT ON (kind) * FROM sync_runs ORDER BY kind, started_at DESC");
  return rows.map(toRun);
}

export async function recentRuns(db: Db, limit = 30): Promise<SyncRun[]> {
  const { rows } = await db.query("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT $1", [limit]);
  return rows.map(toRun);
}

function toRun(r: Record<string, unknown>): SyncRun {
  return {
    id: Number(r.id),
    kind: r.kind as RunKind,
    startedAt: r.started_at as Date,
    finishedAt: (r.finished_at as Date | null) ?? undefined,
    ok: (r.ok as boolean | null) ?? undefined,
    message: (r.message as string | null) ?? undefined,
    stats: (r.stats as Record<string, unknown> | null) ?? undefined,
  };
}

/** State of the saved edu-ID login, read from the cache files. */
export function sessionState(): { sessionSavedAt?: Date; cyberlearnToken: boolean; pendingCode: boolean } {
  const mtime = (file: string) => (existsSync(file) ? statSync(file).mtime : undefined);
  return { sessionSavedAt: mtime(SESSION_FILE), cyberlearnToken: existsSync(CYBERLEARN_TOKEN_FILE), pendingCode: existsSync(PENDING_MFA_FILE) };
}

export type { Course, Deadline };
export const CACHE_FILES = { session: path.basename(SESSION_FILE) };
