import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { DATA_DIR } from "../paths.js";
import { type Chunk, chunkMarkdown } from "./chunk.js";
import { type Db, toVector, transaction } from "./db.js";
import { embed } from "./embed.js";
import { EXTRACTOR_VERSION, extractMarkdown, isDoclingAvailable } from "./extract.js";
import { Progress, formatBytes } from "./progress.js";
import type { SourceDocument } from "./sources/source.js";

export interface IngestStats {
  listed: number;
  unchanged: number;
  /** New content: extracted, chunked and embedded. */
  indexed: number;
  /** New or changed document whose content was already indexed (e.g. the same file in two places). */
  linked: number;
  removed: number;
  failed: number;
  /** Left for a later run (see `IngestOptions.skip`); still listed, so not taken as removed. */
  skipped: number;
  chunks: number;
  /** Bytes of the documents processed (not the unchanged ones), and the time it took. */
  bytes: number;
  ms: number;
}

export interface IngestOptions {
  /**
   * Documents of these courses missing from the listing were removed from the source and are removed from the
   * index; `"all"` applies this to the whole source. Documents of other courses (e.g. courses of past semesters,
   * no longer selected) are kept.
   */
  removalScope: string[] | "all";
  dryRun?: boolean;
  /** Starts the extraction service again when a document made it run out of memory. */
  restartExtractor?: () => Promise<void>;
  /** Documents to leave for a later run, with the reason (e.g. the extraction service is off). */
  skip?: (doc: SourceDocument) => string | undefined;
  log?: (line: string) => void;
}

interface Existing {
  external_id: string;
  version: string;
  content_hash: string | null;
  extractor_version: number | null;
}

/**
 * Brings the index up to date with the documents of one source. Safe to run again: unchanged documents are
 * skipped without being loaded, and content is indexed once per hash.
 */
export async function ingestSource(db: Db, source: string, documents: SourceDocument[], options: IngestOptions): Promise<IngestStats> {
  const log = options.log ?? (() => {});
  const stats: IngestStats = { listed: documents.length, unchanged: 0, indexed: 0, linked: 0, removed: 0, failed: 0, skipped: 0, chunks: 0, bytes: 0, ms: 0 };
  const existing = new Map(
    (
      await db.query<Existing>(
        `SELECT d.external_id, d.version, d.content_hash, c.extractor_version
         FROM documents d LEFT JOIN contents c USING (content_hash) WHERE d.source = $1 AND d.removed_at IS NULL`,
        [source],
      )
    ).rows.map((row) => [row.external_id, row]),
  );

  // Unchanged documents first: they take no time, so the progress below only measures real work.
  const todo: SourceDocument[] = [];
  for (const doc of documents) {
    const known = existing.get(doc.externalId);
    if (known?.content_hash && known.version === doc.version && (known.extractor_version ?? 0) >= EXTRACTOR_VERSION) {
      stats.unchanged++;
      if (!options.dryRun) await upsertDocument(db, doc, known.content_hash);
    } else {
      todo.push(doc);
    }
  }
  const progress = new Progress(todo.map((doc) => doc.size));
  if (todo.length > 0) log(`${todo.length} documents to process (${formatBytes(progress.totalBytes)}), ${stats.unchanged} unchanged`);

  for (const [i, doc] of todo.entries()) {
    const label = `[${i + 1}/${todo.length}] ${[doc.courseCode, doc.title].filter(Boolean).join(" · ")}`;
    const known = existing.get(doc.externalId);
    if (options.dryRun) {
      log(`${label}: ${!known ? "new" : known.version === doc.version ? "to extract again" : "changed"}${doc.size ? `, ${formatBytes(doc.size)}` : ""}`);
      continue;
    }

    let loaded: number | undefined;
    try {
      const reason = options.skip?.(doc);
      if (reason) {
        stats.skipped++;
        log(`${label}: left for later, ${reason}`);
        continue;
      }
      const bytes = await doc.load();
      loaded = bytes.length;
      if (!path.isAbsolute(doc.localPath)) {
        const file = path.join(DATA_DIR, path.relative("data", doc.localPath));
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, bytes);
      }
      const hash = createHash("sha256").update(bytes).digest("hex");
      const indexed =
        (await db.query("SELECT 1 FROM contents WHERE content_hash = $1 AND extractor_version >= $2", [hash, EXTRACTOR_VERSION])).rowCount === 1;
      if (indexed) {
        await upsertDocument(db, doc, hash);
        stats.linked++;
        log(`${label}: already indexed elsewhere, linked`);
        continue;
      }

      const markdown = (await extractWithRecovery(bytes, doc.filename, hash, options, (line) => log(`${label}: ${line}`))).normalize("NFC");
      const chunks = chunkMarkdown(markdown, { exercises: ["exercises", "solutions", "exam"].includes(doc.docType) });
      const vectors = await embed(chunks.map((chunk) => contextualize(doc, chunk)));
      await transaction(db, async (client) => {
        // Content extracted by an older version: its chunks are replaced.
        await client.query(
          `INSERT INTO contents (content_hash, extractor_version) VALUES ($1, $2)
           ON CONFLICT (content_hash) DO UPDATE SET extractor_version = EXCLUDED.extractor_version`,
          [hash, EXTRACTOR_VERSION],
        );
        await client.query("DELETE FROM chunks WHERE content_hash = $1", [hash]);
        if (chunks.length > 0) {
          await client.query(
            `INSERT INTO chunks (content_hash, ordinal, page_from, page_to, heading_path, exercise, text, embedding)
             SELECT $1, o, pf, pt, h, e, t, v::vector
             FROM unnest($2::int[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[]) AS u(o, pf, pt, h, e, t, v)`,
            [
              hash,
              chunks.map((c) => c.ordinal),
              chunks.map((c) => c.pageFrom),
              chunks.map((c) => c.pageTo),
              chunks.map((c) => c.headingPath || null),
              chunks.map((c) => c.exercise ?? null),
              chunks.map((c) => c.text),
              vectors.map(toVector),
            ],
          );
        }
        await upsertDocument(client, doc, hash);
      });
      stats.indexed++;
      stats.chunks += chunks.length;
      log(`${label}: ${known ? "updated" : "indexed"}, ${chunks.length} chunks`);
    } catch (error) {
      stats.failed++;
      log(`${label}: FAILED, ${error instanceof Error ? error.message : error}`);
    } finally {
      // Also after `continue` (a document already indexed elsewhere).
      progress.done(i, loaded);
      log(`  ${progress.line()}`);
    }
  }
  if (!options.dryRun) {
    stats.bytes = progress.processedBytes;
    stats.ms = progress.elapsedMs;
  }

  if (!options.dryRun) {
    const listed = documents.map((d) => d.externalId);
    const courses = options.removalScope === "all" ? null : options.removalScope;
    const removed = await db.query(
      `UPDATE documents SET removed_at = now(), content_hash = NULL, version = ''
       WHERE source = $1 AND removed_at IS NULL AND NOT (external_id = ANY($2::text[]))
         AND ($3::text[] IS NULL OR course_code = ANY($3::text[]))`,
      [source, listed, courses],
    );
    stats.removed = removed.rowCount ?? 0;
  }
  if (!options.dryRun) {
    // Content no document refers to anymore (replaced or removed documents): its chunks go with it.
    await db.query("DELETE FROM contents c WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.content_hash = c.content_hash)");
  }
  return stats;
}

