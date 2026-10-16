/**
 * What HEIG-Kit can do, shared by the command line (src/cli.ts) and the MCP server (src/mcp/host.ts): logins with
 * the saved session and two-step login codes, timetables, GAPS and Cyberlearn information, knowledge base queries.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { type Credentials, MfaRequiredError } from "./auth/eduid.js";
import { loadConfig } from "./config.js";
import { CyberlearnClient, InvalidTokenError } from "./cyberlearn/client.js";
import { TIME_ZONE, addDays, isoDate, startOfDay } from "./dates.js";
import { findCourse, renderCourse, renderCourseList } from "./courses.js";
import { type EntityType, ENTITY_TYPES, GapsClient, type Lesson } from "./gaps/client.js";
import { listEntities, searchEntities } from "./gaps/entities.js";
import { fetchContinuousGrades, fetchTranscript } from "./gaps/grades.js";
import { renderAbsences, renderEntities, renderGrades, renderPlan } from "./gaps/render.js";
import { fetchSheet } from "./gaps/sheets.js";
import { fetchStudentRecord } from "./gaps/student.js";
import { type Page, Session } from "./http.js";
import { CACHE_DIR } from "./paths.js";
import { openDb } from "./rag/db.js";
import {
  documentText,
  figureFile,
  findExercise,
  formatDocuments,
  formatResults,
  listCourses,
  listDocuments,
  search,
} from "./rag/search.js";
import type { ColorMode } from "./render.js";
import { renderWeekTable, scheduleCourses, startOfWeek } from "./table.js";

export const CACHE_FILE = `${CACHE_DIR}/schedule.json`;

export const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export const SESSION_FILE = `${CACHE_DIR}/session.json`;

/** edu-ID two-step login page of a login waiting for a code, resumed by `--mfa-code`. */
export const PENDING_MFA_FILE = `${CACHE_DIR}/mfa-pending.json`;

/** Cyberlearn mobile app token, valid until revoked: grants access to the account like a password. */
export const CYBERLEARN_TOKEN_FILE = `${CACHE_DIR}/cyberlearn-token.json`;

/** Overdue activities stay listed this long after their due date. */
export const OVERDUE_WINDOW_DAYS = 30;

export interface ScheduleCache {
  fetchedAt: string;
  lessons: Lesson[];
}

export async function loadSchedule(refresh: boolean, debug: boolean, mfaCode?: string): Promise<ScheduleCache> {
  if (!refresh && !mfaCode) {
    const cached = await readCache();
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) return cached;
  }

  const gaps = await loginGaps(debug, mfaCode);
  const cache = { fetchedAt: new Date().toISOString(), lessons: await gaps.fetchSchedule() };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  return cache;
}

export function loginGaps(debug: boolean, mfaCode?: string): Promise<GapsClient> {
  return withLogin(debug, mfaCode, async (session, creds, resumeFrom) => {
    const client = new GapsClient(session, loadConfig().gapsStudentId);
    await client.login(creds, resumeFrom);
    return client;
  });
}

/** Schedule of another student, a teacher (acronym), a room, a class or a course group, found by name. */
export async function loadOtherSchedule(query: string, type: string | undefined, debug: boolean, mfaCode?: string) {
  if (type && !(type in ENTITY_TYPES)) throw new Error(`Invalid --type "${type}", expected ${Object.keys(ENTITY_TYPES).join(", ")}`);
  const gaps = await loginGaps(debug, mfaCode);
  const matches = searchEntities(await listEntities(gaps), query, type as EntityType | undefined);
  if (matches.length === 0) throw new Error(`Nothing in GAPS matches "${query}". Teachers are listed by acronym (e.g. JHH).`);
  const exact = matches.filter((m) => m.name.toLowerCase() === query.toLowerCase());
  if (matches.length > 1 && exact.length !== 1) {
    throw new Error(`"${query}" matches several schedules, be more precise (or use --type):\n${renderEntities(matches.slice(0, 20))}`);
  }
  const entity = exact[0] ?? matches[0];
  const lessons = await gaps.fetchEntitySchedule(ENTITY_TYPES[entity.type], entity.id);
  return { entity, cache: { fetchedAt: new Date().toISOString(), lessons } };
}

