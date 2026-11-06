import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { addPhoto, createCorrection, deleteCorrection, getCorrection, listCorrections, markSent, photosWithData, replacePhoto, reorderPhotos, sniffImage, submitResult, updateCorrection, validateResult, verdictStats } from "../src/app/corrections.js";
import { addCards, answerStudySession, createDeck, currentStudySession, deleteDeck, deleteStudySession, getDeck, listDecks, openStudySession, review, schedule, studyQueue, studyStats, updateCard, updateStudySession } from "../src/app/flashcards.js";
import { type Chapter, addNotes, chapterOf, chapterOfAnswer, chapterSummaries, fileNotes, formatProfile, listNotes, profileSummary, resolveNote, searchNotes, setChapters, updateNote } from "../src/app/profile.js";
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
  const pending = await createCorrection(db!);
  assert.equal(pending.title, "Correction en cours", "a correction can be created before it is named, so the QR code comes out at once");
  assert.equal((await updateCorrection(db!, pending.id, { title: "Série 2 MAD", course: "MAD" }))?.title, "Série 2 MAD");
  await deleteCorrection(db!, pending.id);
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

test("profile: chapters get one of four statuses from the notes they claim", () => {
  const chapters: Chapter[] = [
    { id: 1, course: "MAD", position: 1, title: "1. Ensembles", keywords: ["inclusion-exclusion", "cardinal"] },
    { id: 2, course: "MAD", position: 2, title: "2. Relations", keywords: ["diagramme de Hasse"] },
    { id: 3, course: "MAD", position: 3, title: "3. Fonctions", keywords: [] },
  ];
  assert.equal(chapterOf({ topic: "Cardinal", chapter: undefined }, chapters)?.position, 1);
  assert.equal(chapterOf({ topic: "x", chapter: "relations" }, chapters)?.position, 2);
  assert.equal(chapterOf({ topic: "x", chapter: "3" }, chapters)?.position, 3);
  assert.equal(chapterOf({ topic: "récurrence" }, chapters), undefined);
  const { chapters: out, unassigned } = chapterSummaries(chapters, [
    { topic: "inclusion-exclusion", kind: "mistake", severity: 3 },
    { topic: "cardinal", kind: "strength", severity: 1 },
    { topic: "diagramme de Hasse", kind: "strength", severity: 2 },
    { topic: "diagramme de Hasse", kind: "weakness", severity: 1 },
    { topic: "récurrence", kind: "weakness", severity: 2 },
    { topic: "méthode", kind: "note", severity: 2 },
  ]);
  assert.deepEqual(out.map((c) => c.status), ["struggling", "fragile", "unassessed"]);
  assert.equal(out[0].mistakes, 1);
  assert.equal(out[1].level, 2 / 3);
  assert.equal(out[2].level, 0.5);
  assert.deepEqual(unassigned, ["récurrence"]);
  // Quiz answers count one point each: by the question's chapter, topic, source number or a keyword in the statement.
  const { chapters: withQuiz } = chapterSummaries(chapters, [], [
    { chapter: "3", statement: "Une fonction injective…", correct: true },
    { topic: "diagramme de Hasse", statement: "…", correct: false },
    { statement: "…", source: "Cours MAD ch. 2 p. 53", correct: false },
    { statement: "Le cardinal de A union B vaut…", correct: true },
    { statement: "Rien de connu", correct: true },
  ]);
  assert.deepEqual(withQuiz.map((c) => [c.quizCorrect, c.quizWrong, c.status]), [[1, 0, "mastered"], [0, 2, "struggling"], [1, 0, "mastered"]]);
  assert.equal(chapterOfAnswer({ statement: "Les cardinaux…" }, chapters), undefined);
});

