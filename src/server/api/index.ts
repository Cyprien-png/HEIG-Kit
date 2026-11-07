import type { App } from "../app.js";
import { registerAuthRoutes } from "./auth.js";
import { registerCalendarRoutes } from "./calendar.js";
import { registerCampusRoutes } from "./campus.js";
import { registerCorrectionRoutes } from "./corrections.js";
import { registerExamRoutes } from "./exams.js";
import { registerFlashcardRoutes } from "./flashcards.js";
import { registerKnowledgeRoutes } from "./knowledge.js";
import { registerLibraryRoutes } from "./library.js";
import { registerPastExamRoutes } from "./pastexams.js";
import { registerProfileRoutes } from "./profile.js";
import { registerQuizRoutes } from "./quizzes.js";
import { Router } from "./router.js";
import { registerStatusRoutes } from "./status.js";

/** The REST API of the web application (docs/app.md), one module per domain. */
export function createApi(app: App): Router {
  const router = new Router();
  registerAuthRoutes(router, app);
  registerCampusRoutes(router, app);
  registerCalendarRoutes(router, app);
  registerKnowledgeRoutes(router, app);
  registerLibraryRoutes(router, app);
  registerFlashcardRoutes(router, app);
  registerCorrectionRoutes(router, app);
  registerExamRoutes(router, app);
  registerPastExamRoutes(router, app);
  registerProfileRoutes(router, app);
  registerQuizRoutes(router, app);
  registerStatusRoutes(router, app);
  return router;
}
