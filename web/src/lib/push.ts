/**
 * Notifications on this device (Web Push): the service worker (public/sw.js), the permission and the subscription of
 * the browser, registered on the server. On an iPhone or an iPad they only exist for the application installed on the
 * home screen (iOS 16.4 and later).
 */
import { api } from "./api";

export interface NotificationSettings {
  /** The key of the server a browser subscribes with (base64url). */
  publicKey: string;
  kinds: { document: boolean; correction: boolean; courses: boolean };
  /** Devices of the account with notifications on. */
  devices: number;
}

/** `install`: an iPhone or iPad whose browser shows the site; the application must be added to the home screen first. */
export type PushSupport = "ok" | "install" | "unsupported";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "ok";
  return isIos() && !isInstalled() ? "install" : "unsupported";
}

let worker: Promise<ServiceWorkerRegistration> | undefined;
const registration = () => (worker ??= navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready));

const bytes = (base64url: string) => Uint8Array.from(atob(base64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const sameKey = (subscription: PushSubscription, key: Uint8Array) => {
  const used = subscription.options.applicationServerKey;
  if (!used) return false;
  const a = new Uint8Array(used);
  return a.length === key.length && a.every((byte, i) => byte === key[i]);
};

/** Whether this device is subscribed, as far as its browser knows. */
export async function isSubscribed(): Promise<boolean> {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return false;
  return Boolean(await (await registration()).pushManager.getSubscription());
}

async function subscribe(publicKey: string): Promise<NotificationSettings> {
  const manager = (await registration()).pushManager;
  const key = bytes(publicKey);
  let subscription = await manager.getSubscription();
  // Made for another key of the server (its secret changed): useless, replaced.
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await manager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return api<NotificationSettings>("/api/notifications/devices", { method: "POST", json: subscription.toJSON() });
}

/**
 * Turns notifications on for this device. To call straight from a tap: browsers, iOS first, only show the permission
 * question in answer to one.
 */
export async function enablePush(publicKey: string): Promise<NotificationSettings> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Les notifications sont bloquées pour HEIG-Kit dans les réglages de cet appareil." : "Autorisation non donnée.");
  return subscribe(publicKey);
}

export async function disablePush(): Promise<NotificationSettings | undefined> {
  if (pushSupport() !== "ok") return undefined;
  const subscription = await (await registration()).pushManager.getSubscription();
  if (!subscription) return undefined;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return api<NotificationSettings>("/api/notifications/devices", { method: "DELETE", json: { endpoint } });
}

/** Logout: this device stops ringing, whatever the server answers. */
export async function forgetPush(): Promise<void> {
  if (pushSupport() !== "ok") return;
  const existing = await navigator.serviceWorker.getRegistration("/");
  await (await existing?.pushManager.getSubscription())?.unsubscribe();
}

/**
 * At each visit of an account that turned notifications on here: tells the server the subscription of the browser
 * again, since browsers renew them and the server forgets those it could not reach.
 */
export async function refreshPush(): Promise<void> {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing || !(await existing.pushManager.getSubscription())) return;
  const { publicKey } = await api<NotificationSettings>("/api/notifications");
  await subscribe(publicKey);
}

/** A tap on a notification while the application is open: the service worker names the page to show. */
export function onNotificationOpen(open: (url: string) => void): () => void {
  if (!("serviceWorker" in navigator)) return () => undefined;
  const listen = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: unknown } | undefined;
    if (data?.type === "heig-open" && typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//")) open(data.url);
  };
  navigator.serviceWorker.addEventListener("message", listen);
  return () => navigator.serviceWorker.removeEventListener("message", listen);
}
