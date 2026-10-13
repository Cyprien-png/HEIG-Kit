import * as cheerio from "cheerio";
import ical, { type ParameterValue, type VEvent } from "node-ical";
import { type Credentials, loginWithEduId } from "../auth/eduid.js";
import { type Page, Session } from "../http.js";

const GAPS_URL = "https://gaps.heig-vd.ch";
const SCHEDULE_URL = `${GAPS_URL}/consultation/horaires/`;
const HES_SO_IDP = "https://aai-logon.hes-so.ch/idp/shibboleth";

export interface Lesson {
  start: string;
  end: string;
  summary: string;
  location: string;
  description: string;
}

export class GapsClient {
  private schedulePage?: Page;

  constructor(
    private readonly session: Session,
    private readonly studentId?: string,
  ) {}

  /**
   * Logs in to GAPS, reusing the session's cookies when they are still valid. `resumeFrom` is the edu-ID
   * two-step login page of an interrupted login (see `MfaRequiredError`), to finish it instead of starting over.
   */
  async login(creds: Credentials, resumeFrom?: Page): Promise<void> {
    if (!resumeFrom) {
      const page = await this.session.get(SCHEDULE_URL);
      if (isLoggedIn(page)) {
        this.schedulePage = page;
        return;
      }
    }

    const loginUrl = new URL(`${GAPS_URL}/Shibboleth.sso/Login`);
    loginUrl.searchParams.set("entityID", HES_SO_IDP);
    loginUrl.searchParams.set("target", SCHEDULE_URL);

    await loginWithEduId(this.session, resumeFrom ?? (await this.session.get(loginUrl.toString())), creds);

    const page = await this.session.get(SCHEDULE_URL);
    if (!isLoggedIn(page)) {
      throw new Error("GAPS still shows the login form after edu-ID login");
    }
    this.schedulePage = page;
  }

  /** Fetches every lesson of the given academic year (e.g. 2026 for 2026-2027). */
  async fetchSchedule(academicYear = currentAcademicYear()): Promise<Lesson[]> {
    if (!this.schedulePage) throw new Error("Call login() before fetching the schedule");

    const studentId = this.studentId ?? findStudentId(this.schedulePage.html);
    if (!studentId) {
      throw new Error("Could not detect the GAPS student id, set GAPS_STUDENT_ID in .env");
    }

    const lessons: Lesson[] = [];
    // GAPS terms: 1 = autumn semester, 3 = spring semester (0 is the summer term).
    for (const term of [1, 3]) {
      const url = new URL(SCHEDULE_URL);
      url.search = new URLSearchParams({
        annee: String(academicYear),
        trimestre: String(term),
        type: "2",
        id: studentId,
        icalendarversion: "2",
        individual: "1",
      }).toString();

      const page = await this.session.get(url.toString());
      if (!page.html.trimStart().startsWith("BEGIN:VCALENDAR")) {
        throw new Error(`GAPS did not return an iCalendar file for ${url}`);
      }
      lessons.push(...parseLessons(page.html));
    }

    return lessons.sort((a, b) => a.start.localeCompare(b.start));
  }
}

function isLoggedIn(page: Page): boolean {
  return cheerio.load(page.html)("#localaccessform").length === 0;
}

/** The academic year starts in August: October 2026 belongs to 2026-2027. */
export function currentAcademicYear(now = new Date()): number {
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

function findStudentId(html: string): string | undefined {
  const patterns = [
    /DEFAULT_STUDENT_ID\s*=\s*['"]?(\d+)/,
    /[?&](?:amp;)?type=2&(?:amp;)?id=(\d+)/,
    /[?&](?:amp;)?id=(\d+)&(?:amp;)?type=2/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return match[1];
  }
  return undefined;
}

function parseLessons(ics: string): Lesson[] {
  return Object.values(ical.sync.parseICS(ics))
    .filter((item): item is VEvent => item?.type === "VEVENT")
    .flatMap((event) => occurrences(event).map(({ start, end }) => ({
      start: start.toISOString(),
      end: end.toISOString(),
      summary: text(event.summary),
      location: text(event.location),
      description: text(event.description),
    })));
}

/** GAPS exports each course as a weekly RRULE with EXDATEs for holidays. */
function occurrences(event: VEvent): { start: Date; end: Date }[] {
  if (!event.rrule) return [{ start: event.start, end: event.end ?? event.start }];
  const to = new Date(event.start);
  to.setFullYear(to.getFullYear() + 1);
  return ical.expandRecurringEvent(event, { from: event.start, to });
}

function text(value: ParameterValue | undefined): string {
  if (value === undefined) return "";
  return (typeof value === "string" ? value : value.val).trim();
}
