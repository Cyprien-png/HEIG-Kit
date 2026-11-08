import { listMockExams } from "../../app/exams.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";

export function registerExamRoutes(router: Router, app: App): void {
  /** The mock exams of the library with the student's attempts (corrections naming them) and grades. */
  router.get("/api/exams", async ({ url }) => ({ exams: await listMockExams(app.db, url.searchParams.get("course") ?? undefined) }));
}
