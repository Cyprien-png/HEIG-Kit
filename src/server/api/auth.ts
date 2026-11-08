import type { App } from "../app.js";
import { clearedSessionCookie } from "../http.js";
import type { Router } from "./router.js";
import { json } from "./util.js";

/** Session of the web application. Login itself is handled in http.ts, next to the agents' login. */
export function registerAuthRoutes(router: Router, app: App): void {
  router.get("/api/auth/me", async () => ({ username: app.config.username }));
  router.post("/api/auth/logout", async ({ res }) => {
    json(res, 200, { ok: true }, { "Set-Cookie": clearedSessionCookie(app) });
  });
}
