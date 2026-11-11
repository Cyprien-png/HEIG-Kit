import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { identityOf } from "../src/accounts/users.js";
import { addPhoto, correctionsDir, createCorrection, getCorrection, photoFile, sniffImage } from "../src/app/corrections.js";
import { formatHousekeeping, runHousekeeping } from "../src/app/housekeeping.js";
import { runAs } from "../src/identity.js";
import { DATA_DIR } from "../src/paths.js";
import type { Db } from "../src/rag/db.js";
import { type TestAccount, readyAccount } from "./helpers/accounts.js";
import { testDb } from "./helpers/db.js";

// This test deletes folders: it only ever runs in the throwaway data folder of test/helpers/env.ts.
const SAFE = Boolean(process.env.HEIG_TEST_ROOT) && DATA_DIR.startsWith(process.env.HEIG_TEST_ROOT!);

let db: Db | undefined;
let lea: TestAccount;
before(async () => {
  if (!SAFE) return;
  db = await testDb("heigkit_test_housekeeping");
  if (db) lea = await readyAccount(db, "lea.premiere@heig-vd.ch");
});
after(async () => {
  await db?.end();
});

/** A page as a phone sends it: large and heavier than it needs to be. */
async function photo(width = 3000, height = 2200): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = 200 + ((i * 2654435761) >>> 28);
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
}

const old = (file: string, hours: number) => utimesSync(file, new Date(Date.now() - hours * 3_600_000), new Date(Date.now() - hours * 3_600_000));

test("photos of finished corrections are compressed, the others untouched, and leftovers removed", async (t) => {
  if (!SAFE) return t.skip("not in the test data folder");
  if (!db) return t.skip("no local database");
  const page = await photo();
  const as = <T>(work: () => Promise<T>) => runAs(identityOf(lea.user), work);
  const ids = await as(async () => {
    const done = await createCorrection(db!, { title: "Série 3" });
    const recent = await createCorrection(db!, { title: "Corrigée aujourd'hui" });
    const open = await createCorrection(db!, { title: "En cours" });
    const unused = await createCorrection(db!, { title: "Jamais utilisée" });
    for (const c of [done, recent, open]) await addPhoto(db!, c.id, page);
    await addPhoto(db!, done.id, page);
    return { done: done.id, recent: recent.id, open: open.id, unused: unused.id };
  });
  await db.system.query("UPDATE corrections SET state = 'corrected', corrected_at = now() - interval '10 days' WHERE id = $1", [ids.done]);
  await db.system.query("UPDATE corrections SET state = 'corrected', corrected_at = now() WHERE id = $1", [ids.recent]);
  await db.system.query("UPDATE corrections SET created_at = now() - interval '30 days' WHERE id = $1", [ids.unused]);
  // An upload that never finished, the folder of a correction that no longer exists, and one being created right now.
  const stale = path.join(correctionsDir(ids.done), ".9.jpg.partial");
  writeFileSync(stale, "half a photo");
  old(stale, 2);
  const orphan = correctionsDir("00000000-0000-4000-8000-00000000dead");
  mkdirSync(orphan, { recursive: true });
  writeFileSync(path.join(orphan, "1.jpg"), "x".repeat(5000));
  old(orphan, 48);
  const young = correctionsDir("00000000-0000-4000-8000-00000000beef");
  mkdirSync(young, { recursive: true });

  const dry = await runHousekeeping(db, { dryRun: true });
  assert.deepEqual([dry.photos.compressed, dry.removed.abandonedCorrections, dry.removed.orphanFolders, dry.removed.partialFiles], [2, 1, 1, 1]);
  assert.ok(existsSync(stale) && existsSync(orphan), "a dry run changes nothing");
  assert.match(formatHousekeeping(dry), /Dry run/);

  const report = await runHousekeeping(db);
  assert.deepEqual([report.photos.compressed, report.photos.failed, report.removed.abandonedCorrections, report.removed.orphanFolders, report.removed.partialFiles], [2, 0, 1, 1, 1]);
  assert.ok(report.photos.bytesAfter < report.photos.bytesBefore / 3, `${report.photos.bytesBefore} → ${report.photos.bytesAfter}`);
  assert.ok(report.freed > report.photos.bytesBefore / 2);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(orphan), false);
  assert.equal(existsSync(young), true, "a folder of the last day may belong to a correction being created");

  await as(async () => {
    // The correction still shows every page, as a lighter JPEG of a readable size.
    const { default: sharp } = await import("sharp");
    const done = (await getCorrection(db!, ids.done))!;
    assert.equal(done.photos.length, 2);
    for (const p of done.photos) {
      assert.equal(p.contentType, "image/jpeg");
      const found = (await photoFile(db!, ids.done, p.id))!;
      assert.equal(sniffImage(readFileSync(found.file)), "image/jpeg");
      assert.equal(statSync(found.file).size, p.bytes);
      const meta = await sharp(found.file).metadata();
      assert.deepEqual([meta.width, meta.height], [2000, 1467]);
    }
    for (const id of [ids.recent, ids.open]) {
      const c = (await getCorrection(db!, id))!;
      assert.deepEqual([c.photos[0].contentType, c.photos[0].bytes], ["image/png", page.length], "corrected too recently, or not corrected yet");
    }
    assert.equal(await getCorrection(db!, ids.unused), undefined);
  });

  // Nothing is compressed twice.
  const again = await runHousekeeping(db);
  assert.deepEqual([again.photos.compressed, again.photos.skipped, again.freed], [0, 0, 0]);

  // A photo that cannot be read, or that would not get smaller, stays as it is.
  await db.system.query("UPDATE corrections SET corrected_at = now() - interval '10 days' WHERE id = $1", [ids.recent]);
  const broken = await runHousekeeping(db, { encode: async () => Promise.reject(new Error("unreadable")) });
  assert.deepEqual([broken.photos.compressed, broken.photos.failed], [0, 1]);
  const same = await runHousekeeping(db, { encode: async (file, target) => writeFileSync(target, readFileSync(file)) });
  assert.deepEqual([same.photos.compressed, same.photos.skipped], [0, 1]);
  assert.equal((await as(() => getCorrection(db!, ids.recent)))!.photos[0].bytes, page.length);
});

test("with a database that knows none of the folders, nothing is removed", async (t) => {
  if (!SAFE) return t.skip("not in the test data folder");
  const other = await testDb("heigkit_test_housekeeping_other");
  if (!other) return t.skip("no local database");
  try {
    const folders = ["a", "b", "c"].map((x) => correctionsDir(`00000000-0000-4000-8000-00000000000${x}`));
    for (const folder of folders) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, "1.jpg"), "photo");
      old(folder, 72);
    }
    const lines: string[] = [];
    const report = await runHousekeeping(other, { log: (line) => lines.push(line) });
    assert.equal(report.removed.orphanFolders, 0);
    assert.ok(folders.every((folder) => existsSync(path.join(folder, "1.jpg"))));
    assert.match(lines.join("\n"), /nothing is removed/);
  } finally {
    await other.end();
  }
});
