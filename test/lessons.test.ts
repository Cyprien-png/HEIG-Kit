import assert from "node:assert/strict";
import { test } from "node:test";
import { lessonsToEvents } from "../src/app/calendar.js";
import { lessonNotes, planningByDay } from "../src/app/lessons.js";

const planning = `<p>Planning pour la période du 2 au 20 novembre 2026</p>
<ul>
<li>Lundi 2 novembre</li>
<li>Cours : Compositions de fonctions. Injectivité, surjectivité et bijectivité</li>
<li>Exercices : 3.6 à 3.12 et 3.21</li>
<li>Vendredi 6 novembre</li>
<li>Cours : Ensembles dénombrables</li>
<li>Exercices : 3.20, 3.30 à 3.32</li>
<li>Lundi 9 novembre</li>
<li>Évaluation sur les chapitres 1 à 3</li>
</ul>`;

const sections = [
  { id: 1, name: "Ressources générales", summary: "", modules: [{ id: 10, name: "Planning pour la période du 2 au 20 novembre 2026", modname: "label", description: planning }] },
  { id: 2, name: "Semaine du 1er décembre 2026", summary: "<p>Cours : Suites</p>", modules: [] },
];

test("a course page's planning gives the programme of each lesson day", () => {
  const byDay = planningByDay(sections, 2025);
  assert.equal(byDay.get("2026-11-02"), "Cours : Compositions de fonctions. Injectivité, surjectivité et bijectivité\nExercices : 3.6 à 3.12 et 3.21");
  assert.equal(byDay.get("2026-11-06"), "Cours : Ensembles dénombrables\nExercices : 3.20, 3.30 à 3.32");
  assert.equal(byDay.get("2026-11-09"), "Évaluation sur les chapitres 1 à 3");
  assert.equal(byDay.get("2026-12-01"), "Cours : Suites");
  assert.equal(byDay.get("2026-11-03"), undefined);
});

test("lessons carry their announced programme, and an announced evaluation becomes an exam", () => {
  const notes = lessonNotes({ MAD: sections });
  const lesson = (summary: string, start: string) => ({ summary, start, end: start.replace("T09:30", "T11:00"), location: "F01", description: "https://gaps.heig-vd.ch/consultation/horaires" });
  const [course, exam, other] = lessonsToEvents([lesson("MAD-E-C1", "2026-11-02T09:30:00.000Z"), lesson("MAD-E-C1", "2026-11-09T09:30:00.000Z"), lesson("PRG-D-C1", "2026-11-02T09:30:00.000Z")], notes);
  assert.equal(course.kind, "lesson");
  assert.equal(course.title, "MAD-E-C1");
  assert.match(course.details ?? "", /^Cours : Compositions/);
  assert.equal(exam.kind, "exam");
  assert.equal(exam.title, "Évaluation sur les chapitres 1 à 3");
  assert.equal(exam.key, "gaps:MAD-E-C1|2026-11-09T09:30:00.000Z");
  assert.equal(other.details, undefined);
});
