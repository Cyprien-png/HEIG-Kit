/**
 * Calendar, flashcards, corrections and profile tools (docs/app.md), over the local database or a remote server.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import QRCode from "qrcode";
import { z } from "zod";
import type { HeigApi } from "../../app/api.js";
import { formatMockExams } from "../../app/exams.js";
import { formatProfile } from "../../app/profile.js";
import { TIME_ZONE } from "../../dates.js";
import { respond } from "../common.js";

const EVENT_KINDS = ["lesson", "deadline", "exam", "event"] as const;
const NOTE_KINDS = ["weakness", "strength", "mistake", "note"] as const;
const VERDICTS = ["correct", "partial", "wrong", "missing"] as const;

const when = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

type EventJson = Awaited<ReturnType<HeigApi["calendarList"]>>[number];
type CalendarJson = Awaited<ReturnType<HeigApi["calendars"]>>[number];

function formatEvents(events: EventJson[], calendars: CalendarJson[], withDetails = false): string {
  if (events.length === 0) return "No events in this period.";
  const names = new Map(calendars.map((c) => [c.id, c.name]));
  return events
    .map((e) => {
      const end = e.endsAt ? `–${new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(e.endsAt))}` : "";
      const flags = [e.overridden ? "modified by hand" : "", e.source === "manual" ? "manual" : ""].filter(Boolean).join(", ");
      const details = withDetails && e.details ? `\n  ${e.details.replace(/\n/g, "\n  ")}` : "";
      return `${when.format(new Date(e.startsAt))}${end} · ${e.kind} · ${e.course ? `${e.course} · ` : ""}${e.title}${e.location ? ` @ ${e.location}` : ""} · [${names.get(e.calendarId) ?? e.calendarId}]${flags ? ` (${flags})` : ""}\n  key: ${e.key}${details}`;
    })
    .join("\n");
}

const formatCalendars = (calendars: CalendarJson[]) =>
  calendars.length === 0 ? "No calendars." : calendars.map((c) => `${c.id} · ${c.name} · ${c.color} · ${c.visible ? "shown" : "hidden"}${c.slug ? ` · built in (${c.slug})` : ""}${c.description ? `\n  ${c.description}` : ""}`).join("\n");

/** A calendar by id, built-in slug or name. */
async function pickCalendar(api: HeigApi, ref: string | number | undefined): Promise<CalendarJson | undefined> {
  if (ref === undefined) return undefined;
  const calendars = await api.calendars();
  const text = String(ref).toLowerCase();
  const found = calendars.find((c) => String(c.id) === text || c.slug === text || c.name.toLowerCase() === text);
  if (!found) throw new Error(`No calendar "${ref}". Calendars: ${calendars.map((c) => `${c.id} ${c.name}`).join(", ")}`);
  return found;
}

/** What the web app renders in every Markdown field (cards, quiz statements, corrections). */
export const RICH_MARKDOWN = "Markdown: LaTeX between $…$, GFM tables, ```mermaid diagrams and charts (graph, flowchart, xychart-beta, pie…), ```svg drawings (viewBox plus a width in pixels, currentColor or black strokes; flip axes with a <g transform>, not on the <svg>)";

const cardSchema = z.object({
  front: z.string().describe(`Question or notion (${RICH_MARKDOWN})`),
  back: z.string().describe("Answer (same Markdown: a small diagram or table when the notion is visual)"),
  hint: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional().describe("Where it comes from, e.g. 'Cours MAD ch. 1 p. 32'"),
});

