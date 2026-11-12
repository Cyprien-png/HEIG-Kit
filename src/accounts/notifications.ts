/**
 * The notifications of an account (docs/notifications.md): the kinds it wants, for all its devices, and the devices
 * on which it turned them on. A device is a Web Push subscription made by its browser (src/webpush.ts).
 */
import { NOTICE_KINDS, type NoticeKind } from "../app/notify.js";
import type { Db } from "../rag/db.js";
import { type PushTarget, targetProblem } from "../webpush.js";

export type NoticePrefs = Record<NoticeKind, boolean>;

/** Devices kept per account: the oldest ones go when more are added. */
export const MAX_DEVICES = 10;

export async function getNoticePrefs(db: Db, userId: number): Promise<NoticePrefs> {
  const { rows } = await db.system.query("SELECT document, correction, courses FROM notification_prefs WHERE user_id = $1", [userId]);
  const row = rows[0] as Partial<NoticePrefs> | undefined;
  return { document: row?.document ?? true, correction: row?.correction ?? true, courses: row?.courses ?? true };
}

/** Changes the kinds named in `patch`; anything else in it is refused. */
export async function setNoticePrefs(db: Db, userId: number, patch: Record<string, unknown>): Promise<NoticePrefs> {
  for (const [name, value] of Object.entries(patch)) {
    if (!NOTICE_KINDS.includes(name as NoticeKind)) throw new Error(`unknown kind of notification: ${name} (${NOTICE_KINDS.join(", ")})`);
    if (typeof value !== "boolean") throw new Error(`${name} must be true or false`);
  }
  const next = { ...(await getNoticePrefs(db, userId)), ...(patch as Partial<NoticePrefs>) };
  await db.system.query(
    `INSERT INTO notification_prefs (user_id, document, correction, courses) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET document = EXCLUDED.document, correction = EXCLUDED.correction, courses = EXCLUDED.courses`,
    [userId, next.document, next.correction, next.courses],
  );
  return next;
}

/**
 * A device of the account turned notifications on. The same device registered again, by this account or by another
 * one that logged in on it, replaces what was there: a device rings for one account only.
 */
export async function addDevice(db: Db, userId: number, target: PushTarget, device?: string): Promise<void> {
  const problem = targetProblem(target);
  if (problem) throw new Error(problem);
  await db.system.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device = EXCLUDED.device, created_at = now()`,
    [userId, target.endpoint, target.p256dh, target.auth, device?.slice(0, 200) ?? null],
  );
  await db.system.query("DELETE FROM push_subscriptions WHERE user_id = $1 AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)", [userId, MAX_DEVICES]);
}

export async function removeDevice(db: Db, userId: number, endpoint: string): Promise<boolean> {
  return ((await db.system.query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [userId, endpoint])).rowCount ?? 0) > 0;
}

/** Logout: no device keeps ringing for an account that left. */
export async function removeDevices(db: Db, userId: number): Promise<void> {
  await db.system.query("DELETE FROM push_subscriptions WHERE user_id = $1", [userId]);
}

export async function countDevices(db: Db, userId: number): Promise<number> {
  return Number((await db.system.query("SELECT count(*) AS n FROM push_subscriptions WHERE user_id = $1", [userId])).rows[0].n);
}

export interface Device extends PushTarget {
  id: number;
  userId: number;
}

/**
 * The devices to ring: those of one account or of everyone, whose account is active and, with `kind`, kept that kind
 * of notification.
 */
export async function devicesFor(db: Db, to: number | "all", kind?: NoticeKind): Promise<Device[]> {
  if (kind && !NOTICE_KINDS.includes(kind)) throw new Error(`unknown kind of notification: ${kind}`);
  const { rows } = await db.system.query(
    `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN notification_prefs p ON p.user_id = s.user_id
      WHERE u.disabled_at IS NULL AND ($1::bigint IS NULL OR s.user_id = $1) ${kind ? `AND coalesce(p.${kind}, true)` : ""}
      ORDER BY s.id`,
    [to === "all" ? null : to],
  );
  return rows.map((r) => ({ id: Number(r.id), userId: Number(r.user_id), endpoint: r.endpoint as string, p256dh: r.p256dh as string, auth: r.auth as string }));
}

export async function forgetDevice(db: Db, id: number): Promise<void> {
  await db.system.query("DELETE FROM push_subscriptions WHERE id = $1", [id]);
}

export async function markSent(db: Db, ids: number[]): Promise<void> {
  if (ids.length > 0) await db.system.query("UPDATE push_subscriptions SET last_sent_at = now() WHERE id = ANY($1::bigint[])", [ids]);
}
