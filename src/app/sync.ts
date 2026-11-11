/**
 * Keeps the server's copy of GAPS and Cyberlearn up to date (snapshots and calendar) for every account, and records
 * every run in `sync_runs` for the status page. One sync at a time: GAPS and Cyberlearn share an account's saved edu-ID
 * session, and the school's servers are not asked by several accounts at once.
 */
import { existsSync, statSync } from "node:fs";
import { MfaRequiredError } from "../auth/eduid.js";
import { CampusLocked } from "../campus.js";
import { type Identity, LOCAL_OWNER, currentIdentity, runAs } from "../identity.js";
import { findCourse } from "../courses.js";
import type { Course, Deadline } from "../cyberlearn/client.js";
import { fetchContinuousGrades, fetchTranscript } from "../gaps/grades.js";
import { fetchStudentRecord } from "../gaps/student.js";
import type { Lesson } from "../gaps/client.js";
import type { Db } from "../rag/db.js";
import { ensureEmbeddingModel } from "../rag/embed.js";
import { isDoclingAvailable, needsExtractor } from "../rag/extract.js";
import { ingestSource } from "../rag/ingest.js";
import { CyberlearnSource } from "../rag/sources/cyberlearn.js";
import { GitHubSource, readCourseRepos } from "../rag/sources/github.js";
import { campusFiles } from "../campus.js";
import { OVERDUE_WINDOW_DAYS, loginGaps, withCyberlearn } from "../services.js";
import { scheduleCourses } from "../table.js";
import { type SyncResult, deadlinesToEvents, lessonsToEvents, syncSourceEvents } from "./calendar.js";
import { type CourseContents, lessonNotes } from "./lessons.js";
import { latestSnapshot, saveSnapshot } from "./snapshots.js";

export type RunKind = "gaps" | "cyberlearn" | "ingest-check" | "github";
export const RUN_KINDS: RunKind[] = ["gaps", "cyberlearn", "ingest-check", "github"];

/** The advisory lock every ingestion takes, here and in `npm run ingest`: one at a time on the same database. */
const INGEST_LOCK = 7310;

/** The kinds that fetch one account's own data; the others are about the shared course material. */
const PERSONAL: RunKind[] = ["gaps", "cyberlearn"];

export interface SyncAccounts {
  /** The accounts to sync in the background: those whose edu-ID session is known to work. */
  list(): Promise<Identity[]>;
  /** The edu-ID session of an account works, or has ended and needs the person. */
  report?(identity: Identity, state: "ok" | "expired"): Promise<void>;
}

/** A single-user installation: the local owner. */
const LOCAL_ACCOUNTS: SyncAccounts = { list: async () => [LOCAL_OWNER] };

export interface SyncRun {
  id: number;
  kind: RunKind;
  /** The account whose data was fetched; undefined for the shared runs. */
  userId?: number;
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
    private readonly accounts: SyncAccounts = LOCAL_ACCOUNTS,
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

