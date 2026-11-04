import { type SnapshotKind, latestSnapshot } from "../../app/snapshots.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { HttpError } from "./util.js";

const KINDS: Record<string, SnapshotKind> = {
  schedule: "schedule",
  deadlines: "deadlines",
  grades: "grades",
  transcript: "transcript",
  plan: "plan",
  absences: "absences",
  courses: "courses",
};

/** GAPS and Cyberlearn data from the server's snapshots (refreshed by the sync, see /api/status). */
export function registerCampusRoutes(router: Router, app: App): void {
  router.get("/api/campus/:kind", async ({ params }) => {
    const kind = KINDS[params.kind];
    if (!kind) throw new HttpError(404, `unknown data "${params.kind}"`);
    const snapshot = await latestSnapshot(app.db, kind);
    if (!snapshot) throw new HttpError(404, "not fetched yet: run a sync from the status page");
    return { kind, fetchedAt: snapshot.fetchedAt.toISOString(), checkedAt: snapshot.checkedAt.toISOString(), data: snapshot.data };
  });
}
