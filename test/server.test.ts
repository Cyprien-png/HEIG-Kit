import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SignJWT } from "jose";
import { Auth, LoginLimiter } from "../src/server/auth.js";
import { type App, createApp } from "../src/server/app.js";
import { type ServerConfig, loadServerConfig } from "../src/server/config.js";
import { resolveGenerated } from "../src/server/files.js";
import { createRemoteServer } from "../src/server/http.js";
import { JobQueue, safeBaseName } from "../src/server/jobs.js";
import { updateUser } from "../src/accounts/users.js";
import { type TestAccount, newAccount, readyAccount } from "./helpers/accounts.js";
import { testDb } from "./helpers/db.js";

const base = mkdtempSync(path.join(os.tmpdir(), "heig-server-"));
const secretFile = path.join(base, "secret.pdf");
process.env.HEIG_OUTPUT_DIR = path.join(base, "out");
// Without a built web application, unknown paths are 404 (web/dist may exist on a developer's machine).
process.env.HEIG_WEB_DIR = path.join(base, "no-web");
const documents = path.join(base, "out", "documents");
mkdirSync(documents, { recursive: true });
mkdirSync(path.join(base, "out", "videos"), { recursive: true });
writeFileSync(secretFile, "secret");
writeFileSync(path.join(documents, "cours.pdf"), "pdf content");
writeFileSync(path.join(documents, ".hidden.pdf"), "hidden");
writeFileSync(path.join(documents, "notes.env"), "SECRET=1");
symlinkSync(secretFile, path.join(documents, "lien.pdf"));

const ENV = { HEIG_JWT_SECRET: "0123456789abcdef".repeat(3), HEIG_PUBLIC_URL: "https://heig.example.org", HEIG_SYNC_MINUTES: "0" };
const config: ServerConfig = { ...loadServerConfig(ENV), tokenDays: 1 };

test("the server refuses to start with missing or weak settings", () => {
  for (const [change, message] of [
    [{ HEIG_JWT_SECRET: "" }, /HEIG_JWT_SECRET/],
    [{ HEIG_JWT_SECRET: "short" }, /32 characters/],
    [{ HEIG_JWT_SECRET: "x".repeat(40) }, /too simple/],
    [{ HEIG_PUBLIC_URL: "http://heig.example.org" }, /https/],
  ] as const) {
    assert.throws(() => loadServerConfig({ ...ENV, ...change }), message);
  }
  assert.equal(loadServerConfig({ ...ENV, HEIG_PUBLIC_URL: "http://localhost:8766" }).publicUrl.port, "8766");
  assert.equal(loadServerConfig(ENV).host, "127.0.0.1");
});

