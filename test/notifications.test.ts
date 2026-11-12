import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jwtVerify } from "jose";
import { countDevices, devicesFor } from "../src/accounts/notifications.js";
import { updateUser } from "../src/accounts/users.js";
import { createCorrection, submitResult } from "../src/app/corrections.js";
import { notify } from "../src/app/notify.js";
import { runAs } from "../src/identity.js";
import { type App, createApp } from "../src/server/app.js";
import { Auth } from "../src/server/auth.js";
import { loadServerConfig } from "../src/server/config.js";
import { createRemoteServer } from "../src/server/http.js";
import { JobQueue } from "../src/server/jobs.js";
import { type PushTarget, encryptPush, sendPush, targetProblem, vapidAuthorization, vapidFromSecret } from "../src/webpush.js";
import { type TestAccount, readyAccount } from "./helpers/accounts.js";
import { testDb } from "./helpers/db.js";

const base = mkdtempSync(path.join(os.tmpdir(), "heig-push-"));
process.env.HEIG_OUTPUT_DIR = path.join(base, "out");
process.env.HEIG_WEB_DIR = path.join(base, "web");
mkdirSync(process.env.HEIG_WEB_DIR);
writeFileSync(path.join(process.env.HEIG_WEB_DIR, "index.html"), "<!doctype html><title>app</title>");

/** A device as a browser describes it, and what it reads in a message sent to it (RFC 8291, the receiving side). */
function device(endpoint: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.from("0123456789abcdef");
  const target: PushTarget = { endpoint, p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
  const read = (body: Buffer): string => {
    const salt = body.subarray(0, 16);
    const sender = body.subarray(21, 21 + body[20]);
    const hkdf = (s: Buffer, ikm: Buffer, info: Buffer | string, n: number) => Buffer.from(hkdfSync("sha256", ikm, s, info, n));
    const ikm = hkdf(auth, ecdh.computeSecret(sender), Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), sender]), 32);
    const decipher = createDecipheriv("aes-128-gcm", hkdf(salt, ikm, "Content-Encoding: aes128gcm\0", 16), hkdf(salt, ikm, "Content-Encoding: nonce\0", 12));
    const sealed = body.subarray(21 + body[20]);
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
    assert.equal(plain[plain.length - 1], 2, "the record ends with its delimiter");
    return plain.subarray(0, -1).toString("utf-8");
  };
  return { target, read, json: { endpoint, keys: { p256dh: target.p256dh, auth: target.auth } } };
}

test("a push message is encrypted as RFC 8291 says (its own example)", () => {
  const body = encryptPush(
    { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
    Buffer.from("When I grow up, I want to be a watermelon"),
    { salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"), privateKey: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url") },
  );
  assert.equal(
    body.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
  // Random salt and key otherwise: the same text never gives the same message, and only its device reads it.
  const phone = device("https://fcm.googleapis.com/fcm/send/abc");
  const once = encryptPush(phone.target, Buffer.from("Votre document est prêt"));
  assert.notDeepEqual(once, encryptPush(phone.target, Buffer.from("Votre document est prêt")));
  assert.equal(phone.read(once), "Votre document est prêt");
  assert.throws(() => device("https://fcm.googleapis.com/x").read(once));
});

test("only the push services of the browsers are called, with a token signed by the server", async () => {
  const good = device("https://web.push.apple.com/QGk-abc").target;
  assert.equal(targetProblem(good), undefined);
  for (const endpoint of ["https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://db5p.notify.windows.com/w/?token=x"]) assert.equal(targetProblem({ ...good, endpoint }), undefined, endpoint);
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://example.com/x", "https://fcm.googleapis.com.evil.ch/x", "https://evilpush.apple.com/x", "https://u:p@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "nope"]) {
    assert.ok(targetProblem({ ...good, endpoint }), endpoint);
  }
  assert.match(targetProblem({ ...good, p256dh: "AAAA" })!, /P-256/);
  assert.match(targetProblem({ ...good, auth: "AAAA" })!, /16 bytes/);

  const vapid = vapidFromSecret("0123456789abcdef".repeat(3));
  assert.equal(vapidFromSecret("0123456789abcdef".repeat(3)).publicKey, vapid.publicKey, "the same secret gives the same identity");
  assert.notEqual(vapidFromSecret("another secret of the server....").publicKey, vapid.publicKey);
  const point = Buffer.from(vapid.publicKey, "base64url");
  assert.deepEqual([point.length, point[0]], [65, 4]);
  const header = await vapidAuthorization(vapid, good.endpoint, "https://kit.example.ch");
  const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
  assert.equal(k, vapid.publicKey);
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
  const { payload, protectedHeader } = await jwtVerify(token, key, { audience: "https://web.push.apple.com" });
  assert.deepEqual([protectedHeader.alg, payload.sub], ["ES256", "https://kit.example.ch"]);
  assert.ok(payload.exp! - Date.now() / 1000 <= 24 * 3600, "push services refuse tokens valid for more than a day");

  const calls: { endpoint: string; headers: Record<string, string> }[] = [];
  const status = await sendPush(vapid, "https://kit.example.ch", good, "{}", { send: async (endpoint, headers) => (calls.push({ endpoint, headers }), 201) });
  assert.deepEqual([status, calls[0].endpoint, calls[0].headers["Content-Encoding"], calls[0].headers.TTL], [201, good.endpoint, "aes128gcm", "86400"]);
  await assert.rejects(sendPush(vapid, "s", { ...good, endpoint: "https://127.0.0.1/x" }, "{}", { send: async () => 201 }), /https|push service/);
});

