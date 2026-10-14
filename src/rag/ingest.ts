import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { ROOT } from "../paths.js";
import { type Chunk, chunkMarkdown } from "./chunk.js";
import { type Db, toVector, transaction } from "./db.js";
import { embed } from "./embed.js";
import { extractMarkdown } from "./extract.js";
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
  chunks: number;
}

export interface IngestOptions {
  /** The listing covers the whole source: documents missing from it were removed from the source. */
  complete: boolean;
  dryRun?: boolean;
  log?: (line: string) => void;
}

interface Existing {
  external_id: string;
  version: string;
  content_hash: string | null;
}

/**
 * Brings the index up to date with the documents of one source. Safe to run again: unchanged documents are
 * skipped without being loaded, and content is indexed once per hash.
 */
export async function ingestSource(db: Db, source: string, documents: SourceDocument[], options: IngestOptions): Promise<IngestStats> {
  const log = options.log ?? (() => {});
  const stats: IngestStats = { listed: documents.length, unchanged: 0, indexed: 0, linked: 0, removed: 0, failed: 0, chunks: 0 };
  const existing = new Map(
    (
      await db.query<Existing>("SELECT external_id, version, content_hash FROM documents WHERE source = $1 AND removed_at IS NULL", [source])
    ).rows.map((row) => [row.external_id, row]),
  );

  for (const [i, doc] of documents.entries()) {
    const label = `[${i + 1}/${documents.length}] ${[doc.courseCode, doc.title].filter(Boolean).join(" · ")}`;
    const known = existing.get(doc.externalId);
    if (known?.content_hash && known.version === doc.version) {
      stats.unchanged++;
      if (!options.dryRun) await upsertDocument(db, doc, known.content_hash);
      continue;
    }
    if (options.dryRun) {
      log(`${label}: ${known ? "changed" : "new"}`);
      continue;
    }

    try {
      const bytes = await doc.load();
      if (!path.isAbsolute(doc.localPath)) {
        const file = path.join(ROOT, doc.localPath);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, bytes);
      }
      const hash = createHash("sha256").update(bytes).digest("hex");
      const indexed = (await db.query("SELECT 1 FROM contents WHERE content_hash = $1", [hash])).rowCount === 1;
      if (indexed) {
        await upsertDocument(db, doc, hash);
        stats.linked++;
        log(`${label}: already indexed elsewhere, linked`);
        continue;
      }

      const markdown = (await extractMarkdown(bytes, doc.filename, hash)).normalize("NFC");
      const chunks = chunkMarkdown(markdown, { exercises: ["exercises", "solutions", "exam"].includes(doc.docType) });
      const vectors = await embed(chunks.map((chunk) => contextualize(doc, chunk)));
      await transaction(db, async (client) => {
        await client.query("INSERT INTO contents (content_hash) VALUES ($1)", [hash]);
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
    }
  }

  if (options.complete && !options.dryRun) {
    const listed = documents.map((d) => d.externalId);
    const removed = await db.query(
      `UPDATE documents SET removed_at = now(), content_hash = NULL, version = ''
       WHERE source = $1 AND removed_at IS NULL AND NOT (external_id = ANY($2::text[]))`,
      [source, listed],
    );
    stats.removed = removed.rowCount ?? 0;
  }
  if (!options.dryRun) {
    // Content no document refers to anymore (replaced or removed documents): its chunks go with it.
    await db.query("DELETE FROM contents c WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.content_hash = c.content_hash)");
  }
  return stats;
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
