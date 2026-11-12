/**
 * Connects an account to edu-ID: the credentials it types are tried on GAPS right away, with the two-step code asked
 * live when edu-ID wants one, and only sealed (with the account's own password) once GAPS accepted them. Later, when
 * the edu-ID session has ended, the account's password unlocks the sealed credentials for a new login.
 */
import { rmSync } from "node:fs";
import { BadCredentialsError, MfaRequiredError } from "../auth/eduid.js";
import { campusFiles } from "../campus.js";
import { runAs } from "../identity.js";
import type { Db } from "../rag/db.js";
import { loginGaps } from "../services.js";
import { type CampusCredentials, type User, authenticate, identityOf, readCampusCredentials, saveCampusCredentials } from "./users.js";
import type { Vault } from "./vault.js";

export interface ConnectInput {
  /** New edu-ID credentials; without them, those held from the previous step or the sealed ones are used. */
  credentials?: CampusCredentials;
  /** The account's own password, when the key of its sealed credentials is no longer in memory. */
  accountPassword?: string;
  /** The current code of the authenticator app, when the previous attempt answered `code`. */
  mfaCode?: string;
}

/** `ok`: GAPS accepted the login. `code`: edu-ID asks for the two-step code (`invalid`: the one given was refused). */
export type ConnectResult = { state: "ok" } | { state: "code"; invalid: boolean };

export type ConnectProblem = "locked" | "credentials" | "rejected" | "too-many" | "failed";

/** What went wrong, for the person: `locked` asks for the account's password, `credentials` for the edu-ID ones. */
export class ConnectError extends Error {
  constructor(
    readonly problem: ConnectProblem,
    message: string,
  ) {
    super(message);
  }
}

export interface Attempts {
  allowed(key: string): boolean;
  fail(key: string): void;
  succeed(key: string): void;
}

export class CampusConnector {
  constructor(
    private readonly db: Db,
    private readonly vault: Vault,
    /** edu-ID locks an account after too many wrong passwords: the server stops well before. */
    private readonly attempts: Attempts,
    /** Logs in to GAPS as the current account (src/campus.ts); replaced in tests. */
    private readonly login: (mfaCode?: string) => Promise<unknown> = (mfaCode) => loginGaps(false, mfaCode),
  ) {}

  async connect(user: User, input: ConnectInput): Promise<ConnectResult> {
    const who = `campus:${user.id}`;
    if (!this.attempts.allowed(who)) throw new ConnectError("too-many", "Trop de tentatives : réessayez dans un quart d'heure.");

    let key = this.vault.key(user.id);
    if (input.accountPassword !== undefined) {
      const login = await authenticate(this.db, user.email, input.accountPassword);
      if (!login || login.user.id !== user.id) {
        this.attempts.fail(who);
        throw new ConnectError("locked", "Mot de passe HEIG-Kit incorrect.");
      }
      key = login.vaultKey;
      this.vault.unlock(user.id, key);
    }
    if (!key) throw new ConnectError("locked", "Saisissez votre mot de passe HEIG-Kit pour déverrouiller vos identifiants edu-ID.");

    const credentials = input.credentials ?? this.vault.credentials(user.id) ?? (await readCampusCredentials(this.db, user.id, key));
    if (!credentials) throw new ConnectError("credentials", "Saisissez l'adresse et le mot de passe de votre compte edu-ID.");
    this.vault.hold(user.id, credentials);

    try {
      await runAs(identityOf(user), async () => {
        // New credentials are proven by a real login: a session saved for other ones must not answer in their place.
        if (input.credentials && !input.mfaCode) {
          const files = campusFiles();
          for (const file of [files.session, files.pendingMfa, files.cyberlearnToken, files.schedule]) rmSync(file, { force: true });
        }
        await this.login(input.mfaCode);
      });
    } catch (error) {
      if (error instanceof MfaRequiredError) {
        if (error.invalidCode) this.attempts.fail(who);
        return { state: "code", invalid: error.invalidCode };
      }
      this.vault.dropCredentials(user.id);
      if (error instanceof BadCredentialsError) {
        this.attempts.fail(who);
        throw new ConnectError("rejected", "edu-ID a refusé ces identifiants : vérifiez l'adresse et le mot de passe.");
      }
      throw new ConnectError("failed", `La connexion à GAPS a échoué : ${error instanceof Error ? error.message : String(error)}`);
    }
    await saveCampusCredentials(this.db, user.id, key, credentials);
    this.attempts.succeed(who);
    return { state: "ok" };
  }
}
