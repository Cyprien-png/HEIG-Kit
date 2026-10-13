import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { type Credentials, MfaRequiredError } from "./auth/eduid.js";
import { loadConfig } from "./config.js";
import { CyberlearnClient, InvalidTokenError } from "./cyberlearn/client.js";
import { TIME_ZONE, addDays, isoDate, startOfDay } from "./dates.js";
import { findCourse, renderCourse, renderCourseList } from "./courses.js";
import { renderDeadlines } from "./deadlines.js";
import { GapsClient, type Lesson } from "./gaps/client.js";
import { type Page, Session } from "./http.js";
import { CACHE_DIR } from "./paths.js";
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

Schedule options:
  --from <YYYY-MM-DD>  first day to show (default: today)
  --to <YYYY-MM-DD>    last day to show (default: 7 days after --from)
  --all                show the whole academic year
  --table              show the week containing --from (default: this week, next week on weekends) as a timetable
  --color <mode>       table colors: auto (default), ansi, emoji or none
  --json               print lessons as JSON
  --refresh            ignore the cache and log in to GAPS again

Deadlines options:
  --days <n>           only show activities due within n days (overdue ones are always shown)
  --color <mode>       table colors: auto (default), ansi, emoji or none
  --json               print deadlines as JSON

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
      json: { type: "boolean", default: false },
      table: { type: "boolean", default: false },
      color: { type: "string", default: "auto" },
      refresh: { type: "boolean", default: false },
      days: { type: "string" },
      "mfa-code": { type: "string" },
      debug: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !["schedule", "deadlines", "courses", "course"].includes(command)) {
    console.log(USAGE);
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

  const cache = await loadSchedule(values.refresh, values.debug, values["mfa-code"]);
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

  const gaps = await withLogin(debug, mfaCode, async (session, creds, resumeFrom) => {
    const client = new GapsClient(session, loadConfig().gapsStudentId);
    await client.login(creds, resumeFrom);
    return client;
  });

  const cache = { fetchedAt: new Date().toISOString(), lessons: await gaps.fetchSchedule() };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  return cache;
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
