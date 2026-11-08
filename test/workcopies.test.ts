import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { Db } from "../src/rag/db.js";
import { testDb } from "./helpers/db.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "heig-copies-"));
process.env.HEIG_DATA_DIR = tmp;
const { RevisionConflict, checkAnnotations, createWorkcopy, deleteWorkcopy, getWorkcopy, listWorkcopies, saveSource, sourceFile, updateWorkcopy } = await import("../src/app/workcopies.js");

const db: Db | undefined = await testDb("heigkit_test_workcopies");
after(async () => {
  await db?.end();
  rmSync(tmp, { recursive: true, force: true });
});

const pen = { t: "pen", c: "#d90115", w: 0.003, p: [0.1, 0.1, 0.2, 0.2] };

test("annotations are checked: kinds, colors, ranges, pages and sizes", () => {
  assert.deepEqual(checkAnnotations({ "1": [pen, { t: "text", c: "#000000", s: 0.02, x: 0.1, y: 0.1, v: "x = 2" }, { t: "arrow", c: "#2563eb", w: 0.003, a: [0, 0], b: [1, 1] }] })["1"].length, 3);
  assert.deepEqual(checkAnnotations({ "2": [] }), {}, "empty pages are dropped");
  for (const bad of [
    { "0": [pen] },
    { "201": [pen] },
    { x: [pen] },
    { "1": [{ ...pen, c: "red" }] },
    { "1": [{ ...pen, p: [0.1] }] },
    { "1": [{ ...pen, p: [0.1, 7] }] },
    { "1": [{ ...pen, w: 5 }] },
    { "1": [{ t: "image", c: "#000000" }] },
    { "1": [{ t: "text", c: "#000000", s: 0.02, x: 0, y: 0, v: "" }] },
    { "1": [{ t: "rect", c: "#000000", w: 0.003, a: [0, 0] }] },
    { "1": "pen" },
    [],
  ]) assert.throws(() => checkAnnotations(bad), Error, JSON.stringify(bad));
  assert.throws(() => checkAnnotations({ "1": Array.from({ length: 5001 }, () => pen) }), /too many/);
});

test("a copy keeps its PDF and its annotations; an edit from a stale revision is refused", { skip: !db && "no local database" }, async () => {
  const copy = await createWorkcopy(db!, { title: "  TE blanc MAD  ", course: "MAD", exam: "document:te-blanc-mad", pageCount: 3 });
  assert.equal(copy.title, "TE blanc MAD");
  assert.equal(copy.rev, 0);
  assert.equal(copy.hasSource, false);
  assert.equal(sourceFile(copy.id), undefined);

  await assert.rejects(saveSource(db!, copy.id, Buffer.from("not a pdf")), /Not a PDF/);
  const saved = await saveSource(db!, copy.id, Buffer.from("%PDF-1.7\n%%EOF"));
  assert.equal(saved?.hasSource, true);
  assert.ok(existsSync(sourceFile(copy.id)!));

  const first = await updateWorkcopy(db!, copy.id, { annotations: checkAnnotations({ "1": [pen] }) }, 0);
  assert.equal(first?.rev, 1);
  assert.equal(first?.annotatedPages, 1);
  // Another device still on revision 0 must not overwrite it.
  await assert.rejects(updateWorkcopy(db!, copy.id, { annotations: checkAnnotations({ "2": [pen] }) }, 0), (e) => e instanceof RevisionConflict && e.current.rev === 1);
  assert.deepEqual(Object.keys((await getWorkcopy(db!, copy.id))!.annotations!), ["1"]);

  // Metadata do not need a revision and do not move it.
  const renamed = await updateWorkcopy(db!, copy.id, { title: "Autre titre", course: null });
  assert.equal(renamed?.title, "Autre titre");
  assert.equal(renamed?.course, undefined);
  assert.equal(renamed?.rev, 1);
  await assert.rejects(updateWorkcopy(db!, copy.id, { title: "  " }), /empty/);
  await assert.rejects(updateWorkcopy(db!, copy.id, { exam: "../etc" }), /exam/);

  const sent = await updateWorkcopy(db!, copy.id, { submitted: true });
  assert.ok(sent?.submittedAt);
  assert.equal((await listWorkcopies(db!)).length, 1);

  assert.equal(await deleteWorkcopy(db!, copy.id), true);
  assert.equal(sourceFile(copy.id), undefined, "the file goes with the copy");
  assert.equal(await getWorkcopy(db!, copy.id), undefined);
  assert.equal(await deleteWorkcopy(db!, "../../x"), false);
});
