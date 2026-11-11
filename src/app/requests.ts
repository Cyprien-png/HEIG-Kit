import type { Db } from "../rag/db.js";

export interface RequestEntry {
  at: Date;
  client: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  tool?: string;
  note?: string;
}

const KEEP_DAYS = 7;
const MAX_ROWS = 5000;

/** Remembers the last requests for the status page: written in the background, never slowing an answer down. */
export class RequestLog {
  private pending: RequestEntry[] = [];
  private timer?: NodeJS.Timeout;
  private writes = 0;

  constructor(private readonly db: Db) {}

  record(entry: RequestEntry): void {
    this.pending.push(entry);
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 500).unref();
  }

  async flush(): Promise<void> {
    this.timer = undefined;
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;
    try {
      await this.db.system.query(
        `INSERT INTO request_log (at, client, method, path, status, ms, tool, note)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::text[], $8::text[])`,
        [
          batch.map((e) => e.at),
          batch.map((e) => e.client),
          batch.map((e) => e.method),
          batch.map((e) => e.path.slice(0, 200)),
          batch.map((e) => e.status),
          batch.map((e) => Math.round(e.ms)),
          batch.map((e) => e.tool ?? null),
          batch.map((e) => e.note ?? null),
        ],
      );
      if (++this.writes % 200 === 0) await this.prune();
    } catch (error) {
      console.error("request log:", error instanceof Error ? error.message : error);
    }
  }

  async prune(): Promise<void> {
    await this.db.system.query("DELETE FROM request_log WHERE at < now() - make_interval(days => $1)", [KEEP_DAYS]);
    await this.db.system.query("DELETE FROM request_log WHERE id < (SELECT coalesce(max(id), 0) - $1 FROM request_log)", [MAX_ROWS]);
  }

  async recent(limit = 100): Promise<RequestEntry[]> {
    const { rows } = await this.db.system.query(
      "SELECT at, client, method, path, status, ms, tool, note FROM request_log ORDER BY at DESC LIMIT $1",
      [limit],
    );
    return rows.map((r) => ({ at: r.at, client: r.client, method: r.method, path: r.path, status: r.status, ms: r.ms, tool: r.tool ?? undefined, note: r.note ?? undefined }));
  }

  /** Requests of the last 24 hours in numbers, for the status page. */
  async summary(): Promise<{ total: number; errors: number; unauthorized: number; lastUnauthorizedAt?: Date; lastMcpAt?: Date }> {
    const { rows } = await this.db.system.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status >= 500)::int AS errors,
              count(*) FILTER (WHERE status = 401 AND note = 'invalid token')::int AS unauthorized,
              max(at) FILTER (WHERE status = 401 AND note = 'invalid token') AS last_unauthorized,
              max(at) FILTER (WHERE path = '/mcp' AND status < 400) AS last_mcp
       FROM request_log WHERE at > now() - interval '24 hours'`,
    );
    const r = rows[0];
    return { total: r.total, errors: r.errors, unauthorized: r.unauthorized, lastUnauthorizedAt: r.last_unauthorized ?? undefined, lastMcpAt: r.last_mcp ?? undefined };
  }
}