const ENV = { HEIG_JWT_SECRET: "0123456789abcdef".repeat(3), HEIG_PUBLIC_URL: "http://127.0.0.1", HEIG_SYNC_MINUTES: "0" };
const db = await testDb("heigkit_test_push");
const NO_DB = !db && "no local database";
let server: Server;
let origin: string;
let app: App;
let queue: JobQueue;
let lea: TestAccount;
let noe: TestAccount;
/** What the push services received, and what they answer. */
const pushed: { endpoint: string; body: Buffer }[] = [];
let answer = (_endpoint: string) => 201;
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const JSON_HEADERS = { "Content-Type": "application/json", "X-Requested-With": "heig-kit" };

before(async () => {
  if (!db) return;
  lea = await readyAccount(db, "lea.notifs@heig-vd.ch");
  noe = await readyAccount(db, "noe.notifs@heig-vd.ch");
  const config = loadServerConfig(ENV);
  queue = new JobQueue(path.join(base, "jobs"), path.join(base, "records"));
  // The public address of the server is the one it listens on: a free port is found first.
  const probe = createRemoteServer(createApp(config, db, undefined, { auth: new Auth(config) }), async () => new McpServer({ name: "t", version: "1" }));
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  probe.close();
  origin = `http://127.0.0.1:${port}`;
  app = createApp({ ...config, publicUrl: new URL(origin) }, db, queue, { auth: new Auth(config), push: async (endpoint, _headers, body) => (pushed.push({ endpoint, body }), answer(endpoint)) });
  server = createRemoteServer(app, async () => new McpServer({ name: "t", version: "1" }));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
});

after(async () => {
  server?.close();
  rmSync(base, { recursive: true, force: true });
  await db?.end();
});

