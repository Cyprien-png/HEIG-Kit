import { addDevice, countDevices, getNoticePrefs, removeDevice, setNoticePrefs } from "../../accounts/notifications.js";
import type { App } from "../app.js";
import type { Principal, Router } from "./router.js";
import { HttpError, readJson, stringField } from "./util.js";

/** The person's own choices, made in the web application on the device concerned: not the business of an agent. */
const BROWSER = { allow: ["cookie"] as Principal["kind"][] };

const userOf = (principal: Principal): number => {
  if (principal.kind !== "cookie") throw new HttpError(403, "Notifications are managed by the person, in the web application.");
  return principal.user.id;
};

/** Notifications (docs/notifications.md): what the account wants to hear about, and on which devices. */
export function registerNotificationRoutes(router: Router, app: App): void {
  const describe = async (userId: number) => ({ publicKey: app.pusher.publicKey, kinds: await getNoticePrefs(app.db, userId), devices: await countDevices(app.db, userId) });

  router.get("/api/notifications", async ({ principal }) => describe(userOf(principal)), BROWSER);

  /** `{ document?, correction?, courses? }`: the kinds the account wants, on all its devices. */
  router.put(
    "/api/notifications",
    async ({ req, principal }) => {
      try {
        await setNoticePrefs(app.db, userOf(principal), await readJson(req, 1024));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return describe(userOf(principal));
    },
    BROWSER,
  );

  /** This device turned notifications on: the subscription its browser made (`PushSubscription.toJSON()`). */
  router.post(
    "/api/notifications/devices",
    async ({ req, principal }) => {
      const body = await readJson(req, 8192);
      const keys = (typeof body.keys === "object" && body.keys !== null ? body.keys : {}) as Record<string, unknown>;
      const endpoint = stringField(body, "endpoint", { max: 2000 });
      if (!endpoint || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") throw new HttpError(400, "expected { endpoint, keys: { p256dh, auth } }");
      try {
        await addDevice(app.db, userOf(principal), { endpoint, p256dh: keys.p256dh, auth: keys.auth }, req.headers["user-agent"]);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return describe(userOf(principal));
    },
    BROWSER,
  );

  router.delete(
    "/api/notifications/devices",
    async ({ req, principal }) => {
      const endpoint = stringField(await readJson(req, 8192), "endpoint", { max: 2000 });
      if (!endpoint) throw new HttpError(400, "expected { endpoint }");
      await removeDevice(app.db, userOf(principal), endpoint);
      return describe(userOf(principal));
    },
    BROWSER,
  );

  /** Rings the account's own devices once, to check that it works. */
  router.post("/api/notifications/test", async ({ principal }) => ({ sent: await app.pusher.test(userOf(principal)) }), BROWSER);
}
