import assert from "node:assert/strict";
import { test } from "node:test";
import { type DoclingDocument, PAGE_BREAK, enrichMarkdown, formulaText } from "../src/rag/extract.js";

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
