import assert from "node:assert/strict";
import { after, test } from "node:test";
import { addEvent, createCalendar, deadlinesToEvents, deleteCalendar, eventHistory, findCalendar, getEvent, lessonsToEvents, listCalendars, listEvents, removeEvent, resetEvent, syncSourceEvents, updateCalendar, updateEvent } from "../src/app/calendar.js";
import { latestSnapshot, saveSnapshot } from "../src/app/snapshots.js";
import type { Db } from "../src/rag/db.js";
import { testDb } from "./helpers/db.js";

// Created before the tests are declared, so that `skip` knows whether a database is available.
const db: Db | undefined = await testDb("heigkit_test_calendar");
after(async () => db?.end());

const lesson = (summary: string, start: string, location = "A01") => ({ summary, start, end: start.replace("T08:30", "T10:05"), location, description: "" });
const day = (iso: string) => new Date(iso);

test("lessons and deadlines become keyed events, exams are detected", () => {
  const [l] = lessonsToEvents([lesson("MAD-E-C1", "2026-11-10T08:30:00.000Z")]);
  assert.equal(l.key, "gaps:MAD-E-C1|2026-11-10T08:30:00.000Z");
  assert.equal(l.course, "MAD");
  assert.equal(l.kind, "lesson");
  const [te] = lessonsToEvents([{ ...lesson("MAD-E-C1", "2026-11-14T08:30:00.000Z"), description: "TE 1" }]);
  assert.equal(te.kind, "exam");
  const [d] = deadlinesToEvents([{ id: 42, due: "2026-11-20T22:59:00.000Z", name: "Labo 3", module: "assign", course: "Programmation 1", courseShortName: "26-27_HEIG-VD_PRG1", action: "Add submission", overdue: false, url: "u" }], ["PRG1", "MAD"]);
  assert.equal(d.key, "cyberlearn:42");
  assert.equal(d.course, "PRG1");
  assert.equal(d.kind, "deadline");
});

test("a source sync records new, changed and removed events, and a manual change wins until the source changes again", { skip: !db && "no local database" }, async () => {
  const from = day("2026-11-01T00:00:00Z");
  const to = day("2026-12-01T00:00:00Z");
  const first = lessonsToEvents([lesson("MAD-E-C1", "2026-11-10T08:30:00.000Z"), lesson("PRG-D-L1", "2026-11-11T08:30:00.000Z")]);
  assert.deepEqual(await syncSourceEvents(db!, "gaps", first, from), { added: 2, changed: 0, removed: 0, unchanged: 0 });
  assert.deepEqual(await syncSourceEvents(db!, "gaps", first, from), { added: 0, changed: 0, removed: 0, unchanged: 2 });

  // The user moves a lesson to another room: shown, and the unchanged source does not undo it.
  const key = first[0].key;
  await new Promise((r) => setTimeout(r, 5));
  const moved = await updateEvent(db!, key, { location: "B12" }, "user");
  assert.equal(moved.location, "B12");
  assert.equal(moved.overridden, true);
  await syncSourceEvents(db!, "gaps", first, from);
  assert.equal((await getEvent(db!, key))!.location, "B12");

  // The source changes after the user: the source wins back.
  await new Promise((r) => setTimeout(r, 5));
  const changed = [{ ...first[0], location: "C23" }, first[1]];
  const lessons = lessonsToEvents([lesson("MAD-E-C1", "2026-11-10T08:30:00.000Z", "C23"), lesson("PRG-D-L1", "2026-11-11T08:30:00.000Z")]);
  assert.deepEqual(await syncSourceEvents(db!, "gaps", lessons, from), { added: 0, changed: 1, removed: 0, unchanged: 1 });
  const current = (await getEvent(db!, key))!;
  assert.equal(current.location, "C23");
  assert.equal(current.overridden, false);
  assert.equal((await eventHistory(db!, key)).length, 3);
  void changed;

  // A lesson disappears from GAPS: a deleted version hides it.
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await syncSourceEvents(db!, "gaps", [lessons[0]], from), { added: 0, changed: 0, removed: 1, unchanged: 1 });
  assert.deepEqual((await listEvents(db!, from, to)).map((e) => e.key), [key]);

  // Manual events, removal and reset.
  const exam = await addEvent(db!, { kind: "exam", title: "TE 2 MAD", course: "MAD", startsAt: day("2026-11-28T08:30:00Z") }, "agent");
  assert.match(exam.key, /^manual:/);
  assert.equal((await listEvents(db!, from, to, { kinds: ["exam"] })).length, 1);
  await removeEvent(db!, key, "user");
  assert.deepEqual((await listEvents(db!, from, to)).map((e) => e.key), [exam.key]);
  await resetEvent(db!, key);
  assert.equal((await getEvent(db!, key))!.location, "C23");
  await assert.rejects(resetEvent(db!, exam.key), /manual event/);
});