test("profile: notes aggregate into weaknesses, mistakes and topics to revise", { skip: !db && "no local database" }, async () => {
  const notes = await addNotes(db!, [
    { course: "MAD", topic: "inclusion-exclusion", kind: "mistake", text: "Oublie de retirer l'intersection", severity: 3 },
    { course: "MAD", topic: "inclusion-exclusion", kind: "weakness", text: "Ne réduit pas l'union quand C ⊆ A", severity: 2 },
    { course: "MAD", topic: "diagramme de Hasse", kind: "strength", text: "Diagrammes propres et complets" },
    { course: "ANA1", topic: "limites", kind: "weakness", text: "Forme 0/0 mal reconnue", severity: 1 },
  ]);
  assert.equal(notes.length, 4);
  await setChapters(db!, "mad", [{ title: "1. Ensembles", keywords: ["inclusion-exclusion"] }, { title: "2. Relations" }]);
  const summary = await profileSummary(db!);
  const mad = summary.courses.find((c) => c.course === "MAD")!;
  assert.equal(mad.mistakes[0].topic, "inclusion-exclusion");
  assert.deepEqual(mad.chapters.map((c) => [c.course, c.status]), [["MAD", "struggling"], ["MAD", "unassessed"]]);
  assert.deepEqual(mad.unassigned, ["diagramme de Hasse"]);
  assert.match(formatProfile(summary), /1\. Ensembles: struggling/);
  // Setting the chapters wrote them on the notes; new keywords file the rest.
  const filed = await listNotes(db!, { course: "MAD" });
  assert.deepEqual(filed.filter((n) => n.topic === "inclusion-exclusion").map((n) => n.chapter), ["1. Ensembles", "1. Ensembles"]);
  assert.equal(filed.find((n) => n.topic === "diagramme de Hasse")?.chapter, undefined);
  await setChapters(db!, "mad", [{ title: "1. Ensembles", keywords: ["inclusion-exclusion"] }, { title: "2. Relations", keywords: ["Hasse"] }]);
  assert.equal((await listNotes(db!, { course: "MAD" })).find((n) => n.topic === "diagramme de Hasse")?.chapter, "2. Relations");
  assert.deepEqual(await fileNotes(db!, "MAD", true), { filed: 0, unassigned: [] });
  assert.equal((await updateNote(db!, filed[0].id, { chapter: "2" }))?.chapter, "2. Relations");
  assert.equal((await updateNote(db!, filed[0].id, { chapter: null }))?.chapter, undefined);
  assert.equal(mad.strengths.length, 1);
  assert.equal(summary.toRevise[0].topic, "inclusion-exclusion");
  assert.match(formatProfile(summary), /To revise first/);
  const found = await searchNotes(db!, "intersection", "MAD");
  assert.ok(found.some((n) => n.topic === "inclusion-exclusion"));
  await resolveNote(db!, notes[3].id);
  assert.equal((await listNotes(db!, { course: "ANA1" })).length, 0);
  assert.equal((await listNotes(db!, { course: "ANA1", resolved: true })).length, 1);
});

test("review sessions: resumed where they were left, a card to see again comes back, finished or discarded on purpose", { skip: !db && "no local database" }, async () => {
  const deck = await createDeck(db!, { title: "PRG · Tableaux", course: "PRG" });
  const cards = await addCards(db!, deck.id, [
    { front: "Taille d'un `std::array`", back: "Fixée à la compilation" },
    { front: "`v.size()` d'un `std::vector`", back: "Nombre d'éléments, pas la capacité" },
    { front: "Indice valide d'un tableau de n éléments", back: "0 à n - 1" },
  ]);
  const opened = await openStudySession(db!, deck.id, { limit: 10 });
  assert.equal(opened.resumed, false);
  assert.deepEqual(opened.session.slots.map((s) => s.card.id), cards.map((c) => c.id));
  assert.equal((await openStudySession(db!, deck.id)).resumed, true, "the session in progress is resumed, not replaced");

  let session = (await answerStudySession(db!, opened.session.id, 0, 2))!;
  assert.deepEqual([session.position, session.answered, session.slots.length], [1, 1, 3]);
  session = (await answerStudySession(db!, opened.session.id, 1, 0))!;
  assert.equal(session.slots.length, 4, "a card to see again is appended to the session");
  assert.equal(session.slots[3].card.id, cards[1].id);
  assert.equal(session.again, 1);
  session = (await answerStudySession(db!, opened.session.id, 1, 2))!;
  assert.deepEqual([session.slots[1].grade, session.slots.length], [2, 4], "a second answer replaces the first, the appended card stays");
  assert.equal((await studyQueue(db!, deck.id)).map((c) => c.id).join(), String(cards[2].id), "graded cards left the study queue");

  session = (await updateStudySession(db!, opened.session.id, { position: 0 }))!;
  assert.equal(session.position, 0);
  assert.equal((await currentStudySession(db!, deck.id))?.id, opened.session.id);
  assert.equal(await currentStudySession(db!, undefined), undefined, "the session of a deck is not the session of all the due cards");
  await updateStudySession(db!, opened.session.id, { finished: true });
  assert.equal(await currentStudySession(db!, deck.id), undefined, "a finished session is not resumed");
  await assert.rejects(answerStudySession(db!, opened.session.id, 3, 2), /finished/);

  const fresh = await openStudySession(db!, deck.id);
  assert.equal(fresh.resumed, false);
  assert.deepEqual(fresh.session.slots.map((s) => s.card.id), [cards[2].id], "a new session starts from what is still due");
  const replaced = await openStudySession(db!, deck.id, { discard: true });
  assert.notEqual(replaced.session.id, fresh.session.id, "discarding drops the session in progress");
  assert.equal(await deleteStudySession(db!, replaced.session.id), true);
  assert.equal(await currentStudySession(db!, deck.id), undefined);
  await deleteDeck(db!, deck.id);
});
