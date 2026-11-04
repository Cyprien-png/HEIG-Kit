import type { App } from "../app.js";
import { registerAuthRoutes } from "./auth.js";
import { Router } from "./router.js";

/** The REST API of the web application (docs/app.md), one module per domain. */
export function createApi(app: App): Router {
  const router = new Router();
  registerAuthRoutes(router, app);
  return router;
}
