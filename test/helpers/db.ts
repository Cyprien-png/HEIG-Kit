/**
 * A throwaway database for domain tests, created on the local Postgres of rag/compose.yml when it runs; tests that
 * need it are skipped otherwise (e.g. in CI without a database).
 */
import pg from "pg";
import { type Db, migrate, openDb } from "../../src/rag/db.js";

const ADMIN_URL = process.env.RAG_DATABASE_URL ?? "postgres://heigkit:heigkit@127.0.0.1:5433/heigkit";

export async function testDb(name: string): Promise<Db | undefined> {
  const admin = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1500 });
  try {
    await admin.connect();
  } catch {
    return undefined;
  }
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const db = openDb(ADMIN_URL.replace(/\/[^/]+$/, `/${name}`));
  await migrate(db);
  return db;
}