test("calendars: the built-in ones receive the source events, the user's own hold their events and can be hidden or deleted", { skip: !db && "no local database" }, async () => {
  const from = day("2027-01-01T00:00:00Z");
  const to = day("2027-02-01T00:00:00Z");
  const builtin = await listCalendars(db!);
  assert.deepEqual(builtin.map((c) => c.slug), ["schedule", "exams", "deadlines"]);
  const exams = (await findCalendar(db!, "exams"))!;
  assert.equal((await findCalendar(db!, "Examens"))?.id, exams.id);

  const revision = await createCalendar(db!, { name: "Révision MAD", description: "TE 1" });
  assert.match(revision.color, /^#[0-9a-f]{6}$/);
  assert.equal(revision.slug, undefined);
  await assert.rejects(createCalendar(db!, { name: "x", color: "red" }), /rrggbb/);

  const session = await addEvent(db!, { kind: "event", title: "Relire le chapitre 1", course: "MAD", startsAt: day("2027-01-05T17:00:00Z"), calendarId: revision.id }, "agent");
  assert.equal(session.calendarId, revision.id);
  const te = await addEvent(db!, { kind: "exam", title: "TE 1", course: "MAD", startsAt: day("2027-01-08T08:30:00Z") }, "user");
  assert.equal(te.calendarId, exams.id);
  await assert.rejects(addEvent(db!, { kind: "event", title: "x", startsAt: day("2027-01-05T17:00:00Z"), calendarId: 9999 }, "user"), /No calendar 9999/);
  assert.deepEqual((await listEvents(db!, from, to, { calendars: [revision.id] })).map((e) => e.key), [session.key]);

  // Hidden calendars are left out when asked; moving an event to another calendar is a manual version like any other.
  await updateCalendar(db!, revision.id, { visible: false, name: "Révision MAD TE 1" });
  assert.deepEqual((await listEvents(db!, from, to, { visibleOnly: true })).map((e) => e.key), [te.key]);
  assert.equal((await listEvents(db!, from, to)).length, 2);
  const moved = await updateEvent(db!, te.key, { calendarId: revision.id }, "user");
  assert.equal(moved.calendarId, revision.id);

  await assert.rejects(deleteCalendar(db!, exams.id), /built in/);
  await deleteCalendar(db!, revision.id);
  assert.equal(await findCalendar(db!, revision.id), undefined);
  // Its own events are gone; the exam moved into it falls back to its earlier version, in Examens.
  assert.deepEqual((await listEvents(db!, from, to)).map((e) => [e.key, e.calendarId]), [[te.key, exams.id]]);
});

test("snapshots only store a new state when the data changed", { skip: !db && "no local database" }, async () => {
  assert.equal((await saveSnapshot(db!, "grades", [{ course: "MAD", average: "5.0" }])).changed, true);
  assert.equal((await saveSnapshot(db!, "grades", [{ course: "MAD", average: "5.0" }])).changed, false);
  assert.equal((await saveSnapshot(db!, "grades", [{ course: "MAD", average: "5.5" }])).changed, true);
  const latest = await latestSnapshot<{ average: string }[]>(db!, "grades");
  assert.equal(latest?.data[0].average, "5.5");
});
