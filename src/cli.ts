import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { type Credentials, MfaRequiredError } from "./auth/eduid.js";
import { loadConfig } from "./config.js";
import { CyberlearnClient, InvalidTokenError } from "./cyberlearn/client.js";
import { TIME_ZONE, addDays, isoDate, startOfDay } from "./dates.js";
import { findCourse, renderCourse, renderCourseList } from "./courses.js";
import { renderDeadlines } from "./deadlines.js";
import { type EntityType, ENTITY_TYPES, GapsClient, type Lesson } from "./gaps/client.js";
import { listEntities, searchEntities } from "./gaps/entities.js";
import { fetchContinuousGrades, fetchTranscript } from "./gaps/grades.js";
import { renderAbsences, renderEntities, renderGrades, renderPlan } from "./gaps/render.js";
import { fetchSheet } from "./gaps/sheets.js";
import { fetchStudentRecord } from "./gaps/student.js";
import { type Page, Session } from "./http.js";
import { CACHE_DIR, ROOT } from "./paths.js";
import { migrate, openDb } from "./rag/db.js";
import { ensureEmbeddingModel } from "./rag/embed.js";
import { isDoclingAvailable } from "./rag/extract.js";
import { type IngestStats, ingestSource } from "./rag/ingest.js";
import { documentText, findExercise, formatResults, listCourses, listDocuments, search } from "./rag/search.js";
import { CyberlearnSource } from "./rag/sources/cyberlearn.js";
import { LocalSource } from "./rag/sources/local.js";
import type { ColorMode } from "./render.js";
import { renderWeekTable, scheduleCourses, startOfWeek } from "./table.js";

const CACHE_FILE = `${CACHE_DIR}/schedule.json`;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_FILE = `${CACHE_DIR}/session.json`;
/** edu-ID two-step login page of a login waiting for a code, resumed by `--mfa-code`. */
const PENDING_MFA_FILE = `${CACHE_DIR}/mfa-pending.json`;
/** Cyberlearn mobile app token, valid until revoked: grants access to the account like a password. */
const CYBERLEARN_TOKEN_FILE = `${CACHE_DIR}/cyberlearn-token.json`;
/** Overdue activities stay listed this long after their due date. */
const OVERDUE_WINDOW_DAYS = 30;

interface ScheduleCache {
  fetchedAt: string;
  lessons: Lesson[];
}

