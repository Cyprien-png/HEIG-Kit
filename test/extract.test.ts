import assert from "node:assert/strict";
import { test } from "node:test";
import { type DoclingDocument, PAGE_BREAK, enrichMarkdown, formulaText, joinAccents, restorePages } from "../src/rag/extract.js";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

test("square matrices are written back row by row", () => {
  assert.equal(formulaText("a) M(R) = ⎡⎢⎢⎣ 1 0 0 0 1 1 0 0 1 ⎤⎥⎥⎦ b) N = ⎡⎢⎣ 1 2 3 ⎤⎥⎦"), "a) M(R) = [1 0 0; 0 1 1; 0 0 1] b) N = [1 2 3]");
  assert.equal(formulaText("(M(R))  2 = ⎡⎢⎢⎢⎣ 0 0 0 0 0 1 1 1 0 1 1 1 0 0 0 0 ⎤⎥⎥⎥⎦"), "(M(R)) 2 = [0 0 0 0; 0 1 1 1; 0 1 1 1; 0 0 0 0]");
  assert.equal(formulaText("f(x) = ⎧⎨⎩ 1 si x ≥ 0 0 sinon"), "f(x) = { 1 si x ≥ 0 0 sinon");
  // Same brackets in the Symbol font's private use area.
  assert.equal(formulaText("M = \uf8ee\uf8ef\uf8f0 1 0 0 1 \uf8f9\uf8fa\uf8fb (\uf8eb\uf8ed a \uf8f6\uf8f8)"), "M = [1 0; 0 1] ((a))");
});

const DOCUMENT: DoclingDocument = {
  body: { children: [{ $ref: "#/texts/0" }, { $ref: "#/texts/1" }, { $ref: "#/groups/0" }, { $ref: "#/pictures/0" }, { $ref: "#/texts/4" }] },
  texts: [
    { label: "text", text: "Exercice" },
    { label: "formula", text: "", orig: "M = ⎡⎢⎣ 1 0 0 1 ⎤⎥⎦" },
    { label: "text", text: "a" },
    { label: "text", text: "b" },
    { label: "formula", text: "x^2", orig: "x 2" },
    { label: "formula", text: "", orig: "A = {1, 2}" },
  ],
  groups: [{ children: [{ $ref: "#/texts/5" }] }],
  pictures: [{ children: [{ $ref: "#/texts/2" }, { $ref: "#/texts/3" }], image: { uri: `data:image/png;base64,${PNG.toString("base64")}` } }],
};

test("formulas get their raw text and figures their labels, in reading order", () => {
  const markdown = `Exercice\n\n<!-- formula-not-decoded -->\n\n<!-- formula-not-decoded -->\n\n![Image](data:image/png;base64,AAAA)\n\n${PAGE_BREAK}\n\n$$x^2$$`;
  const { markdown: enriched, figures } = enrichMarkdown(markdown, DOCUMENT);
  assert.equal(
    enriched,
    `Exercice\n\n[formule : M = [1 0; 0 1]]\n\n[formule : A = {1, 2}]\n\n[figure 1 : a b]\n\n${PAGE_BREAK}\n\n$$x^2$$`,
  );
  assert.deepEqual(figures, [PNG]);
});

test("placeholders are kept when the markdown and the document disagree", () => {
  const { markdown, figures } = enrichMarkdown("<!-- formula-not-decoded -->\n\n![Image](data:image/png;base64,AAAA)\n\n<!-- image -->", DOCUMENT);
  assert.equal(markdown, "<!-- formula-not-decoded -->\n\n<!-- image -->\n\n<!-- image -->");
  assert.deepEqual(figures, []);
});

test("pages without text are put back, so that page numbers match the document", () => {
  const document: DoclingDocument = {
    body: { children: [{ $ref: "#/texts/0" }, { $ref: "#/pictures/0" }, { $ref: "#/texts/1" }, { $ref: "#/texts/2" }] },
    texts: [
      { label: "text", text: "Couverture", prov: [{ page_no: 1 }] },
      { label: "text", text: "Chapitre 1", prov: [{ page_no: 4 }] },
      // Page footers are left out of the markdown: page 5 has no text.
      { label: "page_footer", content_layer: "furniture", text: "5", prov: [{ page_no: 5 }] },
    ],
    // A figure without labels, on the same page as the cover's text.
    pictures: [{ prov: [{ page_no: 1 }] }],
    pages: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} },
  };
  const { markdown } = enrichMarkdown(`Couverture\n\n<!-- image -->\n\n${PAGE_BREAK}\n\nChapitre 1`, document);
  assert.deepEqual(
    markdown.split(PAGE_BREAK).map((page) => page.trim()),
    ["Couverture\n\n<!-- image -->", "", "", "Chapitre 1", ""],
  );
});

