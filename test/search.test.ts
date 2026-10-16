import assert from "node:assert/strict";
import { test } from "node:test";
import { type SearchResult, formatDocuments, formatResults } from "../src/rag/search.js";

const result = (documentId: number, pages: string, text: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  score: 1,
  documentId,
  title: `Document ${documentId}`,
  course: "MAD",
  chapter: "2. Relations",
  docType: "lecture",
  teachers: [],
  pages,
  headingPath: null,
  exercise: null,
  url: `https://cyberlearn.example/${documentId}`,
  text,
  ...extra,
});

test("search results are grouped by document, with one header per document", () => {
  const text = formatResults([
    result(2, "69", "Diagramme de Hasse", { headingPath: "Relations > Hasse" }),
    result(3, "40", "Exercice", { docType: "exercises", exercise: "2.18" }),
    result(2, "70-71", "Exemple"),
  ]);
  assert.equal(
    text,
    [
      "## MAD · 2. Relations · Document 2 (lecture) · document 2 · https://cyberlearn.example/2",
      "### p. 69 · Relations > Hasse\nDiagramme de Hasse",
      "### p. 70-71\nExemple",
      "## MAD · 2. Relations · Document 3 (exercises) · document 3 · https://cyberlearn.example/3",
      "### p. 40 · ex. 2.18\nExercice",
    ].join("\n\n"),
  );
  assert.equal(formatResults([]), "");
});

test("documents are listed one per line", () => {
  assert.equal(
    formatDocuments([
      { id: 23, title: "TE 1, 2023-2024", docType: "exam", chapter: "Année 2023-2024" },
      { id: 8, title: "Formulaire", docType: "other", chapter: null },
    ]),
    "23 · exam · Année 2023-2024 · TE 1, 2023-2024\n8 · other · - · Formulaire",
  );
});