/** GAPS information beyond the timetable: study plan, unit and module sheets, grades, absences, entity search. */
export async function gapsInfo(args: string[], options: { all: boolean; type?: string; debug: boolean; mfaCode?: string }): Promise<string> {
  const [action, ...rest] = args;
  const usage = "Usage: npm run gaps -- plan [--all] | unit <CODE> | module <CODE> | grades | absences | find <name> [--type …]";
  if (!action) throw new Error(usage);
  const gaps = await loginGaps(options.debug, options.mfaCode);
  switch (action) {
    case "plan": {
      const { plan } = await fetchStudentRecord(gaps);
      const current = `${new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1}`;
      const years = options.all ? undefined : [...new Set(plan.map((u) => u.year))].filter((y) => y.startsWith(current));
      return renderPlan(plan, years);
    }
    case "unit":
    case "module": {
      const code = rest[0];
      if (!code) throw new Error(usage);
      const { plan } = await fetchStudentRecord(gaps);
      const kind = action === "unit" ? "unit" : "module";
      const entry = plan.find((u) => u[kind].code.toLowerCase() === code.toLowerCase());
      if (!entry) {
        const codes = [...new Set(plan.map((u) => u[kind].code))].sort().join(", ");
        throw new Error(`No ${kind} "${code}" in your study plan. Known ${kind}s: ${codes}`);
      }
      return fetchSheet(gaps, entry[kind].sheet, `${entry[kind].name} (${entry[kind].code})`);
    }
    case "grades":
      return renderGrades(await fetchContinuousGrades(gaps), await fetchTranscript(gaps));
    case "absences":
      return renderAbsences((await fetchStudentRecord(gaps)).absences);
    case "find": {
      if (!rest[0]) throw new Error(usage);
      return renderEntities(searchEntities(await listEntities(gaps), rest.join(" "), options.type as EntityType | undefined));
    }
    default:
      throw new Error(usage);
  }
}

