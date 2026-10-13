import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { GapsClient, type Lesson } from "./gaps/client.js";
import { Session } from "./http.js";

const CACHE_DIR = ".cache";
const CACHE_FILE = `${CACHE_DIR}/schedule.json`;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const TIME_ZONE = "Europe/Zurich";

interface ScheduleCache {
  fetchedAt: string;
  lessons: Lesson[];
}

const USAGE = `Usage: npm run schedule -- [options]

Options:
  --from <YYYY-MM-DD>  first day to show (default: today)
  --to <YYYY-MM-DD>    last day to show (default: 7 days after --from)
  --all                show the whole academic year
  --json               print lessons as JSON
  --refresh            ignore the cache and log in to GAPS again
  --debug              save every visited page to ${CACHE_DIR}/debug/`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: "string" },
      to: { type: "string" },
      all: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      refresh: { type: "boolean", default: false },
      debug: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals[0] !== "schedule") {
    console.log(USAGE);
    return;
  }

  const cache = await loadSchedule(values.refresh, values.debug);
  const from = values.from ? startOfDay(values.from) : startOfDay(isoDate(new Date()));
  const to = values.to ? addDays(startOfDay(values.to), 1) : addDays(from, 7);
  const lessons = values.all
    ? cache.lessons
    : cache.lessons.filter((l) => new Date(l.end) > from && new Date(l.start) < to);

  if (values.json) {
    console.log(JSON.stringify({ fetchedAt: cache.fetchedAt, lessons }, null, 2));
  } else {
    printLessons(lessons, cache.fetchedAt);
  }
}

async function loadSchedule(refresh: boolean, debug: boolean): Promise<ScheduleCache> {
  if (!refresh) {
    const cached = await readCache();
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) return cached;
  }

  const config = loadConfig();
  const gaps = new GapsClient(new Session(debug ? `${CACHE_DIR}/debug` : undefined), config.gapsStudentId);
  await gaps.login(config);
  const cache = { fetchedAt: new Date().toISOString(), lessons: await gaps.fetchSchedule() };

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  return cache;
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

/** Midnight in Zurich of the given YYYY-MM-DD day. */
function startOfDay(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  const utcMidnight = new Date(`${date}T00:00:00Z`);
  const zurichHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(utcMidnight),
  );
  return new Date(utcMidnight.getTime() - zurichHour * 60 * 60 * 1000);
}

function isoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
}

function addDays(date: Date, days: number): Date {
  return startOfDay(isoDate(new Date(date.getTime() + (days * 24 + 12) * 60 * 60 * 1000)));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
