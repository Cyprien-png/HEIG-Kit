import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { addCards, createDeck, deleteCard, deleteDeck, getDeck, listDecks, review, updateDeck } from "../src/app/flashcards.js";
import { adoptLibrary, annotatedLibrary, claimLibraryItems, itemKeyOfFile, releaseLibraryItem, requireLibraryEditable, requireNewLibraryItem, setLibraryTags } from "../src/app/library.js";
import { createQuiz, deleteQuiz, listQuizzes } from "../src/app/quizzes.js";
import { AlreadyExists, findSimilar, requireNew, similarity } from "../src/app/reuse.js";
import { AccessDenied, runAs } from "../src/identity.js";
import type { Db } from "../src/rag/db.js";
import { identityOf } from "../src/accounts/users.js";
import { type TestAccount, readyAccount } from "./helpers/accounts.js";
import { testDb } from "./helpers/db.js";

const base = mkdtempSync(path.join(os.tmpdir(), "heig-sharing-"));
process.env.HEIG_OUTPUT_DIR = path.join(base, "out");
mkdirSync(path.join(base, "out", "documents"), { recursive: true });
mkdirSync(path.join(base, "out", "videos"), { recursive: true });

let db: Db | undefined;
let admin: TestAccount;
let lea: TestAccount;
let noe: TestAccount;
before(async () => {
  db = await testDb("heigkit_test_sharing");
  if (!db) return;
  admin = await readyAccount(db, "ada.admin@heig-vd.ch");
  lea = await readyAccount(db, "lea.premiere@heig-vd.ch");
  noe = await readyAccount(db, "noe.second@heig-vd.ch");
});
after(async () => {
  await db?.end();
  rmSync(base, { recursive: true, force: true });
});
const as = <T>(account: TestAccount, work: () => Promise<T>) => runAs(identityOf(account.user), work);