/** Pending Cyberlearn activities: overdue ones, then those due in the next `days` days (all if undefined). */
export async function loadDeadlines(days: number | undefined, debug: boolean, mfaCode?: string) {
  const from = new Date(Date.now() - OVERDUE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const to = days === undefined ? undefined : addDays(startOfDay(isoDate(new Date())), days + 1);

  return withCyberlearn(debug, mfaCode, (client) => client.deadlines(from, to));
}

/** The user's Cyberlearn courses, or one course rendered as text with its pages' content when `query` is given. */
export async function loadCourses(query: string | undefined, debug: boolean, mfaCode?: string): Promise<string> {
  const scheduleCodes = scheduleCourses((await readCache())?.lessons ?? []);
  return withCyberlearn(debug, mfaCode, async (client) => {
    const courses = await client.courses();
    if (!query) return renderCourseList(courses, scheduleCodes);

    const course = findCourse(courses, query, scheduleCodes);
    if (!course) throw new Error(`No Cyberlearn course matches "${query}". Courses:\n${renderCourseList(courses, scheduleCodes)}`);
    const sections = await client.courseContents(course.id);
    const pages = new Map<number, string>();
    for (const module of sections.flatMap((s) => s.modules).filter((m) => m.modname === "page")) {
      const index = module.contents?.find((f) => f.filename === "index.html");
      if (index) pages.set(module.id, new TextDecoder().decode(await client.downloadFile(index.fileurl)));
    }
    return renderCourse(course, sections, pages);
  });
}

/** Read-only access to the knowledge base, the same as the MCP server's tools (for skills and terminal use). */
export async function knowledgeBase(args: string[], course?: string, docType?: string, limit?: string, pages?: string): Promise<string> {
  const [action, ...rest] = args;
  const db = openDb();
  try {
    switch (action) {
      case "search":
        if (rest.length === 0) throw new Error("Usage: npm run kb -- search <query>");
        return formatResults(await search(db, rest.join(" "), { course, docType, limit: limit ? Number(limit) : undefined })) || "No matching material.";
      case "exercise":
        if (!rest[0]) throw new Error("Usage: npm run kb -- exercise <number>");
        return formatResults(await findExercise(db, course, rest[0])) || `Exercise ${rest[0]} not found.`;
      case "document": {
        const [from, to] = (pages ?? "").split("-").map((p) => (p ? Number(p) : undefined));
        const doc = await documentText(db, Number(rest[0]), from, to ?? from);
        if (!doc) return `Document ${rest[0]} not found.`;
        return `# ${doc.title}\n${[doc.course, doc.chapter, doc.docType].filter(Boolean).join(" · ")} · ${doc.pageCount} pages · ${doc.url ?? ""}\n\n${doc.text}`;
      }
      case "figure": {
        if (!rest[0] || !rest[1]) throw new Error("Usage: npm run kb -- figure <document-id> <number>");
        return (await figureFile(db, Number(rest[0]), Number(rest[1]))) ?? `Figure ${rest[1]} of document ${rest[0]} not found.`;
      }
      case "courses":
        return JSON.stringify(await listCourses(db), null, 2);
      case "documents":
        if (!rest[0]) throw new Error("Usage: npm run kb -- documents <course>");
        return formatDocuments(await listDocuments(db, rest[0], docType)) || `No documents for ${rest[0]}.`;
      default:
        throw new Error("Usage: npm run kb -- search|exercise|document|figure|courses|documents …");
    }
  } catch (error) {
    if (error instanceof Error && /ECONNREFUSED/.test(error.message)) {
      throw new Error("Knowledge base unreachable: run `npm run rag:start` (and `npm run ingest` if it is empty)");
    }
    throw error;
  } finally {
    await db.end();
  }
}

/** Runs `use` with a Cyberlearn client, reusing the saved app token and logging in again when it is missing or expired. */
export async function withCyberlearn<T>(
  debug: boolean,
  mfaCode: string | undefined,
  use: (client: CyberlearnClient) => Promise<T>,
): Promise<T> {
  const saved = mfaCode ? undefined : await readCyberlearnToken();
  if (saved) {
    try {
      return await use(new CyberlearnClient(saved));
    } catch (error) {
      if (!(error instanceof InvalidTokenError)) throw error;
    }
  }

  const client = await withLogin(debug, mfaCode, (session, creds, resumeFrom) =>
    CyberlearnClient.login(session, creds, resumeFrom),
  );
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CYBERLEARN_TOKEN_FILE, JSON.stringify({ token: client.apiToken }), { mode: 0o600 });
  return use(client);
}

export async function readCyberlearnToken(): Promise<string | undefined> {
  try {
    return (JSON.parse(await readFile(CYBERLEARN_TOKEN_FILE, "utf-8")) as { token: string }).token;
  } catch {
    return undefined;
  }
}

/**
 * Runs a login with the saved session, handling edu-ID two-step login: the code comes from `--mfa-code` or a
 * terminal prompt; without one, the login is saved as pending and `MfaRequiredError` is thrown.
 */
export async function withLogin<T>(
  debug: boolean,
  mfaCode: string | undefined,
  login: (session: Session, creds: Credentials, resumeFrom?: Page) => Promise<T>,
): Promise<T> {
  const session = await Session.open({ cookieFile: SESSION_FILE, debugDir: debug ? `${CACHE_DIR}/debug` : undefined });
  const creds = { ...loadConfig(), otp: async () => mfaCode ?? (await askMfaCode()) };

  try {
    const pending = mfaCode ? await readPendingMfa() : undefined;
    let result: T;
    try {
      result = await login(session, creds, pending);
    } catch (error) {
      if (!pending || error instanceof MfaRequiredError) throw error;
      // The interrupted edu-ID login expired or belonged to another service: start over, the code is still valid.
      result = await login(session, creds);
    }
    await rm(PENDING_MFA_FILE, { force: true });
    return result;
  } catch (error) {
    if (error instanceof MfaRequiredError) {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(PENDING_MFA_FILE, JSON.stringify(error.page), { mode: 0o600 });
    }
    throw error;
  } finally {
    await session.save();
  }
}

