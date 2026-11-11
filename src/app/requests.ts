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
  /** The account of the request, when its token named one. */
  userId?: number;
}

/** Long enough to look back at what an account did over a few weeks; bounded so a busy class cannot fill the disk. */
const KEEP_DAYS = 30;
const MAX_ROWS = 200_000;

export interface ActivityFilter {
  /** One account only. */
  userId?: number;
  /** Only what changed something or failed: no reading. */
  actionsOnly?: boolean;
  /** Entries older than this one (paging). */
  before?: Date;
  limit?: number;
}

export interface AccountActivity {
  userId: number;
  lastAt?: Date;
  /** Requests of the last 24 hours and 7 days, and those refused (403) over 7 days. */
  day: number;
  week: number;
  refused: number;
}

/**
 * Remembers the requests, with the account that made them: the status page and the administrators' journal. Written in
 * the background, never slowing an answer down. Only what was asked is kept (method, path, tool), never what was sent.
 */
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
        `INSERT INTO request_log (at, client, method, path, status, ms, tool, note, user_id)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::text[], $8::text[], $9::bigint[])`,
        [
          batch.map((e) => e.at),
          batch.map((e) => e.client),
          batch.map((e) => e.method),
          batch.map((e) => e.path.slice(0, 200)),
          batch.map((e) => e.status),
          batch.map((e) => Math.round(e.ms)),
          batch.map((e) => e.tool ?? null),
          batch.map((e) => e.note ?? null),
          batch.map((e) => e.userId ?? null),
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
    return this.activity({ limit });
  }

  /** The journal, most recent first. */
  async activity(filter: ActivityFilter = {}): Promise<RequestEntry[]> {
    await this.flush();
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      where.push(sql.replace("?", `$${values.length}`));
    };
    if (filter.userId !== undefined) add("user_id = ?", filter.userId);
    if (filter.before) add("at < ?", filter.before);
    if (filter.actionsOnly) where.push("(method NOT IN ('GET', 'HEAD') OR status >= 400)");
    values.push(Math.min(Math.max(filter.limit ?? 100, 1), 500));
    const { rows } = await this.db.system.query(
      `SELECT at, client, method, path, status, ms, tool, note, user_id FROM request_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at DESC, id DESC LIMIT $${values.length}`,
      values,
    );
    return rows.map((r) => ({ at: r.at, client: r.client, method: r.method, path: r.path, status: r.status, ms: r.ms, tool: r.tool ?? undefined, note: r.note ?? undefined, userId: r.user_id === null ? undefined : Number(r.user_id) }));
  }

  /** How active each account has been lately. */
  async perAccount(): Promise<AccountActivity[]> {
    await this.flush();
    const { rows } = await this.db.system.query(
      `SELECT user_id, max(at) AS last_at,
              count(*) FILTER (WHERE at > now() - interval '24 hours')::int AS day,
              count(*) FILTER (WHERE at > now() - interval '7 days')::int AS week,
              count(*) FILTER (WHERE at > now() - interval '7 days' AND status = 403)::int AS refused
       FROM request_log WHERE user_id IS NOT NULL GROUP BY user_id`,
    );
    return rows.map((r) => ({ userId: Number(r.user_id), lastAt: r.last_at ?? undefined, day: r.day, week: r.week, refused: r.refused }));
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
