import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderDeadlines } from "../../deadlines.js";
import { gapsInfo, loadCourses, loadDeadlines, readCache, scheduleView } from "../../services.js";
import { scheduleCourses } from "../../table.js";
import { respond } from "../common.js";

const mfaCode = z
  .string()
  .optional()
  .describe("Current 6-digit code of the user's authenticator app, only when a previous call asked for it");
const readOnly = { readOnlyHint: true, openWorldHint: true };

/** GAPS (timetables, study plan, sheets, grades, absences) and Cyberlearn (deadlines, course contents) tools. */
export function registerCampusTools(server: McpServer): void {
  server.registerTool(
    "get_schedule",
    {
      title: "Timetable",
      description:
        "HEIG-VD timetable from GAPS: the user's own by default, or someone else's with `who` (a student's name, a " +
        "teacher's acronym such as JHH, a room such as C23, a class such as HE41, a course group such as MAD-E). Returns " +
        "the lessons of a period as a list, or a week as a table with week_table. Times are Europe/Zurich.",
      inputSchema: {
        from: z.string().optional().describe("First day YYYY-MM-DD (default: today)"),
        to: z.string().optional().describe("Last day YYYY-MM-DD (default: 7 days after from)"),
        week_table: z.boolean().optional().describe("The week containing `from` as a table"),
        who: z.string().optional().describe("Someone else's schedule (see find_in_gaps for exact names)"),
        type: z.enum(["student", "teacher", "room", "class", "course"]).optional(),
        refresh: z.boolean().optional().describe("Download the latest data instead of the 12-hour cache"),
        mfa_code: mfaCode,
      },
      annotations: readOnly,
    },
    async (a) =>
      respond(() =>
        scheduleView({ from: a.from, to: a.to, table: a.week_table, who: a.who, type: a.type, refresh: a.refresh, color: "emoji", mfaCode: a.mfa_code }),
      ),
  );

  server.registerTool(
    "find_in_gaps",
    {
      title: "Find a person, room or class",
      description: "Searches GAPS students (by name), teachers (by acronym), rooms, classes and course groups.",
      inputSchema: { query: z.string(), type: z.enum(["student", "teacher", "room", "class", "course"]).optional(), mfa_code: mfaCode },
      annotations: readOnly,
    },
    async (a) => respond(() => gapsInfo(["find", a.query], { all: false, type: a.type, debug: false, mfaCode: a.mfa_code })),
  );

  server.registerTool(
    "get_study_plan",
    {
      title: "Study plan",
      description:
        "The user's study plan from GAPS as Markdown: per academic year, each module with its units, semester, ECTS " +
        "credits and status (followed, to follow, planned…).",
      inputSchema: { all_years: z.boolean().optional().describe("Every year of the curriculum instead of the current one"), mfa_code: mfaCode },
      annotations: readOnly,
    },
    async (a) => respond(() => gapsInfo(["plan"], { all: Boolean(a.all_years), debug: false, mfaCode: a.mfa_code })),
  );

  for (const kind of ["unit", "module"] as const) {
    server.registerTool(
      `get_${kind}_sheet`,
      {
        title: kind === "unit" ? "Unit sheet" : "Module sheet",
        description:
          kind === "unit"
            ? "The official description of a teaching unit (e.g. MAD, RXI) as Markdown: teacher in charge, workload, " +
              "periods, prerequisites, objectives, content per topic, assessment, final grade, bibliography."
            : "The official description of a module (e.g. MAI1) as Markdown: its units, ECTS credits, how the module grade " +
              "is computed, compensation and repetition thresholds, skills.",
        inputSchema: { code: z.string().describe(kind === "unit" ? "Unit code, e.g. MAD" : "Module code, e.g. MAI1"), mfa_code: mfaCode },
        annotations: readOnly,
      },
      async (a) => respond(() => gapsInfo([kind, a.code], { all: false, debug: false, mfaCode: a.mfa_code })),
    );
  }

  server.registerTool(
    "get_grades",
    {
      title: "Grades",
      description:
        "The user's grades from GAPS: continuous assessment of the current semester per course (each test with grade, " +
        "class average and coefficient) and the official transcript. Personal data: only use when the user asks.",
      inputSchema: { mfa_code: mfaCode },
      annotations: readOnly,
    },
    async (a) => respond(() => gapsInfo(["grades"], { all: false, debug: false, mfaCode: a.mfa_code })),
  );

  server.registerTool(
    "get_absences",
    {
      title: "Absences",
      description: "The user's absences per unit from GAPS (periods, justified ones, rates). Personal data: only use when asked.",
      inputSchema: { mfa_code: mfaCode },
      annotations: readOnly,
    },
    async (a) => respond(() => gapsInfo(["absences"], { all: false, debug: false, mfaCode: a.mfa_code })),
  );

  server.registerTool(
    "get_deadlines",
    {
      title: "Deadlines",
      description:
        "Cyberlearn activities the user still has to do (assignments, quizzes, lab report forms), overdue ones included, " +
        "sorted by due date.",
      inputSchema: { days: z.number().int().min(0).optional().describe("Only those due within this many days"), mfa_code: mfaCode },
      annotations: readOnly,
    },
    async (a) =>
      respond(async () => {
        const deadlines = await loadDeadlines(a.days, false, a.mfa_code);
        return renderDeadlines(deadlines, scheduleCourses((await readCache())?.lessons ?? []), "emoji");
      }),
  );

  server.registerTool(
    "get_cyberlearn_course",
    {
      title: "Cyberlearn course content",
      description:
        "Everything published on a Cyberlearn course page as text: sections, plannings and announcements (where " +
        "teachers list exercises and homework), resources with their dates, quizzes and assignments. Without `course`, " +
        "lists the user's Cyberlearn courses.",
      inputSchema: { course: z.string().optional().describe("Timetable code (e.g. MAD), course id or part of its name"), mfa_code: mfaCode },
      annotations: readOnly,
    },
    async (a) => respond(() => loadCourses(a.course, false, a.mfa_code)),
  );
}
