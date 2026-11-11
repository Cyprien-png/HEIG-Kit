import { getUser } from "../../accounts/users.js";
import { lastRuns } from "../../app/sync.js";
import { requireIdentity } from "../../identity.js";
import type { App } from "../app.js";
import { describeAccount } from "../session.js";
import type { Router } from "./router.js";
import { HttpError, readJson, stringField } from "./util.js";

const OWN_KINDS = ["gaps", "cyberlearn"] as const;

/** What an account does about its own data: refresh what the server fetched for it on GAPS and Cyberlearn. */
export function registerMeRoutes(router: Router, app: App): void {
  router.get("/api/me/sync", async () => {
    const user = (await getUser(app.db, requireIdentity().id))!;
    const runs = (await lastRuns(app.db)).filter((run) => run.userId === user.id);
    return { campus: describeAccount(app, user).campus, runs };
  });

  /** Fetches GAPS or Cyberlearn again for the account of the request; answers when done. */
  router.post("/api/me/sync", async ({ req }) => {
    const kind = stringField(await readJson(req), "kind", { max: 20 }) as (typeof OWN_KINDS)[number];
    if (!OWN_KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${OWN_KINDS.join(", ")}`);
    const run = await app.syncer.runOne(kind);
    const user = (await getUser(app.db, requireIdentity().id))!;
    return { run, campus: describeAccount(app, user).campus };
  });
}