  /**
   * GAPS then Cyberlearn for every account, then the ingestion check and the GitHub repositories; a run already going
   * on is awaited instead.
   */
  runAll(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const accounts = await this.accounts.list();
        for (const account of accounts) {
          await runAs(account, async () => {
            await this.run("gaps", () => this.gaps());
            await this.run("cyberlearn", () => this.cyberlearn());
          });
        }
        // The shared material is compared with what one account sees on Cyberlearn: the first administrator's.
        const reader = accounts.find((a) => a.role === "admin") ?? accounts[0];
        if (reader) await runAs(reader, () => this.run("ingest-check", () => this.ingestCheck()));
        await this.run("github", () => this.github());
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  /** One kind only, for the account of the current request (the status page, a refresh of the calendar). */
  async runOne(kind: RunKind, mfaCode?: string): Promise<SyncRun> {
    while (this.running) await this.running;
    const works: Record<RunKind, () => Promise<Record<string, unknown>>> = {
      gaps: () => this.gaps(mfaCode),
      cyberlearn: () => this.cyberlearn(mfaCode),
      "ingest-check": () => this.ingestCheck(),
      github: () => this.github(),
    };
    const work = works[kind];
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
    const account = currentIdentity();
    const userId = PERSONAL.includes(kind) ? account?.id : undefined;
    const { rows } = await this.db.system.query<{ id: string; started_at: Date }>("INSERT INTO sync_runs (kind, user_id) VALUES ($1, $2) RETURNING id, started_at", [kind, userId ?? null]);
    const id = Number(rows[0].id);
    let ok = false;
    let message: string | undefined;
    let stats: Record<string, unknown> | undefined;
    try {
      stats = await work();
      ok = true;
      if (kind === "gaps" && account) await this.accounts.report?.(account, "ok");
    } catch (error) {
      if (error instanceof MfaRequiredError) {
        message = new NeedsLoginCode(error.invalidCode).message;
        stats = { needsCode: true };
      } else {
        message = error instanceof Error ? error.message : String(error);
      }
      // The session ended and nobody is there to log in again: the account is asked to come back.
      if (account && PERSONAL.includes(kind) && (error instanceof MfaRequiredError || error instanceof CampusLocked)) await this.accounts.report?.(account, "expired");
      this.log(`Sync ${kind}${userId ? ` (account ${userId})` : ""} failed: ${message}`);
    }
    await this.db.system.query("UPDATE sync_runs SET finished_at = now(), ok = $2, message = $3, stats = $4 WHERE id = $1", [id, ok, message ?? null, stats ? JSON.stringify(stats) : null]);
    return { id, kind, userId, startedAt: rows[0].started_at, finishedAt: new Date(), ok, message, stats };
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

  /**
   * Fetches the course repositories of data/github-repos.json and indexes what changed, here on the server: git reads
   * them with HEIG_GITHUB_TOKEN. Documents that need the extraction service wait for it when it is off (the daily
   * `npm run ingest` on the machine starts it); code, Markdown and text are indexed right away.
   */
  private async github(): Promise<Record<string, unknown>> {
    const repos = await readCourseRepos();
    const lock = await this.db.connect();
    try {
      if (!(await lock.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(${INGEST_LOCK}) AS ok`)).rows[0].ok) throw new Error("Another ingestion is already running");
      try {
        const source = new GitHubSource(repos, undefined, this.log);
        const documents = await source.list();
        if (repos.length > 0 && source.failed.length === repos.length) {
          const [label, reason] = [...source.errors.entries()][0];
          throw new Error(`could not fetch ${source.failed.join(", ")} (${label}: ${reason}); check the addresses and HEIG_GITHUB_TOKEN`);
        }
        const extractor = await isDoclingAvailable();
        if (documents.length > 0) await ensureEmbeddingModel();
        const stats = await ingestSource(this.db, "github", documents, {
          // A repository that could not be fetched lists nothing: its documents must not be removed for that.
          removalScope: source.failed.length > 0 ? [] : "all",
          skip: extractor ? undefined : (doc) => (needsExtractor(doc.filename) ? "the extraction service is off" : undefined),
          log: this.log,
        });
        return { repos: repos.length, ...stats, unreachable: source.failed, extractor };
      } finally {
        await lock.query(`SELECT pg_advisory_unlock(${INGEST_LOCK})`);
      }
    } finally {
      lock.release();
    }
  }
}

/** Last run of each kind: the shared ones, and those of the current account. */
export async function lastRuns(db: Db): Promise<SyncRun[]> {
  const { rows } = await db.system.query("SELECT DISTINCT ON (kind) * FROM sync_runs WHERE user_id IS NULL OR user_id = $1 ORDER BY kind, started_at DESC", [currentIdentity()?.id ?? null]);
  return rows.map(toRun);
}

/** When each kind last succeeded, for the shared runs and those of the current account. */
export async function lastOkRuns(db: Db): Promise<Record<string, Date>> {
  const { rows } = await db.system.query("SELECT kind, max(finished_at) AS at FROM sync_runs WHERE ok AND (user_id IS NULL OR user_id = $1) GROUP BY kind", [currentIdentity()?.id ?? null]);
  return Object.fromEntries(rows.map((r) => [r.kind, r.at]));
}

/** The most recent runs of every account (administrators). */
export async function recentRuns(db: Db, limit = 30): Promise<SyncRun[]> {
  const { rows } = await db.system.query("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT $1", [limit]);
  return rows.map(toRun);
}

function toRun(r: Record<string, unknown>): SyncRun {
  return {
    id: Number(r.id),
    kind: r.kind as RunKind,
    userId: r.user_id === null || r.user_id === undefined ? undefined : Number(r.user_id),
    startedAt: r.started_at as Date,
    finishedAt: (r.finished_at as Date | null) ?? undefined,
    ok: (r.ok as boolean | null) ?? undefined,
    message: (r.message as string | null) ?? undefined,
    stats: (r.stats as Record<string, unknown> | null) ?? undefined,
  };
}

/** State of the saved edu-ID login of the current account, read from its cache files. */
export function sessionState(): { sessionSavedAt?: Date; cyberlearnToken: boolean; pendingCode: boolean } {
  const files = campusFiles();
  const mtime = (file: string) => (existsSync(file) ? statSync(file).mtime : undefined);
  return { sessionSavedAt: mtime(files.session), cyberlearnToken: existsSync(files.cyberlearnToken), pendingCode: existsSync(files.pendingMfa) };
}

export type { Course, Deadline };