const USAGE = `Usage:
  npm run schedule -- [options]    GAPS timetable
  npm run deadlines -- [options]   Cyberlearn activities still to do (assignments, quizzes…)
  npm run courses                  Cyberlearn courses
  npm run course -- <course>       content of a Cyberlearn course as text (plannings, resources, activities);
                                   <course> is a timetable code (e.g. MAD), an id or part of the name
  npm run ingest -- [options]      index course documents in the local RAG database (npm run rag:start first)
  npm run gaps -- plan [--all]     study plan: modules, units, credits and status (current year, or all years)
  npm run gaps -- unit <CODE>      unit sheet (e.g. MAD); gaps -- module <CODE> for a module sheet (e.g. MAI1)
  npm run gaps -- grades           continuous assessment grades and transcript
  npm run gaps -- absences         absences per unit
  npm run gaps -- find <name>      search students, teachers, rooms, classes and course groups (--type)
  npm run kb -- search <query>     search the indexed course material (--course MAD, --type exam, --limit 8)
  npm run kb -- exercise <number>  statement and solution of an exercise, e.g. 2.22 (--course MAD)
  npm run kb -- document <id>      extracted text of a document (--pages 41-42)
  npm run kb -- courses            indexed courses; kb -- documents <course> lists a course's documents (--type)

Schedule options:
  --from <YYYY-MM-DD>  first day to show (default: today)
  --to <YYYY-MM-DD>    last day to show (default: 7 days after --from)
  --all                show the whole academic year
  --who <name>         schedule of another student, a teacher (acronym), a room, a class or a course group
  --type <kind>        with --who: student, teacher, room, class or course
  --table              show the week containing --from (default: this week, next week on weekends) as a timetable
  --color <mode>       table colors: auto (default), ansi, emoji or none
  --json               print lessons as JSON
  --refresh            ignore the cache and log in to GAPS again

Deadlines options:
  --days <n>           only show activities due within n days (overdue ones are always shown)
  --color <mode>       table colors: auto (default), ansi, emoji or none
  --json               print deadlines as JSON

Ingest options:
  --source <name>      only this source: cyberlearn or local (default: both; local needs RAG_LOCAL_DIRS in .env)
  --course <code>      only this Cyberlearn course (repeatable), e.g. --course MAD
  --all-courses        every Cyberlearn course, not only those of the GAPS timetable (curriculum)
  --dry-run            only show what is new or changed

Common options:
  --mfa-code <code>    edu-ID two-step login code from your authenticator app (asked interactively in a terminal)
  --debug              save every visited page to .cache/debug/`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: "string" },
      to: { type: "string" },
      all: { type: "boolean", default: false },
      who: { type: "string" },
      json: { type: "boolean", default: false },
      table: { type: "boolean", default: false },
      color: { type: "string", default: "auto" },
      refresh: { type: "boolean", default: false },
      days: { type: "string" },
      source: { type: "string" },
      course: { type: "string", multiple: true },
      "dry-run": { type: "boolean", default: false },
      "all-courses": { type: "boolean", default: false },
      type: { type: "string" },
      limit: { type: "string" },
      pages: { type: "string" },
      "mfa-code": { type: "string" },
      debug: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !["schedule", "deadlines", "courses", "course", "ingest", "kb", "gaps"].includes(command)) {
    console.log(USAGE);
    return;
  }

  if (command === "gaps") {
    console.log(await gapsInfo(positionals.slice(1), { all: values.all, type: values.type, debug: values.debug, mfaCode: values["mfa-code"] }));
    return;
  }

  if (command === "kb") {
    console.log(await knowledgeBase(positionals.slice(1), values.course?.[0], values.type, values.limit, values.pages));
    return;
  }

  if (command === "ingest") {
    await runIngest(values.source, values.course ?? [], values["all-courses"], values["dry-run"], values.debug, values["mfa-code"]);
    return;
  }

  if (command === "courses" || command === "course") {
    if (command === "course" && !positionals[1]) throw new Error("Usage: npm run course -- <course>");
    console.log(await loadCourses(positionals[1], values.debug, values["mfa-code"]));
    return;
  }

  if (command === "deadlines") {
    const days = values.days === undefined ? undefined : Number(values.days);
    if (days !== undefined && !(days >= 0)) throw new Error(`Invalid --days "${values.days}", expected a number of days`);
    const deadlines = await loadDeadlines(days, values.debug, values["mfa-code"]);
    if (values.json) {
      console.log(JSON.stringify({ deadlines }, null, 2));
    } else {
      const courses = scheduleCourses((await readCache())?.lessons ?? []);
      console.log(renderDeadlines(deadlines, courses, colorMode(values.color)));
    }
    return;
  }

  let cache: ScheduleCache;
  if (values.who) {
    const other = await loadOtherSchedule(values.who, values.type, values.debug, values["mfa-code"]);
    console.log(`Horaire : ${other.entity.name} (${other.entity.type})\n`);
    cache = other.cache;
  } else {
    cache = await loadSchedule(values.refresh, values.debug, values["mfa-code"]);
  }
  const from = values.from ? startOfDay(values.from) : startOfDay(isoDate(new Date()));
  const to = values.to ? addDays(startOfDay(values.to), 1) : addDays(from, 7);
  const lessons = values.all
    ? cache.lessons
    : cache.lessons.filter((l) => new Date(l.end) > from && new Date(l.start) < to);

  if (values.table) {
    const now = startOfDay(isoDate(new Date()));
    const weekend = !values.from && addDays(startOfWeek(now), 5) <= now;
    const monday = weekend ? addDays(startOfWeek(now), 7) : startOfWeek(from);
    console.log(renderWeekTable(cache.lessons, monday, cache.fetchedAt, colorMode(values.color)));
    return;
  }

  if (values.json) {
    console.log(JSON.stringify({ fetchedAt: cache.fetchedAt, lessons }, null, 2));
  } else {
    printLessons(lessons, cache.fetchedAt);
  }
}

