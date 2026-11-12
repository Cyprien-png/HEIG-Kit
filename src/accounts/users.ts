/**
 * The accounts of a shared server (docs/accounts.md): created by an administrator from an e-mail address, with a random
 * first password the person must replace, then their edu-ID credentials, sealed with their own password. Everything here
 * goes through the server's own connection (`db.system`): the application's queries cannot reach the `users` table.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import type { Identity, Role } from "../identity.js";
import { CACHE_DIR, DATA_DIR } from "../paths.js";
import type { Db } from "../rag/db.js";
import { type Kdf, generatePassword, hashPassword, passwordProblem, seal, unseal, verifyPassword } from "./password.js";

export const ROLES: Role[] = ["admin", "student"];
export type CampusState = "missing" | "ok" | "expired";
/** The row a single-user installation works as, until the first account takes it over. */
const PLACEHOLDER_EMAIL = "local@heig-kit";

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  /** "Prénom Nom", or the address when no name is known. */
  name: string;
  role: Role;
  hasPassword: boolean;
  mustChangePassword: boolean;
  tokenVersion: number;
  campusState: CampusState;
  campusVerifiedAt?: Date;
  /** Sealed edu-ID credentials are stored (they can be unlocked with the account's password). */
  hasCampusCredentials: boolean;
  disabledAt?: Date;
  createdAt: Date;
  lastLoginAt?: Date;
}

export interface CampusCredentials {
  email: string;
  password: string;
}

const COLUMNS = "id, email, first_name, last_name, role, password_hash IS NOT NULL AS has_password, must_change_password, token_version, campus_state, campus_verified_at, campus_sealed IS NOT NULL AS has_campus, disabled_at, created_at, last_login_at";

function toUser(r: Record<string, unknown>): User {
  const firstName = r.first_name as string;
  const lastName = r.last_name as string;
  return {
    id: Number(r.id),
    email: r.email as string,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim() || (r.email as string),
    role: r.role as Role,
    hasPassword: Boolean(r.has_password),
    mustChangePassword: Boolean(r.must_change_password),
    tokenVersion: r.token_version as number,
    campusState: r.campus_state as CampusState,
    campusVerifiedAt: (r.campus_verified_at as Date | null) ?? undefined,
    hasCampusCredentials: Boolean(r.has_campus),
    disabledAt: (r.disabled_at as Date | null) ?? undefined,
    createdAt: r.created_at as Date,
    lastLoginAt: (r.last_login_at as Date | null) ?? undefined,
  };
}

export const identityOf = (user: User): Identity => ({ id: user.id, role: user.role, email: user.email, name: user.name });

/** What an account still has to do before it can use the server, in order. */
export type SetupStep = "password" | "campus";
export function setupStep(user: User): SetupStep | undefined {
  if (user.mustChangePassword) return "password";
  // Never validated on GAPS: the credentials are asked until a login succeeds.
  if (!user.campusVerifiedAt || user.campusState === "missing") return "campus";
  return undefined;
}

const capitalize = (part: string) =>
  part
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join("-");

/** HEIG-VD addresses are `prenom.nom@…`: the name they give, to be corrected with `users set` when it is wrong. */
export function nameFromEmail(email: string): { firstName: string; lastName: string } {
  const local = email.split("@")[0].replace(/\d+$/g, "");
  const [first, ...rest] = local.split(".").filter(Boolean);
  return { firstName: capitalize(first ?? ""), lastName: rest.map(capitalize).join(" ") };
}

export function normalizeEmail(email: string): string {
  const text = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) || text.length > 200) throw new Error(`"${email}" is not an e-mail address`);
  return text;
}

function role(value: string | undefined, fallback: Role): Role {
  if (value === undefined) return fallback;
  if (!ROLES.includes(value as Role)) throw new Error(`The role must be one of ${ROLES.join(", ")}`);
  return value as Role;
}

export async function listUsers(db: Db): Promise<User[]> {
  const { rows } = await db.system.query(`SELECT ${COLUMNS} FROM users WHERE password_hash IS NOT NULL ORDER BY id`);
  return rows.map(toUser);
}

export async function getUser(db: Db, id: number): Promise<User | undefined> {
  const { rows } = await db.system.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : undefined;
}

/** An account by its number or its address. */
export async function findUser(db: Db, ref: string): Promise<User> {
  const text = ref.trim();
  const { rows } = /^\d+$/.test(text)
    ? await db.system.query(`SELECT ${COLUMNS} FROM users WHERE id = $1 AND password_hash IS NOT NULL`, [Number(text)])
    : await db.system.query(`SELECT ${COLUMNS} FROM users WHERE lower(email) = lower($1) AND password_hash IS NOT NULL`, [text]);
  if (!rows[0]) throw new Error(`No account "${ref}" (npm run users -- list)`);
  return toUser(rows[0]);
}