async function session(account: TestAccount) {
  const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: account.email, password: account.password }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  return async (method: string, route: string, body?: unknown) => {
    const res = await fetch(`${origin}${route}`, { method, headers: { ...JSON_HEADERS, Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
}

test("each account chooses its notifications, and the server follows", { skip: NO_DB }, async () => {
  const asLea = await session(lea);
  const asNoe = await session(noe);
  const phone = device("https://web.push.apple.com/lea-phone");
  const laptop = device("https://fcm.googleapis.com/fcm/send/lea-laptop");
  const other = device("https://fcm.googleapis.com/fcm/send/noe-phone");

  // Nothing is on until a device asks for it; every kind is wanted by default.
  const start = await asLea("GET", "/api/notifications");
  assert.deepEqual([start.status, start.body.kinds, start.body.devices], [200, { document: true, correction: true, courses: true }, 0]);
  assert.equal(start.body.publicKey, app.pusher.publicKey);
  notify(lea.user.id, { kind: "document", title: "t", body: "b" });
  await settle();
  assert.equal(pushed.length, 0);

  assert.equal((await asLea("POST", "/api/notifications/devices", { endpoint: "https://127.0.0.1:5433/x", keys: phone.json.keys })).status, 400, "the server is not sent to any address");
  assert.equal((await asLea("POST", "/api/notifications/devices", { endpoint: phone.target.endpoint })).status, 400);
  assert.equal((await asLea("POST", "/api/notifications/devices", phone.json)).body.devices, 1);
  assert.equal((await asLea("POST", "/api/notifications/devices", phone.json)).body.devices, 1, "the same device twice is one device");
  assert.equal((await asLea("POST", "/api/notifications/devices", laptop.json)).body.devices, 2);
  assert.equal((await asNoe("POST", "/api/notifications/devices", other.json)).body.devices, 1);
  // An agent holds a token of the account, not its devices.
  const token = (await app.auth.issueToken(lea.user)).token;
  assert.equal((await fetch(`${origin}/api/notifications`, { headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` } })).status, 403);

  // A try-out rings the devices of the account, and only they can read it.
  assert.equal((await asLea("POST", "/api/notifications/test")).body.sent, 2);
  assert.deepEqual(pushed.map((p) => p.endpoint).sort(), [laptop.target.endpoint, phone.target.endpoint].sort());
  const onPhone = pushed.find((p) => p.endpoint === phone.target.endpoint)!;
  assert.equal(JSON.parse(phone.read(onPhone.body)).url, "/account");
  assert.throws(() => laptop.read(onPhone.body));
  pushed.length = 0;

  // A correction that becomes corrected is announced to its owner, once.
  const result = { summary: "Bien", exercises: [{ number: "1", answer: "x = 2", verdict: "correct", feedback: "ok" }] };
  const correction = await runAs({ id: lea.user.id, role: "student" }, async () => {
    const created = await createCorrection(db!, { title: "Série 3", course: "MAD" });
    await submitResult(db!, created.id, result);
    await submitResult(db!, created.id, result);
    return created;
  });
  await settle();
  assert.equal(pushed.length, 2, "her two devices, once each");
  const told = JSON.parse(phone.read(pushed.find((p) => p.endpoint === phone.target.endpoint)!.body));
  assert.deepEqual(told, { title: "Votre correction est prête", body: "MAD · Série 3", url: `/corrections/${correction.id}`, tag: `correction-${correction.id}` });
  pushed.length = 0;

  // She no longer wants corrections: the server keeps quiet about them, on every device, and still tells the rest.
  assert.equal((await asLea("PUT", "/api/notifications", { correction: "non" })).status, 400);
  assert.equal((await asLea("PUT", "/api/notifications", { tout: true })).status, 400);
  assert.deepEqual((await asLea("PUT", "/api/notifications", { correction: false })).body.kinds, { document: true, correction: false, courses: true });
  await runAs({ id: lea.user.id, role: "student" }, async () => submitResult(db!, (await createCorrection(db!, { title: "Série 4" })).id, result));
  await settle();
  assert.equal(pushed.length, 0);

  // A rendering that ends is announced to the account that asked for it, with the page of its file.
  const job = queue.submit({ kind: "document", name: "fiche", formats: ["pdf"] }, "fiche.md", "# Fiche", [], [], lea.user.id);
  const dir = path.join(base, "jobs", job.id);
  mkdirSync(path.join(dir, "output"));
  writeFileSync(path.join(dir, "output", "fiche.pdf"), "pdf");
  writeFileSync(path.join(dir, "status.json"), JSON.stringify({ state: "done", files: ["fiche.pdf"] }));
  queue.collect();
  queue.collect();
  await settle();
  assert.deepEqual(pushed.map((p) => p.endpoint).sort(), [laptop.target.endpoint, phone.target.endpoint].sort(), "once, and not to the other account");
  const ready = JSON.parse(laptop.read(pushed.find((p) => p.endpoint === laptop.target.endpoint)!.body));
  assert.deepEqual([ready.title, ready.body, ready.url], ["Votre document est prêt", "fiche", "/library/documents/fiche.pdf"]);
  pushed.length = 0;
  const failing = queue.submit({ kind: "animation", name: "scene", scene: "S", quality: "low", voice: false }, "scene.py", "code", [], [], noe.user.id);
  writeFileSync(path.join(base, "jobs", failing.id, "status.json"), JSON.stringify({ state: "failed", log: "boom" }));
  queue.collect();
  await settle();
  assert.deepEqual(pushed.map((p) => JSON.parse(other.read(p.body)).title), ["La génération de la vidéo a échoué"]);
  pushed.length = 0;

  // New course material is announced to everyone who kept that kind.
  await asNoe("PUT", "/api/notifications", { courses: false });
  notify("all", { kind: "courses", title: "Les cours ont été mis à jour", body: "3 documents ajoutés ou modifiés." });
  await settle();
  assert.deepEqual(pushed.map((p) => p.endpoint).sort(), [laptop.target.endpoint, phone.target.endpoint].sort());
  pushed.length = 0;

  // A device whose subscription ended is forgotten; a disabled account hears nothing.
  answer = (endpoint) => (endpoint === phone.target.endpoint ? 410 : 201);
  notify(lea.user.id, { kind: "document", title: "t", body: "b" });
  await settle();
  assert.equal(await countDevices(db!, lea.user.id), 1);
  answer = () => 201;
  await updateUser(db!, noe.user.id, { disabled: true });
  assert.deepEqual(await devicesFor(db!, "all", "document"), await devicesFor(db!, lea.user.id));
  await updateUser(db!, noe.user.id, { disabled: false });

  // The same device taken by another account rings for that one only; turning it off, or logging out, ends it.
  const noeAgain = await session(noe);
  assert.equal((await noeAgain("POST", "/api/notifications/devices", laptop.json)).body.devices, 2);
  assert.equal(await countDevices(db!, lea.user.id), 0);
  assert.equal((await asLea("DELETE", "/api/notifications/devices", { endpoint: laptop.target.endpoint })).body.devices, 0, "not hers any more: nothing removed");
  assert.equal((await noeAgain("DELETE", "/api/notifications/devices", { endpoint: laptop.target.endpoint })).body.devices, 1);
  assert.equal((await noeAgain("POST", "/api/auth/logout")).status, 200);
  assert.equal(await countDevices(db!, noe.user.id), 0);
});
