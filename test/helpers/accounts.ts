/** Accounts for the server tests: created like the administrator does, then taken through their setup. */
import type { Kdf } from "../../src/accounts/password.js";
import { TERMS_VERSION } from "../../src/accounts/terms.js";
import { type User, acceptTerms, authenticate, changePassword, createUser, getUser, markCampus, setAccess } from "../../src/accounts/users.js";
import type { Db } from "../../src/rag/db.js";

/** Light settings: the tests check the logic, not the cost. */
export const FAST: Kdf = { m: 256, t: 1, p: 1 };

export interface TestAccount {
  user: User;
  email: string;
  password: string;
}

/** A new account as the administrator hands it over: a first password to replace, no edu-ID yet. */
export async function newAccount(db: Db, email: string, role?: string): Promise<TestAccount> {
  const created = await createUser(db, { email, role }, FAST);
  return { user: created.user, email: created.user.email, password: created.password };
}

/** An account that replaced its first password and whose edu-ID login was validated. */
export async function readyAccount(db: Db, email: string, role?: string): Promise<TestAccount> {
  const created = await newAccount(db, email, role);
  const login = (await authenticate(db, created.email, created.password))!;
  const password = `mot de passe choisi no ${created.user.id}`;
  await acceptTerms(db, created.user.id, TERMS_VERSION);
  await changePassword(db, login.user, password, login.vaultKey, FAST);
  await setAccess(db, created.user.id, "campus");
  await markCampus(db, created.user.id, "ok");
  return { user: (await getUser(db, created.user.id))!, email: created.email, password };
}
