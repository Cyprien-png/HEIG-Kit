import assert from "node:assert/strict";
import { after, test } from "node:test";
import { type LibraryItem, annotateLibrary, classify, findLibraryItem, listLibraryTags, normalizeTag, setLibraryTags } from "../src/app/library.js";
import type { Db } from "../src/rag/db.js";
import { testDb } from "./helpers/db.js";

const db: Db | undefined = await testDb("heigkit_test_library");
after(async () => db?.end());

const item = (kind: LibraryItem["kind"], name: string, title = name): LibraryItem => ({ kind, name, title, modifiedAt: "2026-11-04T10:00:00.000Z", files: [], tags: [], tagged: false });

test("library items are classified from their name and title until they are tagged", () => {
  assert.equal(normalizeTag("  #Calcul   Matriciel "), "calcul matriciel");
  const courses = ["MAD", "PRG", "RXI"];
  assert.deepEqual(classify(item("document", "MAD-relations-ordre-exercices", "Relations d'ordre : exercices"), courses), { course: "MAD", tags: ["exercices"] });
  assert.deepEqual(classify(item("document", "prg-te-blanc-corrige"), courses), { course: "PRG", tags: ["corrigé", "te blanc"] });
  assert.deepEqual(classify(item("video", "Hasse", "Diagramme de Hasse expliqué"), courses), { course: undefined, tags: ["explication", "vidéo"] });
  // A code inside a word is not a course ("nomad" is not MAD).
  assert.equal(classify(item("document", "nomad-notes"), courses).course, undefined);

  const items = [item("document", "MAD-fiche-revision", "Fiche de révision"), item("video", "Hasse")];
  const saved = new Map([["document:MAD-fiche-revision", { item: "document:MAD-fiche-revision", course: "MAD", tags: ["révision", "relations"], updatedAt: new Date() }]]);
  const [doc, video] = annotateLibrary(items, saved, courses);
  assert.deepEqual([doc.course, doc.tags, doc.tagged], ["MAD", ["révision", "relations"], true]);
  assert.deepEqual([video.course, video.tags, video.tagged], [undefined, ["vidéo"], false]);

  assert.equal(findLibraryItem(items, "documents/MAD-fiche-revision.pdf").name, "MAD-fiche-revision");
  assert.equal(findLibraryItem(items, "/home/me/HEIG-Kit/videos/Hasse.mp4").kind, "video");
  assert.equal(findLibraryItem(items, "document:MAD-fiche-revision").kind, "document");
  assert.equal(findLibraryItem(items, "Fiche de révision").name, "MAD-fiche-revision");
  assert.throws(() => findLibraryItem(items, "nothing"), /No library item/);
});

test("saved tags merge with the previous ones and are normalised", { skip: !db && "no local database" }, async () => {
  const first = await setLibraryTags(db!, "document:MAD-serie-3", { course: "mad", tags: ["Exercices", "#relations", "exercices"] });
  assert.deepEqual([first.course, first.tags], ["MAD", ["exercices", "relations"]]);
  const second = await setLibraryTags(db!, "document:MAD-serie-3", { add: ["Corrigé"], remove: ["relations"] });
  assert.deepEqual([second.course, second.tags], ["MAD", ["exercices", "corrigé"]]);
  const third = await setLibraryTags(db!, "document:MAD-serie-3", { course: null });
  assert.equal(third.course, undefined);
  assert.deepEqual([...(await listLibraryTags(db!)).keys()], ["document:MAD-serie-3"]);
  await assert.rejects(setLibraryTags(db!, "documents/x.pdf", {}), /not a library item/);
});
