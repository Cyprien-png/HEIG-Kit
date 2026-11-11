import { collectStatus } from "../../app/status.js";
import { RUN_KINDS, type RunKind, recentRuns } from "../../app/sync.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { HttpError, readJson, stringField } from "./util.js";

const ADMIN = { admin: true };

/** The state of the server, for its administrators only: the other accounts refresh their own data with /api/me/sync. */
export function registerStatusRoutes(router: Router, app: App): void {
  router.get("/api/status", async () => collectStatus({ db: app.db, requests: app.requests, queue: app.queue, jobsDir: app.config.jobsDir, syncing: app.syncer.busy }), ADMIN);

  router.get("/api/status/requests", async ({ url }) => {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
    const entries = await app.requests.recent(limit);
    return { requests: entries.map((e) => ({ ...e, at: e.at.toISOString() })) };
  }, ADMIN);

  router.get("/api/status/runs", async () => ({ runs: await recentRuns(app.db) }), ADMIN);

  router.get("/api/status/jobs", async () => ({ jobs: app.queue?.recent() ?? [] }), ADMIN);

  /** Starts a sync (one kind, or everything); answers when it is done, so the page can show the result. */
  router.post("/api/status/sync", async ({ req }) => {
    const body = await readJson(req);
    const kind = stringField(body, "kind", { optional: true });
    if (kind && !RUN_KINDS.includes(kind as RunKind)) throw new HttpError(400, `kind must be one of ${RUN_KINDS.join(", ")}`);
    if (kind) return { run: await app.syncer.runOne(kind as RunKind) };
    await app.syncer.runAll();
    return { ok: true };
  }, ADMIN);
}