const exerciseSchema = z.object({
  number: z.string().describe("As numbered on the sheet, e.g. '2' or '3b'"),
  title: z.string().optional().describe("Plain text, no Markdown"),
  statement: z.string().optional().describe(`The statement of the exercise, always given: the printed statement transcribed from the sheet or the photos, completed from the course material (${RICH_MARKDOWN}); the web app shows it above the answer so that the whole context is in one place`),
  answer: z.string().describe(`The student's answer transcribed as written, mistakes included; their tables as Markdown tables, their drawings, graphs and diagrams redrawn faithfully as \`\`\`svg or \`\`\`mermaid, mistakes included (${RICH_MARKDOWN})`),
  verdict: z.enum(VERDICTS),
  points: z.object({ obtained: z.number(), total: z.number() }).optional(),
  feedback: z.string().describe("What is wrong and how it should have been done, step by step; 'Juste.' with a short confirmation when correct (same Markdown)"),
  solution: z.string().optional().describe("The complete correct solution, with the correct drawing, graph or table when the exercise has one (same Markdown)"),
  cause: z.string().optional().describe("Probable cause of the mistake, e.g. 'confusion entre ⊆ et ∈'"),
  topics: z.array(z.string()).describe("Course topics involved, short and reusable, e.g. 'inclusion-exclusion'"),
  regions: z.array(z.object({ page: z.number().int().positive(), x: z.number(), y: z.number(), w: z.number(), h: z.number() })).optional().describe("The zone of the photos holding this exercise (statement excluded), one per photo it spans: page = photo number (1 = first), x and y = top left corner, w and h = size, all as fractions between 0 and 1 of the photo (x 0 = left edge, y 0 = top edge). Leave a small margin around the writing. The web app crops the photo to it under the transcribed answer (eye icon)"),
  pages: z.array(z.number().int().positive()).optional().describe("Numbers of the photos (1 = first) on which the student wrote this exercise; the web app shows them under the transcribed answer (eye icon) so that nothing has to be searched in the photos"),
});

const noteSchema = z.object({
  course: z.string().optional().describe("Course code, e.g. MAD"),
  chapter: z.string().optional().describe("Chapter of the course the topic belongs to (title or number from get_profile), so the chapter radar reflects it"),
  section: z.string().optional().describe("Section of that chapter (title or number from get_profile, e.g. '2.3' or 'Relation d'ordre')"),
  topic: z.string().describe("Short reusable topic, e.g. 'inclusion-exclusion'"),
  kind: z.enum(NOTE_KINDS),
  text: z.string().describe("The observation, one or two sentences"),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe("1 minor, 2 notable (default), 3 recurring or blocking"),
  correctionId: z.string().optional(),
  exercise: z.string().optional(),
});

