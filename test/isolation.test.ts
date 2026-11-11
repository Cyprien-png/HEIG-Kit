import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addEvent, listCalendars, listEvents } from "../src/app/calendar.js";
import { createCorrection, getCorrection, listCorrections } from "../src/app/corrections.js";
import { addCards, createDeck, deleteDeck, getDeck, listDecks, review, studyQueue } from "../src/app/flashcards.js";
import { addNotes, listNotes } from "../src/app/profile.js";
import { saveSnapshot, latestSnapshot } from "../src/app/snapshots.js";
import { AccessDenied, type Identity, allowLocalOwner, requireExplicitIdentity, runAs } from "../src/identity.js";
import type { Db } from "../src/rag/db.js";
import { testDb } from "./helpers/db.js";

let db: Db | undefined;
let alice: Identity;
let bob: Identity;
let admin: Identity;

before(async () => {
  db = await testDb("heigkit_test_isolation");
  if (!db) return;
  const add = async (email: string, role: string) => Number((await db!.system.query("INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id", [email, role])).rows[0].id);
  alice = { id: await add("alice.martin@heig-vd.ch", "student"), role: "student" };
  bob = { id: await add("bob.durand@heig-vd.ch", "student"), role: "student" };
  admin = { id: await add("admin.root@heig-vd.ch", "admin"), role: "admin" };
  // Like the remote server: no identity outside runAs.
  requireExplicitIdentity();
});

after(async () => {
  allowLocalOwner();
  await db?.end();
});

test("personal data of an account does not exist for the others, administrators included", async (t) => {
  if (!db) return t.skip("no local database");
  const correction = await runAs(alice, () => createCorrection(db!, { title: "Série 3", course: "MAD" }));
  await runAs(alice, () => addNotes(db!, [{ course: "MAD", topic: "relations", kind: "weakness", text: "confond ordre total et partiel" }]));
  await runAs(alice, () => saveSnapshot(db!, "grades", [{ course: "MAD", grade: 5.5 }]));

  for (const other of [bob, admin]) {
    assert.equal(await runAs(other, () => getCorrection(db!, correction.id)), undefined);
    assert.deepEqual(await runAs(other, () => listCorrections(db!)), []);
    assert.deepEqual(await runAs(other, () => listNotes(db!)), []);
    assert.equal(await runAs(other, () => latestSnapshot(db!, "grades")), undefined);
  }
  assert.equal((await runAs(alice, () => listCorrections(db!))).length, 1);
  assert.equal((await runAs(alice, () => listNotes(db!))).length, 1);

  // Naming the other account in a query changes nothing: the row is refused or invisible.
  await assert.rejects(runAs(bob, () => db!.query("INSERT INTO profile_notes (user_id, topic, kind, text) VALUES ($1, 'x', 'note', 'y')", [alice.id])), AccessDenied);
  assert.equal((await runAs(bob, () => db!.query("UPDATE corrections SET title = 'pris' WHERE id = $1", [correction.id]))).rowCount, 0);
  assert.equal((await runAs(bob, () => db!.query("SELECT * FROM corrections WHERE user_id = $1", [alice.id]))).rowCount, 0);
  await assert.rejects(runAs(bob, () => db!.query("INSERT INTO correction_photos (correction_id, file, content_type, bytes) VALUES ($1, 'a.jpg', 'image/jpeg', 1)", [correction.id])), AccessDenied);
});

test("each account has its own calendars and events", async (t) => {
  if (!db) return t.skip("no local database");
  const mine = await runAs(alice, () => listCalendars(db!));
  const theirs = await runAs(bob, () => listCalendars(db!));
  assert.deepEqual(mine.map((c) => c.slug), ["schedule", "exams", "deadlines"]);
  assert.equal(theirs.length, 3);
  assert.equal(mine.some((c) => theirs.some((o) => o.id === c.id)), false);

  const start = new Date("2026-12-01T08:00:00Z");
  await runAs(alice, () => addEvent(db!, { kind: "exam", title: "TE MAD", startsAt: start }, "user"));
  const range = [new Date("2026-11-30T00:00:00Z"), new Date("2026-12-02T00:00:00Z")] as const;
  assert.equal((await runAs(alice, () => listEvents(db!, ...range))).length, 1);
  assert.equal((await runAs(bob, () => listEvents(db!, ...range))).length, 0);
  // An event cannot be put in someone else's calendar.
  await assert.rejects(runAs(bob, () => addEvent(db!, { kind: "event", title: "intrus", startsAt: start, calendarId: mine[0].id }, "user")));
});

test("decks are shared, changed by their author or an administrator, and studied each on their own", async (t) => {
  if (!db) return t.skip("no local database");
  const deck = await runAs(alice, () => createDeck(db!, { title: "Relations", course: "MAD" }));
  const [card] = await runAs(alice, () => addCards(db!, deck.id, [{ front: "Ordre total ?", back: "Tous comparables" }]));

  assert.equal((await runAs(bob, () => listDecks(db!))).length, 1);
  await assert.rejects(runAs(bob, () => addCards(db!, deck.id, [{ front: "x", back: "y" }])), AccessDenied);
  assert.equal(await runAs(bob, () => deleteDeck(db!, deck.id)), false);

  // Bob's reviews do not move Alice's cards.
  await runAs(bob, () => review(db!, card.id, 3));
  assert.equal((await runAs(bob, () => getDeck(db!, deck.id)))!.cardList[0].state?.reps, 1);
  assert.equal((await runAs(alice, () => getDeck(db!, deck.id)))!.cardList[0].state, undefined);
  assert.equal((await runAs(alice, () => studyQueue(db!, deck.id))).length, 1);

  assert.equal(await runAs(admin, () => deleteDeck(db!, deck.id)), true);
});

test("without an account, nothing personal is read or written", async (t) => {
  if (!db) return t.skip("no local database");
  assert.deepEqual(await listCorrections(db!), []);
  assert.deepEqual(await listCalendars(db!), []);
  await assert.rejects(createCorrection(db!, { title: "anonyme" }), AccessDenied);
  // The accounts themselves are out of reach of the application's queries.
  await assert.rejects(db!.query("SELECT password_hash FROM users"), AccessDenied);
  await assert.rejects(runAs(admin, () => db!.query("SELECT * FROM oauth_refresh_tokens")), AccessDenied);
  // A connection of its own carries the account too, and gives it back when released.
  const client = await runAs(alice, () => db!.connect());
  assert.equal((await client.query("SELECT heig_user() AS id")).rows[0].id, String(alice.id));
  client.release();
  assert.equal((await db!.system.query("SELECT current_user AS u, heig_user() AS id")).rows[0].id, null);
});
