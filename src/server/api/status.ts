import { collectStatus } from "../../app/status.js";
import { type RunKind, recentRuns } from "../../app/sync.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { HttpError, readJson, stringField } from "./util.js";

const RUN_KINDS: RunKind[] = ["gaps", "cyberlearn", "ingest-check"];

export function registerStatusRoutes(router: Router, app: App): void {
  router.get("/api/status", async () => collectStatus({ db: app.db, requests: app.requests, queue: app.queue, jobsDir: app.config.jobsDir, syncing: app.syncer.busy }));

  router.get("/api/status/requests", async ({ url }) => {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
    const entries = await app.requests.recent(limit);
    return { requests: entries.map((e) => ({ ...e, at: e.at.toISOString() })) };
  });

  router.get("/api/status/runs", async () => ({ runs: await recentRuns(app.db) }));

  router.get("/api/status/jobs", async () => ({ jobs: app.queue?.recent() ?? [] }));

  /** Starts a sync (one kind, or everything); answers when it is done, so the page can show the result. */
  router.post("/api/status/sync", async ({ req }) => {
    const body = await readJson(req);
    const kind = stringField(body, "kind", { optional: true });
    if (kind && !RUN_KINDS.includes(kind as RunKind)) throw new HttpError(400, `kind must be one of ${RUN_KINDS.join(", ")}`);
    if (kind) return { run: await app.syncer.runOne(kind as RunKind) };
    await app.syncer.runAll();
    return { ok: true };
  });

  /**
   * Logs in to edu-ID again, with the two-step code typed on the page when edu-ID asks for one, then syncs
   * everything. Without a code, answers 409 when a code is needed.
   */
  router.post("/api/status/reconnect", async ({ req }) => {
    const body = await readJson(req);
    const code = stringField(body, "mfa_code", { optional: true, max: 10 })?.replace(/\s+/g, "");
    const run = await app.syncer.runOne("gaps", code);
    if (!run.ok && run.stats?.needsCode) throw new HttpError(409, run.message ?? "edu-ID asks for a two-step login code");
    if (!run.ok) throw new HttpError(502, run.message ?? "login failed");
    const cyberlearn = await app.syncer.runOne("cyberlearn", code);
    void app.syncer.runOne("ingest-check");
    return { gaps: run, cyberlearn };
  });
}
