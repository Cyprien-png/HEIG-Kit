import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { ROOT } from "../paths.js";

/** Local database of `rag/compose.yml`; RAG_DATABASE_URL overrides it (e.g. from another container). */
const DEFAULT_URL = "postgres://heigkit:heigkit@127.0.0.1:5433/heigkit";
const MIGRATIONS_DIR = path.join(ROOT, "rag", "migrations");

export type Db = pg.Pool;

export function openDb(url = process.env.RAG_DATABASE_URL ?? DEFAULT_URL): Db {
  return new pg.Pool({ connectionString: url, max: 4 });
}

/** Applies the SQL files of rag/migrations not applied yet, in name order, each in a transaction. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const pending = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql") && !applied.has(f)).sort();

  for (const name of pending) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf-8");
    await transaction(db, async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    });
  }
  return pending;
}

export async function transaction<T>(db: Db, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** pgvector literal for a vector parameter, e.g. `[0.1,0.2]`. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
