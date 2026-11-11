/**
 * Who a piece of work is done for. On the remote server every request runs inside `runAs` with the account its token
 * names; the database (src/rag/db.ts) and the campus logins (src/campus.ts) read it from there, so no function takes an
 * account as an argument and none can be handed someone else's.
 *
 * A single-user installation (the command line, the MCP server on the user's computer) has no accounts: its work is
 * done as the local owner. The remote server calls `requireExplicitIdentity()` at start, after which work that is not
 * inside `runAs` has no identity at all: it reads and writes nothing personal.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type Role = "admin" | "student";

export interface Identity {
  id: number;
  role: Role;
  /** For messages and logs. */
  email?: string;
  name?: string;
}

/** The owner of a single-user installation: the first row of `users` (rag/migrations/016_accounts.sql). */
export const LOCAL_OWNER: Identity = { id: 1, role: "admin", name: "Local" };

const store = new AsyncLocalStorage<Identity>();
let fallback: Identity | undefined = LOCAL_OWNER;

/** From now on, only `runAs` gives an identity (the remote server). */
export function requireExplicitIdentity(): void {
  fallback = undefined;
}

/** For tests: back to a single-user installation. */
export function allowLocalOwner(): void {
  fallback = LOCAL_OWNER;
}

export function runAs<T>(identity: Identity, work: () => T): T {
  return store.run(identity, work);
}

export function currentIdentity(): Identity | undefined {
  return store.getStore() ?? fallback;
}

/** Thrown when something personal is asked without an account, or belongs to another account. */
export class AccessDenied extends Error {
  constructor(message = "Refused: this belongs to another account. An account reads and changes its own data only; shared items are changed by their author or an administrator.") {
    super(message);
  }
}

export function requireIdentity(): Identity {
  const identity = currentIdentity();
  if (!identity) throw new AccessDenied("No account is bound to this request.");
  return identity;
}

export const isAdmin = (): boolean => currentIdentity()?.role === "admin";
