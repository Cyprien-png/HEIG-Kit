/**
 * What happened that an account may want to hear about on its phone or computer. The code that knows it happened calls
 * `notify`; only a shared server delivers anything (src/server/push.ts), to the devices on which the account turned
 * notifications on and for the kinds it kept. Elsewhere this does nothing.
 */
export type NoticeKind = "document" | "correction" | "courses";
export const NOTICE_KINDS: NoticeKind[] = ["document", "correction", "courses"];

export interface Notice {
  kind: NoticeKind;
  title: string;
  body: string;
  /** Page of the web application opened by a tap on the notification. */
  url?: string;
  /** A later notice with the same tag replaces this one on the device. */
  tag?: string;
}

/** One account, or everyone. */
export type NoticeTarget = number | "all";

let deliver: ((to: NoticeTarget, notice: Notice) => void) | undefined;

export function setNotifier(send: ((to: NoticeTarget, notice: Notice) => void) | undefined): void {
  deliver = send;
}

/** Never throws and never waits: a notification must not break or slow down what it announces. */
export function notify(to: NoticeTarget | undefined, notice: Notice): void {
  if (to === undefined || !deliver) return;
  try {
    deliver(to, notice);
  } catch (error) {
    console.error(`Notification not sent: ${error instanceof Error ? error.message : error}`);
  }
}
