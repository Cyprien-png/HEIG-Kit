import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { addPhoto, createCorrection, deleteCorrection, getCorrection, listCorrections, markSent, photosWithData, replacePhoto, reorderPhotos, sniffImage, submitResult, validateResult, verdictStats } from "../src/app/corrections.js";
import { addCards, createDeck, deleteDeck, getDeck, listDecks, review, schedule, studyQueue, studyStats, updateCard } from "../src/app/flashcards.js";
import { addNotes, formatProfile, listNotes, profileSummary, resolveNote, searchNotes } from "../src/app/profile.js";
import type { Db } from "../src/rag/db.js";
import { testDb } from "./helpers/db.js";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "heig-study-"));
process.env.HEIG_DATA_DIR = dataDir;
const db: Db | undefined = await testDb("heigkit_test_study");
after(async () => {
  await db?.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);

test("spaced repetition: a new card graded good comes back in a day, again in ten minutes, easy grows fast", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  const good = schedule(undefined, 2, now);
  assert.equal(good.intervalDays, 1);
  assert.equal(good.dueAt.toISOString(), "2026-11-05T10:00:00.000Z");
  const again = schedule(good, 0, now);
  assert.ok(again.intervalDays < 0.01 && again.lapses === 1 && again.ease < 2.5);
  const easy = schedule({ ...good, intervalDays: 10, ease: 2.5, reps: 3, lapses: 0 }, 3, now);
  assert.ok(easy.intervalDays > 30 && easy.ease > 2.5);
  const hard = schedule({ ...good, intervalDays: 10, ease: 2.5, reps: 3, lapses: 0 }, 1, now);
  assert.equal(hard.intervalDays, 12);
});

test("decks and cards: create, study queue, review and stats", { skip: !db && "no local database" }, async () => {
  const deck = await createDeck(db!, { title: "MAD · Ensembles", course: "MAD" });
  const cards = await addCards(db!, deck.id, [
    { front: "$|A \\cup B|$ ?", back: "$|A| + |B| - |A \\cap B|$", tags: ["cardinal"] },
    { front: "« tous les X sont Y »", back: "$X \\subseteq Y$" },
  ]);
  assert.equal(cards.length, 2);
  assert.deepEqual((await listDecks(db!, "mad")).map((d) => [d.cards, d.due, d.fresh]), [[2, 0, 2]]);
  const queue = await studyQueue(db!, deck.id);
  assert.deepEqual(queue.map((c) => c.id), cards.map((c) => c.id));
  const reviewed = await review(db!, cards[0].id, 2);
  assert.equal(reviewed?.state?.intervalDays, 1);
  assert.deepEqual((await studyQueue(db!, deck.id)).map((c) => c.id), [cards[1].id], "a card due tomorrow leaves the queue");
  await review(db!, cards[1].id, 0);
  assert.deepEqual((await studyQueue(db!, deck.id)).map((c) => c.id), [], "ten minutes away is not due yet");
  const stats = await studyStats(db!);
  assert.equal(stats.reviewedToday, 2);
  assert.equal(stats.days.at(-1)?.again, 1);
  await updateCard(db!, cards[0].id, { hint: "double comptage" });
  assert.equal((await getDeck(db!, deck.id))?.cardList[0].hint, "double comptage");
  assert.equal(await deleteDeck(db!, deck.id), true);
});

test("corrections: photos are checked, kept in order, then corrected with a validated result", { skip: !db && "no local database" }, async () => {
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(Buffer.from("not an image")), undefined);
  const c = await createCorrection(db!, { title: "Série 3 MAD", course: "MAD", topic: "Relations" });
  assert.equal(c.state, "capture");
  await assert.rejects(markSent(db!, c.id), /at least one photo/);
  const p1 = await addPhoto(db!, c.id, JPEG);
  const p2 = await addPhoto(db!, c.id, PNG);
  await assert.rejects(addPhoto(db!, c.id, Buffer.from("<svg onload=alert(1)>")), /Not a JPEG/);
  await reorderPhotos(db!, c.id, [p2.id, p1.id]);
  assert.deepEqual((await getCorrection(db!, c.id))!.photos.map((p) => p.id), [p2.id, p1.id]);
  const replaced = await replacePhoto(db!, c.id, p1.id, PNG);
  assert.equal(replaced?.contentType, "image/png");
  const withData = await photosWithData(db!, c.id);
  assert.equal(withData.length, 2);
  assert.ok(withData.every((p) => p.data.length === 72));

  const sent = await markSent(db!, c.id);
  assert.equal(sent?.state, "received");
  assert.throws(() => validateResult({ summary: "x", exercises: [{ number: "1", answer: "a", verdict: "meh", feedback: "f" }] }), /verdict/);
  const result = {
    summary: "Deux exercices sur trois justes.",
    exercises: [
      { number: "1", answer: "$|A \\cup B| = 29$", verdict: "correct", feedback: "Juste.", topics: ["inclusion-exclusion"] },
      { number: "2", answer: "$|A| = 25 - 14$", verdict: "wrong", feedback: "Il manque $+|A \\cap D|$.", solution: "$|A| = 11 + |A \\cap D|$", cause: "oubli de l'intersection", topics: ["inclusion-exclusion"] },
    ],
    toRevise: ["inclusion-exclusion"],
  };
  const done = await submitResult(db!, c.id, result);
  assert.equal(done?.state, "corrected");
  assert.equal(done?.result?.exercises.length, 2);
  await assert.rejects(addPhoto(db!, c.id, JPEG), /done/);
  assert.deepEqual(await verdictStats(db!, "MAD"), [{ course: "MAD", corrections: 1, correct: 1, partial: 0, wrong: 1, missing: 0 }]);
  assert.equal((await listCorrections(db!, { course: "MAD" }))[0].photos.length, 2);
  assert.equal(await deleteCorrection(db!, c.id), true);
});

test("profile: notes aggregate into weaknesses, mistakes and topics to revise", { skip: !db && "no local database" }, async () => {
  const notes = await addNotes(db!, [
    { course: "MAD", topic: "inclusion-exclusion", kind: "mistake", text: "Oublie de retirer l'intersection", severity: 3 },
    { course: "MAD", topic: "inclusion-exclusion", kind: "weakness", text: "Ne réduit pas l'union quand C ⊆ A", severity: 2 },
    { course: "MAD", topic: "diagramme de Hasse", kind: "strength", text: "Diagrammes propres et complets" },
    { course: "ANA1", topic: "limites", kind: "weakness", text: "Forme 0/0 mal reconnue", severity: 1 },
  ]);
  assert.equal(notes.length, 4);
  const summary = await profileSummary(db!);
  const mad = summary.courses.find((c) => c.course === "MAD")!;
  assert.equal(mad.mistakes[0].topic, "inclusion-exclusion");
  assert.equal(mad.strengths.length, 1);
  assert.equal(summary.toRevise[0].topic, "inclusion-exclusion");
  assert.match(formatProfile(summary), /To revise first/);
  const found = await searchNotes(db!, "intersection", "MAD");
  assert.ok(found.some((n) => n.topic === "inclusion-exclusion"));
  await resolveNote(db!, notes[3].id);
  assert.equal((await listNotes(db!, { course: "ANA1" })).length, 0);
  assert.equal((await listNotes(db!, { course: "ANA1", resolved: true })).length, 1);
});
