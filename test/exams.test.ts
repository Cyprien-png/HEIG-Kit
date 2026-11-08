import assert from "node:assert/strict";
import { test } from "node:test";
import type { Correction } from "../src/app/corrections.js";
import { examBase, examScore, examTitle, formatMockExams, mockExams, swissGrade } from "../src/app/exams.js";
import type { LibraryItem } from "../src/app/library.js";

const item = (name: string, title: string, tags: string[], course = "MAD"): LibraryItem => ({ kind: "document", name, title, modifiedAt: "2026-11-05T10:00:00.000Z", files: [], course, tags, tagged: true });
const correction = (id: string, exam: string | undefined, state: Correction["state"], exercises: Correction["result"] extends infer R ? (R extends { exercises: infer E } ? E : never) : never = []): Correction => ({
  affectsProfile: true,
  id,
  title: `TE blanc ${id}`,
  course: "MAD",
  state,
  exam,
  result: state === "corrected" ? { summary: "…", exercises } : undefined,
  createdAt: new Date(`2026-11-0${id}T12:00:00Z`),
  updatedAt: new Date(`2026-11-0${id}T12:00:00Z`),
  correctedAt: state === "corrected" ? new Date(`2026-11-0${id}T13:00:00Z`) : undefined,
  photos: [],
});

test("the Swiss grade is 1 + 5 × the success ratio, to a tenth", () => {
  assert.equal(swissGrade(1), 6);
  assert.equal(swissGrade(0), 1);
  assert.equal(swissGrade(0.6), 4);
  assert.equal(swissGrade(37 / 50), 4.7);
  assert.equal(swissGrade(2), 6, "bounded");
  assert.equal(swissGrade(Number.NaN), 1);
});

test("the score of a correction uses the points when every exercise has some, verdicts otherwise", () => {
  const pointed = examScore({ result: { summary: "", exercises: [
    { number: "1", answer: "", verdict: "correct", feedback: "", topics: [], points: { obtained: 8, total: 8 } },
    { number: "2", answer: "", verdict: "partial", feedback: "", topics: [], points: { obtained: 5, total: 9 } },
    { number: "3", answer: "", verdict: "wrong", feedback: "", topics: [], points: { obtained: 0, total: 3 } },
  ] } });
  assert.deepEqual(pointed, { obtained: 13, total: 20, percent: 65, grade: 4.3 });
  const verdicts = examScore({ result: { summary: "", exercises: [
    { number: "1", answer: "", verdict: "correct", feedback: "", topics: [] },
    { number: "2", answer: "", verdict: "partial", feedback: "", topics: [], points: { obtained: 1, total: 4 } },
    { number: "3", answer: "", verdict: "missing", feedback: "", topics: [] },
    { number: "4", answer: "", verdict: "correct", feedback: "", topics: [] },
  ] } });
  assert.deepEqual(verdicts, { obtained: 2.25, total: 4, percent: 56, grade: 3.8 }, "one point per exercise, the partial one by its points");
  assert.equal(examScore({ result: undefined }), undefined);
});

test("statement and solutions of one exam share a base name; the title drops « (énoncé) »", () => {
  assert.equal(examBase("MAD-TE-blanc-chapitres-1-3-enonce"), "mad-te-blanc-chapitres-1-3");
  assert.equal(examBase("MAD-TE-blanc-chapitres-1-3-corrige"), "mad-te-blanc-chapitres-1-3");
  assert.equal(examBase("PRG_test_fichiers_solutions"), "prg-test-fichiers");
  assert.equal(examBase("ANA1-TE-blanc-2-questions"), "ana1-te-blanc-2");
  assert.equal(examTitle("MAD : TE blanc, chapitres 1 à 3 (énoncé)"), "MAD : TE blanc, chapitres 1 à 3");
  assert.equal(examTitle("PRG1 : test blanc, fichiers d'en-tête (corrigé et barème)"), "PRG1 : test blanc, fichiers d'en-tête");
  assert.equal(examTitle("TE blanc ANA1 : énoncé"), "TE blanc ANA1");
});

