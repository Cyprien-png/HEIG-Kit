/** Sessions of the accounts on the remote server: from a token to its account, the browser's cookie, what an account is told about itself. */
import type { IncomingMessage } from "node:http";
import { type User, getUser, identityOf, readCampusCredentials, setupStep } from "../accounts/users.js";
import { runAs } from "../identity.js";
import { parseCookies } from "./api/util.js";
import type { App } from "./app.js";
import type { TokenSubject } from "./auth.js";

export const SESSION_COOKIE = "heig_session";

/** The account a token names, when it may still use it: it exists, is active, and the token was not revoked. */
export async function accountOf(app: App, subject: TokenSubject | undefined): Promise<User | undefined> {
  if (!subject) return undefined;
  const user = await getUser(app.db, subject.userId);
  if (!user || !user.hasPassword || user.disabledAt || user.tokenVersion !== subject.version) return undefined;
  if (subject.vaultKey) await openVault(app, user, subject.vaultKey);
  return user;
}

/**
 * A request of the account came with the key of its sealed edu-ID credentials (in its token): they are at hand for the
 * work of this request and the syncs that follow, and an edu-ID session that ended is renewed without asking anything,
 * unless edu-ID wants a two-step code.
 */
async function openVault(app: App, user: User, key: Buffer): Promise<void> {
  app.vault.unlock(user.id, key);
  if (!user.hasCampusCredentials) return;
  if (!app.vault.credentials(user.id)) {
    const credentials = await readCampusCredentials(app.db, user.id, key);
    if (credentials) app.vault.hold(user.id, credentials);
  }
  renewCampus(app, user);
}

/** An access token of the account, carrying the key of its credentials when the server has it at hand. */
export function issueFor(app: App, user: User, days?: number): Promise<{ token: string; expiresAt: Date }> {
  return app.auth.issueToken(user, days, app.vault.key(user.id));
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
  const { token, expiresAt } = await issueFor(app, user);
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
    /** The key of the sealed credentials is at hand (brought by the token of this request, or a login a moment ago). */
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

/** When the next automatic edu-ID login of an account may be tried: edu-ID is never hammered in someone's name. */
const nextRenewal = new Map<number, number>();
const RETRY_MINUTES = 30;
/** edu-ID wants a two-step code: only the person can give it (page « Mon compte »), trying again is useless. */
const CODE_WAIT_MINUTES = 12 * 60;

/**
 * When the edu-ID session of the account has ended and its credentials can be opened (a login, or any request with
 * its token), it is renewed with them, in the background. If edu-ID wants a two-step code, the account is asked for it.
 */
export function renewCampus(app: App, user: User): void {
  if (user.campusState !== "expired" || !user.hasCampusCredentials) return;
  if ((nextRenewal.get(user.id) ?? 0) > Date.now()) return;
  nextRenewal.set(user.id, Date.now() + RETRY_MINUTES * 60_000);
  void app.connector.connect(user, {}).then(
    (result) => {
      if (result.state === "ok") {
        nextRenewal.delete(user.id);
        syncAccount(app, user);
      } else nextRenewal.set(user.id, Date.now() + CODE_WAIT_MINUTES * 60_000);
    },
    () => undefined,
  );
}

/** The person acted on their edu-ID connection themselves: automatic renewals may be tried again. */
export function allowRenewal(userId: number): void {
  nextRenewal.delete(userId);
}
