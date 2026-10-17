import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkMarkdown } from "../src/rag/chunk.js";
import { PAGE_BREAK } from "../src/rag/extract.js";

const SHEET = `## Chapitre

### Table des matières

| 2 | Relations | 31 |
| | 2.4 | Relations d'ordre . . . . . . | . . . 38 |
| | 2.7 | Solutions d'exercices choisis . . . | . . . 48 |

${PAGE_BREAK}

### 2.4 Relations d'ordre

Une relation d'ordre est réflexive, antisymétrique et transitive sur un ensemble.

- 2.18 Déterminer s'il s'agit d'une relation d'ordre et donner son diagramme de Hasse.

<!-- formula-not-decoded -->

<!-- image -->

## 2.22 Relation de divisibilité

- a) Montrer que la relation de divisibilité est une relation d'ordre.
- b) S'agit-il d'un ordre partiel ou total ?

${PAGE_BREAK}

### 2.7 Solutions d'exercices choisis

- 2.22 a) La relation est réflexive, antisymétrique et transitive : c'est une relation d'ordre.
`;

test("numbered items of an exercise sheet become one chunk per exercise", () => {
  const chunks = chunkMarkdown(SHEET, { exercises: true });
  const statement = chunks.find((c) => c.exercise === "2.22" && !c.headingPath.includes("Solutions"));
  assert.ok(statement);
  assert.match(statement.text, /^2\.22 Relation de divisibilité/);
  assert.match(statement.text, /b\) S'agit-il d'un ordre partiel/, "sub-questions stay with their exercise");
  assert.equal(statement.headingPath, "Chapitre > 2.4 Relations d'ordre");
});

test("section headings listed in the table of contents are not exercises", () => {
  const chunks = chunkMarkdown(SHEET, { exercises: true });
  assert.ok(!chunks.some((c) => c.exercise === "2.4" || c.exercise === "2.7"));
  assert.ok(chunks.some((c) => c.exercise === undefined && c.text.startsWith("Une relation d'ordre")));
});

test("solutions keep the exercise number under their solutions heading", () => {
  const solution = chunkMarkdown(SHEET, { exercises: true }).find((c) => c.headingPath.includes("Solutions"));
  assert.equal(solution?.exercise, "2.22");
  assert.equal(solution?.pageFrom, 3);
});

test("pages, formulas, images and the table of contents", () => {
  const chunks = chunkMarkdown(SHEET, { exercises: true });
  const exercise = chunks.find((c) => c.exercise === "2.18");
  assert.equal(exercise?.pageFrom, 2);
  assert.match(exercise!.text, /\[formule\]/);
  assert.ok(!chunks.some((c) => c.text.includes("<!--")));
  assert.ok(!chunks.some((c) => c.text.includes(". . .")));
});

test("an exercise continued on the next page ends on that page", () => {
  const sheet = `- 3.1 Soit A = {1, 2, 3}. Déterminer l'ensemble des parties de A.\n\n${PAGE_BREAK}\n\nb) Combien d'éléments contient-il ?`;
  const [exercise] = chunkMarkdown(sheet, { exercises: true });
  assert.deepEqual([exercise.exercise, exercise.pageFrom, exercise.pageTo], ["3.1", 1, 2]);
});

test("other documents only split on explicit exercise markers", () => {
  const lecture = `## 1.2 Inclusion\n\nUn ensemble A est inclus dans B si tout élément de A appartient à B.\n\n**Exercice 3** Montrer que l'inclusion est transitive pour tous les ensembles.`;
  const chunks = chunkMarkdown(lecture, { exercises: false });
  assert.deepEqual(
    chunks.map((c) => [c.headingPath, c.exercise]),
    [
      ["1.2 Inclusion", undefined],
      ["1.2 Inclusion", "3"],
    ],
  );
});

test("long sections are split with an overlapping paragraph", () => {
  const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraphe ${i} ${"texte ".repeat(30)}`);
  const chunks = chunkMarkdown(`## Section\n\n${paragraphs.join("\n\n")}`, { exercises: false, maxChars: 500 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.text.length <= 500));
  assert.equal(chunks[1].text.split("\n\n")[0], chunks[0].text.split("\n\n").at(-1), "next chunk starts with the previous last paragraph");
  assert.deepEqual(chunks.map((c) => c.ordinal), chunks.map((_, i) => i));
});
