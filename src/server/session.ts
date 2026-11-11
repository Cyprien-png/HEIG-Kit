/** Sessions of the accounts on the remote server: from a token to its account, the browser's cookie, what an account is told about itself. */
import type { IncomingMessage } from "node:http";
import { type User, getUser, identityOf, setupStep } from "../accounts/users.js";
import { runAs } from "../identity.js";
import { parseCookies } from "./api/util.js";
import type { App } from "./app.js";
import type { TokenSubject } from "./auth.js";

export const SESSION_COOKIE = "heig_session";

/** The account a token names, when it may still use it: it exists, is active, and the token was not revoked. */
export async function accountOf(app: App, subject: TokenSubject | undefined): Promise<User | undefined> {
  if (!subject) return undefined;
  const user = await getUser(app.db, subject.userId);
  return user && user.hasPassword && !user.disabledAt && user.tokenVersion === subject.version ? user : undefined;
}

/** The account of the browser's session cookie, with the cookie's token. */
export async function sessionOf(req: IncomingMessage, app: App): Promise<{ user: User; token: string } | undefined> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const user = token ? await accountOf(app, await app.auth.verifyAccessToken(token)) : undefined;
  return user && token ? { user, token } : undefined;
}

export function sessionCookie(app: App, token: string, expiresAt: Date): string {
  const secure = app.config.publicUrl.protocol === "https:" ? "; Secure" : "";
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearedSessionCookie(app: App): string {
  return sessionCookie(app, "", new Date(0));
}

/** A new session cookie for an account. */
export async function openSession(app: App, user: User): Promise<{ cookie: string; expiresAt: Date }> {
  const { token, expiresAt } = await app.auth.issueToken(user);
  return { cookie: sessionCookie(app, token, expiresAt), expiresAt };
}

export interface AccountView {
  id: number;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  role: User["role"];
  /** What the account must do before anything else: replace its first password, then connect edu-ID. */
  setup: "password" | "campus" | null;
  campus: {
    state: User["campusState"];
    verifiedAt?: string;
    /** Sealed credentials are stored: the account's password is enough to log in to edu-ID again. */
    stored: boolean;
    /** The key of the sealed credentials is in memory (the account logged in with its password a moment ago). */
    unlocked: boolean;
  };
}

export function describeAccount(app: App, user: User): AccountView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    setup: setupStep(user) ?? null,
    campus: { state: user.campusState, verifiedAt: user.campusVerifiedAt?.toISOString(), stored: user.hasCampusCredentials, unlocked: app.vault.key(user.id) !== undefined },
  };
}

/** Fetches the account's GAPS and Cyberlearn data in the background, after its edu-ID login succeeded. */
export function syncAccount(app: App, user: User): void {
  void runAs(identityOf(user), async () => {
    await app.syncer.runOne("gaps");
    await app.syncer.runOne("cyberlearn");
  }).catch((error: unknown) => console.error(`First sync of account ${user.id}:`, error instanceof Error ? error.message : error));
}

/**
 * At a login with the password, the only moment the sealed edu-ID credentials can be opened: when the edu-ID session
 * has ended, it is renewed with them, in the background. If edu-ID wants a two-step code, the account is asked for it.
 */
export function renewCampus(app: App, user: User): void {
  if (user.campusState !== "expired" || !user.hasCampusCredentials) return;
  void app.connector.connect(user, {}).then(
    (result) => {
      if (result.state === "ok") syncAccount(app, user);
    },
    () => undefined,
  );
}
