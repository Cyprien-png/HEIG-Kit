/**
 * Keeps the storage of a server small without anyone thinking about it: photos of corrections are made lighter once
 * the correction is done, and what nobody will read again is removed (old journals, finished jobs, abandoned
 * captures, expired tokens, files left by an interrupted upload). Runs every day on the server, or on demand:
 * `npm run housekeeping`. It works for every account at once, as the server itself, and never reads anyone's content
 * beyond the bytes it re-encodes.
 */
import { existsSync, lstatSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../paths.js";
import type { Db } from "../rag/db.js";
import { outputDir } from "../vendor.js";
import { correctionsDir } from "./corrections.js";

export interface HousekeepingOptions {
  /** Says what would be done, changes nothing. */
  dryRun?: boolean;
  /** A corrected correction keeps its full photos this long, for a second look or a contested mark. */
  compressAfterDays?: number;
  /** Longest side of a compressed photo, in pixels: handwriting stays readable. */
  maxSide?: number;
  quality?: number;
  /** A capture that never got a photo is dropped after this long. */
  abandonedAfterDays?: number;
  syncRunsDays?: number;
  /** Forgets the finished rendering jobs (the queue of the server). */
  pruneJobs?: () => number;
  /** Re-encodes one image file; replaced in tests. */
  encode?: (file: string, target: string, maxSide: number, quality: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface HousekeepingReport {
  dryRun: boolean;
  photos: { compressed: number; skipped: number; failed: number; bytesBefore: number; bytesAfter: number };
  removed: { abandonedCorrections: number; orphanFolders: number; partialFiles: number; jobs: number; syncRuns: number; tokens: number; requests: number };
  /** Bytes given back to the disk. */
  freed: number;
}

/** Shrinks and re-encodes a photo as JPEG, upright (the phone's orientation applied), without its metadata (location, device). */
async function encodeWithSharp(file: string, target: string, maxSide: number, quality: number): Promise<void> {
  const { default: sharp } = await import("sharp");
  await sharp(file, { failOn: "error", limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality, mozjpeg: true })
    .toFile(target);
}

const size = (file: string) => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

function folderSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? folderSize(full) : entry.isFile() ? size(full) : 0;
  }
  return total;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function runHousekeeping(db: Db, options: HousekeepingOptions = {}): Promise<HousekeepingReport> {
  const dryRun = options.dryRun ?? false;
  const encode = options.encode ?? encodeWithSharp;
  const maxSide = options.maxSide ?? 2000;
  const quality = options.quality ?? 72;
  const log = options.log ?? (() => undefined);
  const report: HousekeepingReport = {
    dryRun,
    photos: { compressed: 0, skipped: 0, failed: 0, bytesBefore: 0, bytesAfter: 0 },
    removed: { abandonedCorrections: 0, orphanFolders: 0, partialFiles: 0, jobs: 0, syncRuns: 0, tokens: 0, requests: 0 },
    freed: 0,
  };
  const sql = db.system;

  // 1. Photos of corrections done for a while: the correction keeps every page, lighter.
  const { rows: photos } = await sql.query<{ id: string; correction_id: string; file: string; bytes: number }>(
    `SELECT p.id, p.correction_id, p.file, p.bytes FROM correction_photos p JOIN corrections c ON c.id = p.correction_id
     WHERE p.compressed_at IS NULL AND p.file <> '' AND c.state = 'corrected' AND c.corrected_at < now() - make_interval(days => $1)
     ORDER BY p.id`,
    [options.compressAfterDays ?? 3],
  );
  for (const photo of photos) {
    const dir = correctionsDir(photo.correction_id);
    const source = path.join(dir, path.basename(photo.file));
    if (!existsSync(source) || !lstatSync(source).isFile()) {
      report.photos.skipped++;
      continue;
    }
    const before = size(source);
    if (dryRun) {
      report.photos.compressed++;
      report.photos.bytesBefore += before;
      report.photos.bytesAfter += before;
      continue;
    }
    const name = `${photo.id}.jpg`;
    const partial = path.join(dir, `.${name}.partial`);
    try {
      await encode(source, partial, maxSide, quality);
      const after = size(partial);
      // Not worth a loss of quality for a few percent: the original stays, and is not looked at again.
      if (after === 0 || after > before * 0.85) {
        rmSync(partial, { force: true });
        await sql.query("UPDATE correction_photos SET compressed_at = now() WHERE id = $1", [photo.id]);
        report.photos.skipped++;
        continue;
      }
      renameSync(partial, path.join(dir, name));
      if (path.basename(source) !== name) rmSync(source, { force: true });
      await sql.query("UPDATE correction_photos SET file = $2, content_type = 'image/jpeg', bytes = $3, original_bytes = $4, compressed_at = now() WHERE id = $1", [photo.id, name, after, before]);
      report.photos.compressed++;
      report.photos.bytesBefore += before;
      report.photos.bytesAfter += after;
    } catch (error) {
      rmSync(partial, { force: true });
      report.photos.failed++;
      log(`Photo ${photo.id} of correction ${photo.correction_id} left as it is: ${error instanceof Error ? error.message : error}`);
    }
  }
  report.freed += report.photos.bytesBefore - report.photos.bytesAfter;

  // 2. Captures opened and never used.
  const abandoned = `state = 'capture' AND created_at < now() - make_interval(days => $1) AND NOT EXISTS (SELECT 1 FROM correction_photos p WHERE p.correction_id = corrections.id)`;
  const days = [options.abandonedAfterDays ?? 7];
  if (dryRun) report.removed.abandonedCorrections = Number((await sql.query<{ n: string }>(`SELECT count(*) AS n FROM corrections WHERE ${abandoned}`, days)).rows[0].n);
  else {
    const { rows } = await sql.query<{ id: string }>(`DELETE FROM corrections WHERE ${abandoned} RETURNING id`, days);
    for (const { id } of rows) rmSync(correctionsDir(id), { recursive: true, force: true });
    report.removed.abandonedCorrections = rows.length;
  }

  // 3. Folders of photos whose correction no longer exists, and files of uploads that never finished.
  const root = path.join(DATA_DIR, "corrections");
  if (existsSync(root)) {
    const folders = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && UUID.test(e.name)).map((e) => e.name);
    const { rows } = folders.length ? await sql.query<{ id: string }>("SELECT id FROM corrections WHERE id = ANY($1::uuid[])", [folders]) : { rows: [] };
    const known = new Set(rows.map((r) => r.id));
    // Folders that all look orphaned mean the wrong database or the wrong data folder, not a server to tidy: hands off.
    const suspicious = folders.length >= 3 && known.size === 0;
    if (suspicious) log(`None of the ${folders.length} folders of ${root} belongs to a correction of this database: nothing is removed there. Check RAG_DATABASE_URL and HEIG_DATA_DIR.`);
    for (const folder of folders) {
      const dir = path.join(root, folder);
      if (!known.has(folder)) {
        // A correction being created writes its folder before anything else: young folders are left alone.
        if (suspicious || Date.now() - statSync(dir).mtimeMs < 86_400_000) continue;
        report.freed += folderSize(dir);
        report.removed.orphanFolders++;
        if (!dryRun) rmSync(dir, { recursive: true, force: true });
        continue;
      }
      report.removed.partialFiles += removePartials(dir, dryRun, report);
    }
  }
  for (const kind of ["documents", "videos"] as const) {
    const dir = outputDir(kind);
    if (existsSync(dir)) report.removed.partialFiles += removePartials(dir, dryRun, report);
  }

  // 4. What the server only keeps for a while.
  const count = async (table: string, where: string, values: unknown[] = []) =>
    dryRun ? Number((await sql.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, values)).rows[0].n) : ((await sql.query(`DELETE FROM ${table} WHERE ${where}`, values)).rowCount ?? 0);
  report.removed.syncRuns = await count("sync_runs", "started_at < now() - make_interval(days => $1)", [options.syncRunsDays ?? 60]);
  report.removed.tokens =
    (await count("oauth_codes", "expires_at < now() - interval '1 day'")) + (await count("oauth_refresh_tokens", "expires_at < now() OR revoked_at < now() - interval '7 days'"));
  report.removed.requests = await count("request_log", "at < now() - interval '30 days'");
  if (!dryRun && options.pruneJobs) report.removed.jobs = options.pruneJobs();
  return report;
}

