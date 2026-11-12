/**
 * What the server remembers of an account's secrets, in memory only and for a short while: the key of its sealed
 * edu-ID credentials, brought by a login with its password or by any request carrying one of its tokens
 * (src/server/auth.ts, `wrapVaultKey`), and the credentials themselves while the account is active. Nothing here is
 * written to disk; a restart forgets everything, and the next request of the account brings its key back.
 */
import type { CampusCredentials } from "./users.js";

interface Held<T> {
  value: T;
  until: number;
}

export const KEY_MINUTES = 30;
export const CREDENTIALS_MINUTES = 15;

export class Vault {
  private readonly keys = new Map<number, Held<Buffer>>();
  private readonly held = new Map<number, Held<CampusCredentials>>();

  constructor(private readonly now: () => number = Date.now) {}

  private read<T>(map: Map<number, Held<T>>, id: number): T | undefined {
    const entry = map.get(id);
    if (!entry) return undefined;
    if (entry.until <= this.now()) {
      map.delete(id);
      return undefined;
    }
    return entry.value;
  }

  /** After a login with the password: the account can seal or open its credentials for a while. */
  unlock(id: number, key: Buffer, minutes = KEY_MINUTES): void {
    this.keys.set(id, { value: key, until: this.now() + minutes * 60_000 });
  }

  key(id: number): Buffer | undefined {
    return this.read(this.keys, id);
  }

  hold(id: number, credentials: CampusCredentials, minutes = CREDENTIALS_MINUTES): void {
    this.held.set(id, { value: credentials, until: this.now() + minutes * 60_000 });
  }

  credentials(id: number): CampusCredentials | undefined {
    return this.read(this.held, id);
  }

  dropCredentials(id: number): void {
    this.held.delete(id);
  }

  /** Logout, reset or deletion of the account. */
  forget(id: number): void {
    this.keys.delete(id);
    this.held.delete(id);
  }

  /** Drops what expired (run now and then: entries are otherwise only dropped when read). */
  sweep(): void {
    for (const map of [this.keys, this.held] as Map<number, Held<unknown>>[]) {
      for (const [id, entry] of map) if (entry.until <= this.now()) map.delete(id);
    }
  }
}