test("detached accents of LaTeX PDFs are joined to the letter that follows them", () => {
  // Acute, grave and circumflex accents as found in the ANA1 exercise sheets.
  assert.equal(joinAccents("Analyse : S´erie 1. D´eterminer la limite"), "Analyse : Série 1. Déterminer la limite");
  assert.equal(joinAccents("param`etre, parall`ele, tr`es, o`u"), "paramètre, parallèle, très, où");
  assert.equal(joinAccents("polynˆomes, cˆot´es, fenˆetre"), "polynômes, côtés, fenêtre");
  // The grave accent and the circumflex may be separated from their letter by a space.
  assert.equal(joinAccents("la limite ` a gauche, ` a l'aide de, ˆ o"), "la limite à gauche, à l'aide de, ô");
  // Capitals, the dieresis and the cedilla, and the dotless i that LaTeX puts under an accent.
  assert.equal(joinAccents("`A gauche, ´Etude, na¨ıve, maˆıtre, ¸ca"), "À gauche, Étude, naïve, maître, ça");
  // Several on one line and in one word, at the start and the end of words.
  assert.equal(joinAccents("´el´ev´e d´ej`a, tr`es t´el´ephon´e"), "élévé déjà, très téléphoné");
  // Next to inline code, which is left as it is.
  assert.equal(joinAccents("la variable `x` est d´ej`a d´efinie"), "la variable `x` est déjà définie");
});

test("text that is not a detached French accent is left as it is", () => {
  const unchanged = [
    // Already well extracted, as the lecture notes of ANA1 and the documents of MAD.
    "Série déjà correcte, à gauche, côté, naïve, ça, Étude, À",
    // Not a letter of French: the only two detached accents of MAD.
    "l'application réciproque de´T, est notée",
    // Primes written as acute accents, followed by a bracket, a digit, an operator, a space or another prime.
    "f´(x) = 2x, f´´(x) = 2, y´ = 3, u´ et v´, f´ 2",
    // An acute accent with a space before its letter only happens for primes.
    "u´ est la dérivée",
    // Accents on letters that make no French letter.
    "´b ´y `z ˆk ¨x",
    // Inline code without spaces, and the text that follows it.
    "la variable `abc` et `a`, puis `e` ou `f(x)`",
    // Formulas, as inserted by enrichMarkdown.
    "[formule : lim x→3± x + 1 x - 3] [formule : f ′ (x) = 2 x]",
    // Symbols around letters.
    "x ˆ 2, aˆ2, a`b, ´´",
  ];
  for (const text of unchanged) assert.equal(joinAccents(text), text, text);
});

test("fenced code blocks are left as they are, the text around them is not", () => {
  const code = "```js\nconst a = `e` + ´e;\n// `a la ligne\n```";
  assert.equal(joinAccents(`D´ebut\n\n${code}\n\nFin \`a la ligne`), `Début\n\n${code}\n\nFin à la ligne`);
  assert.equal(joinAccents(`${code}\n${code}`), `${code}\n${code}`);
});

test("formulas inserted by enrichMarkdown are not touched, the text around them is", () => {
  const document: DoclingDocument = {
    body: { children: [{ $ref: "#/texts/0" }, { $ref: "#/texts/1" }] },
    texts: [
      { label: "text", text: "S´erie" },
      // Raw text of a formula with characters that would otherwise look like detached accents.
      { label: "formula", text: "", orig: "f´ a + `e" },
    ],
    pictures: [],
  };
  const { markdown } = enrichMarkdown("S´erie 1, ` a r´esoudre\n\n<!-- formula-not-decoded -->", document);
  assert.equal(markdown, "Série 1, à résoudre\n\n[formule : f´ a + `e]");
});

test("page breaks are kept when they disagree with the document's pages", () => {
  const markdown = `a\n\n${PAGE_BREAK}\n\nb`;
  assert.equal(restorePages(markdown, [1, 2, 5], 5), markdown);
  assert.equal(restorePages(markdown, [3, 2], 5), markdown);
  assert.equal(restorePages(markdown, [2, 3], 3).split(PAGE_BREAK).length, 3, "a document starting on page 2");
});
