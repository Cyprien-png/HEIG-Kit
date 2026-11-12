/**
 * The kind of access an account chose, in full knowledge of what it means (the web application explains it at the
 * first login and on « Mon compte »). It has nothing to do with the role (student, administrator).
 *
 * - `campus`: the account connects edu-ID. The server reads its timetable, grades, absences and study plan on GAPS and
 *   its deadlines and course pages on Cyberlearn, and keeps an edu-ID session to do so.
 * - `local`: nothing of edu-ID is ever asked or kept. Everything that comes from GAPS and Cyberlearn, calendar
 *   included, is closed to the account: in the web application, on the API and for its agents (MCP).
 */
import { AccessDenied, type Identity, currentIdentity } from "../identity.js";

export type Access = "campus" | "local";
export const ACCESSES: Access[] = ["campus", "local"];

/** The API of what comes from GAPS and Cyberlearn, calendar included. */
export const CAMPUS_API = /^\/api\/(campus|calendars?|me\/sync)(\/|$)/;

/** The MCP tools of the same. */
export const CAMPUS_TOOLS = new Set([
  "get_schedule",
  "find_in_gaps",
  "get_study_plan",
  "get_unit_sheet",
  "get_module_sheet",
  "get_grades",
  "get_absences",
  "get_deadlines",
  "get_cyberlearn_course",
  "get_calendar",
  "set_calendar_event",
  "remove_calendar_event",
  "get_calendar_event_history",
  "list_calendars",
  "set_calendar",
  "remove_calendar",
]);

export const NO_CAMPUS_MESSAGE =
  "Refused: this account chose the access without edu-ID. Timetable, grades, absences, study plan, deadlines, Cyberlearn pages and calendar are closed to it. " +
  "Do not retry and do not work around it: only its owner can change this, on the page « Mon compte » of the web application. " +
  "Course material, flashcards, quizzes, documents, corrections and the profile remain available.";

/** Thrown when an account without edu-ID asks for something that comes from GAPS or Cyberlearn. */
export class NoCampusAccess extends AccessDenied {
  constructor() {
    super(NO_CAMPUS_MESSAGE);
  }
}

/** A single-user installation has no such choice: its owner's `.env` decides. */
export const hasCampusAccess = (identity: Identity | undefined = currentIdentity()): boolean => identity?.access !== "local";

export function requireCampusAccess(identity: Identity | undefined = currentIdentity()): void {
  if (!hasCampusAccess(identity)) throw new NoCampusAccess();
}