export function registerStudyTools(server: McpServer, api: HeigApi): void {
  // Calendar
  server.registerTool(
    "get_calendar",
    {
      title: "Calendar",
      description:
        "The student's calendar: GAPS lessons (with the programme their course page announces on Cyberlearn), Cyberlearn " +
        "deadlines, exams and events added by hand, between two dates (default: the coming 14 days), across calendars " +
        "(layers: Horaires, Examens, Rendus, and the student's own such as a revision plan). Each event has a key, needed " +
        "to change or remove it. Events changed by hand stay so until the source changes again.",
      inputSchema: {
        from: z.string().optional().describe("ISO date or date-time, default today"),
        to: z.string().optional().describe("ISO date or date-time, default from + 14 days"),
        kinds: z.array(z.enum(EVENT_KINDS)).optional(),
        course: z.string().optional(),
        calendar: z.string().optional().describe("Only this calendar (id or name)"),
        details: z.boolean().optional().describe("Include each event's details (programme of a lesson, content of a revision session)"),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      respond(async () => {
        const from = a.from ? new Date(a.from) : new Date(new Date().setHours(0, 0, 0, 0));
        const to = a.to ? new Date(a.to) : new Date(from.getTime() + 14 * 86_400_000);
        if (a.to && !/T/.test(a.to)) to.setDate(to.getDate() + 1);
        const calendar = await pickCalendar(api, a.calendar);
        const events = await api.calendarList(from.toISOString(), to.toISOString(), { kinds: a.kinds, course: a.course, calendars: calendar ? [calendar.id] : undefined });
        return formatEvents(events, await api.calendars(), a.details);
      }),
  );

  server.registerTool(
    "set_calendar_event",
    {
      title: "Add or change a calendar event",
      description:
        "Adds an exam, a deadline, a revision session or any event the student asks for, or changes an existing one by " +
        "its key (a deadline a teacher did not update on Cyberlearn, a moved exam…). A change of a GAPS or Cyberlearn " +
        "event stays until that source changes again after it. Times are Europe/Zurich unless an offset is given. " +
        "Details are Markdown (lists of exercises to do, topics, links).",
      inputSchema: {
        key: z.string().optional().describe("Key of the event to change (from get_calendar); omit to add a new event"),
        kind: z.enum(EVENT_KINDS).optional().describe("Default: event (exam for tests and exams)"),
        title: z.string().optional(),
        course: z.string().optional(),
        starts_at: z.string().optional().describe("ISO date-time, e.g. 2026-11-14T08:30:00+01:00"),
        ends_at: z.string().optional(),
        all_day: z.boolean().optional(),
        location: z.string().optional(),
        url: z.string().optional(),
        details: z.string().optional().describe("Markdown"),
        calendar: z.string().optional().describe("Calendar (id or name) the event belongs to; default: Examens for exams, Rendus for deadlines, Horaires otherwise"),
      },
    },
    async (a) =>
      respond(async () => {
        const calendarId = (await pickCalendar(api, a.calendar))?.id;
        const patch = { kind: a.kind, title: a.title, course: a.course, startsAt: a.starts_at, endsAt: a.ends_at, allDay: a.all_day, location: a.location, url: a.url, details: a.details, calendarId };
        const calendars = await api.calendars();
        if (a.key) return `Updated:\n${formatEvents([await api.calendarUpdate(a.key, patch)], calendars)}`;
        if (!a.title || !a.starts_at) throw new Error("A new event needs at least title and starts_at");
        return `Added:\n${formatEvents([await api.calendarAdd({ ...patch, kind: a.kind ?? "event", title: a.title, startsAt: a.starts_at })], calendars)}`;
      }),
  );

  server.registerTool(
    "remove_calendar_event",
    {
      title: "Remove a calendar event",
      description: "Removes an event by its key (hidden until its source changes again, for GAPS and Cyberlearn events). With reset, forgets the manual changes of a source event instead, so its source version shows again.",
      inputSchema: { key: z.string(), reset: z.boolean().optional().describe("Go back to the GAPS or Cyberlearn version instead of removing") },
      annotations: { destructiveHint: true },
    },
    async (a) =>
      respond(async () => {
        if (a.reset) {
          const event = await api.calendarReset(a.key);
          return event ? `Back to the source version:\n${formatEvents([event], await api.calendars())}` : "Manual changes forgotten.";
        }
        await api.calendarRemove(a.key);
        return `Removed ${a.key}.`;
      }),
  );

  server.registerTool(
    "get_calendar_event_history",
    {
      title: "History of a calendar event",
      description: "Every version of an event (source changes and manual changes), most recent first, with who made it and when.",
      inputSchema: { key: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      respond(async () => {
        const versions = await api.calendarHistory(a.key);
        if (versions.length === 0) return `No event ${a.key}`;
        return versions.map((v) => `${v.fetchedAt} · ${v.source}/${v.author}${v.deleted ? " · deleted" : ""} · ${v.title} · ${v.startsAt}${v.endsAt ? ` → ${v.endsAt}` : ""}${v.location ? ` @ ${v.location}` : ""}`).join("\n");
      }),
  );

  server.registerTool(
    "list_calendars",
    {
      title: "Calendars",
      description: "The calendars (layers) of the student's calendar page: the built-in Horaires, Examens and Rendus, and the student's own (revision plans…), with their colors and whether they are shown.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => respond(async () => formatCalendars(await api.calendars())),
  );

  server.registerTool(
    "set_calendar",
    {
      title: "Create or change a calendar",
      description:
        "Creates a calendar (layer), e.g. 'Révision MAD' for a revision plan before an exam, then add its sessions with " +
        "set_calendar_event and calendar=<its name>. With id, changes a calendar's name, color, description or visibility " +
        "(the built-in ones can be renamed and hidden, not deleted).",
      inputSchema: {
        id: z.number().int().optional().describe("Calendar to change; omit to create one"),
        name: z.string().optional(),
        color: z.string().optional().describe("#rrggbb; default: the next free color"),
        description: z.string().optional(),
        visible: z.boolean().optional(),
      },
    },
    async (a) =>
      respond(async () => {
        if (a.id !== undefined) return `Updated:\n${formatCalendars([await api.calendarEdit(a.id, { name: a.name, color: a.color, description: a.description, visible: a.visible })])}`;
        if (!a.name) throw new Error("A new calendar needs a name");
        return `Created:\n${formatCalendars([await api.calendarCreate({ name: a.name, color: a.color, description: a.description })])}`;
      }),
  );

  server.registerTool(
    "remove_calendar",
    {
      title: "Delete a calendar",
      description: "Deletes one of the student's own calendars with all its events (a built-in calendar can only be hidden with set_calendar).",
      inputSchema: { calendar: z.string().describe("Id or name") },
      annotations: { destructiveHint: true },
    },
    async (a) =>
      respond(async () => {
        const calendar = (await pickCalendar(api, a.calendar))!;
        await api.calendarDelete(calendar.id);
        return `Deleted calendar ${calendar.name} and its events.`;
      }),
  );

  // Flashcards
  server.registerTool(
    "list_decks",
    {
      title: "Flashcard decks",
      description: "The student's flashcard decks with their number of cards, cards due and new cards; with deck_id, the deck's cards.",
      inputSchema: { course: z.string().optional(), deck_id: z.number().int().optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      respond(async () => {
        if (a.deck_id) {
          const deck = await api.deck(a.deck_id);
          if (!deck) return `No deck ${a.deck_id}`;
          return [`# ${deck.title} (${deck.course ?? "no course"}, deck ${deck.id})`, deck.description ?? "", ...deck.cardList.map((c) => `- [${c.id}] ${c.front} → ${c.back}${c.tags?.length ? ` (${c.tags.join(", ")})` : ""}`)].join("\n");
        }
        const decks = await api.decks(a.course);
        return decks.length === 0 ? "No decks yet." : decks.map((d) => `[${d.id}] ${d.course ? `${d.course} · ` : ""}${d.title}: ${d.cards} cards, ${d.due} due, ${d.fresh} new`).join("\n");
      }),
  );

  server.registerTool(
    "create_deck",
    {
      title: "Create a flashcard deck",
      description:
        "Creates a deck of flashcards for a course, with its cards. Make cards from the course material (search it first): " +
        "one notion per card, a precise question on the front, a short exact answer on the back, in French, LaTeX for " +
        "formulas, the source of each card. The student studies them on the web app.",
      inputSchema: { title: z.string(), course: z.string().optional(), description: z.string().optional(), cards: z.array(cardSchema).min(1).max(200) },
    },
    async (a) =>
      respond(async () => {
        const deck = await api.createDeck({ title: a.title, course: a.course, description: a.description }, a.cards);
        return `Deck ${deck.id} "${deck.title}" created with ${deck.cards} cards.`;
      }),
  );

  server.registerTool(
    "add_flashcards",
    {
      title: "Add flashcards to a deck",
      description: "Appends cards to an existing deck (see list_decks).",
      inputSchema: { deck_id: z.number().int(), cards: z.array(cardSchema).min(1).max(200) },
    },
    async (a) => respond(async () => `${(await api.addCards(a.deck_id, a.cards)).length} cards added to deck ${a.deck_id}.`),
  );

  server.registerTool(
    "delete_flashcards",
    {
      title: "Delete flashcards or a deck",
      description: "Deletes cards by id, or a whole deck with its cards.",
      inputSchema: { card_ids: z.array(z.number().int()).optional(), deck_id: z.number().int().optional().describe("Deletes the whole deck") },
      annotations: { destructiveHint: true },
    },
    async (a) =>
      respond(async () => {
        if (a.deck_id) return (await api.deleteDeck(a.deck_id)) ? `Deck ${a.deck_id} deleted.` : `No deck ${a.deck_id}`;
        let count = 0;
        for (const id of a.card_ids ?? []) if (await api.deleteCard(id)) count++;
        return `${count} cards deleted.`;
      }),
  );

  // Corrections
  server.registerTool(
    "create_correction",
    {
      title: "Start a correction of handwritten work: capture link and QR code at once",
      description:
        "Creates a correction and returns, immediately, the link and the QR code the student scans to photograph their work. " +
        "Call it FIRST with no arguments and show the QR code right away (the text block as is, every line intact); only then " +
        "name the correction with update_correction (title, course, topic, notes) while the student is taking the photos, " +
        "so that neither waits for the other. Then call get_correction once they have sent their photos.",
      inputSchema: {
        title: z.string().optional().describe("Can be set later with update_correction, e.g. 'Série 3 MAD'"),
        course: z.string().optional(),
        topic: z.string().optional(),
        notes: z.string().optional().describe("What the student should photograph, shown on the capture page"),
        exam: z.string().optional().describe("When the work is a mock exam of the library (list_mock_exams): the statement's id, document:<name>, so that the Tests blancs page shows it as done with its grade"),
        affects_profile: z.boolean().optional().describe("Default true: the correction counts in the profile (course grade, weaknesses, chapters). false when the student asks that this work does not count; then do not call add_profile_notes for it"),
      },
    },
    async (a) => {
      try {
        const c = await api.createCorrection({ title: a.title, course: a.course, topic: a.topic, notes: a.notes, exam: a.exam, affectsProfile: a.affects_profile });
        const qr = await QRCode.toString(c.captureUrl, { type: "terminal", small: true });
        const png = (await QRCode.toDataURL(c.captureUrl, { margin: 1, width: 360 })).split(",")[1];
        const text =
          `Correction ${c.id} created. Show this QR code to the student now, in a code block, every line intact:\n\n${qr}\n` +
          `Link (valid 6 hours): ${c.captureUrl}\n` +
          (a.title ? "" : `Then, while they photograph, call update_correction with the title, course, topic and notes. `) +
          `Call get_correction once they say the photos are sent.`;
        return { content: [{ type: "text" as const, text }, { type: "image" as const, data: png, mimeType: "image/png" }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    },
  );

  server.registerTool(
    "list_mock_exams",
    {
      title: "The mock exams (TE blancs) of the library and what the student did with them",
      description:
        "Lists the practice exams of the library (documents tagged « te blanc », statement paired with its solutions) with " +
        "the corrections that answer them: to do, correction pending, or done with the grade on the Swiss scale (1 to 6). " +
        "Use it before generating a new mock exam (to avoid a duplicate and to vary the exercises) and when correcting one: " +
        "pass its id as `exam` to create_correction or update_correction so that it counts as done.",
      inputSchema: { course: z.string().optional().describe("Only this course code") },
      annotations: { readOnlyHint: true },
    },
    async (a) => respond(async () => formatMockExams(await api.mockExams(a.course))),
  );

  server.registerTool(
    "update_correction",
    {
      title: "Name and describe a correction",
      description:
        "Sets the title, course, topic and notes of a correction created with create_correction, typically right after showing " +
        "the QR code, while the student photographs their work. Pass null to clear a field.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional().describe("e.g. 'Série 3 MAD' or 'TE blanc ANA1'"),
        course: z.string().nullable().optional(),
        topic: z.string().nullable().optional(),
        notes: z.string().nullable().optional().describe("What the student should photograph, shown on the capture page"),
        exam: z.string().nullable().optional().describe("The mock exam this work answers (list_mock_exams id, document:<name>); null unlinks it"),
        affects_profile: z.boolean().optional().describe("true: the correction counts in the profile (the default); false: it is left out of the course grade, weaknesses and chapters (its notes are kept and count again if set back to true)"),
      },
    },
    async (a) =>
      respond(async () => {
        const c = await api.updateCorrection(a.id, { title: a.title, course: a.course, topic: a.topic, notes: a.notes, exam: a.exam, affectsProfile: a.affects_profile });
        return `Correction ${c.id}: ${c.title}${c.course ? ` (${c.course}${c.topic ? `, ${c.topic}` : ""})` : ""}, state ${c.state}${c.exam ? `, exam ${c.exam}` : ""}${c.affectsProfile ? "" : ", NOT counted in the profile"}.`;
      }),
  );

  server.registerTool(
    "get_correction",
    {
      title: "Read a correction and its photos",
      description:
        "State of a correction. Once the student sent their photos (state received), returns them as images to transcribe " +
        "and correct, following the correct_exercises prompt; then call submit_correction. Without id, lists the corrections.",
      inputSchema: { id: z.string().optional(), course: z.string().optional(), with_photos: z.boolean().optional().describe("Include the photos (default true when the state is received or corrected)") },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      if (!a.id) {
        return respond(async () => {
          const list = await api.corrections({ course: a.course });
          return list.length === 0 ? "No corrections yet." : list.map((c) => `${c.id} · ${c.state} · ${c.course ?? ""} ${c.title} · ${c.photos.length} photos · ${c.createdAt}`).join("\n");
        });
      }
      try {
        const c = await api.correction(a.id);
        if (!c) return { content: [{ type: "text" as const, text: `No correction ${a.id}` }], isError: true };
        const header = `Correction ${c.id}: ${c.title} (${c.course ?? "no course"}${c.topic ? `, ${c.topic}` : ""}), state ${c.state}, ${c.photos.length} photos${c.sentAt ? `, sent ${c.sentAt}` : ""}${c.exam ? `, mock exam ${c.exam}` : ""}${c.affectsProfile ? "" : ", NOT counted in the profile (do not add profile notes)"}.${c.notes ? `\nNotes: ${c.notes}` : ""}`;
        if (c.state === "capture") return { content: [{ type: "text" as const, text: `${header}\nThe student has not sent the photos yet: ask them to open the capture link and press Envoyer, then call again.` }] };
        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [{ type: "text", text: header }];
        if (a.with_photos !== false) {
          for (const [i, p] of (await api.correctionPhotos(c.id)).entries()) {
            content.push({ type: "text", text: `Photo ${i + 1}/${c.photos.length} (id ${p.id})` });
            content.push({ type: "image", data: p.data.toString("base64"), mimeType: p.contentType });
          }
        }
        if (c.result) content.push({ type: "text", text: `Result already submitted:\n${JSON.stringify(c.result, null, 2)}` });
        return { content };
      } catch (error) {
        return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    },
  );

  server.registerTool(
    "submit_correction",
    {
      title: "Submit a correction",
      description:
        "Stores the correction of photographed work (see correct_exercises): every exercise with the student's answer as written, " +
        "a verdict, the feedback, the solution, the probable cause and topics. Shown on the web with two levels (verdicts only, " +
        "then the details). Also record the observations in the profile with add_profile_notes.",
      inputSchema: {
        id: z.string(),
        summary: z.string().describe("Two or three sentences: overall result, main strengths and the main thing to work on"),
        exercises: z.array(exerciseSchema).min(1),
        to_revise: z.array(z.string()).optional().describe("Topics to revise, most urgent first"),
      },
    },
    async (a) =>
      respond(async () => {
        const c = await api.submitCorrection(a.id, { summary: a.summary, exercises: a.exercises, toRevise: a.to_revise });
        const counts = VERDICTS.map((v) => `${c.result?.exercises.filter((e) => e.verdict === v).length ?? 0} ${v}`).join(", ");
        return `Correction ${c.id} stored (${counts}). The student sees it on the web app under Corrections.`;
      }),
  );

  // Profile
  server.registerTool(
    "get_profile",
    {
      title: "Student profile",
      description:
        "What the student does well and badly, per course and topic, from past corrections and notes: weaknesses, frequent " +
        "mistakes, strengths, the status of each chapter of the course and the topics to revise first. Use it before preparing " +
        "revisions, exercises or a practice exam. " +
        "With query, the notes closest in meaning.",
      inputSchema: { course: z.string().optional(), query: z.string().optional().describe("Find notes about a topic, e.g. 'cardinal et inclusion-exclusion'") },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      respond(async () => {
        if (a.query) {
          const notes = await api.searchNotes(a.query, a.course);
          return notes.length === 0 ? "No matching notes." : notes.map((n) => `[${n.id}] ${n.course ?? ""} · ${n.topic} · ${n.kind} (severity ${n.severity}) · ${n.text}`).join("\n");
        }
        return formatProfile(await api.profile(a.course));
      }),
  );

  server.registerTool(
    "add_profile_notes",
    {
      title: "Record observations about the student",
      description:
        "Records what a correction or a conversation showed: a mistake (what went wrong and why), a weakness (a topic not " +
        "mastered), a strength, or a note the student asked to keep. Short reusable topics, so they aggregate across time.",
      inputSchema: { notes: z.array(noteSchema).min(1).max(50) },
    },
    async (a) => respond(async () => `${(await api.addNotes(a.notes)).length} notes recorded.`),
  );

  server.registerTool(
    "set_course_chapters",
    {
      title: "Set the chapters of a course",
      description:
        "Replaces the chapters of a course, in order: the axes of the profile's radar, each chapter mastered, fragile, struggling or " +
        "not assessed from the notes filed under it. Take them from the unit sheet (get_unit_sheet) or the course page " +
        "(get_cyberlearn_course); give each chapter the topics its notes use as keywords, so existing notes land in it.",
      inputSchema: {
        course: z.string().describe("Course code, e.g. MAD"),
        chapters: z
          .array(
            z.object({
              title: z.string().describe("e.g. '3. Relations'"),
              keywords: z.array(z.string()).optional().describe("Topics of the chapter as the notes name them, e.g. 'relation d'ordre', 'diagramme de Hasse'"),
              sections: z
                .array(z.object({ title: z.string().describe("e.g. 'Relation d'ordre'"), keywords: z.array(z.string()).optional().describe("Topics of the section, e.g. 'ordre partiel', 'ordre total', 'diagramme de Hasse'") }))
                .max(40)
                .optional()
                .describe("Its sub-chapters in order (the sections of the lecture), each assessed on its own inside the chapter"),
            }),
          )
          .max(60),
        refile: z.boolean().optional().describe("true to refile every existing note of the course by the new keywords, not only the notes without a chapter"),
      },
    },
    async (a) =>
      respond(async () => {
        const chapters = await api.setChapters(a.course, a.chapters);
        if (chapters.length === 0) return `Chapters of ${a.course.toUpperCase()} removed.`;
        const filed = await api.fileNotes(a.course, a.refile ?? false);
        return `${chapters.length} chapters of ${chapters[0].course}:\n${chapters.map((c) => `${c.position}. ${c.title}${c.keywords.length ? ` (${c.keywords.join(", ")})` : ""}${c.sections.map((x) => `\n   ${c.position}.${x.position} ${x.title}${x.keywords.length ? ` (${x.keywords.join(", ")})` : ""}`).join("")}`).join("\n")}\n${filed.filed} existing notes filed under them.${filed.unassigned.length ? ` Under no chapter (add their topic to a chapter's keywords): ${filed.unassigned.join(", ")}` : ""}`;
      }),
  );

  server.registerTool(
    "update_profile_note",
    {
      title: "Refile or rename a note",
      description: "Moves a note to another chapter or section of its course (or clears them with null), or renames its topic so it aggregates with the others.",
      inputSchema: { id: z.number().int(), chapter: z.string().nullable().optional().describe("Chapter title or number, null to clear"), section: z.string().nullable().optional().describe("Section title or number within the chapter, null to clear"), topic: z.string().optional() },
    },
    async (a) =>
      respond(async () => {
        if (a.chapter === undefined && a.section === undefined && a.topic === undefined) throw new Error("Give a chapter, a section or a topic");
        const note = await api.updateNote(a.id, { chapter: a.chapter, section: a.section, topic: a.topic });
        return note ? `Note ${note.id}: ${note.topic}${note.chapter ? ` · ${note.chapter}` : ""}${note.section ? ` › ${note.section}` : ""}` : `No note ${a.id}`;
      }),
  );

  server.registerTool(
    "resolve_profile_note",
    {
      title: "Mark a weakness as overcome",
      description: "Resolves a note (it no longer counts in the profile), e.g. when a later correction shows the topic is mastered.",
      inputSchema: { id: z.number().int(), resolved: z.boolean().optional().describe("false to reopen") },
    },
    async (a) => respond(async () => ((await api.resolveNote(a.id, a.resolved ?? true)) ? `Note ${a.id} ${a.resolved === false ? "reopened" : "resolved"}.` : `No note ${a.id}`)),
  );
}

/** Prompts guiding the agent so that corrections and revisions always follow the same method. */
export function registerStudyPrompts(server: McpServer): void {
  server.registerPrompt(
    "correct_exercises",
    {
      title: "Correct photographed work",
      description: "Transcribes and corrects the student's handwritten exercises from a correction's photos, the same way every time",
      argsSchema: { correction_id: z.string() },
    },
    ({ correction_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: CORRECTION_METHOD.replace("{id}", correction_id),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "revise_weaknesses",
    {
      title: "Revision session on weak points",
      description: "Builds a revision from the student's profile: explanations and exercises on the topics they struggle with",
      argsSchema: { course: z.string().optional() },
    },
    ({ course }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Prépare-moi une séance de révision${course ? ` de ${course}` : ""} ciblée sur mes points faibles. Lis d'abord mon profil (get_profile` +
              `${course ? ` course=${course}` : ""}) et mes dernières corrections (get_correction), puis le cours (search_course_material) sur les 2 ou 3 ` +
              "thèmes les plus urgents de « À réviser en priorité ». Pour chaque thème : pourquoi je me trompe (d'après les causes notées), la bonne " +
              "méthode en quelques étapes avec un exemple du cours, puis 2 exercices nouveaux du même type avec corrigé détaillé. Termine par un " +
              "paquet de cartes (create_deck) reprenant les points clés, et propose une fiche PDF (render_document) si j'en veux une.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "make_flashcards",
    {
      title: "Flashcards from the course",
      description: "Creates a deck of flashcards on a chapter or topic from the student's course material",
      argsSchema: { course: z.string(), topic: z.string().optional() },
    },
    ({ course, topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Crée-moi un paquet de cartes de révision de ${course}${topic ? ` sur ${topic}` : ""}. Regarde d'abord list_decks pour ne pas refaire un paquet existant, ` +
              "puis lis le cours (search_course_material, get_document) et écris 20 à 40 cartes : une notion par carte, question précise au recto, " +
              "réponse courte et exacte au verso (définitions, formules en LaTeX, méthodes en 2-3 étapes, pièges fréquents), la source de chaque carte " +
              "(document, page). Crée le paquet avec create_deck.",
          },
        },
      ],
    }),
  );
}

export const CORRECTION_METHOD = `Corrige mon travail photographié (correction {id}) toujours de la même manière :

1. Lis la correction avec get_correction (les photos y sont). Si l'état est encore "capture", dis-moi d'envoyer les photos et attends.
2. Pour chaque exercice visible, transcris EXACTEMENT ce que j'ai écrit (champ answer, Markdown et LaTeX), erreurs comprises, sans corriger en transcrivant : mes tableaux en tableaux Markdown, mes dessins, graphes, diagrammes (Hasse, automates, courbes, schémas) redessinés fidèlement dans un bloc \`\`\`svg (viewBox, traits en currentColor) ou \`\`\`mermaid (graph, flowchart, xychart-beta…), avec mes erreurs. Si une partie est illisible, écris [illisible] et dis-le dans le feedback. La solution contient le dessin, le graphe ou le tableau correct quand l'exercice en a un.
3. Écris toujours l'énoncé complet de chaque exercice dans le champ statement (recopié de la feuille ou des photos, ou retrouvé dans mes supports de cours avec get_exercise et search_course_material), pour que je retrouve tout le contexte sur la page. Retrouve aussi la solution de référence dans les supports ; sinon résous l'exercice toi-même en suivant la méthode du cours.
4. Juge chaque exercice : correct (résultat et démarche justes), partial (démarche juste mais erreur de calcul, étape manquante ou justification insuffisante), wrong (méthode fausse ou résultat faux), missing (non traité).
5. Pour chaque exercice non correct : dans feedback, montre précisément où est l'erreur (cite ma ligne fautive) et comment il fallait faire, étape par étape ; dans solution, la solution complète ; dans cause, la cause probable en quelques mots (confusion de notions, oubli d'un cas, erreur de calcul, lecture d'énoncé, méthode non maîtrisée…). Pour les exercices corrects, confirme en une phrase et signale une amélioration possible de rédaction s'il y en a.
6. Donne à chaque exercice ses topics (thèmes courts et réutilisables, en français, p. ex. "inclusion-exclusion", "diagramme de Hasse").
7. Appelle submit_correction avec le résumé (résultat global, points forts, LA chose à travailler), les exercices et to_revise.
8. Enregistre dans mon profil (add_profile_notes, avec correctionId, exercise, le chapitre et la section du cours concernés, parmi ceux que donne get_profile ; s'il n'y a pas encore de chapitres pour ce cours, définis-les d'abord avec set_course_chapters depuis la fiche d'unité) : une note "mistake" par erreur (topic, cause, sévérité), une note "weakness" par thème non maîtrisé, une note "strength" par thème clairement maîtrisé. Si une faiblesse déjà notée est maintenant maîtrisée, résous-la (resolve_profile_note).
9. Réponds-moi en deux niveaux : d'abord seulement la liste des exercices avec juste/partiel/faux (pour que je cherche mes erreurs moi-même), puis, séparé par un titre « Détails », la correction complète.`;
