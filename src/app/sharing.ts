/**
 * What the accounts of a server share: decks, quizzes, generated documents and videos. Everyone reads and uses them;
 * only their author (or an administrator) changes or deletes them. The database enforces it (rag/migrations/016); the
 * functions here say it in words, because a refused change must be an error and never look like "nothing to change".
 */
import { AccessDenied } from "../identity.js";
import type { Db } from "../rag/db.js";

export interface Authorship {
  /** The account that created the item; undefined for items older than the accounts, or whose author left. */
  createdBy?: number;
  /** Its name, the only thing an account sees of another. */
  author?: string;
  /** Created by the current account. */
  mine: boolean;
  /** The current account may change or delete it (its author, or an administrator). */
  editable: boolean;
}

const AUTHOR_NAME = (column: string) => `(SELECT nullif(trim(m.first_name || ' ' || m.last_name), '') FROM members m WHERE m.id = ${column})`;

/** Columns to add to a SELECT on a shared table whose alias is given. */
export const authorColumns = (alias: string) =>
  `${alias}.created_by, (${alias}.created_by IS NOT DISTINCT FROM heig_user()) AS mine, heig_may_edit(${alias}.created_by) AS editable, ${AUTHOR_NAME(`${alias}.created_by`)} AS author`;

export function authorship(row: Record<string, unknown>): Authorship {
  return {
    createdBy: row.created_by === null || row.created_by === undefined ? undefined : Number(row.created_by),
    author: (row.author as string | null) ?? undefined,
    mine: row.mine === true,
    editable: row.editable === true,
  };
}

const LABEL = { decks: "deck", quizzes: "quiz" } as const;

export function refusal(what: string, author: string | undefined, advice: string): AccessDenied {
  return new AccessDenied(`Refused: ${what} was created by ${author ?? "another account"}. On this shared server an item is changed or deleted only by its author or an administrator. ${advice}`);
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
