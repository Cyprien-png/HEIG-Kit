import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { MfaRequiredError } from "./auth/eduid.js";
import { loadConfig } from "./config.js";
import { TIME_ZONE, addDays, isoDate, startOfDay } from "./dates.js";
import { GapsClient, type Lesson } from "./gaps/client.js";
import { type Page, Session } from "./http.js";
import { CACHE_DIR } from "./paths.js";
import type { ColorMode } from "./render.js";
import { renderWeekTable, startOfWeek } from "./table.js";

const CACHE_FILE = `${CACHE_DIR}/schedule.json`;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_FILE = `${CACHE_DIR}/session.json`;
/** edu-ID two-step login page of a login waiting for a code, resumed by `--mfa-code`. */
const PENDING_MFA_FILE = `${CACHE_DIR}/mfa-pending.json`;

interface ScheduleCache {
  fetchedAt: string;
  lessons: Lesson[];
}

const USAGE = `Usage: npm run schedule -- [options]

Options:
  --from <YYYY-MM-DD>  first day to show (default: today)
  --to <YYYY-MM-DD>    last day to show (default: 7 days after --from)
  --all                show the whole academic year
  --table              show the week containing --from (default: this week, next week on weekends) as a timetable
  --color <mode>       table colors: auto (default), ansi, emoji or none
  --json               print lessons as JSON
  --refresh            ignore the cache and log in to GAPS again
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
      "mfa-code": { type: "string" },
      debug: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals[0] !== "schedule") {
    console.log(USAGE);
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

  const config = loadConfig();
  const session = await Session.open({ cookieFile: SESSION_FILE, debugDir: debug ? `${CACHE_DIR}/debug` : undefined });
  const gaps = new GapsClient(session, config.gapsStudentId);
  const creds = { ...config, otp: async () => mfaCode ?? (await askMfaCode()) };

  try {
    const pending = mfaCode ? await readPendingMfa() : undefined;
    try {
      await gaps.login(creds, pending);
    } catch (error) {
      if (!pending || error instanceof MfaRequiredError) throw error;
      // The interrupted edu-ID login expired: start over, the code is still valid for a few seconds.
      await gaps.login(creds);
    }
    await rm(PENDING_MFA_FILE, { force: true });
  } catch (error) {
    if (error instanceof MfaRequiredError) {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(PENDING_MFA_FILE, JSON.stringify(error.page), { mode: 0o600 });
    }
    throw error;
  } finally {
    await session.save();
  }

  const cache = { fetchedAt: new Date().toISOString(), lessons: await gaps.fetchSchedule() };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  return cache;
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
