import { createHash, randomBytes } from "node:crypto";
import { type Credentials, loginWithEduId } from "../auth/eduid.js";
import type { Page, Session } from "../http.js";

const CYBERLEARN_URL = "https://cyberlearn.hes-so.ch";
const MAX_EVENTS_PER_CALL = 50;

/** A deadline from the Moodle timeline: an activity the user still has to act on (submit, attempt…). */
export interface Deadline {
  /** Due date, ISO UTC. */
  due: string;
  name: string;
  /** Moodle module, e.g. `assign`, `quiz`. */
  module: string;
  course: string;
  courseShortName: string;
  /** What is expected, e.g. "Add submission". */
  action: string;
  overdue: boolean;
  url: string;
}

export interface Course {
  id: number;
  shortName: string;
  fullName: string;
  /** Teachers shown as course contacts on Cyberlearn. */
  teachers: string[];
}

/** A course section with its activities and resources, as returned by `core_course_get_contents`. */
export interface Section {
  name: string;
  /** HTML. */
  summary: string;
  modules: Module[];
}

export interface Module {
  id: number;
  name: string;
  /** Moodle module type: `label`, `page`, `resource`, `folder`, `url`, `assign`, `quiz`… */
  modname: string;
  url?: string;
  /** HTML text of labels and module descriptions. */
  description?: string;
  /** Files of resources and folders, the HTML content of pages, the target of URLs. */
  contents?: { type: string; filename: string; filepath?: string; fileurl: string; timemodified?: number }[];
  dates?: { label: string; timestamp: number }[];
}

interface TimelineEvent {
  id: number;
  name: string;
  activityname?: string;
  modulename?: string;
  timesort: number;
  overdue?: boolean;
  url: string;
  course?: { fullname: string; shortname: string };
  action?: { name: string; url: string; actionable: boolean };
}

/**
 * Client for Cyberlearn's official Moodle web services, authenticated with the token Moodle issues to its
 * mobile app. The token is obtained through the usual edu-ID login and stays valid across runs.
 */
export class CyberlearnClient {
  constructor(private readonly token: string) {}

  /**
   * Gets a mobile app token by logging in through edu-ID, reusing the session's cookies when possible.
   * `resumeFrom` is the edu-ID two-step login page of an interrupted login (see `MfaRequiredError`).
   */
  static async login(session: Session, creds: Credentials, resumeFrom?: Page): Promise<CyberlearnClient> {
    const passport = randomBytes(8).toString("hex");
    const launchUrl = `${CYBERLEARN_URL}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=moodlemobile`;

    // Visiting the launch page first makes Moodle come back to it after login, handing the token over.
    let page = resumeFrom ?? (await session.get(launchUrl));
    if (!resumeFrom && isTokenRedirect(page)) return new CyberlearnClient(parseToken(page.url, passport));

    page = await loginWithEduId(session, resumeFrom ?? (await session.get(`${CYBERLEARN_URL}/auth/shibboleth/index.php`)), creds);
    if (!isTokenRedirect(page)) page = await session.get(launchUrl);
    if (!isTokenRedirect(page)) throw new Error(`Cyberlearn did not issue an app token (ended at ${page.url})`);
    return new CyberlearnClient(parseToken(page.url, passport));
  }

  get apiToken(): string {
    return this.token;
  }

  /** Courses the user is enrolled in, with their teachers. */
  async courses(): Promise<Course[]> {
    const { userid } = await this.call<{ userid: number }>("core_webservice_get_site_info");
    const courses = await this.call<{ id: number; shortname: string; fullname: string }[]>("core_enrol_get_users_courses", {
      userid,
    });
    if (courses.length === 0) return [];
    const details = await this.call<{ courses: { id: number; contacts?: { fullname: string }[] }[] }>(
      "core_course_get_courses_by_field",
      { field: "ids", value: courses.map((c) => c.id).join(",") },
    );
    const teachers = new Map(details.courses.map((c) => [c.id, (c.contacts ?? []).map((t) => t.fullname)]));
    return courses.map((c) => ({ id: c.id, shortName: c.shortname, fullName: c.fullname, teachers: teachers.get(c.id) ?? [] }));
  }