function colorMode(option: string): ColorMode {
  if (option === "ansi" || option === "emoji" || option === "none") return option;
  if (option !== "auto") throw new Error(`Invalid --color "${option}", expected auto, ansi, emoji or none`);
  return process.stdout.isTTY && !process.env.NO_COLOR ? "ansi" : "none";
}

async function loadSchedule(refresh: boolean, debug: boolean, mfaCode?: string): Promise<ScheduleCache> {
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

function loginGaps(debug: boolean, mfaCode?: string): Promise<GapsClient> {
  return withLogin(debug, mfaCode, async (session, creds, resumeFrom) => {
    const client = new GapsClient(session, loadConfig().gapsStudentId);
    await client.login(creds, resumeFrom);
    return client;
  });
}

/** Schedule of another student, a teacher (acronym), a room, a class or a course group, found by name. */
async function loadOtherSchedule(query: string, type: string | undefined, debug: boolean, mfaCode?: string) {
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
async function gapsInfo(args: string[], options: { all: boolean; type?: string; debug: boolean; mfaCode?: string }): Promise<string> {
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
async function loadDeadlines(days: number | undefined, debug: boolean, mfaCode?: string) {
  const from = new Date(Date.now() - OVERDUE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const to = days === undefined ? undefined : addDays(startOfDay(isoDate(new Date())), days + 1);

  return withCyberlearn(debug, mfaCode, (client) => client.deadlines(from, to));
}

/** The user's Cyberlearn courses, or one course rendered as text with its pages' content when `query` is given. */
async function loadCourses(query: string | undefined, debug: boolean, mfaCode?: string): Promise<string> {
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

/** Indexes Cyberlearn and local documents into the RAG database, starting the extraction service if needed. */
async function runIngest(
  only: string | undefined,
  courses: string[],
  allCourses: boolean,
  dryRun: boolean,
  debug: boolean,
  mfaCode?: string,
) {
  if (only && only !== "cyberlearn" && only !== "local") throw new Error(`Invalid --source "${only}", expected cyberlearn or local`);
  const localDirs = (process.env.RAG_LOCAL_DIRS ?? "").split(path.delimiter).filter(Boolean);
  if (only === "local" && localDirs.length === 0) throw new Error("Set RAG_LOCAL_DIRS in .env to index local folders");

  const db = openDb();
  try {
    await migrate(db).catch((error: unknown) => {
      throw new Error(`RAG database unreachable, run \`npm run rag:start\` first (${error instanceof Error ? error.message : error})`);
    });
    // One ingestion at a time (e.g. the daily update and a manual run): released when the connection closes.
    const lock = await db.connect();
    if (!dryRun && !(await lock.query("SELECT pg_try_advisory_lock(7310) AS ok")).rows[0].ok) {
      lock.release();
      throw new Error("Another ingestion is already running");
    }
    const startedDocling = dryRun ? false : await startServices();
    try {
      const log = (line: string) => console.log(line);
      const summaries: string[] = [];
      if (only !== "local") {
        // The timetable defines the curriculum: refreshed like for `schedule`, so new courses are picked up.
        const scheduleCodes = scheduleCourses((await loadSchedule(false, debug, mfaCode)).lessons);
        const selection = {
          only: courses,
          all: allCourses,
          extra: listSetting("RAG_EXTRA_COURSES"),
          exclude: listSetting("RAG_EXCLUDE_COURSES"),
        };
        const { documents, selected } = await withCyberlearn(debug, mfaCode, async (client) => {
          const source = new CyberlearnSource(client, scheduleCodes, selection);
          return { documents: await source.list(), selected: source.selectedCourses };
        });
        console.log(`Cyberlearn: ${documents.length} documents in ${selected.length} courses (${selected.join(", ")})`);
        const stats = await ingestSource(db, "cyberlearn", documents, { removalScope: selected, dryRun, log });
        summaries.push(summary("Cyberlearn", stats));
      }
      if (only !== "cyberlearn" && localDirs.length > 0) {
        const documents = await new LocalSource(localDirs).list();
        console.log(`Local folders: ${documents.length} documents`);
        summaries.push(summary("Local folders", await ingestSource(db, "local", documents, { removalScope: "all", dryRun, log })));
      }
      console.log(`\n${summaries.join("\n")}`);
    } finally {
      if (startedDocling) compose("stop", "docling");
      lock.release();
    }
  } finally {
    await db.end();
  }
}

/** Read-only access to the knowledge base, the same as the MCP server's tools (for skills and terminal use). */
async function knowledgeBase(args: string[], course?: string, docType?: string, limit?: string, pages?: string): Promise<string> {
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
      case "courses":
        return JSON.stringify(await listCourses(db), null, 2);
      case "documents":
        if (!rest[0]) throw new Error("Usage: npm run kb -- documents <course>");
        return JSON.stringify(await listDocuments(db, rest[0], docType), null, 2);
      default:
        throw new Error("Usage: npm run kb -- search|exercise|document|courses|documents …");
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

/** Makes sure the embedding model is available and docling runs; returns whether docling had to be started. */
async function startServices(): Promise<boolean> {
  await ensureEmbeddingModel();
  if (await isDoclingAvailable()) return false;
  console.log("Starting the document extraction service (first start downloads its image, ~2 GB)…");
  compose("--profile", "ingest", "up", "-d", "docling");
  for (let i = 0; i < 60 && !(await isDoclingAvailable()); i++) await new Promise((r) => setTimeout(r, 5000));
  if (!(await isDoclingAvailable())) throw new Error("The document extraction service did not start (docker compose -f rag/compose.yml logs docling)");
  return true;
}

/** Comma-separated list from .env, e.g. RAG_EXCLUDE_COURSES=PHY,49168. */
function listSetting(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

function compose(...args: string[]): void {
  execFileSync("docker", ["compose", "-f", path.join(ROOT, "rag", "compose.yml"), ...args], { stdio: "inherit" });
}

function summary(name: string, s: IngestStats): string {
  return `${name}: ${s.listed} listed, ${s.unchanged} unchanged, ${s.indexed} indexed (${s.chunks} chunks), ${s.linked} linked, ${s.removed} removed, ${s.failed} failed`;
}

/** Runs `use` with a Cyberlearn client, reusing the saved app token and logging in again when it is missing or expired. */
async function withCyberlearn<T>(
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

async function readCyberlearnToken(): Promise<string | undefined> {
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
async function withLogin<T>(
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
async function askMfaCode(): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined;
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await prompt.question("edu-ID two-step login code: ");
  } finally {
    prompt.close();
  }
}

async function readPendingMfa(): Promise<Page | undefined> {
  try {
    return JSON.parse(await readFile(PENDING_MFA_FILE, "utf-8")) as Page;
  } catch {
    return undefined;
  }
}

async function readCache(): Promise<ScheduleCache | undefined> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf-8")) as ScheduleCache;
  } catch {
    return undefined;
  }
}

function printLessons(lessons: Lesson[], fetchedAt: string): void {
  const day = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, dateStyle: "full" });
  const time = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, timeStyle: "short" });

  console.log(`Schedule fetched at ${new Date(fetchedAt).toLocaleString("fr-CH", { timeZone: TIME_ZONE })}`);
  if (lessons.length === 0) {
    console.log("No lessons in this period.");
    return;
  }

  let currentDay = "";
  for (const lesson of lessons) {
    const start = new Date(lesson.start);
    const lessonDay = day.format(start);
    if (lessonDay !== currentDay) {
      currentDay = lessonDay;
      console.log(`\n${lessonDay}`);
    }
    const end = new Date(lesson.end);
    const where = lesson.location ? ` @ ${lesson.location}` : "";
    const when =
      time.format(start) === "00:00" && time.format(end) === "00:00"
        ? `all day until ${day.format(new Date(end.getTime() - 1))}`
        : `${time.format(start)}-${time.format(end)}`;
    console.log(`  ${when}  ${lesson.summary}${where}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof MfaRequiredError) {
    console.error(
      `${error.message}. Rerun with --mfa-code <code> using the current code of your authenticator app ` +
        "(edu-ID then remembers this device for some time).",
    );
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
