import { createHash } from "node:crypto";
import type { Db } from "../rag/db.js";

/** What the server keeps a copy of, so the web app answers without touching GAPS or Cyberlearn. */
export type SnapshotKind = "schedule" | "deadlines" | "grades" | "transcript" | "plan" | "absences" | "courses" | "contents";

export interface Snapshot<T> {
  data: T;
  /** When this state was first seen. */
  fetchedAt: Date;
  /** When it was last confirmed. */
  checkedAt: Date;
}

/** Stores `data` as the latest state of `kind`; a new row only when it differs from the previous state. */
export async function saveSnapshot(db: Db, kind: SnapshotKind, data: unknown): Promise<{ changed: boolean }> {
  const text = JSON.stringify(data);
  const hash = createHash("sha256").update(text).digest("hex");
  const { rows } = await db.query<{ id: string; hash: string }>("SELECT id, hash FROM snapshots WHERE kind = $1 ORDER BY fetched_at DESC, id DESC LIMIT 1", [kind]);
  if (rows[0]?.hash === hash) {
    await db.query("UPDATE snapshots SET checked_at = now() WHERE id = $1", [rows[0].id]);
    return { changed: false };
  }
  await db.query("INSERT INTO snapshots (kind, hash, data) VALUES ($1, $2, $3)", [kind, hash, text]);
  // Only the last few states are worth keeping.
  await db.query("DELETE FROM snapshots WHERE kind = $1 AND id NOT IN (SELECT id FROM snapshots WHERE kind = $1 ORDER BY fetched_at DESC, id DESC LIMIT 5)", [kind]);
  return { changed: true };
}

export async function latestSnapshot<T>(db: Db, kind: SnapshotKind): Promise<Snapshot<T> | undefined> {
  const { rows } = await db.query("SELECT data, fetched_at, checked_at FROM snapshots WHERE kind = $1 ORDER BY fetched_at DESC, id DESC LIMIT 1", [kind]);
  return rows[0] ? { data: rows[0].data as T, fetchedAt: rows[0].fetched_at, checkedAt: rows[0].checked_at } : undefined;
}

/** When each kind was last fetched and last changed, for the status page. */
export async function snapshotAges(db: Db): Promise<Record<string, { fetchedAt: Date; checkedAt: Date }>> {
  const { rows } = await db.query("SELECT DISTINCT ON (kind) kind, fetched_at, checked_at FROM snapshots ORDER BY kind, fetched_at DESC, id DESC");
  return Object.fromEntries(rows.map((r) => [r.kind, { fetchedAt: r.fetched_at, checkedAt: r.checked_at }]));
}