/**
 * Extraction surviving documents too large for the service's memory (e.g. full HD slides): the service is started again
 * and the document retried with smaller figures. If it still dies, it is restarted for the next documents.
 */
async function extractWithRecovery(bytes: Buffer, filename: string, hash: string, options: IngestOptions, log: (line: string) => void): Promise<string> {
  const restart = options.restartExtractor;
  try {
    return await extractMarkdown(bytes, filename, hash);
  } catch (error) {
    if (!restart || (await isDoclingAvailable())) throw error;
  }
  log("the extraction service ran out of memory, retrying with smaller figures");
  await restart();
  try {
    return await extractMarkdown(bytes, filename, hash, 1);
  } catch (error) {
    if (!(await isDoclingAvailable())) await restart();
    throw error;
  }
}

/** The text that is embedded: the chunk preceded by where it comes from, so a bare paragraph keeps its context. */
function contextualize(doc: SourceDocument, chunk: Chunk): string {
  const where = [doc.courseCode, doc.chapter, doc.docType, doc.title, chunk.exercise && `Ex. ${chunk.exercise}`].filter(Boolean).join(" · ");
  return [where, chunk.headingPath, chunk.text].filter(Boolean).join("\n");
}

async function upsertDocument(db: pg.Pool | pg.PoolClient, doc: SourceDocument, contentHash: string): Promise<void> {
  await db.query(
    `INSERT INTO documents (source, external_id, title, url, local_path, version, content_hash, course_code, course_name,
                            teachers, chapter, doc_type, uploaded_at, indexed_at, removed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), NULL)
     ON CONFLICT (source, external_id) DO UPDATE SET
       title = EXCLUDED.title, url = EXCLUDED.url, local_path = EXCLUDED.local_path, version = EXCLUDED.version,
       content_hash = EXCLUDED.content_hash, course_code = EXCLUDED.course_code, course_name = EXCLUDED.course_name,
       teachers = EXCLUDED.teachers, chapter = EXCLUDED.chapter, doc_type = EXCLUDED.doc_type,
       uploaded_at = EXCLUDED.uploaded_at, removed_at = NULL,
       indexed_at = CASE WHEN documents.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN now() ELSE documents.indexed_at END`,
    [
      doc.source,
      doc.externalId,
      doc.title,
      doc.url ?? null,
      doc.localPath,
      doc.version,
      contentHash,
      doc.courseCode ?? null,
      doc.courseName ?? null,
      doc.teachers,
      doc.chapter ?? null,
      doc.docType,
      doc.uploadedAt ?? null,
    ],
  );
}
