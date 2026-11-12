/**
 * Delivers the notices of the server (src/app/notify.ts) to the devices of the accounts, by Web Push
 * (src/webpush.ts). It follows what each account chose: the devices on which it turned notifications on, and the
 * kinds it kept (src/accounts/notifications.ts).
 */
import { type Device, devicesFor, forgetDevice, markSent } from "../accounts/notifications.js";
import type { Notice, NoticeTarget } from "../app/notify.js";
import type { Db } from "../rag/db.js";
import { type PushPost, type Vapid, sendPush, vapidFromSecret } from "../webpush.js";

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export class Pusher {
  private readonly vapid: Vapid;
  /** Who the push services may contact about this server (required by VAPID; Apple refuses a token without it). */
  private readonly subject: string;

  constructor(private readonly db: Db, secret: Uint8Array, publicUrl: URL, private readonly post?: PushPost) {
    this.vapid = vapidFromSecret(secret);
    this.subject = process.env.HEIG_PUSH_CONTACT?.trim() || publicUrl.origin;
  }

  /** The key a browser subscribes with. */
  get publicKey(): string {
    return this.vapid.publicKey;
  }

  /** Sends a notice of a kind to the devices that want it. Returns how many push services accepted it. */
  send(to: NoticeTarget, notice: Notice): Promise<number> {
    return this.deliver(notice, async () => devicesFor(this.db, to, notice.kind));
  }

  /** A try-out asked by the account itself, whatever the kinds it kept. */
  test(userId: number): Promise<number> {
    return this.deliver({ kind: "document", title: "HEIG-Kit", body: "Les notifications fonctionnent sur cet appareil.", url: "/account", tag: "test" }, async () => devicesFor(this.db, userId));
  }

  private async deliver(notice: Notice, list: () => Promise<Device[]>): Promise<number> {
    const devices = await list();
    if (devices.length === 0) return 0;
    const payload = JSON.stringify({ title: short(notice.title, 80), body: short(notice.body, 300), url: notice.url ?? "/", tag: notice.tag ?? notice.kind });
    const sent: number[] = [];
    await Promise.all(
      devices.map(async (device) => {
        try {
          const status = await sendPush(this.vapid, this.subject, device, payload, { send: this.post });
          if (status >= 200 && status < 300) sent.push(device.id);
          // The browser dropped the subscription, or it was made for another key of this server: the device subscribes again.
          else if (status === 404 || status === 410 || status === 403) await forgetDevice(this.db, device.id);
          else console.error(`Notification refused by ${new URL(device.endpoint).hostname}: ${status}`);
        } catch (error) {
          console.error(`Notification not sent: ${error instanceof Error ? error.message : error}`);
        }
      }),
    );
    await markSent(this.db, sent);
    return sent.length;
  }
}
