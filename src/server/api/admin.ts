import { type User, getUser, listUsers, setupStep } from "../../accounts/users.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { runHousekeeping } from "../../app/housekeeping.js";
import { HttpError, readJson } from "./util.js";

const ADMIN = { admin: true };

const accountRow = (user: User) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  disabled: Boolean(user.disabledAt),
  setup: setupStep(user) ?? null,
  access: user.access ?? null,
  campus: user.campusState,
  createdAt: user.createdAt.toISOString(),
  lastLoginAt: user.lastLoginAt?.toISOString(),
});

/**
 * What the administrators see of the accounts: who exists, and the journal of what each one asked the server. Reading
 * only: accounts are created, changed and removed from the server itself (`npm run users`), never over the network.
 * The journal holds what was asked (method, path, tool, answer), not the content of anyone's work.
 */
export function registerAdminRoutes(router: Router, app: App): void {
  router.get(
    "/api/admin/users",
    async () => {
      const activity = new Map((await app.requests.perAccount()).map((a) => [a.userId, a]));
      return {
        users: (await listUsers(app.db)).map((user) => {
          const seen = activity.get(user.id);
          return { ...accountRow(user), lastActivityAt: seen?.lastAt?.toISOString(), requestsDay: seen?.day ?? 0, requestsWeek: seen?.week ?? 0, refusedWeek: seen?.refused ?? 0 };
        }),
      };
    },
    ADMIN,
  );

  /** The journal, most recent first: `user` (an account), `actions=1` (no reading), `before` (paging), `limit`. */
  router.get(
    "/api/admin/activity",
    async ({ url }) => {
      const param = url.searchParams.get("user");
      const userId = param ? Number(param) : undefined;
      if (userId !== undefined && !(Number.isSafeInteger(userId) && userId > 0)) throw new HttpError(400, "user must be the number of an account");
      const user = userId === undefined ? undefined : await getUser(app.db, userId);
      if (userId !== undefined && !user) throw new HttpError(404, "no such account");
      const beforeParam = url.searchParams.get("before");
      const before = beforeParam ? new Date(beforeParam) : undefined;
      if (before && Number.isNaN(before.getTime())) throw new HttpError(400, "before must be a date");
      const entries = await app.requests.activity({ userId, before, actionsOnly: url.searchParams.get("actions") === "1", limit: Number(url.searchParams.get("limit") ?? 100) || 100 });
      return { user: user ? accountRow(user) : undefined, entries: entries.map((e) => ({ ...e, at: e.at.toISOString() })) };
    },
    ADMIN,
  );

  /** Runs the storage housekeeping now (the server does it every day): `dry_run` only says what it would do. */
  router.post(
    "/api/admin/housekeeping",
    async ({ req }) => {
      const body = await readJson(req);
      return runHousekeeping(app.db, { dryRun: body.dry_run === true, pruneJobs: app.queue ? () => app.queue!.prune() : undefined, log: (line) => console.error(line) });
    },
    ADMIN,
  );
}
