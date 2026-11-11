import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { AccessDenied, type Identity, currentIdentity } from "../identity.js";
import { ROOT } from "../paths.js";

/** Local database of `rag/compose.yml`; RAG_DATABASE_URL overrides it (e.g. from another container). */
const DEFAULT_URL = "postgres://heigkit:heigkit@127.0.0.1:5433/heigkit";
const MIGRATIONS_DIR = path.join(ROOT, "rag", "migrations");
/** The role every query of the application runs as: row level security applies to it (rag/migrations/016_accounts.sql). */
const APP_ROLE = "heigkit_app";

type Values = unknown[];

/**
 * The database as the application sees it: every query runs as the account of the current request (src/identity.ts),
 * so that personal rows of other accounts do not exist for it. `system` is the unrestricted connection, for the
 * server's own business only: accounts, tokens, journals, migrations.
 */
export interface Db {
  query<R extends pg.QueryResultRow = any>(text: string, values?: Values): Promise<pg.QueryResult<R>>;
  /** A connection of its own (transactions, advisory locks), with the same account for as long as it is held. */
  connect(): Promise<pg.PoolClient>;
  end(): Promise<void>;
  readonly system: pg.Pool;
}

/** `SET` statements giving a connection the role and the account; integers and a fixed word only, never user text. */
function settings(identity: Identity | undefined, local: boolean): string {
  const set = local ? "SET LOCAL" : "SET";
  const id = identity && Number.isSafeInteger(identity.id) && identity.id > 0 ? String(identity.id) : "";
  const role = identity?.role === "admin" ? "admin" : "student";
  return `${set} ROLE ${APP_ROLE}; ${set} heig.user_id = '${id}'; ${set} heig.role = '${id ? role : ""}'`;
}

/** Errors of the separation between accounts, said plainly; anything else is passed on. */
function translate(error: unknown): unknown {
  const e = error as { code?: string; column?: string; message?: string };
  // insufficient_privilege: a row level security policy, or a table of the server itself.
  if (e?.code === "42501") return new AccessDenied();
  // A personal row written without an account.
  if (e?.code === "23502" && (e.column === "user_id" || e.column === "created_by")) return new AccessDenied("No account is bound to this request.");
  return error;
}

const notMigrated = (error: unknown) => (error as { code?: string }).code === "42704" && String((error as Error).message).includes(APP_ROLE);

class AccountDb implements Db {
  private migrating?: Promise<unknown>;

  constructor(readonly system: pg.Pool) {}

  async query<R extends pg.QueryResultRow = any>(text: string, values?: Values): Promise<pg.QueryResult<R>> {
    try {
      return await this.run<R>(text, values);
    } catch (error) {
      // A database older than the accounts (a command run right after an update): bring it up to date once.
      if (!notMigrated(error)) throw error;
      await (this.migrating ??= migrate(this));
      return this.run<R>(text, values);
    }
  }

  private async run<R extends pg.QueryResultRow>(text: string, values?: Values): Promise<pg.QueryResult<R>> {
    const client = await this.system.connect();
    let broken = false;
    try {
      await client.query(`BEGIN; ${settings(currentIdentity(), true)}`);
      const result = await client.query<R>(text, values);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        broken = true;
      });
      throw translate(error);
    } finally {
      client.release(broken);
    }
  }

  async connect(): Promise<pg.PoolClient> {
    const client = await this.system.connect();
    try {
      await client.query(settings(currentIdentity(), false));
    } catch (error) {
      client.release(true);
      throw error;
    }
    const release = client.release.bind(client);
    // Given back to the pool as it came: without the role and the account.
    client.release = (error?: Error | boolean) => {
      client.release = release;
      if (error) return release(error);
      client.query("RESET ROLE; RESET heig.user_id; RESET heig.role").then(
        () => release(),
        () => release(true),
      );
    };
    return client;
  }

  end(): Promise<void> {
    return this.system.end();
  }
}

export function openDb(url = process.env.RAG_DATABASE_URL ?? DEFAULT_URL): Db {
  return new AccountDb(new pg.Pool({ connectionString: url, max: 6 }));
}

/**
 * The same database without accounts, for a process that only reads the shared course material (the knowledge-only
 * MCP server of rag/mcp.Dockerfile, which may run on a database that has no accounts yet).
 */
export function openSharedDb(url = process.env.RAG_DATABASE_URL ?? DEFAULT_URL): Db {
  const system = new pg.Pool({ connectionString: url, max: 4 });
  return { system, query: (text, values) => system.query(text, values), connect: () => system.connect(), end: () => system.end() };
}

/** Applies the SQL files of rag/migrations not applied yet, in name order, each in a transaction. */
export async function migrate(db: Db): Promise<string[]> {
  const system = db.system;
  await system.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied = new Set((await system.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const pending = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql") && !applied.has(f)).sort();

  for (const name of pending) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf-8");
    const client = await system.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return pending;
}

/** A transaction as the current account. */
export async function transaction<T>(db: Db, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw translate(error);
  } finally {
    client.release();
  }
}

/** pgvector literal for a vector parameter, e.g. `[0.1,0.2]`. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
