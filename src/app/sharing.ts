/**
 * What the accounts of a server share: decks, quizzes, generated documents and videos. Everyone reads and uses them;
 * only their author (or an administrator) changes them, and only an administrator deletes them, because a deletion
 * takes the item and the progress made on it away from the whole class. The database enforces it (rag/migrations/016
 * and 019); the
 * functions here say it in words, because a refused change must be an error and never look like "nothing to change".
 */
import { AccessDenied, isAdmin } from "../identity.js";
import type { Db } from "../rag/db.js";

export interface Authorship {
  /** The account that created the item; undefined for items older than the accounts, or whose author left. */
  createdBy?: number;
  /** Its name, the only thing an account sees of another. */
  author?: string;
  /** Created by the current account. */
  mine: boolean;
  /** The current account may change it (its author, or an administrator). */
  editable: boolean;
  /** The current account may delete it: administrators only. */
  deletable: boolean;
}

const AUTHOR_NAME = (column: string) => `(SELECT nullif(trim(m.first_name || ' ' || m.last_name), '') FROM members m WHERE m.id = ${column})`;

/** Columns to add to a SELECT on a shared table whose alias is given. */
export const authorColumns = (alias: string) =>
  `${alias}.created_by, (${alias}.created_by IS NOT DISTINCT FROM heig_user()) AS mine, heig_may_edit(${alias}.created_by) AS editable, heig_admin() AS deletable, ${AUTHOR_NAME(`${alias}.created_by`)} AS author`;

export function authorship(row: Record<string, unknown>): Authorship {
  return {
    createdBy: row.created_by === null || row.created_by === undefined ? undefined : Number(row.created_by),
    author: (row.author as string | null) ?? undefined,
    mine: row.mine === true,
    editable: row.editable === true,
    deletable: row.deletable === true,
  };
}

const LABEL = { decks: "deck", quizzes: "quiz" } as const;

export function refusal(what: string, author: string | undefined, advice: string): AccessDenied {
  return new AccessDenied(`Refused: ${what} was created by ${author ?? "another account"}. On this shared server an item is changed only by its author or an administrator. ${advice}`);
}

/**
 * What the whole class relies on and nobody but an administrator touches: the past written tests, the list of GitHub
 * repositories indexed as course material.
 */
export function requireAdmin(action: string): void {
  if (!isAdmin()) throw new AccessDenied(`Refused: only an administrator of this shared server may ${action}. Do not retry or work around it: tell the user to ask an administrator.`);
}

/** Refuses a deletion of something shared to anyone but an administrator, its author included. */
export function requireAdminToDelete(what: string): void {
  if (!isAdmin()) throw new AccessDenied(`Refused: only an administrator of this shared server deletes ${what}; its author may change it, nobody else. Do not retry or work around it: tell the user to ask an administrator.`);
}

/**
 * Before changing a deck or a quiz: false when it does not exist, an error when it belongs to someone else. Without
 * this the database would silently change nothing.
 */
export async function requireEditable(db: Db, table: keyof typeof LABEL, id: number): Promise<boolean> {
  const { rows } = await db.query(`SELECT t.title, ${authorColumns("t")} FROM ${table} t WHERE t.id = $1`, [id]);
  if (!rows[0]) return false;
  const who = authorship(rows[0]);
  if (!who.editable) throw refusal(`the ${LABEL[table]} "${rows[0].title}" (${id})`, who.author, `Use it as it is, or create your own ${LABEL[table]} for what is missing.`);
  return true;
}