test("titles about the same subject are recognised, whatever their wording", () => {
  const close = (a: string, b: string) => similarity(a, b) >= 0.55;
  assert.ok(close("syl-mux-serie6-exercice4", "Multiplexeur série 6 exercice 4"));
  assert.ok(close("fiche révision relations", "Relations : fiche de révision"));
  assert.ok(close("Couche transport TCP", "TCP et UDP : la couche transport"));
  assert.ok(close("pointeurs", "Les pointeurs en C"));
  assert.ok(!close("syl-mux-serie6-exercice4", "syl-mux-serie6-exercice3"), "another exercise is another subject");
  assert.ok(!close("chapitre 4", "chapitre 5"));
  assert.ok(!close("Relations d'ordre", "Calcul matriciel"));
  assert.ok(!close("Quiz relations", "Quiz matrices"));

  const existing = [
    { ref: "deck 1", title: "Relations d'ordre", course: "MAD", author: "Lea Premiere", mine: false },
    { ref: "deck 2", title: "Relations d'ordre", course: "PRG", mine: false },
    { ref: "deck 3", title: "Calcul matriciel", course: "MAD", mine: true },
  ];
  assert.deepEqual(findSimilar({ title: "Les relations d'ordre", course: "mad" }, existing).map((e) => e.ref), ["deck 1"], "the same title in another course is something else");
  assert.equal(findSimilar({ title: "MAD", course: "MAD" }, existing).length, 0, "the course alone says nothing");

  const wanted = { title: "Relations d'ordre", course: "MAD" };
  const refused = (claim?: { checked?: string[]; newBecause?: string }) => {
    try {
      requireNew("deck", wanted, existing, claim, "Read them.");
    } catch (error) {
      assert.ok(error instanceof AlreadyExists);
      return error;
    }
    return undefined;
  };
  const first = refused()!;
  assert.match(first.message, /deck 1: « Relations d'ordre » \(MAD\), by Lea Premiere/);
  assert.match(first.message, /`checked` \("deck 1"\) and `new_because`/);
  assert.deepEqual(first.similar.map((e) => e.ref), ["deck 1"]);
  assert.ok(refused({ newBecause: "I want my own deck about the same thing" }), "a reason without having looked at them");
  assert.ok(refused({ checked: ["deck 1"] }), "looked at, but no reason");
  assert.ok(refused({ checked: ["deck 1"], newBecause: "non" }), "not a reason");
  assert.ok(refused({ checked: ["deck 3"], newBecause: "The existing deck does not cover Hasse diagrams." }), "another item was looked at");
  assert.equal(refused({ checked: ["Deck 1"], newBecause: "The existing deck does not cover Hasse diagrams." }), undefined);
});

test("decks and quizzes are shared: read by all, changed by their author, never copied", async (t) => {
  if (!db) return t.skip("no local database");
  const deck = await as(lea, async () => {
    const created = await createDeck(db!, { title: "Relations d'ordre", course: "MAD" });
    await addCards(db!, created.id, [{ front: "Antisymétrie ?", back: "aRb et bRa ⇒ a = b" }]);
    return created;
  });
  assert.deepEqual([deck.mine, deck.editable, deck.author], [true, true, "Lea Premiere"]);

  await as(noe, async () => {
    // Everyone reads and studies it, with a progress of their own.
    const seen = (await listDecks(db!)).find((d) => d.id === deck.id)!;
    assert.deepEqual([seen.mine, seen.editable, seen.author, seen.cards, seen.fresh], [false, false, "Lea Premiere", 1, 1]);
    const card = (await getDeck(db!, deck.id))!.cardList[0];
    await review(db!, card.id, 3);
    assert.equal((await listDecks(db!)).find((d) => d.id === deck.id)!.fresh, 0);

    // Changing it is refused out loud, never a silent "nothing changed".
    for (const attempt of [() => updateDeck(db!, deck.id, { title: "À moi" }), () => deleteDeck(db!, deck.id), () => addCards(db!, deck.id, [{ front: "x", back: "y" }]), () => deleteCard(db!, card.id)]) {
      await assert.rejects(attempt(), (error: unknown) => error instanceof AccessDenied && /created by Lea Premiere/.test((error as Error).message));
    }
    assert.equal((await db!.query("UPDATE decks SET title = 'x' WHERE id = $1", [deck.id])).rowCount, 0, "and the database leaves the row alone");

    // A copy is refused until the existing one was looked at and something is missing in it.
    await assert.rejects(createDeck(db!, { title: "Les relations d'ordre", course: "MAD" }), (error: unknown) => error instanceof AlreadyExists && error.similar[0].ref === `deck ${deck.id}`);
    const own = await createDeck(db!, { title: "Les relations d'ordre", course: "MAD", reuse: { checked: [`deck ${deck.id}`], newBecause: "It has no card on Hasse diagrams, which the user asks for." } });
    assert.equal(own.mine, true);
    assert.ok(await createDeck(db!, { title: "Calcul matriciel", course: "MAD" }), "something else is created at once");
  });
  assert.equal((await as(lea, () => listDecks(db!))).find((d) => d.id === deck.id)!.fresh, 1, "the author's own progress is untouched");
  assert.equal((await as(lea, () => listDecks(db!))).find((d) => d.id === deck.id)!.title, "Relations d'ordre");

  const questions = [{ statement: "Une relation d'ordre est réflexive.", answer: true }];
  const quiz = await as(lea, () => createQuiz(db!, { title: "Chapitre 3 relations", course: "MAD" }, questions));
  await as(noe, async () => {
    assert.equal((await listQuizzes(db!)).find((q) => q.id === quiz.id)!.author, "Lea Premiere");
    await assert.rejects(deleteQuiz(db!, quiz.id), AccessDenied);
    await assert.rejects(createQuiz(db!, { title: "Relations chapitre 3", course: "MAD" }, questions), AlreadyExists);
    assert.ok(await createQuiz(db!, { title: "Chapitre 4 relations", course: "MAD" }, questions), "another chapter");
  });
  // An administrator may tidy up what anyone created.
  assert.equal(await as(admin, () => deleteQuiz(db!, quiz.id)), true);
  assert.equal(await as(lea, () => deleteDeck(db!, deck.id)), true);
  assert.equal(await as(lea, () => deleteDeck(db!, 999_999)), false);
});

test("the library is shared: a name belongs to its author, and what exists is not rendered again", async (t) => {
  if (!db) return t.skip("no local database");
  const write = (id: string, text: string) => writeFileSync(path.join(base, "out", id), text);
  assert.equal(itemKeyOfFile("documents/MAD-relations.pdf"), "document:MAD-relations");
  assert.equal(itemKeyOfFile("videos/Scene.mp4"), "video:Scene");
  assert.equal(itemKeyOfFile("documents/../x.pdf"), undefined);

  // What was there before the accounts belongs to the first one.
  write("documents/ancien.md", "# Ancien document");
  assert.equal(await adoptLibrary(db, admin.user.id), 1);
  assert.equal(await adoptLibrary(db, admin.user.id), 0);

  await as(lea, async () => {
    await claimLibraryItems(db!, ["document:MAD-relations-ordre-fiche"]);
    write("documents/MAD-relations-ordre-fiche.md", "# Relations d'ordre : fiche de révision");
    await claimLibraryItems(db!, ["document:MAD-relations-ordre-fiche"]);
    await setLibraryTags(db!, "document:MAD-relations-ordre-fiche", { course: "MAD", tags: ["révision"] });
  });

  await as(noe, async () => {
    const items = await annotatedLibrary(db!);
    const fiche = items.find((i) => i.name === "MAD-relations-ordre-fiche")!;
    assert.deepEqual([fiche.mine, fiche.editable, fiche.author, fiche.course], [false, false, "Lea Premiere", "MAD"]);
    assert.equal(items.find((i) => i.name === "ancien")!.author, "Ada Admin");

    // Its name cannot be taken, its files and tags cannot be changed.
    await assert.rejects(claimLibraryItems(db!, ["document:MAD-relations-ordre-fiche"]), (error: unknown) => error instanceof AccessDenied && /Lea Premiere/.test((error as Error).message));
    await assert.rejects(requireLibraryEditable(db!, "document:ancien"), AccessDenied);
    await assert.rejects(setLibraryTags(db!, "document:MAD-relations-ordre-fiche", { tags: ["exercices"] }), AccessDenied);
    assert.throws(() => requireNewLibraryItem(items, "document", { name: "MAD-relations-ordre-fiche" }, undefined), AccessDenied);

    // The same thing under another name is refused until the existing one was looked at.
    const copy = { name: "fiche-relations-ordre", title: "Fiche de révision : relations d'ordre" };
    assert.throws(() => requireNewLibraryItem(items, "document", copy, undefined), (error: unknown) => error instanceof AlreadyExists && error.similar[0].ref === "document:MAD-relations-ordre-fiche");
    assert.doesNotThrow(() => requireNewLibraryItem(items, "document", copy, { checked: ["document:MAD-relations-ordre-fiche"], newBecause: "The user wants the proofs too, which the sheet leaves out." }));
    assert.doesNotThrow(() => requireNewLibraryItem(items, "video", copy, undefined), "a video of it does not exist yet");
    assert.doesNotThrow(() => requireNewLibraryItem(items, "document", { name: "MAD-calcul-matriciel-exercices" }, undefined));
  });

  await as(lea, async () => {
    // Rendering one's own document again is the normal way to improve it.
    assert.doesNotThrow(() => annotatedLibrary(db!).then((items) => requireNewLibraryItem(items, "document", { name: "MAD-relations-ordre-fiche" }, undefined)));
    rmSync(path.join(base, "out", "documents", "MAD-relations-ordre-fiche.md"));
    await releaseLibraryItem(db!, "document:MAD-relations-ordre-fiche");
  });
  // Once deleted by its author, the name is free again.
  await as(noe, () => claimLibraryItems(db!, ["document:MAD-relations-ordre-fiche"]));
});