export interface NewUser {
  email: string;
  role?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Creates an account with a random first password, shown once and never stored in clear. The first account of a server
 * becomes an administrator and takes over the data of the single-user installation, if there was one.
 */
export async function createUser(db: Db, input: NewUser, kdf?: Kdf): Promise<{ user: User; password: string; tookOver: boolean }> {
  const email = normalizeEmail(input.email);
  const guessed = nameFromEmail(email);
  const firstName = input.firstName?.trim() || guessed.firstName;
  const lastName = input.lastName?.trim() ?? guessed.lastName;
  const password = generatePassword();
  const { hash } = await hashPassword(password, kdf);
  const first = (await listUsers(db)).length === 0;
  const as = role(input.role, first ? "admin" : "student");
  try {
    if (first) {
      const { rows } = await db.system.query(
        `UPDATE users SET email = $1, first_name = $2, last_name = $3, role = $4, password_hash = $5, must_change_password = true, created_at = now()
         WHERE id = 1 AND password_hash IS NULL AND email = $6 RETURNING ${COLUMNS}`,
        [email, firstName, lastName, as, hash, PLACEHOLDER_EMAIL],
      );
      if (rows[0]) return { user: toUser(rows[0]), password, tookOver: true };
    }
    const { rows } = await db.system.query(`INSERT INTO users (email, first_name, last_name, role, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`, [email, firstName, lastName, as, hash]);
    return { user: toUser(rows[0]), password, tookOver: false };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new Error(`An account already exists for ${email}`);
    throw error;
  }
}

async function admins(db: Db): Promise<number> {
  return Number((await db.system.query("SELECT count(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL AND password_hash IS NOT NULL")).rows[0].n);
}

export interface UserPatch {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  disabled?: boolean;
}

/** Changes an account; a server always keeps one active administrator. */
export async function updateUser(db: Db, id: number, patch: UserPatch): Promise<User> {
  const user = await getUser(db, id);
  if (!user || !user.hasPassword) throw new Error(`No account ${id}`);
  const next = { role: role(patch.role, user.role), disabled: patch.disabled ?? Boolean(user.disabledAt) };
  const wasAdmin = user.role === "admin" && !user.disabledAt;
  if (wasAdmin && (next.role !== "admin" || next.disabled) && (await admins(db)) <= 1) throw new Error("This is the only administrator: give the role to another account first");
  try {
    const { rows } = await db.system.query(
      `UPDATE users SET email = $2, first_name = $3, last_name = $4, role = $5,
         disabled_at = CASE WHEN $6::boolean THEN coalesce(disabled_at, now()) ELSE NULL END,
         token_version = token_version + CASE WHEN $6::boolean OR role <> $5 THEN 1 ELSE 0 END
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, patch.email === undefined ? user.email : normalizeEmail(patch.email), patch.firstName?.trim() ?? user.firstName, patch.lastName?.trim() ?? user.lastName, next.role, next.disabled],
    );
    if (next.disabled) await db.system.query("DELETE FROM oauth_refresh_tokens WHERE user_id = $1", [id]);
    return toUser(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new Error(`An account already exists for ${patch.email}`);
    throw error;
  }
}

/**
 * A new random password, to replace at the next login. Every token of the account stops working, and its sealed edu-ID
 * credentials are dropped: nobody can open them without the old password. The account enters them again.
 */
/** Ends every session of the account: its access tokens, cookies and refresh tokens stop working at once. */
export async function revokeTokens(db: Db, id: number): Promise<void> {
  await db.system.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [id]);
  await db.system.query("DELETE FROM oauth_refresh_tokens WHERE user_id = $1", [id]);
  await db.system.query("DELETE FROM oauth_codes WHERE user_id = $1", [id]);
}

export async function resetPassword(db: Db, id: number, kdf?: Kdf): Promise<{ user: User; password: string }> {
  const password = generatePassword();
  const { hash } = await hashPassword(password, kdf);
  const { rows } = await db.system.query(
    `UPDATE users SET password_hash = $2, must_change_password = true, password_changed_at = NULL, token_version = token_version + 1, campus_sealed = NULL
     WHERE id = $1 AND password_hash IS NOT NULL RETURNING ${COLUMNS}`,
    [id, hash],
  );
  if (!rows[0]) throw new Error(`No account ${id}`);
  await db.system.query("DELETE FROM oauth_refresh_tokens WHERE user_id = $1", [id]);
  return { user: toUser(rows[0]), password };
}

/** The folder of an account's edu-ID session and Cyberlearn token. */
export const userCacheDir = (id: number) => path.join(CACHE_DIR, "users", String(id));

/** Deletes an account with everything personal it owns; what it shared stays, without author. */
export async function deleteUser(db: Db, id: number): Promise<void> {
  if (id === 1) throw new Error("The first account cannot be deleted: commands run on the server itself act as it. Disable it instead.");
  const user = await getUser(db, id);
  if (!user) throw new Error(`No account ${id}`);
  if (user.role === "admin" && !user.disabledAt && (await admins(db)) <= 1) throw new Error("This is the only administrator: give the role to another account first");
  const folders = [
    ...(await db.system.query<{ id: string }>("SELECT id FROM corrections WHERE user_id = $1", [id])).rows.map((r) => path.join(DATA_DIR, "corrections", r.id)),
    ...(await db.system.query<{ id: string }>("SELECT id FROM workcopies WHERE user_id = $1", [id])).rows.map((r) => path.join(DATA_DIR, "workcopies", r.id)),
    userCacheDir(id),
  ];
  await db.system.query("DELETE FROM users WHERE id = $1", [id]);
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
}

export interface Login {
  user: User;
  /** Opens the account's sealed edu-ID credentials; kept in memory for a short while only (src/accounts/vault.ts). */
  vaultKey: Buffer;
}

/** The account of an address and its password; undefined for anything wrong, in the same time. */
export async function authenticate(db: Db, email: unknown, password: unknown): Promise<Login | undefined> {
  if (typeof email !== "string" || typeof password !== "string" || password.length > 1000) return undefined;
  const { rows } = await db.system.query(`SELECT ${COLUMNS}, password_hash FROM users WHERE lower(email) = lower($1)`, [email.trim()]);
  const vaultKey = await verifyPassword(password, rows[0]?.password_hash as string | undefined);
  if (!vaultKey || !rows[0] || rows[0].disabled_at) return undefined;
  await db.system.query("UPDATE users SET last_login_at = now() WHERE id = $1", [rows[0].id]);
  return { user: toUser(rows[0]), vaultKey };
}

/**
 * Replaces the password. The sealed edu-ID credentials are sealed again with the new key when the old key is at hand,
 * dropped otherwise. Tokens issued before stop working, except the session making the change (it gets a new one).
 */
export async function changePassword(db: Db, user: User, password: string, oldKey?: Buffer, kdf?: Kdf): Promise<Login> {
  const problem = passwordProblem(password, { email: user.email });
  if (problem) throw new Error(problem);
  const { rows: current } = await db.system.query<{ password_hash: string | null; campus_sealed: Buffer | null }>("SELECT password_hash, campus_sealed FROM users WHERE id = $1", [user.id]);
  if (!current[0]) throw new Error(`No account ${user.id}`);
  if (await verifyPassword(password, current[0].password_hash)) throw new Error("Le nouveau mot de passe doit être différent de l'ancien.");
  const { hash, vaultKey } = await hashPassword(password, kdf);
  const opened = oldKey && current[0].campus_sealed ? unseal(oldKey, current[0].campus_sealed) : undefined;
  const { rows } = await db.system.query(
    `UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(), token_version = token_version + 1, campus_sealed = $3 WHERE id = $1 RETURNING ${COLUMNS}`,
    [user.id, hash, opened === undefined ? null : seal(vaultKey, opened)],
  );
  await db.system.query("DELETE FROM oauth_refresh_tokens WHERE user_id = $1", [user.id]);
  return { user: toUser(rows[0]), vaultKey };
}

/** Seals the edu-ID credentials of an account once a login with them succeeded on GAPS. */
export async function saveCampusCredentials(db: Db, id: number, vaultKey: Buffer, credentials: CampusCredentials): Promise<void> {
  await db.system.query("UPDATE users SET campus_sealed = $2, campus_state = 'ok', campus_verified_at = now() WHERE id = $1", [id, seal(vaultKey, JSON.stringify(credentials))]);
}

export async function readCampusCredentials(db: Db, id: number, vaultKey: Buffer): Promise<CampusCredentials | undefined> {
  const { rows } = await db.system.query<{ campus_sealed: Buffer | null }>("SELECT campus_sealed FROM users WHERE id = $1", [id]);
  const text = rows[0]?.campus_sealed ? unseal(vaultKey, rows[0].campus_sealed) : undefined;
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as CampusCredentials;
    return typeof parsed.email === "string" && typeof parsed.password === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The edu-ID session of an account works (a GAPS login just succeeded) or has ended. */
export async function markCampus(db: Db, id: number, state: "ok" | "expired"): Promise<void> {
  if (state === "ok") await db.system.query("UPDATE users SET campus_state = 'ok', campus_verified_at = now() WHERE id = $1", [id]);
  else await db.system.query("UPDATE users SET campus_state = 'expired' WHERE id = $1 AND campus_state = 'ok'", [id]);
}