test("mock exams pair the library items, read the corrections that name them and tell their status", () => {
  const items = [
    item("MAD-TE-blanc-chapitres-1-3-corrige", "MAD : TE blanc, chapitres 1 à 3 (corrigé et barème)", ["te blanc", "corrigé"]),
    item("MAD-TE-blanc-chapitres-1-3-enonce", "MAD : TE blanc, chapitres 1 à 3 (énoncé)", ["te blanc", "énoncé"]),
    item("MAD-examen-blanc-ch1-3", "MAD – Examen blanc, chapitres 1 à 3", ["te blanc"]),
    item("PRG-test-fichiers-en-tete-enonce", "PRG1 : test blanc, fichiers d'en-tête (énoncé)", ["te blanc"], "PRG"),
    item("PRG-test-fichiers-en-tete-corrige", "PRG1 : test blanc, fichiers d'en-tête (corrigé et barème)", ["te blanc", "corrigé"], "PRG"),
    item("MAD-serie-3", "Série 3", ["exercices"]),
    { ...item("GrapheEx330", "Vidéo", ["vidéo", "te blanc"]), kind: "video" as const },
  ];
  const corrections = [
    correction("1", "document:MAD-TE-blanc-chapitres-1-3-enonce", "corrected", [
      { number: "1", answer: "", verdict: "correct", feedback: "", topics: [], points: { obtained: 6, total: 8 } },
      { number: "2", answer: "", verdict: "wrong", feedback: "", topics: [], points: { obtained: 2, total: 9 } },
    ]),
    correction("2", "document:MAD-TE-blanc-chapitres-1-3-corrige", "corrected", [{ number: "1", answer: "", verdict: "correct", feedback: "", topics: [], points: { obtained: 17, total: 17 } }]),
    correction("3", "document:PRG-test-fichiers-en-tete-enonce", "received"),
    correction("4", undefined, "corrected", [{ number: "1", answer: "", verdict: "correct", feedback: "", topics: [] }]),
  ];
  const exams = mockExams(items, corrections);
  assert.deepEqual(exams.map((e) => [e.course, e.key, e.status]), [
    ["MAD", "document:MAD-TE-blanc-chapitres-1-3-enonce", "done"],
    ["MAD", "document:MAD-examen-blanc-ch1-3", "todo"],
    ["PRG", "document:PRG-test-fichiers-en-tete-enonce", "pending"],
  ]);
  const mad = exams[0];
  assert.equal(mad.title, "MAD : TE blanc, chapitres 1 à 3");
  assert.equal(mad.solutions?.name, "MAD-TE-blanc-chapitres-1-3-corrige");
  assert.deepEqual(mad.attempts.map((a) => a.id), ["1", "2"], "a correction naming the solutions counts too");
  assert.deepEqual(mad.last?.score, { obtained: 17, total: 17, percent: 100, grade: 6 });
  assert.equal(mad.best?.grade, 6);
  assert.equal(exams[1].solutions, undefined);
  assert.equal(exams[2].attempts[0].score, undefined, "no grade before the correction");
  const text = formatMockExams(exams);
  assert.match(text, /MAD\s+2026-11-05\s+done · 6\.0\/6 \(100 %\)/);
  assert.match(text, /PRG\s+2026-11-05\s+correction pending/);
  assert.equal(formatMockExams([]), "No mock exam in the library (documents tagged « te blanc »).");
});

test("the grade of a course adds its corrected exercises and its quiz answers", async () => {
  const { courseScore } = await import("../src/app/profile.js");
  assert.equal(courseScore(undefined, []), undefined);
  assert.deepEqual(courseScore({ correct: 3, partial: 2, wrong: 1, missing: 0 }, [{ correct: true }, { correct: true }, { correct: false }, { correct: true }]), {
    exercises: { credit: 4, total: 6 },
    quiz: { correct: 3, total: 4 },
    ratio: 0.7,
    grade: 4.5,
  });
  assert.equal(courseScore(undefined, [{ correct: true }, { correct: false }])?.grade, 3.5, "a course with quizzes only still gets a grade");
});
