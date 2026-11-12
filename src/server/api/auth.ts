import { ConnectError, type ConnectProblem } from "../../accounts/connect.js";
import { REPOSITORY_URL, TERMS_MARKDOWN, TERMS_VERSION } from "../../accounts/terms.js";
import { acceptTerms, authenticate, changePassword, getUser, revokeTokens, setupStep } from "../../accounts/users.js";
import type { App } from "../app.js";
import { allowRenewal, clearedSessionCookie, describeAccount, openSession, syncAccount } from "../session.js";
import type { Principal, Router } from "./router.js";
import { HttpError, json, readJson, rethrowRefusal, stringField } from "./util.js";

const SETUP = { setup: true };

function accountOf(principal: Principal) {
  if (principal.kind === "capture") throw new HttpError(403, "forbidden");
  return principal.user;
}

/** What the person must give next, as HTTP answers the web application follows. */
const CONNECT_STATUS: Record<ConnectProblem, { status: number; needs?: string }> = {
  locked: { status: 409, needs: "account_password" },
  credentials: { status: 409, needs: "credentials" },
  rejected: { status: 401, needs: "credentials" },
  "too-many": { status: 429 },
  failed: { status: 502 },
};

/**
 * The account of the session and its setup: replacing the first password, then connecting edu-ID. These routes are the
 * only ones an account can use until both are done. Login itself is handled in http.ts.
 */
export function registerAuthRoutes(router: Router, app: App): void {
  router.get("/api/auth/me", async ({ principal }) => describeAccount(app, accountOf(principal)), SETUP);

  router.post(
    "/api/auth/logout",
    async ({ res, principal }) => {
      // Logging out ends everything the account had open: this browser, the others, the agents and the CLI. They log
      // in again; a token copied somewhere dies with the rest.
      await revokeTokens(app.db, accountOf(principal).id);
      app.vault.forget(accountOf(principal).id);
      json(res, 200, { ok: true }, { "Set-Cookie": clearedSessionCookie(app) });
    },
    SETUP,
  );

  /** The conditions of use (src/accounts/terms.ts), readable at any time. */
  router.get("/api/auth/terms", async () => ({ version: TERMS_VERSION, repository: REPOSITORY_URL, markdown: TERMS_MARKDOWN }), SETUP);

  /**
   * The person ticked « J'ai lu et j'accepte » in the web application: only a browser session may say so, never the
   * token of an agent or of the CLI.
   */
  router.post(
    "/api/auth/terms",
    async ({ req, principal }) => {
      const user = accountOf(principal);
      if (principal.kind !== "cookie") throw new HttpError(403, "The conditions of use are accepted by the person themselves, in the web application. Do not retry: tell the user to open it.");
      const body = (await readJson(req, 1024)) as Record<string, unknown>;
      if (body.accept !== true) throw new HttpError(400, "Cochez la case pour accepter les conditions.");
      try {
        return describeAccount(app, await acceptTerms(app.db, user.id, stringField(body, "version", { max: 40 })!));
      } catch (error) {
        rethrowRefusal(error);
        throw new HttpError(409, error instanceof Error ? error.message : String(error));
      }
    },
    SETUP,
  );

  /**
   * Replaces the password. Right after the login that asked for it, the session is enough; otherwise the current
   * password is asked again (409 with `needs: "current"`). Every other session and token of the account stops working.
   */
  router.post(
    "/api/auth/password",
    async ({ req, res, principal, client }) => {
      const user = accountOf(principal);
      if (setupStep(user) === "terms") throw new HttpError(403, "account setup required", {}, { setup: "terms" });
      const body = await readJson(req, 4 * 1024);
      const password = stringField(body, "password", { max: 200 })!;
      const current = stringField(body, "current", { optional: true, max: 1000 });
      let key = user.mustChangePassword ? app.vault.key(user.id) : undefined;
      if (!key) {
        if (!current) throw new HttpError(409, "Saisissez votre mot de passe actuel.", {}, { needs: "current" });
        if (!app.limiter.allowed(client)) throw new HttpError(429, "Trop de tentatives : réessayez dans un quart d'heure.", { "Retry-After": "900" });
        const login = await authenticate(app.db, user.email, current);
        if (!login || login.user.id !== user.id) {
          app.limiter.fail(client);
          throw new HttpError(401, "Mot de passe actuel incorrect.", {}, { needs: "current" });
        }
        key = login.vaultKey;
      }
      let changed;
      try {
        changed = await changePassword(app.db, user, password, key);
      } catch (error) {
        rethrowRefusal(error);
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      app.vault.unlock(changed.user.id, changed.vaultKey);
      // The change revoked every token of the account, this session's included: it gets a new one.
      const session = await openSession(app, changed.user);
      json(res, 200, describeAccount(app, changed.user), principal.kind === "cookie" ? { "Set-Cookie": session.cookie } : {});
    },
    SETUP,
  );

  /**
   * Connects the account to edu-ID, or reconnects it. The body carries what the person has typed so far (`email` and
   * `password` of edu-ID, `mfa_code`, `account_password`); the answer says what is missing: 409 with `needs` set to
   * `credentials`, `code` (edu-ID asks for the two-step code) or `account_password` (to unlock the stored credentials).
   * Nothing is stored before GAPS accepted the login.
   */
  router.post(
    "/api/auth/campus",
    async ({ req, principal }) => {
      const user = accountOf(principal);
      const before = setupStep(user);
      if (before && before !== "campus") throw new HttpError(403, "account setup required", {}, { setup: before });
      const body = await readJson(req, 4 * 1024);
      const email = stringField(body, "email", { optional: true, max: 200 })?.trim();
      const password = stringField(body, "password", { optional: true, max: 1000 });
      if ((email === undefined) !== (password === undefined)) throw new HttpError(400, "email and password go together");
      // The person acts on their connection themselves: automatic renewals may be tried again afterwards.
      allowRenewal(user.id);
      let result;
      try {
        result = await app.connector.connect(user, {
          credentials: email !== undefined && password !== undefined ? { email, password } : undefined,
          accountPassword: stringField(body, "account_password", { optional: true, max: 1000 }),
          mfaCode: stringField(body, "mfa_code", { optional: true, max: 12 })?.replace(/\s+/g, ""),
        });
      } catch (error) {
        rethrowRefusal(error);
        if (!(error instanceof ConnectError)) throw error;
        const { status, needs } = CONNECT_STATUS[error.problem];
        throw new HttpError(status, error.message, {}, needs ? { needs } : {});
      }
      if (result.state === "code") {
        throw new HttpError(409, result.invalid ? "edu-ID a refusé ce code : saisissez le code actuel de votre application." : "edu-ID demande le code à 6 chiffres de votre application d'authentification.", {}, { needs: "code" });
      }
      const connected = (await getUser(app.db, user.id))!;
      allowRenewal(user.id);
      syncAccount(app, connected);
      return describeAccount(app, connected);
    },
    SETUP,
  );
}