/** Files left by an upload or a rendering interrupted more than an hour ago. */
function removePartials(dir: string, dryRun: boolean, report: HousekeepingReport): number {
  let removed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(".") || !entry.name.endsWith(".partial")) continue;
    const file = path.join(dir, entry.name);
    if (Date.now() - statSync(file).mtimeMs < 3_600_000) continue;
    report.freed += size(file);
    if (!dryRun) rmSync(file, { force: true });
    removed++;
  }
  return removed;
}

const megabytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function formatHousekeeping(report: HousekeepingReport): string {
  const { photos, removed } = report;
  const would = report.dryRun ? "would be " : "";
  return [
    report.dryRun ? "Dry run: nothing was changed." : "Housekeeping done.",
    `Photos of finished corrections: ${photos.compressed} ${would}compressed${report.dryRun ? ` (${megabytes(photos.bytesBefore)} today)` : ` (${megabytes(photos.bytesBefore)} → ${megabytes(photos.bytesAfter)})`}, ${photos.skipped} left as they are${photos.failed ? `, ${photos.failed} unreadable` : ""}.`,
    `${would}Removed: ${removed.abandonedCorrections} captures never used, ${removed.orphanFolders} folders without a correction, ${removed.partialFiles} interrupted uploads, ${removed.jobs} old rendering jobs, ` +
      `${removed.syncRuns} old sync runs, ${removed.tokens} expired tokens, ${removed.requests} old journal entries.`,
    `${report.dryRun ? "Would free at least" : "Freed"} ${megabytes(report.freed)}.`,
  ].join("\n");
}

/** Runs the housekeeping a few minutes after the start, then every day. */
export function scheduleHousekeeping(db: Db, options: HousekeepingOptions = {}, everyHours = 24): NodeJS.Timeout {
  const log = options.log ?? ((line: string) => console.error(line));
  const run = () =>
    void runHousekeeping(db, { ...options, log }).then(
      (report) => {
        if (report.photos.compressed || report.freed > 1024 ** 2) log(formatHousekeeping(report).replace(/\n/g, " "));
      },
      (error: unknown) => log(`Housekeeping failed: ${error instanceof Error ? error.message : error}`),
    );
  setTimeout(run, 10 * 60_000).unref();
  return setInterval(run, everyHours * 3_600_000).unref();
}