  async courseContents(courseId: number): Promise<Section[]> {
    return this.call<Section[]>("core_course_get_contents", { courseid: courseId });
  }

  /** Downloads a file listed in course contents (e.g. a page's `index.html`), authenticated with the token. */
  async downloadFile(fileUrl: string): Promise<ArrayBuffer> {
    const url = new URL(fileUrl);
    url.searchParams.set("token", this.token);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Cyberlearn file download failed (${res.status}): ${fileUrl}`);
    return res.arrayBuffer();
  }

  /** Activities still to do (assignments to submit, quizzes to attempt…) due from `from` on, sorted by due date. */
  async deadlines(from: Date, to?: Date): Promise<Deadline[]> {
    const deadlines: Deadline[] = [];
    let afterEventId: number | undefined;
    for (;;) {
      const { events } = await this.call<{ events: TimelineEvent[] }>("core_calendar_get_action_events_by_timesort", {
        timesortfrom: Math.floor(from.getTime() / 1000),
        ...(to && { timesortto: Math.floor(to.getTime() / 1000) }),
        limitnum: MAX_EVENTS_PER_CALL,
        ...(afterEventId && { aftereventid: afterEventId }),
      });
      deadlines.push(...events.map(toDeadline));
      if (events.length < MAX_EVENTS_PER_CALL) return deadlines;
      afterEventId = events.at(-1)!.id;
    }
  }

  /** Calls a Moodle web service function; throws `InvalidTokenError` when the token expired or was revoked. */
  async call<T>(wsfunction: string, params: Record<string, unknown> = {}): Promise<T> {
    const body = new URLSearchParams({ wstoken: this.token, wsfunction, moodlewsrestformat: "json" });
    flatten(params, "", body);
    const res = await fetch(`${CYBERLEARN_URL}/webservice/rest/server.php`, { method: "POST", body });
    const data = (await res.json()) as T & { exception?: string; errorcode?: string; message?: string };
    if (data && typeof data === "object" && "exception" in data) {
      if (data.errorcode === "invalidtoken") throw new InvalidTokenError();
      throw new Error(`Cyberlearn ${wsfunction} failed: ${data.message ?? data.errorcode}`);
    }
    return data;
  }
}

export class InvalidTokenError extends Error {
  constructor() {
    super("Cyberlearn app token expired or revoked");
  }
}

function isTokenRedirect(page: Page): boolean {
  return page.url.startsWith("moodlemobile://token=");
}

/**
 * The redirect carries base64("<md5(siteurl + passport)>:::<token>:::<private token>"); the signature
 * proves the token answers this login attempt.
 */
function parseToken(url: string, passport: string): string {
  const [signature, token] = Buffer.from(url.slice("moodlemobile://token=".length), "base64").toString().split(":::");
  const expected = createHash("md5").update(`${CYBERLEARN_URL}${passport}`).digest("hex");
  if (signature !== expected || !token) throw new Error("Cyberlearn returned an app token that does not match the login");
  return token;
}

/** Moodle's REST format: nested values as `key[sub]=value`. */
function flatten(value: unknown, key: string, body: URLSearchParams): void {
  if (value === undefined) return;
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, key ? `${key}[${k}]` : k, body);
  } else {
    body.set(key, String(value));
  }
}

function toDeadline(event: TimelineEvent): Deadline {
  return {
    due: new Date(event.timesort * 1000).toISOString(),
    name: event.activityname ?? event.name,
    module: event.modulename ?? "",
    course: event.course?.fullname ?? "",
    courseShortName: event.course?.shortname ?? "",
    action: event.action?.name ?? "",
    overdue: event.overdue ?? false,
    url: event.action?.url ?? event.url,
  };
}