/** Asks for the two-step login code when run in a terminal; elsewhere (e.g. by an agent) `--mfa-code` is needed. */
export async function askMfaCode(): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined;
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await prompt.question("edu-ID two-step login code: ");
  } finally {
    prompt.close();
  }
}

export async function readPendingMfa(): Promise<Page | undefined> {
  try {
    return JSON.parse(await readFile(PENDING_MFA_FILE, "utf-8")) as Page;
  } catch {
    return undefined;
  }
}

export async function readCache(): Promise<ScheduleCache | undefined> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf-8")) as ScheduleCache;
  } catch {
    return undefined;
  }
}

export interface ScheduleViewOptions {
  from?: string;
  to?: string;
  all?: boolean;
  table?: boolean;
  json?: boolean;
  /** Someone else's schedule: a student, a teacher acronym, a room, a class or a course group. */
  who?: string;
  type?: string;
  refresh?: boolean;
  color?: ColorMode;
  debug?: boolean;
  mfaCode?: string;
}

/** A timetable as text: the week as a table, a list of days (default: next 7 days) or JSON. */
export async function scheduleView(options: ScheduleViewOptions): Promise<string> {
  let cache: ScheduleCache;
  let heading = "";
  if (options.who) {
    const other = await loadOtherSchedule(options.who, options.type, Boolean(options.debug), options.mfaCode);
    heading = `Horaire : ${other.entity.name} (${other.entity.type})\n\n`;
    cache = other.cache;
  } else {
    cache = await loadSchedule(Boolean(options.refresh), Boolean(options.debug), options.mfaCode);
  }
  const from = options.from ? startOfDay(options.from) : startOfDay(isoDate(new Date()));
  const to = options.to ? addDays(startOfDay(options.to), 1) : addDays(from, 7);
  const lessons = options.all ? cache.lessons : cache.lessons.filter((l) => new Date(l.end) > from && new Date(l.start) < to);

  if (options.table) {
    const now = startOfDay(isoDate(new Date()));
    const weekend = !options.from && addDays(startOfWeek(now), 5) <= now;
    const monday = weekend ? addDays(startOfWeek(now), 7) : startOfWeek(from);
    return heading + renderWeekTable(cache.lessons, monday, cache.fetchedAt, options.color ?? "none");
  }
  if (options.json) return heading + JSON.stringify({ fetchedAt: cache.fetchedAt, lessons }, null, 2);
  return heading + formatLessons(lessons, cache.fetchedAt);
}

/** Lessons as a list grouped by day (Europe/Zurich). */
export function formatLessons(lessons: Lesson[], fetchedAt: string): string {
  const out: string[] = [];
  const day = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, dateStyle: "full" });
  const time = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, timeStyle: "short" });

  out.push(`Schedule fetched at ${new Date(fetchedAt).toLocaleString("fr-CH", { timeZone: TIME_ZONE })}`);
  if (lessons.length === 0) {
    out.push("No lessons in this period.");
    return out.join("\n");
  }

  let currentDay = "";
  for (const lesson of lessons) {
    const start = new Date(lesson.start);
    const lessonDay = day.format(start);
    if (lessonDay !== currentDay) {
      currentDay = lessonDay;
      out.push(`\n${lessonDay}`);
    }
    const end = new Date(lesson.end);
    const where = lesson.location ? ` @ ${lesson.location}` : "";
    const when =
      time.format(start) === "00:00" && time.format(end) === "00:00"
        ? `all day until ${day.format(new Date(end.getTime() - 1))}`
        : `${time.format(start)}-${time.format(end)}`;
    out.push(`  ${when}  ${lesson.summary}${where}`);
  }
  return out.join("\n");
}