test("access tokens name one account; expiry, version, algorithm and purpose are all checked", async () => {
  const auth = new Auth(config);
  const holder = { id: 7, tokenVersion: 3 };
  const { token } = await auth.issueToken(holder);
  assert.deepEqual(await auth.verifyHeader(`Bearer ${token}`), { userId: 7, version: 3 });
  assert.equal(await auth.verifyHeader(token), undefined);
  assert.equal(await auth.verifyHeader(undefined), undefined);
  assert.equal(await auth.verifyHeader(`Bearer ${token.slice(0, -2)}xx`), undefined);
  assert.equal(await new Auth({ ...config, tokenVersion: "2" }).verifyHeader(`Bearer ${token}`), undefined, "revoked by a new version");
  assert.equal(await new Auth({ ...config, jwtSecret: "fedcba9876543210".repeat(3) }).verifyHeader(`Bearer ${token}`), undefined);
  // Unsigned token.
  const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${token.split(".")[1]}.`;
  assert.equal(await auth.verifyHeader(`Bearer ${none}`), undefined);
  // The account of a token cannot be rewritten: the payload of another account with this signature is refused.
  const [head, , signature] = token.split(".");
  const other = (await auth.issueToken({ id: 8, tokenVersion: 3 })).token.split(".")[1];
  assert.equal(await auth.verifyHeader(`Bearer ${head}.${other}.${signature}`), undefined);
  // A download link is not an access token, and the other way round.
  const fileToken = await auth.issueFileToken("documents/cours.pdf");
  assert.equal(await auth.verifyHeader(`Bearer ${fileToken}`), undefined);
  assert.equal(await auth.verifyFileToken(token), undefined);
  assert.equal(await auth.verifyFileToken(fileToken), "documents/cours.pdf");
  // A capture link names its correction and its owner, and is neither an access token nor a download link.
  const capture = await auth.issueCaptureToken("c1", 7);
  assert.deepEqual(await auth.verifyCaptureToken(capture), { correctionId: "c1", userId: 7 });
  assert.equal(await auth.verifyHeader(`Bearer ${capture}`), undefined);
  assert.equal(await auth.verifyCaptureToken(token), undefined);
  // Signed with the raw secret instead of the derived key, or without a numeric account.
  const raw = await new SignJWT({ ver: "1", uv: 3 }).setProtectedHeader({ alg: "HS256" }).setSubject("7").setIssuer("heig-kit").setAudience("heig-kit-mcp").setExpirationTime("1h").sign(new TextEncoder().encode(config.jwtSecret));
  assert.equal(await auth.verifyHeader(`Bearer ${raw}`), undefined);
  const expired = new Auth({ ...config, tokenDays: -1 });
  assert.equal(await expired.verifyHeader(`Bearer ${(await expired.issueToken(holder)).token}`), undefined);
  // Forms of the server's own pages are tied to the session that displayed them.
  assert.equal(auth.checkFormToken(auth.formToken("session-a", "oauth:x"), "session-a", "oauth:x"), true);
  assert.equal(auth.checkFormToken(auth.formToken("session-a", "oauth:x"), "session-b", "oauth:x"), false);
  assert.equal(auth.checkFormToken(auth.formToken("session-a", "oauth:x"), "session-a", "oauth:y"), false);
  const expiredLink = new Auth({ ...config, linkMinutes: -1 });
  assert.equal(await expiredLink.verifyFileToken(await expiredLink.issueFileToken("documents/cours.pdf")), undefined);
});

test("login attempts are limited per client and overall, and the window expires", () => {
  let now = 0;
  const limiter = new LoginLimiter(2, 3, 1000, () => now);
  limiter.fail("a");
  assert.equal(limiter.allowed("a"), true);
  limiter.fail("a");
  assert.equal(limiter.allowed("a"), false);
  assert.equal(limiter.allowed("b"), true);
  limiter.fail("b");
  assert.equal(limiter.allowed("b"), false, "overall limit reached");
  now = 1001;
  assert.equal(limiter.allowed("a"), true);
});

test("only regular generated files of the output folders can be resolved", () => {
  assert.ok(resolveGenerated("documents/cours.pdf"));
  for (const id of ["documents/lien.pdf", "documents/.hidden.pdf", "documents/notes.env", "documents/../../secret.pdf", "documents/absent.pdf", "../secret.pdf", "/etc/passwd", "documents/a/b.pdf", "data/x.pdf", "documents\\..\\secret.pdf"]) {
    assert.equal(resolveGenerated(id), undefined, id);
  }
});

let server: Server;
let origin: string;
const auth = new Auth(config);
const db = await testDb("heigkit_test_server");
const NO_DB = !db && "no local database";
let ready: TestAccount;
let pending: TestAccount;
const appFor = (publicUrl: URL, limiter?: LoginLimiter): App => {
  const app = createApp({ ...config, publicUrl }, db!, undefined, { auth });
  return limiter ? { ...app, limiter } : app;
};

before(async () => {
  if (!db) return;
  ready = await readyAccount(db, "lea.ready@heig-vd.ch");
  pending = await newAccount(db, "noe.pending@heig-vd.ch");
  server = createRemoteServer(appFor(new URL("http://127.0.0.1")), async () => new McpServer({ name: "test", version: "1" }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  // The host check needs the real port.
  server.close();
  server = createRemoteServer(appFor(new URL(origin)), async () => new McpServer({ name: "test", version: "1" }));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
});

after(async () => {
  server?.close();
  rmSync(base, { recursive: true, force: true });
  await db?.end();
});

const login = (body: unknown, at = origin) => fetch(`${at}/api/auth/login`, { method: "POST", headers: { "X-Requested-With": "heig-kit" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
const mcp = (token?: string) =>
  fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(INIT),
  });

test("the HTTP API: login, MCP for the account of the token only, signed downloads", { skip: NO_DB }, async () => {
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  assert.equal((await fetch(`${origin}/nope`)).status, 404);
  assert.equal((await fetch(`${origin}/api/auth/login`)).status, 405);
  assert.equal((await fetch(`${origin}/auth/login`, { method: "POST", body: JSON.stringify({ email: ready.email, password: ready.password }) })).status, 404, "no token against a password outside OAuth");
  assert.equal((await fetch(`${origin}/api/auth/login`, { method: "POST", body: JSON.stringify({ email: ready.email, password: ready.password }) })).status, 403, "a page of another site cannot log in");
  assert.equal((await login("not json")).status, 400);
  assert.equal((await login([1])).status, 400);
  assert.equal((await login({ email: ready.email, password: "wrong" })).status, 401);
  assert.equal((await login({ email: "nobody@heig-vd.ch", password: ready.password })).status, 401);

  const ok = await login({ email: ready.email.toUpperCase(), password: ready.password });
  assert.equal(ok.status, 200);
  const me = (await ok.json()) as Record<string, unknown>;
  assert.equal(me.email, ready.email);
  assert.equal(me.setup, null);
  assert.equal(JSON.stringify(me).includes("password"), false, "nothing of a password comes back");

  const token = (await auth.issueToken(ready.user)).token;
  assert.equal((await mcp()).status, 401);
  assert.equal((await mcp("invalid")).status, 401);
  assert.equal((await mcp(token)).status, 200);

  // A token is worth what its account is: unknown account, account not ready, revoked, disabled.
  assert.equal((await mcp((await auth.issueToken({ id: 9999, tokenVersion: 0 })).token)).status, 401);
  const notReady = await mcp((await auth.issueToken(pending.user)).token);
  assert.equal(notReady.status, 403);
  assert.equal(((await notReady.json()) as { setup: string }).setup, "password");
  assert.equal((await mcp((await auth.issueToken({ id: ready.user.id, tokenVersion: ready.user.tokenVersion + 1 })).token)).status, 401);
  const gone = await readyAccount(db!, "max.gone@heig-vd.ch");
  const goneToken = (await auth.issueToken(gone.user)).token;
  assert.equal((await mcp(goneToken)).status, 200);
  await updateUser(db!, gone.user.id, { disabled: true });
  assert.equal((await mcp(goneToken)).status, 401, "a disabled account loses its tokens at once");
  assert.equal((await login({ email: gone.email, password: gone.password })).status, 401);

  const link = await auth.issueFileToken("documents/cours.pdf");
  const file = await fetch(`${origin}/files?token=${encodeURIComponent(link)}`);
  assert.equal(file.status, 200);
  assert.equal(await file.text(), "pdf content");
  assert.match(file.headers.get("content-disposition") ?? "", /^attachment/);
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
  assert.match(file.headers.get("content-security-policy") ?? "", /sandbox/);

  assert.equal((await fetch(`${origin}/files`)).status, 404);
  assert.equal((await fetch(`${origin}/files?token=${token}`)).status, 404, "an access token is not a download link");
  for (const id of ["documents/lien.pdf", "documents/../../secret.pdf"]) {
    assert.equal((await fetch(`${origin}/files?token=${encodeURIComponent(await auth.issueFileToken(id))}`)).status, 404, id);
  }
});

test("requests for another host name are refused, and large logins too", { skip: NO_DB }, async () => {
  const { request } = await import("node:http");
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(`${origin}/api/auth/login`, { method: "POST", headers: { Host: "evil.example.org" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end("{}");
  });
  assert.equal(status, 421);
  assert.equal((await login("x".repeat(10_000))).status, 413);
});

test("login is blocked after repeated failures, even with the right password", { skip: NO_DB }, async () => {
  const limited = createRemoteServer(appFor(new URL("http://127.0.0.1:18766"), new LoginLimiter(2)), async () => new McpServer({ name: "t", version: "1" }));
  await new Promise<void>((resolve) => limited.listen(18766, "127.0.0.1", resolve));
  try {
    const attempt = (password: string) => login({ email: ready.email, password }, "http://127.0.0.1:18766");
    assert.equal((await attempt("bad")).status, 401);
    assert.equal((await attempt("bad")).status, 401);
    assert.equal((await attempt(ready.password)).status, 429);
  } finally {
    limited.close();
  }
});

test("the job queue only accepts safe, whitelisted regular files back from the worker", () => {
  const jobs = path.join(base, "jobs");
  const queue = new JobQueue(jobs, path.join(base, "records"));
  const job = queue.submit({ kind: "document", name: "a", formats: ["pdf"] }, "a.md", "# A");
  const dir = path.join(jobs, job.id);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "request.json"), "utf-8")).source, "input/documents/a.md");
  assert.equal(readFileSync(path.join(base, "out", "documents", "a.md"), "utf-8"), "# A");
  assert.equal(queue.get(job.id)?.state, "queued");

  const output = path.join(dir, "output");
  mkdirSync(output);
  writeFileSync(path.join(output, "a.pdf"), "good");
  writeFileSync(path.join(output, "evil.py"), "bad type");
  writeFileSync(path.join(output, ".hidden.pdf"), "hidden");
  symlinkSync(secretFile, path.join(output, "stolen.pdf"));
  writeFileSync(path.join(dir, "status.json"), JSON.stringify({ state: "done", files: ["a.pdf", "evil.py", ".hidden.pdf", "stolen.pdf", "../../../escape.pdf", 3], log: "ok" }));

  const done = queue.get(job.id)!;
  assert.equal(done.state, "done");
  assert.deepEqual(done.files, ["documents/a.pdf"]);
  assert.equal(existsSync(path.join(documents, "stolen.pdf")), false);
  assert.equal(existsSync(path.join(documents, "evil.py")), false);
  assert.equal(existsSync(dir), false, "the job folder is removed");
  assert.equal(queue.get("../../secret"), undefined);
});

test("a job whose status is a link or has no usable file fails, and the queue is bounded", () => {
  const jobs = path.join(base, "jobs2");
  const queue = new JobQueue(jobs, path.join(base, "records2"));
  const job = queue.submit({ kind: "animation", name: "s", scene: "S", quality: "low", voice: false }, "s.py", "code");
  symlinkSync(secretFile, path.join(jobs, job.id, "status.json"));
  assert.equal(queue.get(job.id)?.state, "queued", "a link is not read");
  rmSync(path.join(jobs, job.id, "status.json"));
  writeFileSync(path.join(jobs, job.id, "status.json"), JSON.stringify({ state: "done", files: ["nothing.mp4"] }));
  assert.equal(queue.get(job.id)?.state, "failed");

  queue.submit({ kind: "document", name: "a", formats: ["pdf"] }, "a.md", "");
  queue.submit({ kind: "document", name: "b", formats: ["pdf"] }, "b.md", "");
  queue.submit({ kind: "document", name: "c", formats: ["pdf"] }, "c.md", "");
  assert.throws(() => queue.submit({ kind: "document", name: "d", formats: ["pdf"] }, "d.md", ""), /Too many/);
});

test("a high quality video is queued with its narration, and its check succeeds with key frames only", () => {
  const jobs = path.join(base, "jobs4");
  const queue = new JobQueue(jobs, path.join(base, "records4"));
  const request = { kind: "hqvideo" as const, name: "v", audio: false, check: true, quality: "high" as const, subtitles: true };
  const job = queue.submit(request, "v.tsx", "code", [], [{ name: "v.narration.json", content: "[]" }]);
  assert.equal(job.source, "videos/v.tsx");
  const dir = path.join(jobs, job.id);
  assert.equal(readFileSync(path.join(dir, "input", "videos", "v.narration.json"), "utf-8"), "[]", "the worker gets the narration next to the scenes");
  assert.equal(readFileSync(path.join(base, "out", "videos", "v.narration.json"), "utf-8"), "[]");
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "request.json"), "utf-8")), { ...request, source: "input/videos/v.tsx" });

  mkdirSync(path.join(dir, "output"));
  writeFileSync(path.join(dir, "output", "frames.png"), "png");
  writeFileSync(path.join(dir, "status.json"), JSON.stringify({ state: "done", files: [], log: "Video OK: 1 scene, 3.0 s without the voice." }));
  const done = queue.get(job.id)!;
  assert.equal(done.state, "done", "a check gives no video");
  assert.equal(done.frames, true);
  assert.deepEqual(done.files, []);

  const rendered = queue.submit({ ...request, check: false }, "w.tsx", "code");
  mkdirSync(path.join(jobs, rendered.id, "output"));
  writeFileSync(path.join(jobs, rendered.id, "output", "w.mp4"), "video");
  writeFileSync(path.join(jobs, rendered.id, "output", "w.mov"), "other type");
  writeFileSync(path.join(jobs, rendered.id, "status.json"), JSON.stringify({ state: "done", files: ["w.mp4", "w.mov"], log: "" }));
  assert.deepEqual(queue.get(rendered.id)?.files, ["videos/w.mp4"]);
});

test("names cannot leave the output folder and embedded videos are looked up by name only", () => {
  assert.equal(safeBaseName("../../etc/passwd"), "etc-passwd");
  assert.equal(safeBaseName(".env"), "document");
  const queue = new JobQueue(path.join(base, "jobs3"), path.join(base, "records3"));
  const video = path.join(base, "out", "videos", "Scene.mp4");
  writeFileSync(video, "v");
  symlinkSync(secretFile, path.join(base, "out", "videos", "Link.mp4"));
  assert.deepEqual(queue.embeddedVideos("![a](../videos/Scene.mp4) ![b](/etc/../videos/Link.mp4) ![c](../../absent.mp4)"), [video]);
});
