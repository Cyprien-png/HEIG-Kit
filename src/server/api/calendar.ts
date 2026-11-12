import {
  type CalendarPatch,
  type EventKind,
  type EventPatch,
  addEvent,
  calendarToJson,
  createCalendar,
  deleteCalendar,
  eventHistory,
  eventToJson,
  getEvent,
  listCalendars,
  listEvents,
  overriddenEvents,
  removeEvent,
  resetEvent,
  updateCalendar,
  updateEvent,
} from "../../app/calendar.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { dateField, HttpError, intParam, readJson, rethrowRefusal, stringField } from "./util.js";

const KINDS: EventKind[] = ["lesson", "deadline", "exam", "event"];

function kindField(body: Record<string, unknown>, optional: boolean): EventKind | undefined {
  const kind = stringField(body, "kind", { optional });
  if (kind !== undefined && !KINDS.includes(kind as EventKind)) throw new HttpError(400, `kind must be one of ${KINDS.join(", ")}`);
  return kind as EventKind | undefined;
}

function calendarField(body: Record<string, unknown>): number | undefined {
  if (body.calendarId === undefined || body.calendarId === null) return undefined;
  if (typeof body.calendarId !== "number" || !Number.isInteger(body.calendarId) || body.calendarId <= 0) throw new HttpError(400, "calendarId must be a positive integer");
  return body.calendarId;
}

/** The author of a change: the browser is the user, a bearer token is the agent (or the CLI on their behalf). */
const authorOf = (kind: string): "user" | "agent" => (kind === "cookie" ? "user" : "agent");

/** Domain errors as HTTP answers: missing things are 404, the rest 400. */
async function domain<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    rethrowRefusal(error);
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(/^No (event|calendar)/.test(message) ? 404 : 400, message);
  }
}

export function registerCalendarRoutes(router: Router, app: App): void {
  router.get("/api/calendar", async ({ url }) => {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const start = from ? new Date(from) : new Date(Date.now() - 7 * 86_400_000);
    const end = to ? new Date(to) : new Date(start.getTime() + 35 * 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new HttpError(400, "from and to must be ISO dates");
    const kinds = url.searchParams.get("kinds")?.split(",").filter((k): k is EventKind => KINDS.includes(k as EventKind));
    const calendars = url.searchParams.get("calendars")?.split(",").map((id) => intParam(id, "calendars"));
    const events = await listEvents(app.db, start, end, {
      kinds: kinds?.length ? kinds : undefined,
      course: url.searchParams.get("course") ?? undefined,
      calendars: calendars?.length ? calendars : undefined,
      visibleOnly: url.searchParams.get("visible") === "true",
    });
    return { from: start.toISOString(), to: end.toISOString(), events: events.map(eventToJson) };
  });

  router.get("/api/calendar/overrides", async () => ({ events: (await overriddenEvents(app.db)).map(eventToJson) }));

  // Calendars (layers)
  router.get("/api/calendars", async () => ({ calendars: (await listCalendars(app.db)).map(calendarToJson) }));

  router.post("/api/calendars", async ({ req }) => {
    const body = await readJson(req);
    const calendar = await domain(() =>
      createCalendar(app.db, {
        name: stringField(body, "name", { max: 80 })!,
        color: stringField(body, "color", { optional: true, max: 7 }),
        description: stringField(body, "description", { optional: true, max: 1000 }),
      }),
    );
    return calendarToJson(calendar);
  });

  router.patch("/api/calendars/:id", async ({ req, params }) => {
    const body = await readJson(req);
    const patch: CalendarPatch = {
      name: stringField(body, "name", { optional: true, max: 80 }),
      color: stringField(body, "color", { optional: true, max: 7 }),
      description: body.description === null ? null : stringField(body, "description", { optional: true, max: 1000 }),
      visible: typeof body.visible === "boolean" ? body.visible : undefined,
      position: typeof body.position === "number" && Number.isInteger(body.position) ? body.position : undefined,
    };
    return calendarToJson(await domain(() => updateCalendar(app.db, intParam(params.id, "id"), patch)));
  });

  router.delete("/api/calendars/:id", async ({ params }) => {
    await domain(() => deleteCalendar(app.db, intParam(params.id, "id")));
    return undefined;
  });

  // Events
  router.post("/api/calendar/events", async ({ req, principal }) => {
    const body = await readJson(req);
    const startsAt = dateField(body, "startsAt")!;
    const endsAt = dateField(body, "endsAt", true);
    if (endsAt && endsAt < startsAt) throw new HttpError(400, "the event ends before it starts");
    const event = await domain(() =>
      addEvent(
        app.db,
        {
          kind: kindField(body, true) ?? "event",
          title: stringField(body, "title", { max: 200 })!,
          course: stringField(body, "course", { optional: true, max: 40 }),
          startsAt,
          endsAt,
          allDay: body.allDay === true,
          location: stringField(body, "location", { optional: true, max: 200 }),
          url: stringField(body, "url", { optional: true, max: 500 }),
          details: stringField(body, "details", { optional: true, max: 20_000 }),
          calendarId: calendarField(body),
        },
        authorOf(principal.kind),
      ),
    );
    return eventToJson(event);
  });

  router.get("/api/calendar/events/:key", async ({ params }) => {
    const event = await getEvent(app.db, params.key);
    if (!event) throw new HttpError(404, "no such event");
    return eventToJson(event);
  });

  router.get("/api/calendar/events/:key/history", async ({ params }) => ({ versions: (await eventHistory(app.db, params.key)).map(eventToJson) }));

  router.patch("/api/calendar/events/:key", async ({ req, params, principal }) => {
    const body = await readJson(req);
    const nullable = (name: string, max: number) => (body[name] === null ? null : stringField(body, name, { optional: true, max }));
    const patch: EventPatch = {
      kind: kindField(body, true),
      title: stringField(body, "title", { optional: true, max: 200 }),
      course: nullable("course", 40),
      startsAt: dateField(body, "startsAt", true),
      endsAt: body.endsAt === null ? null : dateField(body, "endsAt", true),
      allDay: typeof body.allDay === "boolean" ? body.allDay : undefined,
      location: nullable("location", 200),
      url: nullable("url", 500),
      details: nullable("details", 20_000),
      calendarId: calendarField(body),
    };
    return eventToJson(await domain(() => updateEvent(app.db, params.key, patch, authorOf(principal.kind))));
  });

  router.delete("/api/calendar/events/:key", async ({ params, principal }) => {
    await domain(() => removeEvent(app.db, params.key, authorOf(principal.kind)));
    return undefined;
  });

  router.post("/api/calendar/events/:key/reset", async ({ params }) => {
    const event = await domain(() => resetEvent(app.db, params.key));
    return event ? eventToJson(event) : { reset: true };
  });
}
