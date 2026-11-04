import type { App } from "../app.js";
import { registerAuthRoutes } from "./auth.js";
import { registerCalendarRoutes } from "./calendar.js";
import { registerCampusRoutes } from "./campus.js";
import { Router } from "./router.js";
import { registerStatusRoutes } from "./status.js";

/** The REST API of the web application (docs/app.md), one module per domain. */
export function createApi(app: App): Router {
  const router = new Router();
  registerAuthRoutes(router, app);
  registerCampusRoutes(router, app);
  registerCalendarRoutes(router, app);
  registerStatusRoutes(router, app);
  return router;
}
