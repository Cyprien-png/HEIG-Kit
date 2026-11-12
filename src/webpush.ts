/**
 * Web Push, the standard every browser uses for the notifications of a web application, iOS and Android included:
 * the message is encrypted for the device alone (RFC 8291, `aes128gcm` of RFC 8188), so the push service of Apple,
 * Google or Mozilla carries it without being able to read it, and the server proves who it is with a signed token
 * (VAPID, RFC 8292).
 */
import { type KeyObject, createCipheriv, createECDH, createHmac, createPrivateKey, hkdfSync, randomBytes } from "node:crypto";
import { SignJWT } from "jose";

export interface PushTarget {
  endpoint: string;
  /** The device's public key (65 bytes, base64url) and its secret (16 bytes, base64url). */
  p256dh: string;
  auth: string;
}

/**
 * The push services of the browsers. A subscription comes from the browser of a user: the server must not be made to
 * call any address it is handed.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

/** Why a subscription is refused, or undefined when it can be used. */
export function targetProblem(target: PushTarget): string | undefined {
  let url: URL;
  try {
    url = new URL(target.endpoint);
  } catch {
    return "endpoint is not an address";
  }
  if (target.endpoint.length > 2000 || url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return "endpoint must be a plain https address";
  if (!PUSH_HOSTS.some((host) => host.test(url.hostname))) return "endpoint is not a known push service (Apple, Google, Mozilla, Microsoft)";
  if (!/^[A-Za-z0-9_-]+$/.test(target.p256dh) || !/^[A-Za-z0-9_-]+$/.test(target.auth)) return "keys must be base64url";
  const key = Buffer.from(target.p256dh, "base64url");
  if (key.length !== 65 || key[0] !== 4) return "p256dh must be an uncompressed P-256 point";
  if (Buffer.from(target.auth, "base64url").length !== 16) return "auth must be 16 bytes";
  return undefined;
}

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer | string, length: number) => Buffer.from(hkdfSync("sha256", ikm, salt, info, length));

/** Plain text a push service accepts in one message (4096 bytes with the header, the padding byte and the tag). */
export const MAX_PUSH_BYTES = 3993;

/**
 * The body of a push message. `fixed`: the salt and the sender's key, for the test vector of the RFC; random
 * otherwise, as they must be.
 */
export function encryptPush(target: Pick<PushTarget, "p256dh" | "auth">, plaintext: Buffer, fixed?: { salt: Buffer; privateKey: Buffer }): Buffer {
  if (plaintext.length > MAX_PUSH_BYTES) throw new Error("push message too long");
  const receiver = Buffer.from(target.p256dh, "base64url");
  const sender = createECDH("prime256v1");
  if (fixed) sender.setPrivateKey(fixed.privateKey);
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const ikm = hkdf(Buffer.from(target.auth, "base64url"), sender.computeSecret(receiver), Buffer.concat([Buffer.from("WebPush: info\0"), receiver, senderPublic]), 32);
  const salt = fixed?.salt ?? randomBytes(16);
  const cipher = createCipheriv("aes-128-gcm", hkdf(salt, ikm, "Content-Encoding: aes128gcm\0", 16), hkdf(salt, ikm, "Content-Encoding: nonce\0", 12));
  // 0x02 ends the last (here the only) record.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(4096, 16);
  header[20] = senderPublic.length;
  return Buffer.concat([header, senderPublic, sealed]);
}

/** The key pair that identifies this server to the push services. */
export interface Vapid {
  /** What the browser subscribes with (`applicationServerKey`), base64url. */
  publicKey: string;
  key: KeyObject;
}

/**
 * The server's push identity, derived from its secret: nothing more to configure or to store. Changing the secret
 * changes it, and the devices subscribe again at their next visit.
 */
export function vapidFromSecret(secret: string | Uint8Array): Vapid {
  for (let i = 0; ; i++) {
    const d = createHmac("sha256", secret).update(`web push vapid ${i}`).digest();
    const ecdh = createECDH("prime256v1");
    try {
      ecdh.setPrivateKey(d);
    } catch {
      // Not a valid P-256 scalar (one chance in 2^32): the next one.
      continue;
    }
    const point = ecdh.getPublicKey();
    const jwk = { kty: "EC", crv: "P-256", d: d.toString("base64url"), x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") };
    return { publicKey: point.toString("base64url"), key: createPrivateKey({ key: jwk, format: "jwk" }) };
  }
}

/** The `Authorization` header of a push request: valid for one push service, for a few hours. */
export async function vapidAuthorization(vapid: Vapid, endpoint: string, subject: string, hours = 12): Promise<string> {
  const token = await new SignJWT({}).setProtectedHeader({ typ: "JWT", alg: "ES256" }).setAudience(new URL(endpoint).origin).setSubject(subject).setExpirationTime(Math.floor(Date.now() / 1000) + hours * 3600).sign(vapid.key);
  return `vapid t=${token}, k=${vapid.publicKey}`;
}

export type PushPost = (endpoint: string, headers: Record<string, string>, body: Buffer) => Promise<number>;

const post: PushPost = async (endpoint, headers, body) => (await fetch(endpoint, { method: "POST", headers, body: new Uint8Array(body), redirect: "error", signal: AbortSignal.timeout(15_000) })).status;

/**
 * Sends one message to one device and gives the answer of its push service: 2xx accepted, 404 or 410 the subscription
 * no longer exists, 403 it belongs to another server key.
 */
export async function sendPush(vapid: Vapid, subject: string, target: PushTarget, payload: string, options: { ttlSeconds?: number; send?: PushPost } = {}): Promise<number> {
  const problem = targetProblem(target);
  if (problem) throw new Error(problem);
  const headers = {
    Authorization: await vapidAuthorization(vapid, target.endpoint, subject),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds ?? 86_400),
    Urgency: "normal",
  };
  return (options.send ?? post)(target.endpoint, headers, encryptPush(target, Buffer.from(payload, "utf-8")));
}
